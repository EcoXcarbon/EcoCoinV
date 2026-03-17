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

    bytes32 public constant POOL_ADMIN_ROLE = keccak256("POOL_ADMIN_ROLE");
    uint256 public constant FEE_BASE        = 10000;
    uint256 public constant MAX_PROTOCOL_FEE = 100;  // 1%
    uint256 public constant LP_FEE          = 30;    // 0.3%

    address public treasury;
    uint256 public protocolFee = 10; // 0.1% default

    struct Pool {
        address tokenA;
        address tokenB;
        uint256 reserveA;
        uint256 reserveB;
        uint256 totalLPShares;
        uint256 kLast;        // reserveA * reserveB at last mint/burn
        bool    active;
    }

    uint256 public nextPoolId;
    mapping(uint256 => Pool) public pools;
    mapping(bytes32 => uint256) public pairToPool;  // keccak(tokenA,tokenB) => poolId
    mapping(uint256 => mapping(address => uint256)) public lpShares;

    // ── Events ─────────────────────────────────────────────────────────────
    event PoolCreated(uint256 indexed poolId, address tokenA, address tokenB);
    event LiquidityAdded(uint256 indexed poolId, address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event LiquidityRemoved(uint256 indexed poolId, address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event Swapped(uint256 indexed poolId, address indexed user, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut);
    event ProtocolFeeUpdated(uint256 newFee);

    constructor(address _treasury) {
        require(_treasury != address(0), "Zero treasury");
        treasury = _treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(POOL_ADMIN_ROLE, msg.sender);
    }

    // ── Create pool ────────────────────────────────────────────────────────
    function createPool(address tokenA, address tokenB)
        external onlyRole(POOL_ADMIN_ROLE) returns (uint256 poolId)
    {
        require(tokenA != address(0) && tokenB != address(0), "Zero token");
        require(tokenA != tokenB, "Same token");

        // Normalize order
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);

        bytes32 pairKey = keccak256(abi.encodePacked(tokenA, tokenB));
        require(pairToPool[pairKey] == 0, "Pool exists");

        poolId = ++nextPoolId;  // start from 1
        pools[poolId] = Pool({
            tokenA:       tokenA,
            tokenB:       tokenB,
            reserveA:     0,
            reserveB:     0,
            totalLPShares: 0,
            kLast:        0,
            active:       true
        });
        pairToPool[pairKey] = poolId;

        emit PoolCreated(poolId, tokenA, tokenB);
    }

    // ── Add liquidity ──────────────────────────────────────────────────────
    function addLiquidity(
        uint256 poolId,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) external nonReentrant whenNotPaused returns (uint256 shares) {
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

        // Mint LP shares
        if (p.totalLPShares == 0) {
            shares = _sqrt(amountA * amountB);
        } else {
            uint256 sharesA = (amountA * p.totalLPShares) / p.reserveA;
            uint256 sharesB = (amountB * p.totalLPShares) / p.reserveB;
            shares = sharesA < sharesB ? sharesA : sharesB;
        }
        require(shares > 0, "Zero shares");

        // CEI: update state before external transfers
        p.reserveA       += amountA;
        p.reserveB       += amountB;
        p.totalLPShares  += shares;
        p.kLast           = p.reserveA * p.reserveB;
        lpShares[poolId][msg.sender] += shares;

        emit LiquidityAdded(poolId, msg.sender, amountA, amountB, shares);

        IERC20(p.tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(p.tokenB).safeTransferFrom(msg.sender, address(this), amountB);
    }

    // ── Remove liquidity ───────────────────────────────────────────────────
    function removeLiquidity(
        uint256 poolId,
        uint256 shares,
        uint256 amountAMin,
        uint256 amountBMin
    ) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        Pool storage p = pools[poolId];
        require(lpShares[poolId][msg.sender] >= shares, "Insufficient shares");
        require(p.totalLPShares > 0, "Empty pool");

        amountA = (shares * p.reserveA) / p.totalLPShares;
        amountB = (shares * p.reserveB) / p.totalLPShares;
        require(amountA >= amountAMin, "Slippage: A");
        require(amountB >= amountBMin, "Slippage: B");

        lpShares[poolId][msg.sender] -= shares;
        p.totalLPShares -= shares;
        p.reserveA      -= amountA;
        p.reserveB      -= amountB;
        p.kLast          = p.reserveA * p.reserveB;

        IERC20(p.tokenA).safeTransfer(msg.sender, amountA);
        IERC20(p.tokenB).safeTransfer(msg.sender, amountB);

        emit LiquidityRemoved(poolId, msg.sender, amountA, amountB, shares);
    }

    // ── Swap ───────────────────────────────────────────────────────────────
    function swap(
        uint256 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        Pool storage p = pools[poolId];
        require(p.active, "Pool not active");
        require(tokenIn == p.tokenA || tokenIn == p.tokenB, "Invalid token");
        require(amountIn > 0, "Zero input");

        bool aToB = (tokenIn == p.tokenA);
        (uint256 reserveIn, uint256 reserveOut) = aToB
            ? (p.reserveA, p.reserveB)
            : (p.reserveB, p.reserveA);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Protocol fee
        uint256 fee = (amountIn * protocolFee) / FEE_BASE;
        if (fee > 0) {
            IERC20(tokenIn).safeTransfer(treasury, fee);
        }

        // LP fee stays in pool (amountIn for calculation includes LP fee)
        uint256 amountInWithFee = amountIn - fee;
        uint256 lpFeeAmount     = (amountInWithFee * LP_FEE) / FEE_BASE;
        uint256 amountInNet     = amountInWithFee - lpFeeAmount;

        // x * y = k formula
        amountOut = (amountInNet * reserveOut) / (reserveIn + amountInNet);
        require(amountOut >= amountOutMin, "Slippage exceeded");
        require(amountOut < reserveOut,    "Insufficient liquidity");

        // CEI: update reserves before outbound transfer
        address tokenOut = aToB ? p.tokenB : p.tokenA;
        if (aToB) {
            p.reserveA += amountInWithFee;  // includes LP fee
            p.reserveB -= amountOut;
        } else {
            p.reserveB += amountInWithFee;
            p.reserveA -= amountOut;
        }
        p.kLast = p.reserveA * p.reserveB;

        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        emit Swapped(poolId, msg.sender, tokenIn, amountIn, tokenOut, amountOut);
    }

    // ── Quote ──────────────────────────────────────────────────────────────
    function getAmountOut(
        uint256 poolId,
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        Pool storage p = pools[poolId];
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
        treasury = _treasury;
    }

    function setPoolActive(uint256 poolId, bool active) external onlyRole(POOL_ADMIN_ROLE) {
        pools[poolId].active = active;
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Internal ───────────────────────────────────────────────────────────
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
