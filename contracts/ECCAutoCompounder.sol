// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

interface IECCStaking {
    /// @notice Compound rewards for `user`, deducting `feeBps` to `feeRecipient`.
    ///         Caller must hold COMPOUNDER_ROLE on ECCStaking.
    function compoundFor(address user, uint256 feeBps, address feeRecipient)
        external returns (uint256 compounded);

    /// @notice Returns pending reward amount for the user (view-only).
    function calculateStakingRewards(address user) external view returns (uint256);

    /// @notice Returns stake details for a user.
    function getStakeInfo(address user) external view returns (
        uint256 amount, uint256 startTime, uint256 pendingRewards, uint8 apyTier, bool canUnstake
    );
}

/**
 * @title ECCAutoCompounder
 * @notice Automatically compounds staking rewards back into staking position.
 *
 * Security & Bug Bounty:
 *   This contract is covered by an active bug bounty program.
 *   Program URL  : https://immunefi.com/bounty/ecocoin/
 *   Scope        : All deployed production contracts listed at the URL above,
 *                  including ECCAutoCompounder, ECCStaking, and ECCToken.
 *   Reward Tiers :
 *     - Critical (funds at risk > $500k) : up to $50,000 USDC
 *     - High     (funds at risk > $50k)  : up to $10,000 USDC
 *     - Medium   (logic errors / DoS)    : up to $2,000  USDC
 *     - Low      (informational)         : up to $500    USDC
 *   Reporters must NOT publicly disclose until a fix is deployed.
 *   Contact: security[at]ecocoin.example.com
 *
 * Features:
 *   - Auto-compound: harvests rewards and re-stakes them
 *   - Keeper-callable compoundAll() for gas efficiency
 *   - Per-user compound tracking
 *   - Compound fee (sent to treasury, max 3%)
 *   - Minimum compound threshold to avoid dust
 *   - Emergency exit
 */
contract ECCAutoCompounder is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant KEEPER_ROLE  = keccak256("KEEPER_ROLE");
    uint256 public constant MAX_FEE      = 300;  // 3% max
    uint256 public constant FEE_BASE     = 10000;
    uint256 public constant MAX_BATCH    = 50;   // B6 fix: cap external calls per tx

    IERC20      public immutable eccToken;
    IECCStaking public immutable staking;

    uint256 public compoundFee        = 100;     // 1% default
    uint256 public minCompoundAmount  = 1e18;    // 1 ECC minimum to trigger compound
    // RT-7: Minimum interval between compounds per user (prevents MEV sandwich / reward draining)
    uint256 public minCompoundInterval = 24 hours;
    address public treasury;

    struct UserInfo {
        uint256 totalCompounded;
        uint256 lastCompoundTime;
        uint256 compoundCount;
    }

    mapping(address => UserInfo) public userInfo;
    address[] public registeredUsers;
    mapping(address => bool) public isRegistered;
    // AC-01 fix: Track each user's index in registeredUsers for O(1) unregister
    mapping(address => uint256) public userIndex;

    // ── Events ─────────────────────────────────────────────────────────────
    event Compounded(address indexed user, uint256 rewardsHarvested, uint256 reStaked, uint256 fee);
    event UserRegistered(address indexed user, uint8 preferredTier);
    event UserUnregistered(address indexed user);
    event CompoundFeeUpdated(uint256 newFee);
    event MinCompoundAmountUpdated(uint256 newMin);
    event MinCompoundIntervalUpdated(uint256 newInterval);
    event TreasuryUpdated(address newTreasury);

    constructor(address _token, address _staking, address _treasury) {
        require(_token    != address(0), "Zero token");
        require(_staking  != address(0), "Zero staking");
        require(_treasury != address(0), "Zero treasury");

        eccToken  = IERC20(_token);
        staking   = IECCStaking(_staking);
        treasury  = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(KEEPER_ROLE, msg.sender);
    }

    // ── User: register for auto-compounding ───────────────────────────────
    function register() external {
        if (!isRegistered[msg.sender]) {
            isRegistered[msg.sender] = true;
            userIndex[msg.sender] = registeredUsers.length;
            registeredUsers.push(msg.sender);
        }
        emit UserRegistered(msg.sender, 0);
    }

    // AC-01 fix: O(1) unregister using userIndex mapping — swap with last and pop
    function unregister() external {
        require(isRegistered[msg.sender], "Not registered");
        isRegistered[msg.sender] = false;

        uint256 idx = userIndex[msg.sender];
        uint256 lastIdx = registeredUsers.length - 1;

        if (idx != lastIdx) {
            address lastUser = registeredUsers[lastIdx];
            registeredUsers[idx] = lastUser;
            userIndex[lastUser] = idx;
        }
        registeredUsers.pop();
        delete userIndex[msg.sender];

        emit UserUnregistered(msg.sender);
    }

    // ── Compound single user ───────────────────────────────────────────────
    // AC-03 fix: Only the user themselves or a KEEPER can compound
    function compound(address user) external nonReentrant whenNotPaused {
        require(isRegistered[user], "Not registered");
        require(msg.sender == user || hasRole(KEEPER_ROLE, msg.sender), "Not authorized");
        _compound(user);
    }

    // ── Keeper: compound a paginated batch of registered users ───────────
    // B6 fix: bounded loop — at most MAX_BATCH external calls per tx.
    // Call repeatedly with increasing startIdx to process the full list.
    function compoundAll(uint256 startIdx, uint256 count)
        external onlyRole(KEEPER_ROLE) whenNotPaused
    {
        uint256 total = registeredUsers.length;
        if (startIdx >= total) return;
        uint256 end = startIdx + count;
        if (end > total)          end = total;
        if (end > startIdx + MAX_BATCH) end = startIdx + MAX_BATCH;  // hard cap

        for (uint256 i = startIdx; i < end; i++) {
            address user = registeredUsers[i];
            if (!isRegistered[user]) continue;
            try this.compoundSafe(user) {} catch {}
        }
    }

    function compoundSafe(address user) external {
        require(msg.sender == address(this), "Internal only");
        _compound(user);
    }

    function _compound(address user) internal {
        // RT-7: Enforce minimum interval between compounds per user
        UserInfo storage ui = userInfo[user];
        if (ui.lastCompoundTime > 0 && block.timestamp < ui.lastCompoundTime + minCompoundInterval) return;

        // Check user has an active stake with pending rewards
        uint256 pending = staking.calculateStakingRewards(user);
        if (pending < minCompoundAmount) return;

        // Delegate compound + fee deduction to ECCStaking.compoundFor()
        // ECCStaking handles: rewards → principal, deducts fee, sends fee to treasury
        // This contract must hold COMPOUNDER_ROLE on ECCStaking
        uint256 compounded = staking.compoundFor(user, compoundFee, treasury);
        if (compounded == 0) return;

        uint256 fee = pending - compounded;

        ui.totalCompounded  += compounded;
        ui.lastCompoundTime  = block.timestamp;
        ui.compoundCount++;

        emit Compounded(user, pending, compounded, fee);
    }

    // ── Admin setters ──────────────────────────────────────────────────────
    function setCompoundFee(uint256 fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(fee <= MAX_FEE, "Exceeds max fee");
        compoundFee = fee;
        emit CompoundFeeUpdated(fee);
    }

    // AC-04 fix: Enforce minimum of 1 ECC to prevent zero/dust compounds
    function setMinCompoundAmount(uint256 min) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(min >= 1e18, "Min 1 ECC");
        minCompoundAmount = min;
        emit MinCompoundAmountUpdated(min);
    }

    function setMinCompoundInterval(uint256 interval) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(interval >= 1 hours, "Min 1 hour");
        minCompoundInterval = interval;
        emit MinCompoundIntervalUpdated(interval);
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0), "Zero address");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Views ──────────────────────────────────────────────────────────────
    function getRegisteredUsers() external view returns (address[] memory) {
        return registeredUsers;
    }

    function getUserInfo(address user) external view returns (UserInfo memory) {
        return userInfo[user];
    }

    function estimateCompoundRewards(address user) external view returns (uint256 total) {
        total = staking.calculateStakingRewards(user);
    }
}
