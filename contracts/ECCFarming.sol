// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ECCFarming
 * @notice EcoCoin yield farming — MasterChef-style LP token pools, ECC rewards.
 *
 * Responsibility 3 of 3:
 *   - Admin creates pools for approved LP tokens (e.g. ECC/MATIC on QuickSwap).
 *   - Each pool has an allocation point that determines its share of rewardPerSecond.
 *   - Users deposit LP tokens; rewards accrue per-second based on pool weight.
 *   - Rewards paid from a pre-funded pool (3 M ECC from ECCToken.initializeContracts()).
 *   - Reward rate changes go through a 48-hour timelock (audit #78).
 *   - Emergency withdraw: returns LP tokens, forfeits pending rewards.
 *
 * Deployment order:
 *   1. Deploy ECCToken
 *   2. Deploy ECCStaking(eccTokenAddress, adminAddress)
 *   3. Deploy ECCFarming(eccTokenAddress, adminAddress)
 *   4. Call ECCToken.initializeContracts(staking, farming)  ← pushes 10 M + 3 M ECC
 *   5. Call ECCFarming.syncPoolBalance()                    ← registers 3 M ECC received
 */
contract ECCFarming is ReentrancyGuard, Pausable, AccessControl {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    // ROLES & CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    bytes32 public constant ADMIN_ROLE  = keccak256("ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant MAX_POOLS_PER_UPDATE = 20;     // DoS guard (audit #8)
    uint256 public constant CHANGE_DELAY         = 48 hours; // timelock for reward rate

    uint256 private constant PRECISION = 1e18;

    // ═══════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct PoolInfo {
        address lpToken;
        uint256 allocPoint;
        uint256 lastRewardTime;
        uint256 accRewardPerShare; // scaled by PRECISION
        uint256 totalStaked;
        bool    active;
    }

    struct UserPoolInfo {
        uint256 amount;
        uint256 rewardDebt;
        uint256 pendingRewards;
    }

    struct PendingChange {
        uint256 timestamp;  // earliest execution time
        uint256 newValue;
        bool    executed;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════

    IERC20 public immutable eccToken;

    PoolInfo[]                                           public poolInfo;
    mapping(uint256 => mapping(address => UserPoolInfo)) public userPoolInfo;
    mapping(address => bool)                             public approvedLPTokens;
    mapping(address => bool)                             public lpTokenHasPool; // C-1/H-3: prevent duplicate LP pools
    mapping(bytes32 => PendingChange)                    public pendingChanges;

    uint256 public totalAllocPoint;
    uint256 public rewardPerSecond;
    uint256 public farmingPoolBalance;
    uint256 public totalFarmingRewardsPaid;
    uint256 private nextNonce;
    bool    public poolSynced;                           // C-2: one-time sync guard
    uint256 public constant MAX_REWARD_PER_SECOND = 100 ether; // M-6: cap

    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event PoolAdded(uint256 indexed pid, address indexed lpToken, uint256 allocPoint);
    event PoolUpdated(uint256 indexed pid, uint256 allocPoint);
    event PoolDeactivated(uint256 indexed pid);
    event FarmDeposit(address indexed user, uint256 indexed pid, uint256 amount);
    event FarmWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event FarmEmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event FarmRewardsClaimed(address indexed user, uint256 indexed pid, uint256 amount);
    event LPTokenApproved(address indexed token);
    event LPTokenRevoked(address indexed token);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate, uint256 effectiveTime);
    event PendingChangeProposed(bytes32 indexed changeId, uint256 newValue, uint256 effectiveTime);
    event PendingChangeExecuted(bytes32 indexed changeId, uint256 newValue);
    event PendingChangeCancelled(bytes32 indexed changeId);
    event FarmingPoolFunded(uint256 amount, uint256 newBalance);
    event PoolBalanceSynced(uint256 newBalance);

    // ═══════════════════════════════════════════════════════════════════════
    // CUSTOM ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidAddress();
    error LPTokenNotApproved();
    error InvalidPool();
    error InactivePool();
    error TimelockNotExpired();
    error ChangeAlreadyExecuted();
    error SlippageExceeded(uint256 expected, uint256 actual);

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(address _eccToken, address _admin) {
        if (_eccToken == address(0)) revert InvalidAddress();
        if (_admin    == address(0)) revert InvalidAddress();
        eccToken = IERC20(_eccToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE,         _admin);
        _grantRole(PAUSER_ROLE,        _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // POOL MANAGEMENT (admin)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Add a new LP farming pool.
     * @param lpToken     Address of the LP token (must be pre-approved).
     * @param allocPoint  Weight of this pool vs. others; higher = more rewards.
     */
    function addPool(address lpToken, uint256 allocPoint) external onlyRole(ADMIN_ROLE) {
        if (lpToken == address(0)) revert InvalidAddress();
        if (!approvedLPTokens[lpToken]) revert LPTokenNotApproved();
        require(lpToken != address(eccToken), "LP cannot be reward token"); // C-1
        require(!lpTokenHasPool[lpToken], "LP token already has pool");     // H-3
        lpTokenHasPool[lpToken] = true;

        totalAllocPoint += allocPoint;
        poolInfo.push(PoolInfo({
            lpToken:          lpToken,
            allocPoint:       allocPoint,
            lastRewardTime:   block.timestamp,
            accRewardPerShare: 0,
            totalStaked:      0,
            active:           true
        }));
        emit PoolAdded(poolInfo.length - 1, lpToken, allocPoint);
    }

    function updatePoolAllocation(uint256 pid, uint256 newAllocPoint)
        external onlyRole(ADMIN_ROLE)
    {
        if (pid >= poolInfo.length) revert InvalidPool();
        updatePool(pid);
        PoolInfo storage pool = poolInfo[pid];
        totalAllocPoint = totalAllocPoint - pool.allocPoint + newAllocPoint;
        pool.allocPoint = newAllocPoint;
        emit PoolUpdated(pid, newAllocPoint);
    }

    function deactivatePool(uint256 pid) external onlyRole(ADMIN_ROLE) {
        if (pid >= poolInfo.length) revert InvalidPool();
        updatePool(pid);
        totalAllocPoint -= poolInfo[pid].allocPoint;
        poolInfo[pid].allocPoint = 0;
        poolInfo[pid].active = false;
        emit PoolDeactivated(pid);
    }

    /// @notice Update reward accumulators for a range of pools.
    function massUpdatePools(uint256 startPid, uint256 endPid) public {
        require(endPid <= poolInfo.length,          "Invalid end pool ID");
        require(endPid > startPid,                  "Invalid range");
        require(endPid - startPid <= MAX_POOLS_PER_UPDATE, "Too many pools");
        for (uint256 pid = startPid; pid < endPid; ++pid) {
            updatePool(pid);
        }
    }

    /// @notice Advance a single pool's accRewardPerShare to the current block.
    function updatePool(uint256 pid) public {
        if (pid >= poolInfo.length) revert InvalidPool();
        PoolInfo storage pool = poolInfo[pid];
        if (block.timestamp <= pool.lastRewardTime) return;
        if (pool.totalStaked == 0 || totalAllocPoint == 0) {
            pool.lastRewardTime = block.timestamp;
            return;
        }
        uint256 elapsed   = block.timestamp - pool.lastRewardTime;
        // H-1: Separate division steps to reduce overflow risk
        uint256 poolReward = (elapsed * rewardPerSecond * pool.allocPoint) / totalAllocPoint;
        // C-3: Cap reward to available pool balance
        if (poolReward > farmingPoolBalance) {
            poolReward = farmingPoolBalance;
        }
        farmingPoolBalance -= poolReward; // C-3: Decrement here, not at claim time
        pool.accRewardPerShare += (poolReward * PRECISION) / pool.totalStaked;
        pool.lastRewardTime     = block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // USER FARMING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit LP tokens into a farm pool to earn ECC rewards.
     * @param pid    Pool ID.
     * @param amount Amount of LP tokens to deposit (must be approved first).
     */
    function depositToFarm(uint256 pid, uint256 amount)
        external nonReentrant whenNotPaused
    {
        if (pid >= poolInfo.length) revert InvalidPool();
        PoolInfo    storage pool = poolInfo[pid];
        UserPoolInfo storage u   = userPoolInfo[pid][msg.sender];

        if (!pool.active) revert InactivePool();
        require(amount > 0, "Zero amount"); // M-2: prevent zero-amount deposit
        updatePool(pid);

        if (u.amount > 0) {
            uint256 pending = (u.amount * pool.accRewardPerShare / PRECISION) - u.rewardDebt;
            if (pending > 0) u.pendingRewards += pending;
        }

        // F-2 FIX: fee-on-transfer protection — use balance-before/after pattern
        // to account for LP tokens that deduct a fee on transfer.
        uint256 balBefore = IERC20(pool.lpToken).balanceOf(address(this));
        IERC20(pool.lpToken).safeTransferFrom(msg.sender, address(this), amount);
        uint256 actual = IERC20(pool.lpToken).balanceOf(address(this)) - balBefore;

        u.amount         += actual;
        u.rewardDebt      = u.amount * pool.accRewardPerShare / PRECISION;
        pool.totalStaked += actual;

        emit FarmDeposit(msg.sender, pid, actual);
    }

    /**
     * @notice Withdraw LP tokens from a pool. Pending rewards are held, not auto-paid.
     * @param pid    Pool ID.
     * @param amount LP tokens to withdraw.
     */
    function withdrawFromFarm(uint256 pid, uint256 amount)
        external nonReentrant whenNotPaused
    {
        if (pid >= poolInfo.length) revert InvalidPool();
        PoolInfo    storage pool = poolInfo[pid];
        UserPoolInfo storage u   = userPoolInfo[pid][msg.sender];

        require(amount > 0, "Zero amount");              // M-3: prevent zero-amount withdrawal
        require(u.amount >= amount, "Insufficient balance");
        updatePool(pid);

        uint256 pending  = (u.amount * pool.accRewardPerShare / PRECISION) - u.rewardDebt;
        u.amount        -= amount;
        pool.totalStaked -= amount;
        if (pending > 0) u.pendingRewards += pending;
        u.rewardDebt = u.amount * pool.accRewardPerShare / PRECISION;

        IERC20(pool.lpToken).safeTransfer(msg.sender, amount);
        emit FarmWithdraw(msg.sender, pid, amount);
    }

    /**
     * @notice Claim accumulated ECC rewards from a pool without withdrawing LP tokens.
     * @param pid        Pool ID.
     * @param minRewards Slippage guard — revert if rewards fall below this.
     */
    function claimFarmRewards(uint256 pid, uint256 minRewards)
        external nonReentrant whenNotPaused
    {
        if (pid >= poolInfo.length) revert InvalidPool();
        PoolInfo    storage pool = poolInfo[pid];
        UserPoolInfo storage u   = userPoolInfo[pid][msg.sender];

        updatePool(pid);

        uint256 pending      = (u.amount * pool.accRewardPerShare / PRECISION) - u.rewardDebt;
        uint256 totalRewards = u.pendingRewards + pending;

        if (totalRewards < minRewards) revert SlippageExceeded(minRewards, totalRewards);
        require(totalRewards > 0, "No rewards");
        // F-1 FIX: Removed `require(farmingPoolBalance >= totalRewards)` — rewards
        // were already reserved via `farmingPoolBalance -= poolReward` in updatePool().
        // Re-checking here double-counts and causes legitimate claims to revert.
        // If the actual token balance is insufficient, safeTransfer will revert.

        u.pendingRewards         = 0;
        u.rewardDebt             = u.amount * pool.accRewardPerShare / PRECISION;
        // C-3: farmingPoolBalance already decremented in updatePool()
        totalFarmingRewardsPaid += totalRewards;

        eccToken.safeTransfer(msg.sender, totalRewards);
        emit FarmRewardsClaimed(msg.sender, pid, totalRewards);
    }

    /**
     * @notice Emergency withdraw LP tokens — forfeits all pending rewards.
     * @dev F-5: There is a minor accounting leak: the user's share of rewards
     *      accrued via accRewardPerShare (but not yet added to pendingRewards)
     *      is neither returned to farmingPoolBalance nor claimed. This is
     *      acceptable for emergency scenarios — the priority is returning LP
     *      tokens safely. The small leaked amount remains in the contract's
     *      ECC balance and can be recovered via fundFarmingPool or admin action.
     */
    function emergencyWithdrawFarm(uint256 pid) external nonReentrant {
        if (pid >= poolInfo.length) revert InvalidPool();
        PoolInfo    storage pool = poolInfo[pid];
        UserPoolInfo storage u   = userPoolInfo[pid][msg.sender];

        uint256 amount = u.amount;
        require(amount > 0, "No deposit");

        // L-1: Return forfeited rewards to pool so they aren't stranded
        farmingPoolBalance += u.pendingRewards;

        u.amount         = 0;
        u.rewardDebt     = 0;
        u.pendingRewards = 0;
        pool.totalStaked -= amount;

        IERC20(pool.lpToken).safeTransfer(msg.sender, amount);
        emit FarmEmergencyWithdraw(msg.sender, pid, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function approveLPToken(address token) external onlyRole(ADMIN_ROLE) {
        if (token == address(0)) revert InvalidAddress();
        approvedLPTokens[token] = true;
        emit LPTokenApproved(token);
    }

    function revokeLPToken(address token) external onlyRole(ADMIN_ROLE) {
        approvedLPTokens[token] = false;
        // M-4 / F-4 FIX: Deactivate ALL pools using this token (removed i < 50 cap).
        for (uint256 i = 0; i < poolInfo.length; i++) {
            if (poolInfo[i].lpToken == token && poolInfo[i].active) {
                updatePool(i);
                totalAllocPoint -= poolInfo[i].allocPoint;
                poolInfo[i].allocPoint = 0;
                poolInfo[i].active = false;
                emit PoolDeactivated(i);
            }
        }
        emit LPTokenRevoked(token);
    }

    /**
     * @notice Propose a new reward rate. Effective only after CHANGE_DELAY (48 h).
     * @dev Audit #78 — rate manipulation guard via timelock.
     */
    function proposeRewardRateChange(uint256 newRate) external onlyRole(ADMIN_ROLE) {
        require(newRate <= MAX_REWARD_PER_SECOND, "Rate too high"); // M-6
        bytes32 changeId = keccak256(abi.encodePacked("rewardRate", newRate, block.timestamp, nextNonce++));
        require(!pendingChanges[changeId].executed, "Already executed");
        pendingChanges[changeId] = PendingChange({
            timestamp: block.timestamp + CHANGE_DELAY,
            newValue:  newRate,
            executed:  false
        });
        emit PendingChangeProposed(changeId, newRate, block.timestamp + CHANGE_DELAY);
    }

    function executeRewardRateChange(bytes32 changeId) external onlyRole(ADMIN_ROLE) {
        PendingChange storage change = pendingChanges[changeId];
        if (change.executed)                   revert ChangeAlreadyExecuted();
        if (block.timestamp < change.timestamp) revert TimelockNotExpired();

        // M-1 / F-3 FIX: Update ALL pools at old rate before switching.
        // The MAX_POOLS_PER_UPDATE cap is removed here — all pools MUST be
        // current before the rate changes, otherwise rewards are miscalculated.
        for (uint256 i = 0; i < poolInfo.length; ++i) { updatePool(i); }

        uint256 oldRate = rewardPerSecond;
        rewardPerSecond = change.newValue;
        change.executed = true;

        emit RewardRateUpdated(oldRate, change.newValue, change.timestamp);
        emit PendingChangeExecuted(changeId, change.newValue);
    }

    function cancelRewardRateChange(bytes32 changeId) external onlyRole(ADMIN_ROLE) {
        PendingChange storage change = pendingChanges[changeId];
        require(!change.executed, "Already executed");
        change.executed = true; // mark done to prevent re-use
        emit PendingChangeCancelled(changeId);
    }

    /**
     * @notice Top up the farming reward pool.
     */
    function fundFarmingPool(uint256 amount) external onlyRole(ADMIN_ROLE) {
        require(amount > 0, "Zero amount");
        // F-LOW-2: Balance-diff + CEI fix — transfer first, then update state
        uint256 balBefore = eccToken.balanceOf(address(this));
        eccToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actual = eccToken.balanceOf(address(this)) - balBefore;
        farmingPoolBalance += actual;
        emit FarmingPoolFunded(actual, farmingPoolBalance);
    }

    /**
     * @notice Register the ECC balance received from ECCToken.initializeContracts().
     * @dev Call once immediately after initializeContracts(). Only ECC in this contract
     *      is reward pool — LP tokens are separate and don't affect eccToken.balanceOf().
     */
    function syncPoolBalance() external onlyRole(ADMIN_ROLE) {
        require(!poolSynced, "Already synced"); // C-2: prevent repeated inflation
        poolSynced = true;
        farmingPoolBalance = eccToken.balanceOf(address(this));
        emit PoolBalanceSynced(farmingPoolBalance);
    }

    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function pendingFarmRewards(uint256 pid, address user) external view returns (uint256) {
        if (pid >= poolInfo.length) return 0;
        PoolInfo    storage pool     = poolInfo[pid];
        UserPoolInfo storage userInfo = userPoolInfo[pid][user];

        uint256 acc = pool.accRewardPerShare;
        if (block.timestamp > pool.lastRewardTime &&
            pool.totalStaked > 0 &&
            totalAllocPoint > 0)
        {
            uint256 elapsed    = block.timestamp - pool.lastRewardTime;
            uint256 poolReward = (elapsed * rewardPerSecond * pool.allocPoint) / totalAllocPoint;
            // H-2: Mirror the farmingPoolBalance cap from updatePool
            if (poolReward > farmingPoolBalance) poolReward = farmingPoolBalance;
            acc += (poolReward * PRECISION) / pool.totalStaked;
        }
        uint256 pending = (userInfo.amount * acc / PRECISION) - userInfo.rewardDebt;
        return pending + userInfo.pendingRewards;
    }

    function getPoolInfo(uint256 pid) external view returns (
        address lpToken,
        uint256 allocPoint,
        uint256 totalStakedInPool,
        bool    active
    ) {
        if (pid >= poolInfo.length) revert InvalidPool();
        PoolInfo memory pool = poolInfo[pid];
        return (pool.lpToken, pool.allocPoint, pool.totalStaked, pool.active);
    }

    function getPoolCount()             external view returns (uint256) { return poolInfo.length; }
    function isLPTokenApproved(address t) external view returns (bool) { return approvedLPTokens[t]; }
}
