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
    uint256 public constant MAX_TICKETS_PER_TX = 100;   // anti-MEV: cap per transaction

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
    mapping(uint256 => bool) public prizeClaimed;

    address public treasury;
    uint256 public totalBurned;

    // ── Events ─────────────────────────────────────────────────────────────
    event RoundCreated(uint256 indexed roundId, uint256 ticketPrice, uint64 endTime);
    event TicketsPurchased(uint256 indexed roundId, address indexed buyer, uint256 count);
    event WinnersDrawn(uint256 indexed roundId, address[] winners);
    event VRFRequested(uint256 indexed roundId, uint256 requestId);
    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);
    event RoundCancelled(uint256 indexed roundId);
    event TokensBurned(uint256 amount);
    event VRFConfigUpdated(address coordinator, bytes32 keyHash, uint64 subId);

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
        require(startTime    < endTime,          "Invalid times");
        require(treasuryFee  <= MAX_TREASURY_FEE,"Fee too high");
        require(burnPercent  + treasuryFee <= FEE_BASE, "Fee overflow");
        require(prizeTiers.length > 0,           "No prize tiers");

        uint256 totalPct = 0;
        for (uint256 i = 0; i < prizeTiers.length; i++) {
            totalPct += prizeTiers[i].percentage;
        }
        require(totalPct <= FEE_BASE, "Prize tiers exceed 100%");

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
        if (r.maxTickets > 0) {
            require(r.totalTickets + count <= r.maxTickets, "Sold out");
        }

        uint256 totalCost  = r.ticketPrice * count;
        uint256 burnAmount = (totalCost * r.burnPercent) / FEE_BASE;
        uint256 feeAmount  = (totalCost * r.treasuryFee) / FEE_BASE;

        // CEI: update all state before any external transfers
        r.prizePool    += totalCost - burnAmount - feeAmount;
        r.totalTickets += count;
        userTicketCount[roundId][msg.sender] += count;

        for (uint256 i = 0; i < count; i++) {
            roundTickets[roundId].push(Ticket({
                owner:        msg.sender,
                roundId:      roundId,
                ticketNumber: r.totalTickets - count + i
            }));
        }

        emit TicketsPurchased(roundId, msg.sender, count);

        // Transfers last
        eccToken.safeTransferFrom(msg.sender, address(this), totalCost);
        if (burnAmount > 0) {
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
     * @notice Initiate winner draw. Requires Chainlink VRF to be configured.
     * @dev    VRF must be set via setVRFConfig() before any draw can proceed.
     *         Pseudo-random fallback has been removed (A5 fix — CRI randomness check).
     */
    function drawWinners(uint256 roundId) external onlyRole(LOTTERY_ADMIN_ROLE) nonReentrant {
        Round storage r = rounds[roundId];
        require(block.timestamp >= r.endTime, "Round not ended");
        require(r.status == LotteryStatus.OPEN, "Not open");
        require(r.totalTickets > 0,             "No tickets sold");
        require(vrfEnabled, "VRF not configured: call setVRFConfig first");

        r.status = LotteryStatus.DRAWING;

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

        emit WinnersDrawn(roundId, winnerList);
    }

    // ── Claim prize ────────────────────────────────────────────────────────
    function claimPrize(uint256 roundId) external nonReentrant {
        Round storage r = rounds[roundId];
        require(r.status == LotteryStatus.ENDED, "Round not ended");

        uint256 prize = userPrizes[roundId][msg.sender];
        require(prize > 0, "No prize");

        userPrizes[roundId][msg.sender] = 0;
        eccToken.safeTransfer(msg.sender, prize);

        emit PrizeClaimed(roundId, msg.sender, prize);
    }

    // ── Admin: cancel round ────────────────────────────────────────────────
    function cancelRound(uint256 roundId) external onlyRole(LOTTERY_ADMIN_ROLE) {
        Round storage r = rounds[roundId];
        require(r.status == LotteryStatus.OPEN, "Cannot cancel");
        r.status = LotteryStatus.CANCELLED;
        emit RoundCancelled(roundId);
    }

    // ── Refund on cancelled round ──────────────────────────────────────────
    function refundTickets(uint256 roundId) external nonReentrant {
        Round storage r = rounds[roundId];
        require(r.status == LotteryStatus.CANCELLED, "Not cancelled");
        uint256 count = userTicketCount[roundId][msg.sender];
        require(count > 0, "No tickets");
        userTicketCount[roundId][msg.sender] = 0;
        // Refund only the net amount that reached the prize pool
        uint256 netPerTicket = r.ticketPrice
            - (r.ticketPrice * r.burnPercent  / FEE_BASE)
            - (r.ticketPrice * r.treasuryFee  / FEE_BASE);
        uint256 refund    = count * netPerTicket;
        uint256 available = refund > r.prizePool ? r.prizePool : refund;
        r.prizePool -= available;
        eccToken.safeTransfer(msg.sender, available);
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0), "Zero address");
        treasury = _treasury;
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
