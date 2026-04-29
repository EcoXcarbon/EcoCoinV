// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title CertificateNFT
 * @notice ERC-721 contract for carbon retirement certificates
 * @dev Soulbound tokens representing carbon offset achievements
 * 
 * Features:
 * - Unique retirement certificates (ERC-721)
 * - Soulbound (non-transferable) option
 * - Dynamic metadata with IPFS
 * - Achievement tracking
 * - Batch minting support
 * - Enumerable for portfolio display
 * 
 * Certificate Types:
 * - Retirement Certificate: Issued when carbon is retired
 * - Achievement Badge: Milestones (1T, 10T, 100T, etc.)
 * - Project Supporter: Contributing to specific projects
 */
contract CertificateNFT is
    ERC721,
    ERC721URIStorage,
    ERC721Enumerable,
    AccessControl,
    Pausable,
    ReentrancyGuard
{
    // Security: Max batch size to prevent DoS attacks (audit item #8 - SWC-113)
    uint256 public constant MAX_BATCH_SIZE = 50;

    // Security: Rate limiting (audit items #81-100)
    uint256 public constant MINT_RATE_LIMIT = 100;
    uint256 public constant MINT_RATE_PERIOD = 1 hours;

    using Counters for Counters.Counter;

    // ═══════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════
    
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant URI_SETTER_ROLE = keccak256("URI_SETTER_ROLE");

    // ═══════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════
    
    /// @notice Token ID counter
    Counters.Counter private _tokenIdCounter;
    
    /// @notice Base URI for metadata
    string private _baseTokenURI;
    
    /// @notice Whether certificates are soulbound (non-transferable)
    bool public isSoulbound;
    
    /// @notice Per-token soulbound status
    mapping(uint256 => bool) public tokenSoulbound;

    // ═══════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════
    
    enum CertificateType {
        RETIREMENT,        // Basic retirement certificate
        MILESTONE,         // Achievement milestone
        PROJECT_SUPPORTER, // Project contribution
        EARLY_ADOPTER,     // Early user badge
        COMMUNITY_LEADER   // Community contribution
    }

    // ═══════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @dev Certificate metadata
     */
    struct Certificate {
        CertificateType certType;   // Certificate type
        uint256 carbonAmount;        // Tonnes CO2 offset
        string projectId;            // Related project ID
        string description;          // Certificate description
        uint256 issuanceDate;        // Issuance timestamp
        address issuer;              // Who issued the certificate
        bool revoked;                // Revocation status
    }
    
    /// @notice Certificate metadata per token ID
    mapping(uint256 => Certificate) public certificates;
    
    /// @notice User achievement tracking
    mapping(address => uint256) public userTotalCarbonRetired;
    mapping(address => uint256) public userCertificateCount;

    // Security: CERT-01 fix — per-minter rate limiting (audit items #81-100)
    mapping(address => uint256) public mintsThisPeriod;
    mapping(address => uint256) public mintPeriodStart;

    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════
    
    event CertificateMinted(
        address indexed to,
        uint256 indexed tokenId,
        CertificateType certType,
        uint256 carbonAmount,
        string projectId
    );
    
    event CertificateRevoked(
        uint256 indexed tokenId,
        address indexed revoker,
        string reason
    );
    
    event SoulboundStatusUpdated(
        bool isSoulbound
    );
    
    event BaseURIUpdated(
        string newBaseURI
    );

    // Security: Events for monitoring (audit items #246-260)
    event RateLimitExceeded(address indexed minter, uint256 mintCount, uint256 timestamp);

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Initialize certificate NFT contract
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param baseTokenURI_ Base URI for metadata
     * @param soulbound_ Whether certificates are soulbound
     */
    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseTokenURI_,
        bool soulbound_
    ) ERC721(name_, symbol_) {
        _baseTokenURI = baseTokenURI_;
        isSoulbound = soulbound_;
        
        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(URI_SETTER_ROLE, msg.sender);
        
        // Start token IDs at 1
        _tokenIdCounter.increment();
    }

    // ═══════════════════════════════════════════════════════════════
    // MINTING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Mint retirement certificate
     * @param to Recipient address
     * @param certType Certificate type
     * @param carbonAmount Tonnes CO2 offset
     * @param projectId Project identifier
     * @param description Certificate description
     * @param metadataURI IPFS URI for metadata
     * @return tokenId Minted token ID
     */
    /**
     * @notice Mint retirement certificate (uint8 certType variant for interface compatibility).
     * @dev ICertificateNFT in ECCToken declares certType as uint8; enums are uint8-encoded
     *      in the ABI so the selector is identical — this signature is the canonical one.
     */
    function mintCertificate(
        address to,
        uint8   certType,
        uint256 carbonAmount,
        string memory projectId,
        string memory description,
        string memory metadataURI
    ) external onlyRole(MINTER_ROLE) nonReentrant whenNotPaused returns (uint256) {
        return _mintCertificateInternal(to, CertificateType(certType), carbonAmount, projectId, description, metadataURI);
    }

    function _mintCertificateInternal(
        address to,
        CertificateType certType,
        uint256 carbonAmount,
        string memory projectId,
        string memory description,
        string memory metadataURI
    ) internal returns (uint256) {
        require(to != address(0), "Invalid recipient");

        // Security: Rate limiting check (audit items #81-100)
        _checkRateLimit(1);

        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        
        // Create certificate metadata
        certificates[tokenId] = Certificate({
            certType: certType,
            carbonAmount: carbonAmount,
            projectId: projectId,
            description: description,
            issuanceDate: block.timestamp,
            issuer: msg.sender,
            revoked: false
        });
        
        // Update user stats
        userTotalCarbonRetired[to] += carbonAmount;
        userCertificateCount[to]++;
        
        // Mark as soulbound if global setting is enabled
        if (isSoulbound) {
            tokenSoulbound[tokenId] = true;
        }
        
        // Mint token
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataURI);
        
        emit CertificateMinted(to, tokenId, certType, carbonAmount, projectId);
        
        return tokenId;
    }
    
    /**
     * @notice Batch mint certificates
     * @param recipients Array of recipient addresses
     * @param certTypes Array of certificate types
     * @param carbonAmounts Array of carbon amounts
     * @param projectIds Array of project IDs
     * @param metadataURIs Array of metadata URIs
     * @return tokenIds Array of minted token IDs
     */
    function mintBatch(
        address[] memory recipients,
        CertificateType[] memory certTypes,
        uint256[] memory carbonAmounts,
        string[] memory projectIds,
        string[] memory metadataURIs
    ) external onlyRole(MINTER_ROLE) nonReentrant whenNotPaused returns (uint256[] memory) {
        require(recipients.length == certTypes.length, "Length mismatch");
        require(recipients.length == carbonAmounts.length, "Length mismatch");
        require(recipients.length == projectIds.length, "Length mismatch");
        require(recipients.length == metadataURIs.length, "Length mismatch");
        // Security: Prevent DoS via unbounded loops (audit item #8 - SWC-113)
        require(recipients.length <= MAX_BATCH_SIZE, "Batch too large");

        // CERT-02 fix: Rate limit by batch size, not counted as single mint
        _checkRateLimit(recipients.length);

        uint256[] memory tokenIds = new uint256[](recipients.length);
        
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient");
            
            uint256 tokenId = _tokenIdCounter.current();
            _tokenIdCounter.increment();
            tokenIds[i] = tokenId;
            
            certificates[tokenId] = Certificate({
                certType: certTypes[i],
                carbonAmount: carbonAmounts[i],
                projectId: projectIds[i],
                description: "",
                issuanceDate: block.timestamp,
                issuer: msg.sender,
                revoked: false
            });
            
            userTotalCarbonRetired[recipients[i]] += carbonAmounts[i];
            userCertificateCount[recipients[i]]++;
            
            if (isSoulbound) {
                tokenSoulbound[tokenId] = true;
            }
            
            _safeMint(recipients[i], tokenId);
            _setTokenURI(tokenId, metadataURIs[i]);
            
            emit CertificateMinted(
                recipients[i],
                tokenId,
                certTypes[i],
                carbonAmounts[i],
                projectIds[i]
            );
        }
        
        return tokenIds;
    }

    // ═══════════════════════════════════════════════════════════════
    // ACHIEVEMENT FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Check if user qualifies for milestone achievement
     * @param user User address
     * @return milestones Array of milestone amounts user has achieved
     */
    function checkMilestones(address user) 
        external 
        view 
        returns (uint256[] memory milestones) 
    {
        uint256 totalRetired = userTotalCarbonRetired[user];
        uint256[] memory achievedMilestones = new uint256[](10);
        uint256 count = 0;
        
        // Check milestone thresholds: 1, 10, 100, 1000, 10000 tonnes
        uint256[10] memory thresholds = [
            uint256(1),
            uint256(10),
            uint256(100),
            uint256(1000),
            uint256(10000),
            uint256(100000),
            uint256(1000000),
            uint256(10000000),
            uint256(100000000),
            uint256(1000000000)
        ];
        
        for (uint256 i = 0; i < thresholds.length; i++) {
            if (totalRetired >= thresholds[i]) {
                achievedMilestones[count] = thresholds[i];
                count++;
            }
        }
        
        // Resize array to actual count
        milestones = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            milestones[i] = achievedMilestones[i];
        }
        
        return milestones;
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Get certificate details
     * @param tokenId Token ID
     * @return Certificate metadata
     */
    function getCertificate(uint256 tokenId) 
        external 
        view 
        returns (Certificate memory) 
    {
        require(_exists(tokenId), "Token does not exist");
        return certificates[tokenId];
    }
    
    /**
     * @notice Get all certificates owned by user
     * @param user User address
     * @return tokenIds Array of token IDs
     */
    function getUserCertificates(address user) 
        external 
        view 
        returns (uint256[] memory) 
    {
        uint256 balance = balanceOf(user);
        uint256[] memory tokenIds = new uint256[](balance);
        
        for (uint256 i = 0; i < balance; i++) {
            tokenIds[i] = tokenOfOwnerByIndex(user, i);
        }
        
        return tokenIds;
    }
    
    /**
     * @notice Get user statistics
     * @param user User address
     * @return totalRetired Total carbon retired
     * @return certificateCount Number of certificates
     */
    function getUserStats(address user) 
        external 
        view 
        returns (uint256 totalRetired, uint256 certificateCount) 
    {
        return (
            userTotalCarbonRetired[user],
            userCertificateCount[user]
        );
    }
    
    /**
     * @notice Get base URI
     * @return Base token URI
     */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Revoke certificate
     * @param tokenId Token ID to revoke
     * @param reason Revocation reason
     */
    // CERT-03 fix: Also burn the token on revocation to remove it from holder's wallet
    function revokeCertificate(uint256 tokenId, string memory reason)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_exists(tokenId), "Token does not exist");
        require(!certificates[tokenId].revoked, "Already revoked");

        certificates[tokenId].revoked = true;
        _burn(tokenId);

        emit CertificateRevoked(tokenId, msg.sender, reason);
    }
    
    /**
     * @notice Returns a collision-resistant hash of certificate parameters (interface compliance).
     * @dev Uses abi.encode (not abi.encodePacked) to avoid hash collisions with multiple
     *      dynamic-type arguments (strings).
     */
    function getCertificateHash(
        address to,
        uint8   certType,
        uint256 carbonAmount,
        string memory projectId,
        string memory description,
        string memory metadataURI
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(to, certType, carbonAmount, projectId, description, metadataURI));
    }

    /**
     * @notice Burn a soulbound certificate (admin only).
     * @dev Required to remove soulbound tokens that cannot be transferred.
     * @param tokenId Token ID to burn.
     */
    function burn(uint256 tokenId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_exists(tokenId), "Token does not exist");
        _burn(tokenId);
    }

    /**
     * @notice Set base URI
     * @param baseURI New base URI
     */
    function setBaseURI(string memory baseURI) 
        external 
        onlyRole(URI_SETTER_ROLE) 
    {
        _baseTokenURI = baseURI;
        emit BaseURIUpdated(baseURI);
    }
    
    /**
     * @notice Enable soulbound status (one-way lock — cannot be disabled once enabled).
     * @dev RT-8: Soulbound is a security guarantee for certificate holders. Once enabled,
     *      disabling it would allow previously non-transferable certificates to be traded,
     *      undermining the trust model. Only allows setting true.
     */
    function setSoulbound(bool soulbound)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(soulbound, "Cannot disable soulbound");
        isSoulbound = soulbound;
        emit SoulboundStatusUpdated(soulbound);
    }
    
    /**
     * @notice Set individual token soulbound status
     * @param tokenId Token ID
     * @param soulbound Soulbound status
     */
    function setTokenSoulbound(uint256 tokenId, bool soulbound) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(_exists(tokenId), "Token does not exist");
        tokenSoulbound[tokenId] = soulbound;
    }
    
    /**
     * @notice Pause contract
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    /**
     * @notice Unpause contract
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERNAL OVERRIDES
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @dev Hook before token transfer
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override(ERC721, ERC721Enumerable) whenNotPaused {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        
        // Prevent transfer if soulbound (except minting/burning)
        if (from != address(0) && to != address(0)) {
            require(!tokenSoulbound[tokenId], "Token is soulbound");
        }
    }
    
    /**
     * @dev Burn override
     */
    function _burn(uint256 tokenId) 
        internal 
        override(ERC721, ERC721URIStorage) 
    {
        super._burn(tokenId);
    }
    
    /**
     * @dev Token URI override
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }
    
    /**
     * @dev See {IERC165-supportsInterface}
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, ERC721Enumerable, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECURITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @dev Internal rate limit check (audit items #81-100)
     * CERT-01 fix: Per-minter tracking
     * CERT-02 fix: Accepts count parameter for batch operations
     */
    function _checkRateLimit(uint256 count) internal {
        if (block.timestamp > mintPeriodStart[msg.sender] + MINT_RATE_PERIOD) {
            mintPeriodStart[msg.sender] = block.timestamp;
            mintsThisPeriod[msg.sender] = count;
        } else {
            mintsThisPeriod[msg.sender] += count;
        }
        if (mintsThisPeriod[msg.sender] > MINT_RATE_LIMIT) {
            emit RateLimitExceeded(msg.sender, mintsThisPeriod[msg.sender], block.timestamp);
            revert("Rate limit exceeded");
        }
    }
}
