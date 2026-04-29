// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ECCStaking
 * @notice EcoCoin staking vault — tiered APR (8/10/12%), lock periods (7/30/90 days).
 *
 * Responsibility 2 of 3:
 *   - Users stake ECC to earn passive yield.
 *   - Three tiers: Tier 0 → 8% APR / 7-day lock
 *                  Tier 1 → 10% APR / 30-day lock
 *                  Tier 2 → 12% APR / 90-day lock
 *   - Rewards paid from a pre-funded pool (10 M ECC transferred by ECCToken.initializeContracts()).
 *   - Compound: re-stakes pending rewards to increase principal.
 *   - Emergency withdraw: returns principal, forfeits rewards.
 *
 * Deployment order:
 *   1. Deploy ECCToken
 *   2. Deploy ECCStaking(eccTokenAddress, adminAddress)
 *   3. Deploy ECCFarming(eccTokenAddress, adminAddress)
 *   4. Call ECCToken.initializeContracts(staking, farming)  ← pushes 10 M + 3 M ECC
 *   5. Call ECCStaking.syncPoolBalance()                    ← registers received balance
 */
contract ECCStaking is ReentrancyGuard, Pausable, AccessControl {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    // ROLES & CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    bytes32 public constant ADMIN_ROLE      = keccak256("ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE     = keccak256("PAUSER_ROLE");
    bytes32 public constant COMPOUNDER_ROLE = keccak256("COMPOUNDER_ROLE");

    uint256 public constant MIN_STAKE_AMOUNT   = 100         * 10 ** 18;
    uint256 public constant MAX_STAKE_AMOUNT   = 10_000_000  * 10 ** 18;
    uint256 public constant MAX_TOTAL_STAKED   = 100_000_000 * 10 ** 18;

    uint8   public constant MIN_STAKING_APR    = 8;
    uint8   public constant MAX_STAKING_APR    = 12;
    uint256 public constant SECONDS_PER_YEAR   = 365 days;

    uint256 public constant MIN_STAKE_DURATION = 7  days;  // Tier 0 — 8% APR
    uint256 public constant TIER_1_LOCK        = 30 days;  // Tier 1 — 10% APR
    uint256 public constant TIER_2_LOCK        = 90 days;  // Tier 2 — 12% APR

    uint256 private constant PRECISION       = 1e18;
    uint256 private constant PERCENTAGE_BASE = 100;

    // ═══════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct StakeInfo {
        uint256 amount;
        uint256 startTime;
        uint256 lastRewardTime;
        uint256 accumulatedRewards;
        uint8   apyTier;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════

    IERC20 public immutable eccToken;

    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;
    uint256 public stakingPoolBalance;
    uint256 public totalStakingRewardsPaid;
    bool    public poolSynced;

    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event Staked(address indexed user, uint256 amount, uint8 apyTier, uint256 timestamp);
    event Unstaked(address indexed user, uint256 amount, uint256 rewards, uint256 timestamp);
    event RewardsClaimed(address indexed user, uint256 amount);
    event Compounded(address indexed user, uint256 amount);
    event CompoundedFor(address indexed user, uint256 compounded, uint256 fee, address indexed compounder);
    event EmergencyWithdraw(address indexed user, uint256 amount);
    event StakingPoolFunded(uint256 amount, uint256 newBalance);
    event PoolBalanceSynced(uint256 newBalance);

    // ═══════════════════════════════════════════════════════════════════════
    // CUSTOM ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidAddress();
    error BelowMinimumStake();
    error ExceedsMaximumStake();
    error StakingPoolFull();
    error InsufficientStakingPool();
    error MinimumStakeDurationNotMet();
    error NoStakeFound();
    error InvalidAPYTier();
    error SlippageExceeded(uint256 expected, uint256 actual);

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @param _admin Should be a multisig (e.g. Gnosis Safe) to mitigate
     *               centralization risk — a single admin can pause the contract
     *               and trap rewards.
     */
    constructor(address _eccToken, address _admin) {
        if (_eccToken == address(0)) revert InvalidAddress();
        if (_admin    == address(0)) revert InvalidAddress();
        eccToken = IERC20(_eccToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE,         _admin);
        _grantRole(PAUSER_ROLE,        _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STAKING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Stake ECC to earn APR rewards.
     * @param amount   Amount of ECC to stake (must be approved first).
     * @param apyTier  0 → 8% / 7d,  1 → 10% / 30d,  2 → 12% / 90d
     */
    function stake(uint256 amount, uint8 apyTier) external nonReentrant whenNotPaused {
        if (amount < MIN_STAKE_AMOUNT) revert BelowMinimumStake();
        if (amount > MAX_STAKE_AMOUNT) revert ExceedsMaximumStake();
        if (totalStaked + amount > MAX_TOTAL_STAKED) revert StakingPoolFull();
        if (apyTier > 2) revert InvalidAPYTier();

        StakeInfo storage s = stakes[msg.sender];
        require(s.amount == 0, "Active stake exists");

        // Balance-before/after pattern: detect actual tokens received
        // (handles fee-on-transfer tokens if contract is not fee-exempt)
        uint256 balBefore = eccToken.balanceOf(address(this));
        eccToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = eccToken.balanceOf(address(this)) - balBefore;

        s.amount         = received;
        s.startTime      = block.timestamp;
        s.lastRewardTime = block.timestamp;
        s.apyTier        = apyTier;
        totalStaked += received;

        emit Staked(msg.sender, received, apyTier, block.timestamp);
    }

    /**
     * @notice Unstake principal + rewards after lock period.
     * @param minRewards Slippage guard — revert if rewards fall below this.
     */
    function unstake(uint256 minRewards) external nonReentrant whenNotPaused {
        StakeInfo storage s = stakes[msg.sender];
        if (s.amount == 0) revert NoStakeFound();
        if (block.timestamp < s.startTime + _lockPeriod(s.apyTier))
            revert MinimumStakeDurationNotMet();

        uint256 rewards = _calculateStakingRewards(msg.sender);
        // S-1 fix: Cap rewards to available pool balance instead of reverting,
        // so late claimers still get their principal back
        if (rewards > stakingPoolBalance) rewards = stakingPoolBalance;
        if (rewards < minRewards) revert SlippageExceeded(minRewards, rewards);

        uint256 principal = s.amount;
        totalStaked          -= principal;
        stakingPoolBalance   -= rewards;
        totalStakingRewardsPaid += rewards;

        // Clear all stake metadata to prevent stale state (MEDIUM #1)
        delete stakes[msg.sender];

        eccToken.safeTransfer(msg.sender, principal + rewards);
        emit Unstaked(msg.sender, principal, rewards, block.timestamp);
    }

    /**
     * @notice Claim accrued rewards without unstaking principal.
     * @param minRewards Slippage guard.
     */
    function claimStakingRewards(uint256 minRewards) external nonReentrant whenNotPaused {
        uint256 rewards = _claimStakingRewards(msg.sender);
        if (rewards < minRewards) revert SlippageExceeded(minRewards, rewards);
        emit RewardsClaimed(msg.sender, rewards);
    }

    /**
     * @notice Re-stake pending rewards, increasing principal without new transfer.
     */
    function compoundStakingRewards() external nonReentrant whenNotPaused {
        StakeInfo storage s = stakes[msg.sender];
        if (s.amount == 0) revert NoStakeFound();

        uint256 rewards = _calculateStakingRewards(msg.sender);
        require(rewards > 0, "No rewards to compound");
        if (stakingPoolBalance < rewards) revert InsufficientStakingPool();
        require(s.amount + rewards <= MAX_STAKE_AMOUNT, "Exceeds max stake");
        require(totalStaked + rewards <= MAX_TOTAL_STAKED, "Exceeds max total");

        s.amount             += rewards;
        s.lastRewardTime      = block.timestamp;
        s.accumulatedRewards += rewards;
        totalStaked          += rewards;
        stakingPoolBalance   -= rewards;
        totalStakingRewardsPaid += rewards;

        emit Compounded(msg.sender, rewards);
    }

    /**
     * @notice Compound rewards for any user. Only callable by COMPOUNDER_ROLE (ECCAutoCompounder).
     * @param user           Address of the staker to compound for.
     * @param feeBps         Compound fee in basis points (sent from reward pool to feeRecipient).
     * @param feeRecipient   Address that receives the compound fee (treasury).
     * @return compounded    Amount of rewards added to user's principal.
     */
    function compoundFor(address user, uint256 feeBps, address feeRecipient)
        external onlyRole(COMPOUNDER_ROLE) nonReentrant whenNotPaused
        returns (uint256 compounded)
    {
        require(feeBps <= 300, "Fee > 3%");          // mirror ECCAutoCompounder MAX_FEE
        require(feeRecipient != address(0) || feeBps == 0, "Zero fee recipient");

        StakeInfo storage s = stakes[user];
        if (s.amount == 0) revert NoStakeFound();

        uint256 rewards = _calculateStakingRewards(user);
        require(rewards > 0, "No rewards to compound");
        if (stakingPoolBalance < rewards) revert InsufficientStakingPool();

        uint256 fee = (rewards * feeBps) / 10000;
        compounded  = rewards - fee;

        require(s.amount + compounded <= MAX_STAKE_AMOUNT, "Exceeds max stake");
        require(totalStaked + compounded <= MAX_TOTAL_STAKED, "Exceeds max total");

        s.amount             += compounded;
        s.lastRewardTime      = block.timestamp;
        s.accumulatedRewards += rewards;
        totalStaked          += compounded;
        stakingPoolBalance   -= rewards;
        totalStakingRewardsPaid += rewards;

        if (fee > 0) {
            eccToken.safeTransfer(feeRecipient, fee);
        }

        emit CompoundedFor(user, compounded, fee, msg.sender);
    }

    /**
     * @notice Emergency withdraw — returns only principal, forfeits all rewards.
     */
    function emergencyWithdrawStake() external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        if (s.amount == 0) revert NoStakeFound();

        uint256 amount = s.amount;
        totalStaked   -= amount;

        // Clear all stake metadata to prevent stale state (MEDIUM #1)
        delete stakes[msg.sender];

        eccToken.safeTransfer(msg.sender, amount);
        emit EmergencyWithdraw(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Top up the staking reward pool (admin-to-admin funding).
     * @dev For initial setup, call syncPoolBalance() after ECCToken.initializeContracts().
     */
    // NEW-4: Balance-diff pattern — safe if ECCToken transfer fees are ever enabled
    function fundStakingPool(uint256 amount) external onlyRole(ADMIN_ROLE) {
        require(amount > 0, "Zero amount");
        uint256 balBefore = eccToken.balanceOf(address(this));
        eccToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actual = eccToken.balanceOf(address(this)) - balBefore;
        stakingPoolBalance += actual;
        emit StakingPoolFunded(actual, stakingPoolBalance);
    }

    /**
     * @notice Register the ECC balance received from ECCToken.initializeContracts().
     * @dev Call once immediately after initializeContracts(). Can only be called once.
     */
    function syncPoolBalance() external onlyRole(ADMIN_ROLE) {
        require(!poolSynced, "Already synced");
        // Available rewards = total ECC held minus the principals being staked
        stakingPoolBalance = eccToken.balanceOf(address(this)) - totalStaked;
        poolSynced = true;
        emit PoolBalanceSynced(stakingPoolBalance);
    }

    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function calculateStakingRewards(address user) external view returns (uint256) {
        return _calculateStakingRewards(user);
    }

    function getStakeInfo(address user) external view returns (
        uint256 amount,
        uint256 startTime,
        uint256 pendingRewards,
        uint8   apyTier,
        bool    canUnstake
    ) {
        StakeInfo memory s  = stakes[user];
        uint256 rewards     = _calculateStakingRewards(user);
        bool    unlocked    = block.timestamp >= s.startTime + _lockPeriod(s.apyTier);
        return (s.amount, s.startTime, rewards, s.apyTier, unlocked);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    function _lockPeriod(uint8 apyTier) internal pure returns (uint256) {
        if (apyTier == 1) return TIER_1_LOCK;
        if (apyTier == 2) return TIER_2_LOCK;
        return MIN_STAKE_DURATION;
    }

    /**
     * @dev Design choice (MEDIUM #7): rewards are claimable during the lock period.
     *      Only the principal is locked — users can harvest yield at any time.
     *      This is intentional to incentivize staking without trapping earned rewards.
     */
    function _claimStakingRewards(address user) private returns (uint256) {
        StakeInfo storage s = stakes[user];
        if (s.amount == 0) return 0;

        uint256 rewards = _calculateStakingRewards(user);
        if (rewards == 0) return 0;
        if (stakingPoolBalance < rewards) revert InsufficientStakingPool();

        s.lastRewardTime     = block.timestamp;
        s.accumulatedRewards += rewards;
        stakingPoolBalance   -= rewards;
        totalStakingRewardsPaid += rewards;

        eccToken.safeTransfer(user, rewards);
        return rewards;
    }

    function _calculateStakingRewards(address user) private view returns (uint256) {
        StakeInfo storage s = stakes[user];
        if (s.amount == 0) return 0;

        uint256 timeStaked = block.timestamp - s.lastRewardTime;
        if (timeStaked == 0) return 0;

        uint256 apr;
        if      (s.apyTier == 0) apr = 8;
        else if (s.apyTier == 1) apr = 10;
        else                     apr = 12;

        // Simple interest (APR, not APY). PRECISION multiply/divide removed — it was a no-op.
        uint256 rewards = (s.amount * apr * timeStaked)
                        / (PERCENTAGE_BASE * SECONDS_PER_YEAR);
        return rewards;
    }
}
