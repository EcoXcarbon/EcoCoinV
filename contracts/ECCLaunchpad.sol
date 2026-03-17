// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title ECCLaunchpad
 * @notice IDO/Token Sale platform for EcoCoin ecosystem projects.
 *
 * Sale types:
 *   PUBLIC   — anyone can participate up to maxAllocation
 *   WHITELIST — only whitelisted addresses
 *   FCFS     — first come first served, no per-user cap
 *
 * Features:
 *   - Multiple simultaneous sales
 *   - Whitelist management
 *   - Vesting of purchased tokens (cliff + linear)
 *   - Refund if soft cap not reached
 *   - Native POL or ERC-20 payment token
 *   - Emergency pause & withdrawal
 */
contract ECCLaunchpad is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant SALE_ADMIN_ROLE = keccak256("SALE_ADMIN_ROLE");

    enum SaleType   { PUBLIC, WHITELIST, FCFS }
    enum SaleStatus { PENDING, ACTIVE, ENDED, CANCELLED }

    struct Sale {
        address saleToken;          // token being sold
        address paymentToken;       // address(0) = native POL
        address raisedRecipient;    // validated recipient for withdrawRaised() (B8/B9 fix)
        uint256 tokenPrice;         // payment tokens per sale token (18 dec)
        uint256 hardCap;            // max payment tokens to raise
        uint256 softCap;            // min payment tokens to raise
        uint256 maxAllocation;      // max per wallet (0 = unlimited)
        uint256 minAllocation;      // min per wallet
        uint256 totalRaised;        // total payment tokens collected
        uint256 totalSold;          // total sale tokens sold
        uint64  startTime;
        uint64  endTime;
        uint64  cliffDuration;      // vesting cliff after sale ends
        uint64  vestingDuration;    // total vesting duration
        SaleType   saleType;
        SaleStatus status;
        bool    claimsEnabled;      // admin enables after TGE
        string  projectName;
        string  projectURI;
    }

    struct Allocation {
        uint256 paid;           // payment tokens contributed
        uint256 tokensBought;   // sale tokens bought
        uint256 tokensClaimed;  // sale tokens already claimed
        bool    refunded;
    }

    uint256 public nextSaleId;
    mapping(uint256 => Sale) public sales;
    mapping(uint256 => mapping(address => Allocation)) public allocations;
    mapping(uint256 => mapping(address => bool)) public whitelist;
    mapping(uint256 => address[]) public participants;

    // ── Events ─────────────────────────────────────────────────────────────
    event SaleCreated(uint256 indexed saleId, string projectName, address saleToken);
    event Purchased(uint256 indexed saleId, address indexed buyer, uint256 paid, uint256 tokens);
    event TokensClaimed(uint256 indexed saleId, address indexed buyer, uint256 amount);
    event Refunded(uint256 indexed saleId, address indexed buyer, uint256 amount);
    event SaleFinalized(uint256 indexed saleId, uint256 totalRaised);
    event SaleCancelled(uint256 indexed saleId);
    event WhitelistUpdated(uint256 indexed saleId, address[] addresses, bool status);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SALE_ADMIN_ROLE, msg.sender);
    }

    // ── Admin: create sale ─────────────────────────────────────────────────
    function createSale(
        address saleToken,
        address paymentToken,
        address raisedRecipient,
        uint256 tokenPrice,
        uint256 hardCap,
        uint256 softCap,
        uint256 maxAllocation,
        uint256 minAllocation,
        uint64  startTime,
        uint64  endTime,
        uint64  cliffDuration,
        uint64  vestingDuration,
        SaleType saleType,
        string calldata projectName,
        string calldata projectURI
    ) external onlyRole(SALE_ADMIN_ROLE) returns (uint256 saleId) {
        require(saleToken        != address(0), "Zero sale token");
        require(raisedRecipient  != address(0), "Zero recipient");   // B9 fix
        require(tokenPrice  > 0,           "Zero price");
        require(hardCap     > 0,           "Zero hard cap");
        require(softCap     <= hardCap,    "Soft > hard cap");
        require(startTime   < endTime,     "Invalid times");
        require(endTime     > block.timestamp, "End in past");

        saleId = nextSaleId++;
        sales[saleId] = Sale({
            saleToken:        saleToken,
            paymentToken:     paymentToken,
            raisedRecipient:  raisedRecipient,
            tokenPrice:       tokenPrice,
            hardCap:          hardCap,
            softCap:          softCap,
            maxAllocation:    maxAllocation,
            minAllocation:    minAllocation,
            totalRaised:      0,
            totalSold:        0,
            startTime:        startTime,
            endTime:          endTime,
            cliffDuration:    cliffDuration,
            vestingDuration:  vestingDuration,
            saleType:         saleType,
            status:           SaleStatus.PENDING,
            claimsEnabled:    false,
            projectName:      projectName,
            projectURI:       projectURI
        });

        emit SaleCreated(saleId, projectName, saleToken);
    }

    // ── Buy tokens ─────────────────────────────────────────────────────────
    /**
     * @param saleId        ID of the sale to participate in.
     * @param paymentAmount For ERC-20 payment token — amount to pay. Pass 0 for native POL.
     * @param minTokensOut  Slippage guard — revert if tokens received would be less than this.
     */
    function buy(uint256 saleId, uint256 paymentAmount, uint256 minTokensOut)
        external payable nonReentrant whenNotPaused
    {
        Sale storage s = sales[saleId];
        require(s.status == SaleStatus.PENDING || s.status == SaleStatus.ACTIVE, "Sale not active");
        require(block.timestamp >= s.startTime, "Not started");
        require(block.timestamp <= s.endTime,   "Sale ended");

        if (s.status == SaleStatus.PENDING) s.status = SaleStatus.ACTIVE;

        if (s.saleType == SaleType.WHITELIST) {
            require(whitelist[saleId][msg.sender], "Not whitelisted");
        }

        uint256 payment;
        if (s.paymentToken == address(0)) {
            payment = msg.value;
        } else {
            require(msg.value == 0, "Send ERC20 not POL");
            payment = paymentAmount;
        }

        require(payment >= s.minAllocation || s.minAllocation == 0, "Below min");

        Allocation storage alloc = allocations[saleId][msg.sender];
        if (s.maxAllocation > 0) {
            require(alloc.paid + payment <= s.maxAllocation, "Exceeds max allocation");
        }
        require(s.totalRaised + payment <= s.hardCap, "Hard cap reached");

        uint256 tokensBought = (payment * 1e18) / s.tokenPrice;
        require(tokensBought >= minTokensOut, "Slippage: too few tokens"); // slippage guard

        // CEI: update state before external transfer
        if (alloc.paid == 0) participants[saleId].push(msg.sender);
        alloc.paid         += payment;
        alloc.tokensBought += tokensBought;
        s.totalRaised      += payment;
        s.totalSold        += tokensBought;

        if (s.paymentToken != address(0)) {
            IERC20(s.paymentToken).safeTransferFrom(msg.sender, address(this), payment);
        }

        emit Purchased(saleId, msg.sender, payment, tokensBought);
    }

    // ── Claim vested tokens ────────────────────────────────────────────────
    function claim(uint256 saleId) external nonReentrant whenNotPaused {
        Sale storage s = sales[saleId];
        require(s.claimsEnabled, "Claims not enabled");
        require(block.timestamp >= s.endTime + s.cliffDuration, "Cliff not passed");

        Allocation storage alloc = allocations[saleId][msg.sender];
        require(alloc.tokensBought > 0, "Nothing bought");

        uint256 claimable = _claimable(s, alloc);
        require(claimable > 0, "Nothing to claim");

        alloc.tokensClaimed += claimable;
        IERC20(s.saleToken).safeTransfer(msg.sender, claimable);

        emit TokensClaimed(saleId, msg.sender, claimable);
    }

    // ── Refund if soft cap not reached ────────────────────────────────────
    function refund(uint256 saleId) external nonReentrant {
        Sale storage s = sales[saleId];
        require(
            s.status == SaleStatus.CANCELLED ||
            (block.timestamp > s.endTime && s.totalRaised < s.softCap),
            "Not refundable"
        );

        Allocation storage alloc = allocations[saleId][msg.sender];
        require(alloc.paid > 0,       "Nothing to refund");
        require(!alloc.refunded,      "Already refunded");

        alloc.refunded = true;
        uint256 amount = alloc.paid;

        if (s.paymentToken == address(0)) {
            (bool ok, ) = msg.sender.call{value: amount}("");
            require(ok, "POL refund failed");
        } else {
            IERC20(s.paymentToken).safeTransfer(msg.sender, amount);
        }

        emit Refunded(saleId, msg.sender, amount);
    }

    // ── Admin: finalize sale ───────────────────────────────────────────────
    function finalizeSale(uint256 saleId) external onlyRole(SALE_ADMIN_ROLE) {
        Sale storage s = sales[saleId];
        require(block.timestamp > s.endTime, "Sale not ended");
        require(s.status == SaleStatus.ACTIVE || s.status == SaleStatus.PENDING, "Already finalized");

        s.status = SaleStatus.ENDED;
        emit SaleFinalized(saleId, s.totalRaised);
    }

    function cancelSale(uint256 saleId) external onlyRole(SALE_ADMIN_ROLE) {
        Sale storage s = sales[saleId];
        require(s.status != SaleStatus.ENDED, "Already ended");
        s.status = SaleStatus.CANCELLED;
        emit SaleCancelled(saleId);
    }

    function enableClaims(uint256 saleId) external onlyRole(SALE_ADMIN_ROLE) {
        sales[saleId].claimsEnabled = true;
    }

    // ── Whitelist management ───────────────────────────────────────────────
    function updateWhitelist(uint256 saleId, address[] calldata addresses, bool status)
        external onlyRole(SALE_ADMIN_ROLE)
    {
        for (uint256 i = 0; i < addresses.length; i++) {
            whitelist[saleId][addresses[i]] = status;
        }
        emit WhitelistUpdated(saleId, addresses, status);
    }

    // ── Admin: withdraw raised funds ───────────────────────────────────────
    // B8/B9 fix: recipient is raisedRecipient set at sale creation — not a free parameter
    function withdrawRaised(uint256 saleId)
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant
    {
        Sale storage s = sales[saleId];
        require(s.status == SaleStatus.ENDED, "Sale not ended");
        require(s.totalRaised >= s.softCap,   "Soft cap not met");

        address recipient = s.raisedRecipient;  // validated non-zero at createSale
        uint256 amount    = s.totalRaised;
        s.totalRaised     = 0;                  // CEI: zero before transfer

        if (s.paymentToken == address(0)) {
            (bool ok, ) = recipient.call{value: amount}("");
            require(ok, "Withdraw failed");
        } else {
            IERC20(s.paymentToken).safeTransfer(recipient, amount);
        }
    }

    // ── Admin: deposit sale tokens ─────────────────────────────────────────
    function depositSaleTokens(uint256 saleId, uint256 amount)
        external onlyRole(SALE_ADMIN_ROLE)
    {
        IERC20(sales[saleId].saleToken).safeTransferFrom(msg.sender, address(this), amount);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Views ──────────────────────────────────────────────────────────────
    function claimableAmount(uint256 saleId, address user) external view returns (uint256) {
        return _claimable(sales[saleId], allocations[saleId][user]);
    }

    function getParticipants(uint256 saleId) external view returns (address[] memory) {
        return participants[saleId];
    }

    function _claimable(Sale storage s, Allocation storage alloc) internal view returns (uint256) {
        if (alloc.tokensBought == 0) return 0;
        uint256 elapsed = block.timestamp > s.endTime + s.cliffDuration
            ? block.timestamp - (s.endTime + s.cliffDuration)
            : 0;
        if (elapsed == 0) return 0;
        uint256 vested = s.vestingDuration == 0
            ? alloc.tokensBought
            : alloc.tokensBought * elapsed / s.vestingDuration;
        if (vested > alloc.tokensBought) vested = alloc.tokensBought;
        return vested > alloc.tokensClaimed ? vested - alloc.tokensClaimed : 0;
    }

    receive() external payable {}
}
