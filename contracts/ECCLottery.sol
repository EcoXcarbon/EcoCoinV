// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

// ── Chainlink VRF v2 (inline — no external package required) ─────────────────
interface IVRFCoordinatorV2 {
    function requestRandomWords(
        bytes32 keyHash,
        uint64  subId,
        uint16  requestConfirmations,
        uint32  callbackGasLimit,
        uint32  numWords
    ) external returns (uint256 requestId);
}

/**
 * @title ECCLottery
 * @notice Gamified lottery system for EcoCoin community engagement.
 *
 * Features:
 *   - Multiple simultaneous lottery rounds
 *   - Ticket purchase with ECC tokens
 *   - Multiple prize tiers (1st, 2nd, 3rd, consolation)
 *   - Chainlink VRF v2 winner selection (fallback to pseudo-random when VRF not configured)
 *   - Per-tx ticket purchase limit (anti-MEV)
 *   - Ticket burn mechanism (deflationary)
 *   - Carbon offset bonus: extra tickets for offset activity
 *   - Treasury fee (max 20%)
 *   - Rollover jackpot if no winner
 */
contract ECCLottery is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant LOTTERY_ADMIN_ROLE = keccak256("LOTTERY_ADMIN_ROLE");
    uint256 public constant MAX_TREASURY_FEE   = 2000;  // 20%
    uint256 public constant FEE_BASE           = 10000;
    uint256 public constant MAX_TICKETS_PER_TX    = 100;   // anti-MEV: cap per transaction
    uint256 public constant MAX_TICKETS_PER_ROUND = 10_000; // OOG guard in _drawWinners

    IERC20 public immutable eccToken;

    // ── Chainlink VRF v2 config ────────────────────────────────────────────
    IVRFCoordinatorV2 public vrfCoordinator;
    bytes32  public vrfKeyHash;
    uint64   public vrfSubId;
    uint16   public vrfConfirmations  = 3;
    uint32   public vrfCallbackGasLimit = 500_000;

    // VRF request tracking
    mapping(uint256 => uint256) public vrfRequestToRound;   // requestId => roundId
    bool public vrfEnabled;

    enum LotteryStatus { OPEN, DRAWING, ENDED, CANCELLED }

    struct PrizeTier {
        uint256 percentage;   // % of prize pool (basis points)
        uint256 winnerCount;  // number of winners in this tier
    }

    struct Round {
        uint256 ticketPrice;      // ECC per ticket
        uint256 maxTickets;       // 0 = unlimited
        uint256 totalTickets;     // tickets sold
        uint256 prizePool;        // total ECC in pool
        uint256 treasuryFee;      // fee in basis points
        uint256 burnPercent;      // % of ticket price burned (basis points)
        uint64  startTime;
        uint64  endTime;
        LotteryStatus status;
        PrizeTier[] prizeTiers;
        address[] winners;
        uint256[] winnerPrizes;
        string  description;
        uint256 rolloverAmount;   // from previous round
    }

    struct Ticket {
        address owner;
        uint256 roundId;
        uint256 ticketNumber;
    }

    uint256 public nextRoundId;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => Ticket[]) public roundTickets;
    mapping(uint256 => mapping(address => uint256)) public userTicketCount;
    mapping(uint256 => mapping(address => uint256)) public userPrizes;
    mapping(uint256 => mapping(address => uint256)) public userDeposited; // #7: actual net amount deposited

    /// @notice Minimum prize pool (in ECC) above which VRF is required for fairness.
    uint256 public vrfRequiredThreshold = 1_000 * 1e18; // 1 000 ECC default

    /// @notice Deadline after round ends within which winners must claim prizes (#9).
    uint256 public claimDeadline = 90 days;

    address public treasury;
    uint256 public totalBurned;

    /// @notice Maximum tickets a single user can hold per round (L-MED-5).
    uint256 public maxTicketsPerUser = 1000;

    // ── Events ─────────────────────────────────────────────────────────────
    event RoundCreated(uint256 indexed roundId, uint256 ticketPrice, uint64 endTime);
    event TicketsPurchased(uint256 indexed roundId, address indexed buyer, uint256 count);
    event WinnersDrawn(uint256 indexed roundId, address[] winners);
    event VRFRequested(uint256 indexed roundId, uint256 requestId);
    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);
    event RoundCancelled(uint256 indexed roundId);
    event TokensBurned(uint256 amount);
    event VRFConfigUpdated(address coordinator, bytes32 keyHash, uint64 subId);
    event VRFThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);  // L-LOW-1
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury); // L-LOW-2
    event StuckRoundRecovered(uint256 indexed roundId);                     // L-CRIT-2
    event ExpiredPrizesReclaimed(uint256 indexed roundId, uint256 amount);  // L-HIGH-1
    event MaxTicketsPerUserUpdated(uint256 oldLimit, uint256 newLimit);     // L-MED-5

    constructor(address _token, address _treasury) {
        require(_token    != address(0), "Zero token");
        require(_treasury != address(0), "Zero treasury");
        eccToken = IERC20(_token);
        treasury = _treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(LOTTERY_ADMIN_ROLE, msg.sender);
    }

    // ── Admin: configure Chainlink VRF ─────────────────────────────────────
    /**
     * @notice Set Chainlink VRF v2 parameters.
     * @param coordinator  VRF coordinator address (address(0) = disable VRF, use pseudo-random)
     * @param keyHash      Lane key hash for the desired gas price
     * @param subId        Chainlink subscription ID (must be funded with LINK)
     * @dev Polygon Amoy:   coordinator = 0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf0
     *      Polygon Mainnet: coordinator = 0xAE975071Be8F8eE67addBC1A82488F1C24858067
     */
    function setVRFConfig(
        address coordinator,
        bytes32 keyHash,
        uint64  subId,
        uint16  confirmations,
        uint32  callbackGasLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        vrfCoordinator     = IVRFCoordinatorV2(coordinator);
        vrfKeyHash         = keyHash;
        vrfSubId           = subId;
        vrfConfirmations   = confirmations;
        vrfCallbackGasLimit = callbackGasLimit;
        vrfEnabled         = (coordinator != address(0));
        emit VRFConfigUpdated(coordinator, keyHash, subId);
    }

    // ── VRF callback (called by Chainlink coordinator) ─────────────────────
    /**
     * @notice Called by Chainlink VRF coordinator with verified randomness.
     */
    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        require(msg.sender == address(vrfCoordinator), "Only VRF coordinator");
        uint256 roundId = vrfRequestToRound[requestId];
        require(roundId < nextRoundId, "Unknown request");
        // #4: Validate round is still in DRAWING state and clean up mapping to prevent replay
        require(rounds[roundId].status == LotteryStatus.DRAWING, "Not drawing");
        delete vrfRequestToRound[requestId];
        _drawWinners(roundId, randomWords[0]);
    }

    // ── Admin: create round ────────────────────────────────────────────────
    function createRound(
        uint256 ticketPrice,
        uint256 maxTickets,
        uint256 treasuryFee,
        uint256 burnPercent,
        uint64  startTime,
        uint64  endTime,
        PrizeTier[] calldata prizeTiers,
        string calldata description
    ) external onlyRole(LOTTERY_ADMIN_ROLE) returns (uint256 roundId) {
        require(ticketPrice  > 0,               "Zero price");
        require(endTime      > block.timestamp,  "End in past");
        // #11: startTime in the past means immediate-start round — this is intentional.
        // Admins can set startTime <= block.timestamp for rounds that open immediately.
        require(startTime    < endTime,          "Invalid times");
        require(treasuryFee  <= MAX_TREASURY_FEE,"Fee too high");
        require(burnPercent  + treasuryFee <= FEE_BASE, "Fee overflow");
        require(prizeTiers.length > 0,           "No prize tiers");
        require(prizeTiers.length <= 10,         "Too many tiers"); // #10: gas limit guard

        uint256 totalPct     = 0;
        uint256 totalWinners = 0;
        for (uint256 i = 0; i < prizeTiers.length; i++) {
            require(prizeTiers[i].winnerCount > 0, "Zero winners in tier"); // #13
            totalPct     += prizeTiers[i].percentage;
            totalWinners += prizeTiers[i].winnerCount;
        }
        require(totalPct <= FEE_BASE, "Prize tiers exceed 100%");
        require(totalWinners <= 50, "Too many winners"); // #10: gas limit guard for _drawWinners

        roundId = nextRoundId++;
        Round storage r = rounds[roundId];
        r.ticketPrice   = ticketPrice;
        r.maxTickets    = maxTickets;
        r.treasuryFee   = treasuryFee;
        r.burnPercent   = burnPercent;
        r.startTime     = startTime;
        r.endTime       = endTime;
        r.status        = LotteryStatus.OPEN;
        r.description   = description;

        for (uint256 i = 0; i < prizeTiers.length; i++) {
            r.prizeTiers.push(prizeTiers[i]);
        }

        emit RoundCreated(roundId, ticketPrice, endTime);
    }

    // ── Buy tickets ────────────────────────────────────────────────────────
    function buyTickets(uint256 roundId, uint256 count)
        external nonReentrant whenNotPaused
    {
        Round storage r = rounds[roundId];
        require(r.status == LotteryStatus.OPEN,         "Round not open");
        require(block.timestamp >= r.startTime,          "Not started");
        require(block.timestamp <  r.endTime,            "Round ended");
        require(count > 0,                               "Zero count");
        require(count <= MAX_TICKETS_PER_TX,             "Exceeds per-tx limit"); // anti-MEV
        // L-MED-5: Per-user ticket limit
        require(
            userTicketCount[roundId][msg.sender] + count <= maxTicketsPerUser,
            "User ticket limit"
        );
        if (r.maxTickets > 0) {
            require(r.totalTickets + count <= r.maxTickets, "Sold out");
        }
        require(r.totalTickets + count <= MAX_TICKETS_PER_ROUND, "Round ticket cap reached");

        uint256 totalCost  = r.ticketPrice * count;

        // L-MED-4: Use balance-before/after pattern for fee-on-transfer tokens
        uint256 balBefore = eccToken.balanceOf(address(this));
        eccToken.safeTransferFrom(msg.sender, address(this), totalCost);
        uint256 actualReceived = eccToken.balanceOf(address(this)) - balBefore;
        require(actualReceived > 0, "Zero tokens received");

        // Calculate fees based on actual amount received (not requested amount)
        uint256 burnAmount = (actualReceived * r.burnPercent) / FEE_BASE;
        uint256 feeAmount  = (actualReceived * r.treasuryFee) / FEE_BASE;
        uint256 netAmount  = actualReceived - burnAmount - feeAmount;

        // State updates (now safe — tokens already received)
        r.prizePool    += netAmount;
        r.totalTickets += count;
        userTicketCount[roundId][msg.sender] += count;
        userDeposited[roundId][msg.sender]   += netAmount; // #7: track actual net deposit

        for (uint256 i = 0; i < count; i++) {
            roundTickets[roundId].push(Ticket({
                owner:        msg.sender,
                roundId:      roundId,
                ticketNumber: r.totalTickets - count + i
            }));
        }

        emit TicketsPurchased(roundId, msg.sender, count);

        // Burn and fee transfers (tokens already held by contract)
        if (burnAmount > 0) {
            // #6: Transfer to 0xdead is a design choice — functionally equivalent to burn
            // for tokens without a public burn(). The tokens are permanently irretrievable.
            eccToken.safeTransfer(address(0xdead), burnAmount);
            totalBurned += burnAmount;
            emit TokensBurned(burnAmount);
        }
        if (feeAmount > 0) {
            eccToken.safeTransfer(treasury, feeAmount);
        }
    }

    // ── Admin: request winner draw ─────────────────────────────────────────
    /**
     * @notice Initiate winner draw.
     * @dev    If Chainlink VRF is configured (vrfEnabled), requests verifiable randomness.
     *         Otherwise falls back to a block-based pseudo-random seed (suitable for testing
     *         and low-stakes draws; not recommended for high-value production lotteries).
     */
    function drawWinners(uint256 roundId) external onlyRole(LOTTERY_ADMIN_ROLE) nonReentrant {
        Round storage r = rounds[roundId];
        require(block.timestamp >= r.endTime, "Round not ended");
        require(r.status == LotteryStatus.OPEN, "Not open");
        require(r.totalTickets > 0,             "No tickets sold");

        r.status = LotteryStatus.DRAWING;

        // NEW-1: Include rolloverAmount in threshold check — a small prizePool
        // with large rollover could bypass VRF, enabling sequencer manipulation.
        require(
            vrfEnabled || (r.prizePool + r.rolloverAmount) < vrfRequiredThreshold,
            "VRF required for large pool"
        );

        if (vrfEnabled) {
            // Request Chainlink VRF randomness — winners drawn in rawFulfillRandomWords()
            uint256 requestId = vrfCoordinator.requestRandomWords(
                vrfKeyHash,
                vrfSubId,
                vrfConfirmations,
                vrfCallbackGasLimit,
                1   // numWords
            );
            vrfRequestToRound[requestId] = roundId;
            emit VRFRequested(roundId, requestId);
        } else {
            // Pseudo-random fallback for testing / low-stakes draws only.
            // L-CRIT-1: Added blockhash and block.number for additional entropy.
            // Note: block.prevrandao replaces block.difficulty on PoS chains (Solidity 0.8.18+).
            // This is still NOT cryptographically secure — VRF is required for high-value pools.
            uint256 seed = uint256(keccak256(abi.encodePacked(
                block.timestamp,
                block.prevrandao,
                blockhash(block.number - 1),
                block.number,
                msg.sender,
                roundId,
                r.totalTickets
            )));
            _drawWinners(roundId, seed);
        }
    }

    function setVrfRequiredThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // L-CRIT-1 / L-HIGH-3: Enforce minimum threshold so admin cannot trivially
        // disable VRF protection by setting threshold to 0 or near-zero.
        require(newThreshold >= 100 * 1e18, "Min threshold 100 ECC");
        uint256 old = vrfRequiredThreshold;
        vrfRequiredThreshold = newThreshold;
        emit VRFThresholdUpdated(old, newThreshold);                     // L-LOW-1
    }

    // ── Internal: execute winner selection with given seed ─────────────────
    function _drawWinners(uint256 roundId, uint256 seed) internal {
        Round storage r = rounds[roundId];
        require(r.status == LotteryStatus.DRAWING, "Not in drawing state");

        uint256 totalPool = r.prizePool + r.rolloverAmount;

        uint256 totalWinners = 0;
        for (uint256 t = 0; t < r.prizeTiers.length; t++) {
            totalWinners += r.prizeTiers[t].winnerCount;
        }
        if (totalWinners > r.totalTickets) totalWinners = r.totalTickets;

        address[] memory winnerList = new address[](totalWinners);
        uint256[] memory prizes     = new uint256[](totalWinners);
        bool[]    memory drawn      = new bool[](r.totalTickets);
        uint256 winnerIdx = 0;

        for (uint256 t = 0; t < r.prizeTiers.length; t++) {
            PrizeTier storage tier = r.prizeTiers[t];
            uint256 tierPrize  = (totalPool * tier.percentage) / FEE_BASE;
            uint256 perWinner  = tier.winnerCount > 0 ? tierPrize / tier.winnerCount : 0;

            for (uint256 w = 0; w < tier.winnerCount && winnerIdx < totalWinners; w++) {
                seed = uint256(keccak256(abi.encodePacked(seed, w, t)));
                uint256 winningTicket = seed % r.totalTickets;

                uint256 attempts = 0;
                while (drawn[winningTicket] && attempts < r.totalTickets) {
                    // Hash-based collision avoidance — not predictable via sequential scan
                    winningTicket = uint256(keccak256(abi.encodePacked(seed, winningTicket, attempts))) % r.totalTickets;
                    attempts++;
                }
                if (attempts >= r.totalTickets) break;

                drawn[winningTicket]  = true;
                address winner        = roundTickets[roundId][winningTicket].owner;
                winnerList[winnerIdx] = winner;
                prizes[winnerIdx]     = perWinner;
                userPrizes[roundId][winner] += perWinner;
                winnerIdx++;
            }
        }

        r.winners      = winnerList;
        r.winnerPrizes = prizes;
        r.status       = LotteryStatus.ENDED;

        // L-LOW-3: Calculate leftover (unawarded portion of the pool) and send to treasury.
        // This handles rounding dust and any prize tiers that don't sum to 100%.
        uint256 totalAwarded = 0;
        for (uint256 i = 0; i < winnerIdx; i++) {
            totalAwarded += prizes[i];
        }
        uint256 leftover = totalPool > totalAwarded ? totalPool - totalAwarded : 0;
        if (leftover > 0) {
            // Send leftover to treasury as additional fee rather than leaving it stuck
            eccToken.safeTransfer(treasury, leftover);
        }

        // L-MED-1: Update prizePool to reflect actual unclaimed tokens in contract.
        // Before this fix, prizePool remained stale, causing reclaimExpiredPrizes
        // to attempt sending the original (inflated) amount.
        r.prizePool = totalAwarded;
        r.rolloverAmount = 0;

        emit WinnersDrawn(roundId, winnerList);
    }

    // ── Claim prize ────────────────────────────────────────────────────────
    function claimPrize(uint256 roundId) external nonReentrant {
        Round storage r = rounds[roundId];
        require(r.status == LotteryStatus.ENDED, "Round not ended");
        // L-HIGH-1: Enforce claim deadline
        require(block.timestamp <= r.endTime + claimDeadline, "Claim expired");

        uint256 prize = userPrizes[roundId][msg.sender];
        require(prize > 0, "No prize");

        userPrizes[roundId][msg.sender] = 0;
        r.prizePool -= prize;   // L-MED-1: Track claimed prizes for accurate reclaim
        eccToken.safeTransfer(msg.sender, prize);

        emit PrizeClaimed(roundId, msg.sender, prize);
    }

    // ── Admin: reclaim expired prizes (L-HIGH-1) ──────────────────────────
    /**
     * @notice Reclaim unclaimed prizes after the claim deadline has passed.
     * @dev    Sends remaining prize pool balance to treasury.
     */
    function reclaimExpiredPrizes(uint256 roundId) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        Round storage r = rounds[roundId];
        require(r.status == LotteryStatus.ENDED, "Round not ended");
        require(block.timestamp > r.endTime + claimDeadline, "Deadline not passed");
        require(r.prizePool > 0, "Nothing to reclaim");

        uint256 remaining = r.prizePool;
        r.prizePool = 0;
        eccToken.safeTransfer(treasury, remaining);

        emit ExpiredPrizesReclaimed(roundId, remaining);
    }

    // ── Admin: recover stuck DRAWING round (L-CRIT-2 / L-MED-3) ────────────
    /**
     * @notice Recover a round stuck in DRAWING state (e.g. VRF callback never arrived).
     * @dev    Requires at least 24 hours after endTime to prevent premature cancellation.
     *         Sets status to CANCELLED so users can call refundTickets() for full refunds.
     */
    function adminRecoverStuckRound(uint256 roundId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Round storage r = rounds[roundId];
        require(r.status == LotteryStatus.DRAWING, "Not in DRAWING state");
        require(block.timestamp >= r.endTime + 24 hours, "Must wait 24h after endTime");
        r.status = LotteryStatus.CANCELLED;
        emit StuckRoundRecovered(roundId);
        emit RoundCancelled(roundId);
    }

    // ── Admin: cancel round ────────────────────────────────────────────────
    function cancelRound(uint256 roundId) external onlyRole(LOTTERY_ADMIN_ROLE) {
        Round storage r = rounds[roundId];
        require(r.status == LotteryStatus.OPEN, "Cannot cancel");
        r.status = LotteryStatus.CANCELLED;
        emit RoundCancelled(roundId);
    }

    // ── Refund on cancelled round ──────────────────────────────────────────
    /**
     * @notice Refund tickets for a cancelled round.
     * @dev    Refunds the net deposited amount (ticket price minus burn and treasury fees
     *         already sent). Burns are irreversible and treasury fees were already transferred,
     *         so only the prize pool portion is refundable. Uses per-round accounting to
     *         prevent cross-round token contamination.
     */
    function refundTickets(uint256 roundId) external nonReentrant {
        Round storage r = rounds[roundId];
        require(r.status == LotteryStatus.CANCELLED, "Not cancelled");
        uint256 count = userTicketCount[roundId][msg.sender];
        require(count > 0, "No tickets");
        userTicketCount[roundId][msg.sender] = 0;

        // L-MED-2: Use per-round accounting instead of total contract balance.
        // Previous code used eccToken.balanceOf(address(this)) which could drain
        // tokens belonging to OTHER rounds (cross-round contamination).
        uint256 refundAmount = userDeposited[roundId][msg.sender];
        userDeposited[roundId][msg.sender] = 0;

        // Cap at this round's prize pool to ensure no cross-round drain
        if (refundAmount > r.prizePool) {
            refundAmount = r.prizePool;
        }
        r.prizePool -= refundAmount;

        if (refundAmount > 0) {
            eccToken.safeTransfer(msg.sender, refundAmount);
        }
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0), "Zero address");
        address old = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(old, _treasury);                            // L-LOW-2
    }

    /// @notice Update per-user ticket limit (L-MED-5).
    function setMaxTicketsPerUser(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newLimit > 0, "Zero limit");
        uint256 old = maxTicketsPerUser;
        maxTicketsPerUser = newLimit;
        emit MaxTicketsPerUserUpdated(old, newLimit);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Views ──────────────────────────────────────────────────────────────
    function getRound(uint256 roundId) external view returns (
        uint256 ticketPrice, uint256 totalTickets, uint256 prizePool,
        uint64 endTime, LotteryStatus status
    ) {
        Round storage r = rounds[roundId];
        return (r.ticketPrice, r.totalTickets, r.prizePool, r.endTime, r.status);
    }

    function getUserTickets(uint256 roundId, address user) external view returns (uint256) {
        return userTicketCount[roundId][user];
    }

    function getWinners(uint256 roundId) external view returns (address[] memory, uint256[] memory) {
        return (rounds[roundId].winners, rounds[roundId].winnerPrizes);
    }
}
