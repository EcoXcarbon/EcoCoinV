// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

// ── Interfaces ───────────────────────────────────────────────────────────────

interface IECCToken {
    function mint(address to, uint256 amount) external;
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId, int256 answer, uint256 startedAt,
        uint256 updatedAt, uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

interface ICarbonCreditNFT {
    function mint(
        address to, uint256 amount, string memory projectId,
        string memory vintage, string memory methodology,
        string memory region, bytes memory data
    ) external returns (uint256);
}

interface ICertificateNFT {
    function mintCertificate(
        address to, uint8 certType, uint256 carbonAmount,
        string memory projectId, string memory description,
        string memory metadataURI
    ) external returns (uint256);
}

/**
 * @title ECCCarbonOffset
 * @notice Carbon offset minting module for EcoCoin — retail & enterprise minting,
 *         referral system, NFT auto-minting, and Chainlink oracle integration.
 * @dev Extracted from ECCToken to keep the core token under the 24KB Spurious Dragon limit.
 *      This contract holds MINTER_ROLE on ECCToken and calls token.mint() for offset minting.
 *
 * Deployment order:
 *   1. Deploy ECCToken (core ERC-20)
 *   2. Deploy ECCCarbonOffset(eccTokenAddress)
 *   3. Grant MINTER_ROLE on ECCToken to ECCCarbonOffset
 */
contract ECCCarbonOffset is AccessControl, ReentrancyGuard, Pausable {

    // ═══════════════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════════════

    bytes32 public constant ADMIN_ROLE    = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant MAX_SUPPLY            = 1_000_000_000 * 10 ** 18;
    uint256 public constant EMISSION_RATE_PER_TON = 1 * 10 ** 18;

    uint256 public constant RETAIL_MAX_PER_TRANSACTION = 100  * 10 ** 18;
    uint256 public constant RETAIL_DAILY_LIMIT         = 1000 * 10 ** 18;

    uint256 public constant REFERRAL_REWARD_RATE       = 5;
    uint256 public constant AMBASSADOR_POOL_ALLOCATION = 2_000_000 * 10 ** 18;
    uint256 public constant MIN_REFERRER_BALANCE       = 100 * 10 ** 18;
    uint256 public constant MAX_REFERRALS_PER_USER     = 100;
    uint256 public constant MAX_PRICE_CHANGE_PERCENT   = 50;
    uint256 public constant REFERRAL_GRACE_PERIOD      = 7 days;

    uint256 public constant MAX_ENTERPRISE_MINT_DEFAULT = 10_000; // raw tonnes

    // ═══════════════════════════════════════════════════════════════════════
    // ENUMS & STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    enum UserTier           { RETAIL, ENTERPRISE }
    enum RetailActivityType { FLIGHT, CAR_TRAVEL, HOME_ENERGY, GENERAL }

    struct EnterpriseOffset {
        string  projectId;
        uint256 carbonTons;
        string  mrvHash;
        address verifier;
        bool    requiresWaiver;
        bool    waiverConfirmed;
        uint256 timestamp;
    }

    struct RetailOffset {
        RetailActivityType activityType;
        uint256 carbonTons;
        string  description;
        uint256 timestamp;
        bool    autoApproved;
    }

    struct UserProfile {
        UserTier tier;
        bool     acceptedRetailTerms;
        uint256  totalCarbonOffset;
        address  referrer;
        bool     hasReferrer;
        bool     hasReceivedReferralBonus;
        bool     hasMintedBefore;
        uint256  firstMintTime;
    }

    struct RetailMintRecord {
        uint256 timestamp;
        uint256 amount;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════

    IECCToken public immutable eccToken;

    mapping(address => UserProfile)          public userProfiles;
    mapping(address => EnterpriseOffset[])   public enterpriseOffsets;
    mapping(address => RetailOffset[])       public retailOffsets;

    uint256 public totalCarbonOffset;
    uint256 public totalRetailOffset;
    uint256 public totalEnterpriseOffset;

    bool    public retailMintingEnabled = true;
    mapping(RetailActivityType => uint256) public retailPricePerTon;

    // Referral
    mapping(address => address[]) public referrals;
    mapping(address => uint256)   public referralRewards;
    uint256 public totalReferralRewards;
    uint256 public ambassadorPoolRemaining;

    // Enterprise daily limit
    uint256 public maxEnterpriseMintPerTx = MAX_ENTERPRISE_MINT_DEFAULT;
    uint256 public enterpriseDailyLimit = 100_000 * 1e18; // in token units (wei)
    uint256 public enterpriseMintedToday;
    uint256 public enterpriseMintDayStart;

    // NFT integration
    ICarbonCreditNFT public carbonCreditNFT;
    ICertificateNFT  public certificateNFT;
    mapping(address => mapping(uint256 => bool)) public milestoneAwarded;

    // Chainlink Oracle
    AggregatorV3Interface public priceFeed;
    bool    public oracleEnabled;
    uint256 public stalePriceThreshold = 1 hours;

    // Ring buffer
    uint256 private constant RING_BUFFER_SIZE = 100;
    struct RingBuffer {
        RetailMintRecord[100] entries;
        uint256 head;
        uint256 count;
    }
    mapping(address => RingBuffer) private mintBuffer;

    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event RetailTermsAccepted(address indexed user, uint256 timestamp);
    event RetailOffsetMinted(address indexed user, uint256 carbonTons, RetailActivityType activityType, uint256 tokenAmount);
    event EnterpriseOffsetMinted(address indexed user, uint256 carbonTons, string projectId, uint256 tokenAmount);
    event RetailMintingToggled(bool enabled);
    event RetailPriceUpdated(RetailActivityType activityType, uint256 pricePerTon);
    event ReferralRegistered(address indexed referee, address indexed referrer);
    event ReferralRewardPaid(address indexed referrer, address indexed referee, uint256 amount);
    event NFTContractsSet(address indexed carbonNFT, address indexed certNFT);
    event PriceFeedSet(address indexed feed, bool enabled);
    event StalePriceThresholdUpdated(uint256 newThreshold);
    event CarbonNFTAutoMinted(address indexed user, uint256 indexed nftTokenId, uint256 carbonTons);
    event MilestoneAwarded(address indexed user, uint256 milestone, uint256 nftTokenId);
    event EnterpriseDailyLimitUpdated(uint256 newLimit);
    event CarbonNFTMintFailed(address indexed user, uint256 carbonTons, bytes reason);
    event MilestoneAwardFailed(address indexed user, uint256 milestone, bytes reason);

    // ═══════════════════════════════════════════════════════════════════════
    // CUSTOM ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidAddress();
    error ExceedsMaxSupply();
    error DailyLimitExceeded();
    error ReferrerNotQualified();
    error AlreadyHasReferrer();
    error CannotReferSelf();
    error MaxReferralsReached();
    error PriceChangeTooDrastic();

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(address _eccToken) {
        if (_eccToken == address(0)) revert InvalidAddress();
        eccToken = IECCToken(_eccToken);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE,         msg.sender);
        _grantRole(MINTER_ROLE,        msg.sender);
        _grantRole(PAUSER_ROLE,        msg.sender);

        ambassadorPoolRemaining = AMBASSADOR_POOL_ALLOCATION;

        retailPricePerTon[RetailActivityType.FLIGHT]      = 0.01 ether;
        retailPricePerTon[RetailActivityType.CAR_TRAVEL]  = 0.005 ether;
        retailPricePerTon[RetailActivityType.HOME_ENERGY] = 0.008 ether;
        retailPricePerTon[RetailActivityType.GENERAL]     = 0.01 ether;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RETAIL CARBON OFFSET MINTING
    // ═══════════════════════════════════════════════════════════════════════

    function acceptRetailTerms() external {
        userProfiles[msg.sender].acceptedRetailTerms = true;
        emit RetailTermsAccepted(msg.sender, block.timestamp);
    }

    function mintRetailOffset(
        RetailActivityType activityType,
        uint256 carbonTons,
        string memory description
    ) external payable nonReentrant whenNotPaused {
        UserProfile storage profile = userProfiles[msg.sender];

        require(retailMintingEnabled, "Retail minting disabled");
        require(profile.acceptedRetailTerms, "Must accept terms");
        require(carbonTons > 0, "Zero carbon tons");

        uint256 tokenAmount = carbonTons * EMISSION_RATE_PER_TON;
        require(tokenAmount <= RETAIL_MAX_PER_TRANSACTION, "Exceeds per-transaction limit");

        _checkRolling24HourLimit(msg.sender, tokenAmount);

        uint256 requiredPayment = carbonTons * retailPricePerTon[activityType];
        require(msg.value >= requiredPayment, "Insufficient payment");

        if (eccToken.totalSupply() + tokenAmount > MAX_SUPPLY) revert ExceedsMaxSupply();

        profile.tier              = UserTier.RETAIL;
        profile.totalCarbonOffset += carbonTons;
        if (!profile.hasMintedBefore) {
            profile.hasMintedBefore = true;
            profile.firstMintTime   = block.timestamp;
        }

        _addToBuffer(msg.sender, RetailMintRecord({
            timestamp: block.timestamp,
            amount:    tokenAmount
        }));

        totalCarbonOffset += carbonTons;
        totalRetailOffset += carbonTons;

        retailOffsets[msg.sender].push(RetailOffset({
            activityType: activityType,
            carbonTons:   carbonTons,
            description:  description,
            timestamp:    block.timestamp,
            autoApproved: true
        }));

        eccToken.mint(msg.sender, tokenAmount);
        _payReferralReward(msg.sender, tokenAmount);
        _tryMintCarbonNFT(msg.sender, carbonTons, _activityTypeStr(activityType), "Retail", _activityTypeStr(activityType));
        _tryAwardMilestones(msg.sender);

        emit RetailOffsetMinted(msg.sender, carbonTons, activityType, tokenAmount);

        if (msg.value > requiredPayment) {
            uint256 refundAmt = msg.value - requiredPayment;
            (bool refundOk, ) = msg.sender.call{value: refundAmt}("");
            require(refundOk, "POL refund failed");
        }
    }

    function _checkRolling24HourLimit(address user, uint256 newAmount) private view {
        uint256 cutoff   = block.timestamp - 24 hours;
        uint256 total24h = 0;
        RingBuffer storage buf = mintBuffer[user];
        uint256 cnt   = buf.count;
        uint256 start = (buf.head >= cnt)
            ? (buf.head - cnt) % RING_BUFFER_SIZE
            : 0;
        for (uint256 i = 0; i < cnt; i++) {
            RetailMintRecord storage rec = buf.entries[(start + i) % RING_BUFFER_SIZE];
            if (rec.timestamp >= cutoff) {
                total24h += rec.amount;
            }
        }
        if (total24h + newAmount > RETAIL_DAILY_LIMIT) revert DailyLimitExceeded();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ENTERPRISE CARBON OFFSET MINTING
    // ═══════════════════════════════════════════════════════════════════════

    function mintEnterpriseOffset(
        address to,
        string calldata projectId,
        uint256 carbonTons,
        string calldata mrvHash
    ) external onlyRole(MINTER_ROLE) nonReentrant whenNotPaused returns (uint256) {
        if (to == address(0)) revert InvalidAddress();
        require(carbonTons > 0, "Zero carbon tons");
        require(carbonTons <= maxEnterpriseMintPerTx, "Exceeds enterprise cap");

        uint256 tokenAmount = carbonTons * EMISSION_RATE_PER_TON;

        // Enterprise daily limit
        uint256 today = block.timestamp / 1 days;
        if (today != enterpriseMintDayStart) {
            enterpriseMintDayStart = today;
            enterpriseMintedToday = 0;
        }
        require(enterpriseMintedToday + tokenAmount <= enterpriseDailyLimit, "Enterprise daily limit exceeded");
        enterpriseMintedToday += tokenAmount;

        if (eccToken.totalSupply() + tokenAmount > MAX_SUPPLY) revert ExceedsMaxSupply();

        UserProfile storage profile = userProfiles[to];
        profile.tier               = UserTier.ENTERPRISE;
        profile.totalCarbonOffset += carbonTons;
        if (!profile.hasMintedBefore) {
            profile.hasMintedBefore = true;
            profile.firstMintTime   = block.timestamp;
        }
        totalCarbonOffset         += carbonTons;
        totalEnterpriseOffset     += carbonTons;

        enterpriseOffsets[to].push(EnterpriseOffset({
            projectId:       projectId,
            carbonTons:      carbonTons,
            mrvHash:         mrvHash,
            verifier:        msg.sender,
            requiresWaiver:  true,
            waiverConfirmed: false,
            timestamp:       block.timestamp
        }));

        eccToken.mint(to, tokenAmount);
        _payReferralReward(to, tokenAmount);
        _tryMintCarbonNFT(to, carbonTons, string(projectId), "Enterprise", "MRV-Verified");
        _tryAwardMilestones(to);

        emit EnterpriseOffsetMinted(to, carbonTons, projectId, tokenAmount);
        return tokenAmount;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // REFERRAL SYSTEM
    // ═══════════════════════════════════════════════════════════════════════

    function registerReferrer(address referrer) external {
        UserProfile storage profile = userProfiles[msg.sender];
        if (profile.hasReferrer) revert AlreadyHasReferrer();
        if (profile.hasMintedBefore) {
            require(
                block.timestamp <= profile.firstMintTime + REFERRAL_GRACE_PERIOD,
                "Referral grace period expired"
            );
        }
        if (referrer == msg.sender) revert CannotReferSelf();
        if (referrer == address(0))                  revert InvalidAddress();
        if (referrals[referrer].length >= MAX_REFERRALS_PER_USER) revert MaxReferralsReached();

        if (eccToken.balanceOf(referrer) < MIN_REFERRER_BALANCE &&
            userProfiles[referrer].totalCarbonOffset < 1) {
            revert ReferrerNotQualified();
        }

        userProfiles[msg.sender].referrer    = referrer;
        userProfiles[msg.sender].hasReferrer = true;
        referrals[referrer].push(msg.sender);

        emit ReferralRegistered(msg.sender, referrer);
    }

    function _payReferralReward(address referee, uint256 mintAmount) private {
        UserProfile storage profile = userProfiles[referee];
        if (profile.hasReceivedReferralBonus) return;
        if (!profile.hasReferrer) return;

        address referrer = profile.referrer;
        uint256 reward   = (mintAmount * REFERRAL_REWARD_RATE) / 100;
        if (reward > ambassadorPoolRemaining) return;

        ambassadorPoolRemaining           -= reward;
        referralRewards[referrer]         += reward;
        totalReferralRewards              += reward;

        if (eccToken.totalSupply() + reward <= MAX_SUPPLY) {
            eccToken.mint(referrer, reward);
            profile.hasReceivedReferralBonus = true;
            emit ReferralRewardPaid(referrer, referee, reward);
        } else {
            ambassadorPoolRemaining  += reward;
            referralRewards[referrer] -= reward;
            totalReferralRewards     -= reward;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function toggleRetailMinting(bool enabled) external onlyRole(ADMIN_ROLE) {
        retailMintingEnabled = enabled;
        emit RetailMintingToggled(enabled);
    }

    function updateRetailPrice(RetailActivityType activityType, uint256 pricePerTon)
        external onlyRole(ADMIN_ROLE)
    {
        require(pricePerTon > 0, "Price cannot be zero");
        uint256 currentPrice = retailPricePerTon[activityType];
        if (currentPrice > 0) {
            uint256 priceDiff = pricePerTon > currentPrice
                ? pricePerTon - currentPrice
                : currentPrice - pricePerTon;
            if ((priceDiff * 100) / currentPrice > MAX_PRICE_CHANGE_PERCENT)
                revert PriceChangeTooDrastic();
        }
        retailPricePerTon[activityType] = pricePerTon;
        emit RetailPriceUpdated(activityType, pricePerTon);
    }

    function setNFTContracts(address _carbonNFT, address _certNFT)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        carbonCreditNFT = ICarbonCreditNFT(_carbonNFT);
        certificateNFT  = ICertificateNFT(_certNFT);
        emit NFTContractsSet(_carbonNFT, _certNFT);
    }

    function setEnterpriseDailyLimit(uint256 _limit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_limit > 0, "Zero limit");
        enterpriseDailyLimit = _limit;
        emit EnterpriseDailyLimitUpdated(_limit);
    }

    function setMaxEnterpriseMintPerTx(uint256 _maxTons) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_maxTons > 0 && _maxTons <= 100_000, "Invalid cap");
        maxEnterpriseMintPerTx = _maxTons;
    }

    function withdrawPayments(address payable to, uint256 amount)
        external onlyRole(ADMIN_ROLE) nonReentrant
    {
        if (to == address(0)) revert InvalidAddress();
        require(amount > 0 && amount <= address(this).balance, "Invalid amount");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Transfer failed");
    }

    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ═══════════════════════════════════════════════════════════════════════
    // CHAINLINK ORACLE
    // ═══════════════════════════════════════════════════════════════════════

    function setPriceFeed(address feed, bool enabled)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        priceFeed      = AggregatorV3Interface(feed);
        oracleEnabled  = (feed != address(0)) && enabled;
        emit PriceFeedSet(feed, oracleEnabled);
    }

    function setStalePriceThreshold(uint256 threshold)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(threshold >= 1 minutes, "Threshold too low");
        stalePriceThreshold = threshold;
        emit StalePriceThresholdUpdated(threshold);
    }

    function getLatestPrice() public view returns (int256 price, bool valid) {
        if (!oracleEnabled || address(priceFeed) == address(0)) return (0, false);
        try priceFeed.latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 updatedAt, uint80
        ) {
            if (answer <= 0) return (0, false);
            if (block.timestamp - updatedAt > stalePriceThreshold) return (0, false);
            return (answer, true);
        } catch {
            return (0, false);
        }
    }

    function usdToNative(uint256 usdAmount, uint256 fallbackWei)
        public view returns (uint256 nativeAmount)
    {
        (int256 price, bool valid) = getLatestPrice();
        if (valid && price > 0) {
            nativeAmount = (usdAmount * 1e18) / uint256(price);
        } else {
            nativeAmount = fallbackWei;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getUserProfile(address user) external view returns (
        UserTier tier, bool acceptedRetailTerms, uint256 userTotalCarbonOffset,
        uint256 retailOffsetsCount, uint256 enterpriseOffsetsCount,
        address referrer, bool hasReferrer
    ) {
        UserProfile memory p = userProfiles[user];
        return (
            p.tier, p.acceptedRetailTerms, p.totalCarbonOffset,
            retailOffsets[user].length, enterpriseOffsets[user].length,
            p.referrer, p.hasReferrer
        );
    }

    function getPlatformStats() external view returns (
        uint256 circulatingSupply, uint256 totalCO2Offset,
        uint256 retailOffsetTotal, uint256 enterpriseOffsetTotal,
        uint256 percentageOfMaxSupply, uint256 totalReferralRewardsPaid
    ) {
        return (
            eccToken.totalSupply(), totalCarbonOffset,
            totalRetailOffset, totalEnterpriseOffset,
            (eccToken.totalSupply() * 100) / MAX_SUPPLY,
            totalReferralRewards
        );
    }

    function getRemainingMintableSupply() external view returns (uint256) {
        return MAX_SUPPLY - eccToken.totalSupply();
    }

    function getReferralStats(address user) external view returns (
        uint256 totalRefs, uint256 totalRewardsEarned
    ) {
        return (referrals[user].length, referralRewards[user]);
    }

    function getUserReferrals(address user) external view returns (address[] memory) {
        return referrals[user];
    }

    function getRetailOffsetsPaginated(address user, uint256 offset, uint256 limit)
        public view returns (RetailOffset[] memory)
    {
        RetailOffset[] storage all = retailOffsets[user];
        if (offset >= all.length) return new RetailOffset[](0);
        uint256 end = offset + limit;
        if (end > all.length) end = all.length;
        uint256 len = end - offset;
        RetailOffset[] memory slice = new RetailOffset[](len);
        for (uint256 i = 0; i < len; i++) slice[i] = all[offset + i];
        return slice;
    }

    function getRetailOffsets(address user) external view returns (RetailOffset[] memory) {
        return getRetailOffsetsPaginated(user, 0, 100);
    }

    function getEnterpriseOffsetsPaginated(address user, uint256 offset, uint256 limit)
        public view returns (EnterpriseOffset[] memory)
    {
        EnterpriseOffset[] storage all = enterpriseOffsets[user];
        if (offset >= all.length) return new EnterpriseOffset[](0);
        uint256 end = offset + limit;
        if (end > all.length) end = all.length;
        uint256 len = end - offset;
        EnterpriseOffset[] memory slice = new EnterpriseOffset[](len);
        for (uint256 i = 0; i < len; i++) slice[i] = all[offset + i];
        return slice;
    }

    function getEnterpriseOffsets(address user) external view returns (EnterpriseOffset[] memory) {
        return getEnterpriseOffsetsPaginated(user, 0, 100);
    }

    function getMintHistory(address user)
        external view returns (RetailMintRecord[] memory records)
    {
        RingBuffer storage buf = mintBuffer[user];
        uint256 cnt = buf.count;
        records = new RetailMintRecord[](cnt);
        uint256 start = (buf.head - cnt) % RING_BUFFER_SIZE;
        for (uint256 i = 0; i < cnt; i++) {
            records[i] = buf.entries[(start + i) % RING_BUFFER_SIZE];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    function _addToBuffer(address user, RetailMintRecord memory rec) internal {
        RingBuffer storage buf = mintBuffer[user];
        buf.entries[buf.head % RING_BUFFER_SIZE] = rec;
        buf.head++;
        if (buf.count < RING_BUFFER_SIZE) buf.count++;
    }

    function _activityTypeStr(RetailActivityType t) private pure returns (string memory) {
        if (t == RetailActivityType.FLIGHT)      return "Flight";
        if (t == RetailActivityType.CAR_TRAVEL)  return "CarTravel";
        if (t == RetailActivityType.HOME_ENERGY) return "HomeEnergy";
        return "General";
    }

    function _tryMintCarbonNFT(
        address user, uint256 carbonTons, string memory projectId,
        string memory category, string memory methodology
    ) private {
        if (address(carbonCreditNFT) == address(0)) return;
        string memory vintage = _currentYear();
        try carbonCreditNFT.mint(user, carbonTons, projectId, vintage, methodology, category, "") returns (uint256 nftTokenId) {
            emit CarbonNFTAutoMinted(user, nftTokenId, carbonTons);
        } catch (bytes memory reason) {
            emit CarbonNFTMintFailed(user, carbonTons, reason);
        }
    }

    function _currentYear() private view returns (string memory) {
        uint256 year = 1970 + (block.timestamp / 365 days);
        return _uintToStr(year);
    }

    function _uintToStr(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 digits;
        uint256 tmp = v;
        while (tmp != 0) { digits++; tmp /= 10; }
        bytes memory buf = new bytes(digits);
        while (v != 0) { buf[--digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(buf);
    }

    function _tryAwardMilestones(address user) private {
        if (address(certificateNFT) == address(0)) return;
        uint256 total = userProfiles[user].totalCarbonOffset;
        uint256[4] memory thresholds = [uint256(1), uint256(10), uint256(100), uint256(1000)];
        for (uint256 i = 0; i < 4; i++) {
            uint256 t = thresholds[i];
            if (total >= t && !milestoneAwarded[user][t]) {
                milestoneAwarded[user][t] = true;
                try certificateNFT.mintCertificate(
                    user, 1, t, "milestone", "Carbon offset milestone", ""
                ) returns (uint256 nftId) {
                    emit MilestoneAwarded(user, t, nftId);
                } catch (bytes memory reason) {
                    emit MilestoneAwardFailed(user, t, reason);
                }
            }
        }
    }

    receive() external payable {}
}
