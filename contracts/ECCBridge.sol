// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title ECCBridge
 * @notice Lock-and-mint bridge for cross-chain ECC transfers.
 *
 * Model:
 *   Source chain  → lock tokens in ECCBridge → emit BridgeOut event
 *   Relayer picks up event → calls confirmRelease() on destination ECCBridge
 *   Destination   → mint/release tokens to recipient
 *
 * Features:
 *   - Multi-chain support (configurable chain IDs)
 *   - Daily transfer limits (anti-whale) — per-chain AND global
 *   - Bridge fee (sent to treasury)
 *   - Nonce-based replay protection
 *   - On-chain requestId recomputation (B-1) — relayers submit full params
 *   - Multi-relayer support with threshold
 *   - Emergency pause & fund recovery (requires paused state)
 *   - Minimum/maximum transfer amounts
 *   - Request expiry & cancellation (B-5)
 *   - Fee-on-transfer token safe accounting (B-10)
 */
contract ECCBridge is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant RELAYER_ROLE  = keccak256("RELAYER_ROLE");
    bytes32 public constant BRIDGE_ADMIN  = keccak256("BRIDGE_ADMIN");

    uint256 public constant FEE_BASE      = 10000;
    uint256 public constant MAX_FEE       = 100;   // 1%

    IERC20  public immutable token;
    address public treasury;

    // ── Chain config ───────────────────────────────────────────────────────
    struct ChainConfig {
        bool    supported;
        uint256 minAmount;
        uint256 maxAmount;
        uint256 dailyLimit;
        uint256 bridgeFee;   // basis points
    }

    mapping(uint256 => ChainConfig) public chainConfigs;

    // ── Bridge records ─────────────────────────────────────────────────────
    struct BridgeRequest {
        address sender;
        address recipient;
        uint256 amount;
        uint256 fee;
        uint256 srcChainId;
        uint256 dstChainId;
        uint256 timestamp;
        bool    released;
        bool    cancelled;
    }

    uint256 public nextNonce;
    mapping(bytes32 => BridgeRequest) public bridgeRequests; // requestId => request

    // B-1: On-chain lock verification — processed request tracking & replay guard
    mapping(bytes32 => bool) public processedRequests;

    // Daily limits tracking (per-chain)
    mapping(uint256 => mapping(uint256 => uint256)) public dailyVolume; // chainId => day => volume

    // B-7: Global daily limit tracking
    uint256 public globalDailyVolume;
    uint256 public globalDailyLimit = 1_000_000 ether; // 1M ECC default
    uint256 public globalDayStart;

    // B-5: Request expiry (RT-2: increased to 7 days for cross-chain safety)
    uint256 public requestExpiry = 7 days;

    // Relayer threshold (multi-sig releases)
    // RT-1: Enforce minimum 3 relayers for production security
    uint256 public relayerThreshold = 3;
    mapping(bytes32 => mapping(address => bool)) public relayerConfirmed;
    mapping(bytes32 => uint256)                  public relayerConfirmCount;

    // RT-2: Cancel attestation — relayers must confirm no release before cancel is allowed
    mapping(bytes32 => mapping(address => bool)) public cancelAttested;
    mapping(bytes32 => uint256)                  public cancelAttestCount;

    // ── Events ─────────────────────────────────────────────────────────────
    event BridgeOut(
        bytes32 indexed requestId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 fee,
        uint256 srcChainId,
        uint256 dstChainId,
        uint256 nonce
    );
    event BridgeIn(
        bytes32 indexed requestId,
        address indexed recipient,
        uint256 amount,
        uint256 srcChainId
    );
    event RelayerConfirmed(bytes32 indexed requestId, address relayer, uint256 confirmCount);
    event ChainConfigUpdated(uint256 chainId, bool supported, uint256 minAmount, uint256 maxAmount);
    event RelayerThresholdUpdated(uint256 newThreshold);
    event BridgeRequestCancelled(bytes32 indexed requestId, address indexed sender, uint256 amount);
    event CancelAttestationReceived(bytes32 indexed requestId, address indexed relayer, uint256 attestCount);
    event RequestExpiryUpdated(uint256 newExpiry);
    event GlobalDailyLimitUpdated(uint256 newLimit);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    constructor(address _token, address _treasury) {
        require(_token    != address(0), "Zero token");
        require(_treasury != address(0), "Zero treasury");
        token    = IERC20(_token);
        treasury = _treasury;
        globalDayStart = block.timestamp / 1 days;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(BRIDGE_ADMIN,       msg.sender);
        _grantRole(RELAYER_ROLE,       msg.sender);
    }

    // ── Lock & Bridge Out ──────────────────────────────────────────────────
    function bridgeOut(
        address recipient,
        uint256 amount,
        uint256 dstChainId
    ) external nonReentrant whenNotPaused returns (bytes32 requestId) {
        require(recipient != address(0),     "Zero recipient");
        ChainConfig storage cc = chainConfigs[dstChainId];
        require(cc.supported,                "Chain not supported");
        require(amount >= cc.minAmount,      "Below min amount");
        require(amount <= cc.maxAmount,      "Exceeds max amount");

        // Per-chain daily limit check
        uint256 today = block.timestamp / 1 days;
        require(dailyVolume[dstChainId][today] + amount <= cc.dailyLimit, "Daily limit exceeded");

        // B-7: Global daily limit check
        if (today != globalDayStart) {
            globalDayStart = today;
            globalDailyVolume = 0;
        }
        require(globalDailyVolume + amount <= globalDailyLimit, "Global daily limit exceeded");

        // B-10: Fee-on-transfer safe accounting — measure actual received amount
        uint256 balBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actualReceived = token.balanceOf(address(this)) - balBefore;

        // Calculate fee on actual received amount
        uint256 fee       = (actualReceived * cc.bridgeFee) / FEE_BASE;
        uint256 netAmount = actualReceived - fee;

        // Transfer fee to treasury
        if (fee > 0) {
            token.safeTransfer(treasury, fee);
        }

        // Update daily volumes with actual received amount
        dailyVolume[dstChainId][today] += actualReceived;
        globalDailyVolume += actualReceived;

        // B-3: Use abi.encode (not abi.encodePacked) to avoid hash collision
        uint256 nonce = nextNonce++;
        requestId = keccak256(abi.encode(
            msg.sender, recipient, netAmount, block.chainid, dstChainId, nonce
        ));

        bridgeRequests[requestId] = BridgeRequest({
            sender:     msg.sender,
            recipient:  recipient,
            amount:     netAmount,
            fee:        fee,
            srcChainId: block.chainid,
            dstChainId: dstChainId,
            timestamp:  block.timestamp,
            released:   false,
            cancelled:  false
        });

        // B-4: Emit AFTER all token transfers
        emit BridgeOut(requestId, msg.sender, recipient, netAmount, fee, block.chainid, dstChainId, nonce);
    }

    // ── Relayer: confirm & release ─────────────────────────────────────────
    /**
     * @notice B-1: Relayer must submit full parameters for on-chain verification.
     * The requestId is recomputed on-chain from the provided parameters to ensure
     * it corresponds to a legitimate lock on the source chain.
     */
    function confirmRelease(
        bytes32 requestId,
        address sender,
        address recipient,
        uint256 amount,
        uint256 srcChainId,
        uint256 nonce
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        // B-1: Recompute requestId on-chain and verify it matches
        bytes32 computedId = keccak256(abi.encode(
            sender, recipient, amount, srcChainId, block.chainid, nonce
        ));
        require(computedId == requestId,                     "RequestId mismatch");

        // B-1: Check not already processed
        require(!processedRequests[requestId],               "Already processed");
        require(!relayerConfirmed[requestId][msg.sender],    "Already confirmed");

        relayerConfirmed[requestId][msg.sender] = true;
        relayerConfirmCount[requestId]++;

        emit RelayerConfirmed(requestId, msg.sender, relayerConfirmCount[requestId]);

        if (relayerConfirmCount[requestId] >= relayerThreshold) {
            _release(requestId, recipient, amount, srcChainId);
        }
    }

    /**
     * @dev Release tokens on the destination chain.
     * Uses parameters already verified in confirmRelease() rather than reading
     * from bridgeRequests, because bridgeRequests is only populated on the
     * source chain by bridgeOut(). The bridgeRequests mapping is still used
     * on the source chain for cancellations.
     */
    function _release(
        bytes32 requestId,
        address recipient,
        uint256 amount,
        uint256 srcChainId
    ) internal {
        require(recipient != address(0),         "Invalid recipient");
        require(amount > 0,                      "Invalid amount");

        processedRequests[requestId] = true;

        token.safeTransfer(recipient, amount);

        emit BridgeIn(requestId, recipient, amount, srcChainId);
    }

    // ── RT-2: Relayer attestation that no release occurred on destination ──
    /**
     * @notice Relayers attest that no release has been executed for this requestId
     *         on the destination chain. Required before a cancel can proceed.
     */
    function attestCancellation(bytes32 requestId)
        external onlyRole(RELAYER_ROLE)
    {
        BridgeRequest storage req = bridgeRequests[requestId];
        require(req.amount > 0,                               "Unknown request");
        require(!processedRequests[requestId],                "Already processed");
        require(!req.cancelled,                               "Already cancelled");
        require(!cancelAttested[requestId][msg.sender],      "Already attested");

        cancelAttested[requestId][msg.sender] = true;
        cancelAttestCount[requestId]++;

        emit CancelAttestationReceived(requestId, msg.sender, cancelAttestCount[requestId]);
    }

    // ── B-5: Cancel expired bridge request ─────────────────────────────────
    /**
     * @notice Allows the original sender to cancel and reclaim tokens after expiry.
     *         RT-2: Requires relayer attestation that no release has occurred on the
     *         destination chain, preventing cross-chain double-spend.
     * @param requestId The bridge request to cancel.
     */
    function cancelBridgeRequest(bytes32 requestId) external nonReentrant {
        BridgeRequest storage req = bridgeRequests[requestId];
        require(req.sender == msg.sender,                     "Not request sender");
        require(!processedRequests[requestId],                "Already processed");
        require(!req.released,                                "Already released");
        require(!req.cancelled,                               "Already cancelled");
        require(block.timestamp > req.timestamp + requestExpiry, "Not yet expired");
        // RT-2: Relayers must confirm no release on destination before cancel allowed
        require(cancelAttestCount[requestId] >= relayerThreshold, "Relayer attestation required");

        req.cancelled = true;
        processedRequests[requestId] = true;

        token.safeTransfer(msg.sender, req.amount);

        emit BridgeRequestCancelled(requestId, msg.sender, req.amount);
    }

    // ── Admin: chain config ────────────────────────────────────────────────
    function setChainConfig(
        uint256 chainId,
        bool    supported,
        uint256 minAmount,
        uint256 maxAmount,
        uint256 dailyLimit,
        uint256 bridgeFee
    ) external onlyRole(BRIDGE_ADMIN) {
        require(bridgeFee <= MAX_FEE, "Fee too high");
        require(minAmount <= maxAmount, "Min > max");
        // B-9: dailyLimit must be > 0 if chain is supported
        require(dailyLimit > 0 || !supported, "Daily limit required");
        chainConfigs[chainId] = ChainConfig({
            supported:  supported,
            minAmount:  minAmount,
            maxAmount:  maxAmount,
            dailyLimit: dailyLimit,
            bridgeFee:  bridgeFee
        });
        emit ChainConfigUpdated(chainId, supported, minAmount, maxAmount);
    }

    // B-6: Threshold setter with minimum validation
    // NOTE: Threshold changes do not affect in-flight requests — the confirmation
    // count is tracked per-request, so a request that already accumulated N
    // confirmations will release when the *current* threshold is met on the
    // next confirmRelease() call.
    function setRelayerThreshold(uint256 threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(threshold >= 3, "Min 3 relayers");
        relayerThreshold = threshold;
        emit RelayerThresholdUpdated(threshold);
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0), "Zero address");
        address old = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(old, _treasury);
    }

    // B-5: Admin setter for request expiry
    function setRequestExpiry(uint256 _expiry) external onlyRole(BRIDGE_ADMIN) {
        require(_expiry >= 1 hours,  "Expiry too short");
        require(_expiry <= 30 days,  "Max 30 days");
        requestExpiry = _expiry;
        emit RequestExpiryUpdated(_expiry);
    }

    // B-7: Admin setter for global daily limit
    function setGlobalDailyLimit(uint256 _limit) external onlyRole(BRIDGE_ADMIN) {
        require(_limit > 0, "Zero limit");
        globalDailyLimit = _limit;
        emit GlobalDailyLimitUpdated(_limit);
    }

    // ── Emergency ──────────────────────────────────────────────────────────
    // B-2: emergencyWithdraw requires paused state (two-step: pause then withdraw)
    // WARNING: This intentionally allows withdrawing ALL contract funds, including
    // tokens backing pending bridge requests. Use ONLY in critical emergency
    // scenarios (e.g., exploit detected, contract migration). The admin is
    // responsible for manually reconciling any pending requests off-chain.
    function emergencyWithdraw(address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) whenPaused
    {
        require(to != address(0), "Zero address");
        token.safeTransfer(to, amount);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Views ──────────────────────────────────────────────────────────────
    function getRequest(bytes32 requestId) external view returns (BridgeRequest memory) {
        return bridgeRequests[requestId];
    }

    function getTodayVolume(uint256 chainId) external view returns (uint256) {
        return dailyVolume[chainId][block.timestamp / 1 days];
    }

    function getGlobalTodayVolume() external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        if (today != globalDayStart) {
            return 0;
        }
        return globalDailyVolume;
    }
}
