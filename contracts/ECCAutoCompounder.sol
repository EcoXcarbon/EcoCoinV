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
    address public treasury;

    struct UserInfo {
        uint256 totalCompounded;
        uint256 lastCompoundTime;
        uint256 compoundCount;
    }

    mapping(address => UserInfo) public userInfo;
    address[] public registeredUsers;
    mapping(address => bool) public isRegistered;

    // ── Events ─────────────────────────────────────────────────────────────
    event Compounded(address indexed user, uint256 rewardsHarvested, uint256 reStaked, uint256 fee);
    event UserRegistered(address indexed user, uint8 preferredTier);
    event UserUnregistered(address indexed user);
    event CompoundFeeUpdated(uint256 newFee);
    event MinCompoundAmountUpdated(uint256 newMin);
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
            registeredUsers.push(msg.sender);
        }
        emit UserRegistered(msg.sender, 0);
    }

    function unregister() external {
        isRegistered[msg.sender] = false;
        emit UserUnregistered(msg.sender);
    }

    // ── Compound single user ───────────────────────────────────────────────
    function compound(address user) external nonReentrant whenNotPaused {
        require(isRegistered[user], "Not registered");
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
        // Check user has an active stake with pending rewards
        uint256 pending = staking.calculateStakingRewards(user);
        if (pending < minCompoundAmount) return;

        // Delegate compound + fee deduction to ECCStaking.compoundFor()
        // ECCStaking handles: rewards → principal, deducts fee, sends fee to treasury
        // This contract must hold COMPOUNDER_ROLE on ECCStaking
        uint256 compounded = staking.compoundFor(user, compoundFee, treasury);
        if (compounded == 0) return;

        uint256 fee = pending - compounded;

        UserInfo storage ui = userInfo[user];
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

    function setMinCompoundAmount(uint256 min) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minCompoundAmount = min;
        emit MinCompoundAmountUpdated(min);
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
