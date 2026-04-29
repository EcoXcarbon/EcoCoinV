// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title ECCSwap
 * @notice Simple AMM-style DEX for ECC token pairs.
 *
 * Model: Constant product AMM (x * y = k), similar to Uniswap V2.
 *
 * Features:
 *   - Create liquidity pools for any ECC/token pair
 *   - Add/remove liquidity with LP shares
 *   - Swap tokens with slippage protection
 *   - Protocol fee (max 1%) sent to treasury
 *   - LP fee (0.3% default) stays in pool
 *   - Price impact protection
 *   - Emergency pause
 */
contract ECCSwap is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant POOL_ADMIN_ROLE   = keccak256("POOL_ADMIN_ROLE");
    uint256 public constant FEE_BASE          = 10000;
    uint256 public constant MAX_PROTOCOL_FEE  = 100;  // 1%
    uint256 public constant LP_FEE            = 30;   // 0.3%
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    address public treasury;
    uint256 public protocolFee       = 10;   // 0.1% default
    uint256 public maxPriceImpactBps = 1000; // 10% default

    struct Pool {
        address tokenA;
        address tokenB;
        uint256 reserveA;
        uint256 reserveB;
        uint256 totalLPShares;
        bool    active;
    }

    uint256 public nextPoolId;
    mapping(uint256 => Pool) public pools;
    mapping(bytes32 => uint256) public pairToPool;   // keccak(tokenA,tokenB) => poolId
    mapping(bytes32 => bool)    public pairExists;   // S-3: separate existence check
    mapping(uint256 => mapping(address => uint256)) public lpShares;

    // ── Events ─────────────────────────────────────────────────────────────
    event PoolCreated(uint256 indexed poolId, address tokenA, address tokenB);
    event LiquidityAdded(uint256 indexed poolId, address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event LiquidityRemoved(uint256 indexed poolId, address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event Swapped(uint256 indexed poolId, address indexed user, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut);
    event ProtocolFeeUpdated(uint256 newFee);
    event MaxPriceImpactUpdated(uint256 newMaxBps);
    event PoolStatusChanged(uint256 indexed poolId, bool active);         // S-LOW-1
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury); // S-LOW-2
    event Sync(uint256 indexed poolId, uint256 reserve0, uint256 reserve1);

    constructor(address _treasury) {
        require(_treasury != address(0), "Zero treasury");
        treasury = _treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(POOL_ADMIN_ROLE, msg.sender);
    }

    // ── Create pool ────────────────────────────────────────────────────────
    function createPool(address tokenA, address tokenB)
        external
        onlyRole(POOL_ADMIN_ROLE)
        returns (uint256 poolId, address storedTokenA, address storedTokenB)
    {
        require(tokenA != address(0) && tokenB != address(0), "Zero token");
        require(tokenA != tokenB, "Same token");

        // Normalize order
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);

        bytes32 pairKey = keccak256(abi.encodePacked(tokenA, tokenB));
        require(!pairExists[pairKey], "Pool exists");          // S-3

        poolId = ++nextPoolId;  // start from 1
        pools[poolId] = Pool({
            tokenA:        tokenA,
            tokenB:        tokenB,
            reserveA:      0,
            reserveB:      0,
            totalLPShares: 0,
            active:        true
        });
        pairToPool[pairKey] = poolId;
        pairExists[pairKey] = true;                            // S-3

        storedTokenA = tokenA;                                 // S-11
        storedTokenB = tokenB;                                 // S-11

        emit PoolCreated(poolId, tokenA, tokenB);
    }

    // ── Add liquidity ──────────────────────────────────────────────────────
    function addLiquidity(
        uint256 poolId,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline                                         // S-7
    ) external nonReentrant whenNotPaused returns (uint256 shares) {
        require(block.timestamp <= deadline, "Expired");          // S-7

        Pool storage p = pools[poolId];
        require(p.active, "Pool not active");
        require(amountADesired > 0 && amountBDesired > 0, "Zero amounts");

        uint256 amountA = amountADesired;
        uint256 amountB = amountBDesired;

        if (p.reserveA > 0 && p.reserveB > 0) {
            // Maintain ratio
            uint256 amountBOptimal = (amountADesired * p.reserveB) / p.reserveA;
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "Slippage: B");
                amountB = amountBOptimal;
            } else {
                uint256 amountAOptimal = (amountBDesired * p.reserveA) / p.reserveB;
                require(amountAOptimal >= amountAMin, "Slippage: A");
                amountA = amountAOptimal;
            }
        }

        // Mint LP shares — initial share calculation is preliminary;
        // final shares are recalculated below using actual tokens received.
        if (p.totalLPShares == 0) {
            // Burn MINIMUM_LIQUIDITY to dead address to prevent LP share inflation attack (S-HIGH-3)
            lpShares[poolId][address(0xdead)] = MINIMUM_LIQUIDITY;
            p.totalLPShares += MINIMUM_LIQUIDITY;
            // shares will be recalculated after transfer using actualA/actualB
            shares = 0; // placeholder
        } else {
            // shares will be recalculated after transfer using actualA/actualB
            shares = 0; // placeholder
        }

        // S-CRIT-1: Use balance-difference pattern for fee-on-transfer tokens
        uint256 balBeforeA = IERC20(p.tokenA).balanceOf(address(this));
        uint256 balBeforeB = IERC20(p.tokenB).balanceOf(address(this));
        IERC20(p.tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(p.tokenB).safeTransferFrom(msg.sender, address(this), amountB);
        uint256 actualA = IERC20(p.tokenA).balanceOf(address(this)) - balBeforeA;
        uint256 actualB = IERC20(p.tokenB).balanceOf(address(this)) - balBeforeB;
        require(actualA > 0 && actualB > 0, "Zero received");

        // Recalculate LP shares using actual amounts received (for fee-on-transfer tokens)
        if (p.totalLPShares == MINIMUM_LIQUIDITY) {
            // First liquidity addition — recalculate shares with actual amounts
            shares = _sqrt(actualA * actualB) - MINIMUM_LIQUIDITY;
            require(shares > MINIMUM_LIQUIDITY, "Initial liquidity too low");
        } else if (p.totalLPShares > MINIMUM_LIQUIDITY) {
            uint256 sharesA = (actualA * p.totalLPShares) / p.reserveA;
            uint256 sharesB = (actualB * p.totalLPShares) / p.reserveB;
            shares = sharesA < sharesB ? sharesA : sharesB;
        }
        require(shares > 0, "Zero shares");

        // Update state after transfers using actual amounts received
        p.reserveA      += actualA;
        p.reserveB      += actualB;
        p.totalLPShares += shares;
        lpShares[poolId][msg.sender] += shares;

        emit LiquidityAdded(poolId, msg.sender, actualA, actualB, shares);
    }

    // ── Remove liquidity ───────────────────────────────────────────────────
    function removeLiquidity(
        uint256 poolId,
        uint256 shares,
        uint256 amountAMin,
        uint256 amountBMin
    ) external nonReentrant whenNotPaused returns (uint256 amountA, uint256 amountB) {
        require(poolId > 0 && poolId <= nextPoolId, "Invalid pool"); // S-8

        Pool storage p = pools[poolId];
        require(lpShares[poolId][msg.sender] >= shares, "Insufficient shares");
        require(p.totalLPShares > 0, "Empty pool");

        // S-MED-2: Ensure MINIMUM_LIQUIDITY shares remain permanently locked.
        // The dead address holds MINIMUM_LIQUIDITY and can never call this function,
        // so prevent any withdrawal that would reduce totalLPShares below MINIMUM_LIQUIDITY.
        require(
            p.totalLPShares - shares >= MINIMUM_LIQUIDITY || p.totalLPShares <= MINIMUM_LIQUIDITY,
            "Must leave MINIMUM_LIQUIDITY locked"
        );

        // S-LOW-1: Simplified — proportional calculation covers all cases.
        // The dead-address MINIMUM_LIQUIDITY shares can never call this function,
        // so shares == totalLPShares is unreachable in practice.
        amountA = (shares * p.reserveA) / p.totalLPShares;
        amountB = (shares * p.reserveB) / p.totalLPShares;
        require(amountA >= amountAMin, "Slippage: A");
        require(amountB >= amountBMin, "Slippage: B");

        lpShares[poolId][msg.sender] -= shares;
        p.totalLPShares -= shares;
        p.reserveA      -= amountA;
        p.reserveB      -= amountB;

        IERC20(p.tokenA).safeTransfer(msg.sender, amountA);
        IERC20(p.tokenB).safeTransfer(msg.sender, amountB);

        emit LiquidityRemoved(poolId, msg.sender, amountA, amountB, shares);
    }

    // ── Swap ───────────────────────────────────────────────────────────────
    function swap(
        uint256 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline                                          // S-6
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "Expired");           // S-6

        Pool storage p = pools[poolId];
        require(p.active, "Pool not active");
        require(tokenIn == p.tokenA || tokenIn == p.tokenB, "Invalid token");
        require(amountIn > 0, "Zero input");

        // Snapshot pre-swap k for invariant check
        uint256 kBefore = p.reserveA * p.reserveB;

        // S-2: Transfer in first, measure actual amount received
        uint256 balBefore = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 actualIn = IERC20(tokenIn).balanceOf(address(this)) - balBefore;

        bool aToB = (tokenIn == p.tokenA);
        (uint256 reserveIn, uint256 reserveOut) = aToB
            ? (p.reserveA, p.reserveB)
            : (p.reserveB, p.reserveA);

        // Compute fees and output amount using actualIn
        uint256 fee             = (actualIn * protocolFee) / FEE_BASE;
        uint256 amountInWithFee = actualIn - fee;
        uint256 lpFeeAmount     = (amountInWithFee * LP_FEE) / FEE_BASE;
        uint256 amountInNet     = amountInWithFee - lpFeeAmount;

        // x * y = k formula
        amountOut = (amountInNet * reserveOut) / (reserveIn + amountInNet);
        require(amountOut >= amountOutMin, "Slippage exceeded");
        require(amountOut < reserveOut,    "Insufficient liquidity");

        // S-5: Price impact protection
        uint256 impact = (amountOut * FEE_BASE) / reserveOut;
        require(impact <= maxPriceImpactBps, "Price impact too high");

        // Update reserves after transfer verification
        address tokenOut = aToB ? p.tokenB : p.tokenA;
        if (aToB) {
            p.reserveA += amountInWithFee;  // includes LP fee
            p.reserveB -= amountOut;
        } else {
            p.reserveB += amountInWithFee;
            p.reserveA -= amountOut;
        }

        // D3: Post-swap k-invariant check — k must never decrease
        // LP fees grow k over time; protocol fee is extracted before reserve update
        uint256 kAfter = p.reserveA * p.reserveB;
        require(kAfter >= kBefore, "K invariant violated");

        // Send protocol fee to treasury and output to user
        if (fee > 0) {
            IERC20(tokenIn).safeTransfer(treasury, fee);
        }
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        _update(poolId, p.reserveA, p.reserveB);
        emit Swapped(poolId, msg.sender, tokenIn, actualIn, tokenOut, amountOut);
    }

    // ── Quote ──────────────────────────────────────────────────────────────
    /**
     * @notice Returns the estimated output amount for a given input.
     * @dev WARNING (S-MED-4): This function uses instantaneous reserves and is
     *      susceptible to flash-loan and sandwich manipulation. It MUST NOT be
     *      used as a price oracle by external protocols. Use a TWAP oracle or
     *      Chainlink price feeds instead for any on-chain price reference.
     */
    function getAmountOut(
        uint256 poolId,
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        Pool storage p = pools[poolId];
        require(tokenIn == p.tokenA || tokenIn == p.tokenB, "Invalid token"); // S-14
        bool aToB = (tokenIn == p.tokenA);
        (uint256 reserveIn, uint256 reserveOut) = aToB
            ? (p.reserveA, p.reserveB)
            : (p.reserveB, p.reserveA);

        // Apply fees sequentially to match swap(): protocol fee first, then LP fee on remainder
        uint256 afterProtocol = amountIn - (amountIn * protocolFee) / FEE_BASE;
        uint256 amountInNet   = afterProtocol - (afterProtocol * LP_FEE) / FEE_BASE;
        amountOut = (amountInNet * reserveOut) / (reserveIn + amountInNet);
    }

    // ── Admin ──────────────────────────────────────────────────────────────
    function setProtocolFee(uint256 fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(fee <= MAX_PROTOCOL_FEE, "Fee too high");
        protocolFee = fee;
        emit ProtocolFeeUpdated(fee);
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0), "Zero address");
        address old = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(old, _treasury);                             // S-LOW-2
    }

    function setMaxPriceImpact(uint256 _maxBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_maxBps > 0 && _maxBps <= FEE_BASE, "Invalid bps");
        maxPriceImpactBps = _maxBps;
        emit MaxPriceImpactUpdated(_maxBps);
    }

    function setPoolActive(uint256 poolId, bool active) external onlyRole(POOL_ADMIN_ROLE) {
        pools[poolId].active = active;
        emit PoolStatusChanged(poolId, active);                           // S-LOW-1
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Views ──────────────────────────────────────────────────────────────
    function getReserves(uint256 poolId) external view returns (uint256 reserve0, uint256 reserve1) {
        Pool storage p = pools[poolId];
        return (p.reserveA, p.reserveB);
    }

    // ── Internal ───────────────────────────────────────────────────────────
    function _update(uint256 poolId, uint256 reserve0, uint256 reserve1) private {
        emit Sync(poolId, reserve0, reserve1);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) {
            z = 1;
        }
    }
}
