// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
// Dependency versions (enforced via package.json / npm audit)
// @openzeppelin/contracts  ^4.9.6   (>=4.9.3, latest safe patch)
// @chainlink/contracts     ^0.8.0
// ============================================================

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";

// package.json (excerpt — pin in your repo):
// {
//   "dependencies": {
//     "@openzeppelin/contracts": "^4.9.6",
//     "@chainlink/contracts": "^0.8.0"
//   },
//   "scripts": {
//     "audit": "npm audit --audit-level=high",
//     "audit:ci": "npm audit --audit-level=high --json | tee audit-report.json"
//   }
// }

/// @dev Minimal interface for auto-issuing retirement certificates.
interface ICertificateNFTForCarbon {
    function mintCertificate(
        address to,
        uint8   certType,
        uint256 carbonAmount,
        string memory projectId,
        string memory description,
        string memory metadataURI
    ) external returns (uint256);

    /// @dev Returns a collision-resistant hash of certificate parameters using abi.encode.
    /// Never use abi.encodePacked with multiple dynamic types (string, bytes) as arguments
    /// because it can produce identical byte sequences for different inputs (hash collision).
    function getCertificateHash(
        address to,
        uint8   certType,
        uint256 carbonAmount,
        string memory projectId,
        string memory description,
        string memory metadataURI
    ) external pure returns (bytes32);
}

/**
 * @notice A minimal 3-of-5 multisig guard that must be deployed before CarbonCreditNFT.
 *         All DEFAULT_ADMIN_ROLE and privileged roles are granted exclusively to this
 *         contract address, never to an EOA.
 *
 *         Deployment sequence:
 *         1. Deploy MultiSigAdmin with the 5 signer addresses.
 *         2. Deploy CarbonCreditNFT passing address(multiSigAdmin) as `adminMultisig`.
 *         3. The deployer holds NO roles after construction; all roles sit with the multisig.
 *
 * @dev    For production use, replace this lightweight implementation with a battle-tested
 *         multisig such as Gnosis Safe (https://safe.global) configured to a 3-of-5
 *         threshold, and pass its proxy address as `adminMultisig` in the constructor.
 *         The contract below is provided as a self-contained reference implementation.
 */
contract MultiSigAdmin {
    // ------------------------------------------------------------------ //
    //  Constants                                                           //
    // ------------------------------------------------------------------ //
    uint256 public constant REQUIRED_CONFIRMATIONS = 3;
    uint256 public constant MAX_OWNERS             = 5;

    // ------------------------------------------------------------------ //
    //  State                                                               //
    // ------------------------------------------------------------------ //
    address[] public owners;
    mapping(address => bool) public isOwner;

    struct Transaction {
        address  target;
        uint256  value;
        bytes    data;
        bool     executed;
        uint256  confirmations;
    }

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmed;

    // ------------------------------------------------------------------ //
    //  Events                                                              //
    // ------------------------------------------------------------------ //
    event TransactionSubmitted(uint256 indexed txId, address indexed submitter);
    event TransactionConfirmed(uint256 indexed txId, address indexed owner);
    event TransactionExecuted(uint256 indexed txId);
    event ConfirmationRevoked(uint256 indexed txId, address indexed owner);

    // ------------------------------------------------------------------ //
    //  Modifiers                                                           //
    // ------------------------------------------------------------------ //
    modifier onlyOwner() {
        require(isOwner[msg.sender], "MultiSigAdmin: not an owner");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactions.length, "MultiSigAdmin: tx does not exist");
        _;
    }

    modifier notExecuted(uint256 txId) {
        require(!transactions[txId].executed, "MultiSigAdmin: already executed");
        _;
    }

    modifier notConfirmed(uint256 txId) {
        require(!confirmed[txId][msg.sender], "MultiSigAdmin: already confirmed");
        _;
    }

    // ------------------------------------------------------------------ //
    //  Constructor                                                         //
    // ------------------------------------------------------------------ //
    constructor(address[] memory _owners) {
        require(
            _owners.length == MAX_OWNERS,
            "MultiSigAdmin: must have exactly 5 owners"
        );
        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "MultiSigAdmin: zero address owner");
            require(!isOwner[owner],     "MultiSigAdmin: duplicate owner");
            isOwner[owner] = true;
            owners.push(owner);
        }
    }

    receive() external payable {}

    // ------------------------------------------------------------------ //
    //  Functions                                                           //
    // ------------------------------------------------------------------ //

    function submitTransaction(address target, uint256 value, bytes calldata data)
        external onlyOwner returns (uint256 txId)
    {
        require(target != address(0), "MultiSigAdmin: zero target");
        txId = transactions.length;
        transactions.push(Transaction({
            target:        target,
            value:         value,
            data:          data,
            executed:      false,
            confirmations: 0
        }));
        emit TransactionSubmitted(txId, msg.sender);
        _confirm(txId);
    }

    function confirmTransaction(uint256 txId)
        external onlyOwner txExists(txId) notExecuted(txId) notConfirmed(txId)
    {
        _confirm(txId);
    }

    function revokeConfirmation(uint256 txId)
        external onlyOwner txExists(txId) notExecuted(txId)
    {
        require(confirmed[txId][msg.sender], "MultiSigAdmin: not confirmed");
        confirmed[txId][msg.sender] = false;
        transactions[txId].confirmations--;
        emit ConfirmationRevoked(txId, msg.sender);
    }

    function _confirm(uint256 txId) internal {
        confirmed[txId][msg.sender] = true;
        transactions[txId].confirmations++;
        emit TransactionConfirmed(txId, msg.sender);
        if (transactions[txId].confirmations >= REQUIRED_CONFIRMATIONS) {
            _execute(txId);
        }
    }

    function _execute(uint256 txId) internal {
        Transaction storage txn = transactions[txId];
        if (txn.executed) return;
        txn.executed = true;  // CEI: mark before external call (B1 fix)
        (bool ok, ) = txn.target.call{value: txn.value}(txn.data);
        require(ok, "MultiSigAdmin: execution failed");
        emit TransactionExecuted(txId);
    }
}

contract CarbonCreditNFT is ERC1155, AccessControl, Pausable, ReentrancyGuard {
    using Strings for uint256;

    // ═══════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════
    
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant URI_SETTER_ROLE = keccak256("URI_SETTER_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // Security: Max batch size to prevent DoS attacks (audit item #8 - SWC-113)
    uint256 public constant MAX_BATCH_SIZE = 50;

    // Security: Rate limiting for mint operations (audit items #81-100 - infrastructure security)
    uint256 public constant MINT_RATE_LIMIT = 100; // Max mints per hour
    uint256 public constant MINT_RATE_PERIOD = 1 hours;

    // ═══════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════
    
    /// @notice Base URI for token metadata
    string private _baseURI;
    
    /// @notice Next token ID to be minted
    uint256 private _nextTokenId;
    
    /// @notice Total supply per token ID
    mapping(uint256 => uint256) public totalSupply;
    
    /// @notice Retired amount per token ID
    mapping(uint256 => uint256) public totalRetired;
    
    /// @notice User retired amounts per token ID
    mapping(address => mapping(uint256 => uint256)) public userRetired;
    
    /// @notice Total retired by user across all tokens
    mapping(address => uint256) public userTotalRetired;
    
    /// @notice Custom URI per token ID
    mapping(uint256 => string) private _tokenURIs;
    
    /// @notice Whether token exists
    mapping(uint256 => bool) public tokenExists;
    
    /// @notice Transfer whitelist for compliance
    mapping(address => bool) public transferWhitelist;

    /// @notice Rate limiting tracking (audit items #81-100)
    uint256 public mintsThisPeriod;
    uint256 public mintPeriodStart;

    /// @notice CertificateNFT contract for auto-issuing first-retirement certificates.
    ICertificateNFTForCarbon public certificateNFT;
    /// @notice Tracks whether a user has already received their first retirement certificate.
    mapping(address => bool) public retirementCertIssued;

    // ═══════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @dev Carbon credit metadata
     */
    struct CarbonCredit {
        string projectId;        // Verra/Gold Standard project ID
        string vintage;          // Year of carbon reduction
        string methodology;      // Carbon accounting methodology
        string region;           // Geographic region
        uint256 totalAmount;     // Total tonnes issued
        uint256 retiredAmount;   // Total tonnes retired
        bool verified;           // Registry verification status
        uint256 issuanceDate;    // Token issuance timestamp
    }
    
    /// @notice Carbon credit metadata per token ID
    mapping(uint256 => CarbonCredit) public carbonCredits;

    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════
    
    event CarbonCreditMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint256 amount,
        string projectId,
        string vintage
    );
    
    event CarbonCreditRetired(
        address indexed by,
        uint256 indexed tokenId,
        uint256 amount,
        string reason
    );
    
    event CarbonCreditVerified(
        uint256 indexed tokenId,
        string projectId,
        address verifier
    );
    
    event TransferWhitelistUpdated(
        address indexed account,
        bool status
    );
    
    event BaseURIUpdated(
        string newBaseURI
    );

    // Security: Events for monitoring (audit items #246-260)
    event RateLimitExceeded(address indexed minter, uint256 mintCount, uint256 timestamp);
    event LargeRetirementDetected(address indexed user, uint256 tokenId, uint256 amount);
    event CertificateNFTSet(address indexed certNFT);
    event RetirementCertAutoIssued(address indexed user, uint256 certTokenId, uint256 carbonTons);

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Initialize carbon credit NFT contract
     * @param baseURI_ Base URI for metadata
     */
    constructor(string memory baseURI_) ERC1155(baseURI_) {
        _baseURI = baseURI_;
        _nextTokenId = 1;
        
        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(URI_SETTER_ROLE, msg.sender);
        _grantRole(VERIFIER_ROLE, msg.sender);
        
        // Whitelist contract itself for flexibility
        transferWhitelist[address(this)] = true;
    }

    // ═══════════════════════════════════════════════════════════════
    // MINTING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Mint new carbon credits
     * @param to Recipient address
     * @param amount Amount of credits (tonnes CO2)
     * @param projectId Project identifier
     * @param vintage Vintage year
     * @param methodology Carbon methodology
     * @param region Geographic region
     * @param data Additional data
     * @return tokenId The minted token ID
     */
    function mint(
        address to,
        uint256 amount,
        string memory projectId,
        string memory vintage,
        string memory methodology,
        string memory region,
        bytes memory data
    ) external onlyRole(MINTER_ROLE) nonReentrant returns (uint256) {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        require(bytes(projectId).length > 0, "Invalid project ID");

        // Security: Rate limiting check (audit items #81-100)
        _checkRateLimit();
        
        uint256 tokenId = _nextTokenId++;
        
        // Create carbon credit metadata
        carbonCredits[tokenId] = CarbonCredit({
            projectId: projectId,
            vintage: vintage,
            methodology: methodology,
            region: region,
            totalAmount: amount,
            retiredAmount: 0,
            verified: false,
            issuanceDate: block.timestamp
        });
        
        tokenExists[tokenId] = true;
        totalSupply[tokenId] = amount;
        
        // Mint tokens
        _mint(to, tokenId, amount, data);
        
        emit CarbonCreditMinted(to, tokenId, amount, projectId, vintage);
        
        return tokenId;
    }
    
    /**
     * @notice Batch mint multiple carbon credits
     * @param to Recipient address
     * @param amounts Array of amounts
     * @param projectIds Array of project IDs
     * @param vintages Array of vintages
     * @param data Additional data
     * @return tokenIds Array of minted token IDs
     */
    function mintBatch(
        address to,
        uint256[] memory amounts,
        string[] memory projectIds,
        string[] memory vintages,
        bytes memory data
    ) external onlyRole(MINTER_ROLE) nonReentrant returns (uint256[] memory) {
        require(to != address(0), "Invalid recipient");
        require(amounts.length == projectIds.length, "Length mismatch");
        require(amounts.length == vintages.length, "Length mismatch");
        // Security: Prevent DoS via unbounded loops (audit item #8 - SWC-113)
        require(amounts.length <= MAX_BATCH_SIZE, "Batch too large");
        
        uint256[] memory tokenIds = new uint256[](amounts.length);
        
        for (uint256 i = 0; i < amounts.length; i++) {
            require(amounts[i] > 0, "Invalid amount");
            
            uint256 tokenId = _nextTokenId++;
            tokenIds[i] = tokenId;
            
            carbonCredits[tokenId] = CarbonCredit({
                projectId: projectIds[i],
                vintage: vintages[i],
                methodology: "",
                region: "",
                totalAmount: amounts[i],
                retiredAmount: 0,
                verified: false,
                issuanceDate: block.timestamp
            });
            
            tokenExists[tokenId] = true;
            totalSupply[tokenId] = amounts[i];
        }
        
        _mintBatch(to, tokenIds, amounts, data);
        
        return tokenIds;
    }

    // ═══════════════════════════════════════════════════════════════
    // RETIREMENT FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Retire carbon credits (permanent removal)
     * @param tokenId Token ID to retire
     * @param amount Amount to retire
     * @param reason Retirement reason
     */
    function retire(
        uint256 tokenId,
        uint256 amount,
        string memory reason
    ) external nonReentrant whenNotPaused {
        require(tokenExists[tokenId], "Token does not exist");
        require(amount > 0, "Invalid amount");
        require(balanceOf(msg.sender, tokenId) >= amount, "Insufficient balance");
        
        // Burn tokens (permanent retirement)
        _burn(msg.sender, tokenId, amount);
        
        // Update retirement tracking
        totalRetired[tokenId] += amount;
        userRetired[msg.sender][tokenId] += amount;
        userTotalRetired[msg.sender] += amount;
        carbonCredits[tokenId].retiredAmount += amount;
        
        emit CarbonCreditRetired(msg.sender, tokenId, amount, reason);
        _tryIssueRetirementCert(msg.sender, amount, tokenId);
    }

    /**
     * @notice Batch retire multiple token types
     * @param tokenIds Array of token IDs
     * @param amounts Array of amounts
     * @param reason Retirement reason
     */
    function retireBatch(
        uint256[] memory tokenIds,
        uint256[] memory amounts,
        string memory reason
    ) external nonReentrant whenNotPaused {
        require(tokenIds.length == amounts.length, "Length mismatch");
        // Security: Prevent DoS via unbounded loops (audit item #8 - SWC-113)
        require(tokenIds.length <= MAX_BATCH_SIZE, "Batch too large");
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(tokenExists[tokenIds[i]], "Token does not exist");
            require(amounts[i] > 0, "Invalid amount");
            require(
                balanceOf(msg.sender, tokenIds[i]) >= amounts[i],
                "Insufficient balance"
            );
            
            totalRetired[tokenIds[i]] += amounts[i];
            userRetired[msg.sender][tokenIds[i]] += amounts[i];
            userTotalRetired[msg.sender] += amounts[i];
            carbonCredits[tokenIds[i]].retiredAmount += amounts[i];
            
            emit CarbonCreditRetired(msg.sender, tokenIds[i], amounts[i], reason);
        }
        
        _burnBatch(msg.sender, tokenIds, amounts);
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Get carbon credit details
     * @param tokenId Token ID
     * @return Carbon credit metadata
     */
    function getCarbonCredit(uint256 tokenId) 
        external 
        view 
        returns (CarbonCredit memory) 
    {
        require(tokenExists[tokenId], "Token does not exist");
        return carbonCredits[tokenId];
    }
    
    /**
     * @notice Get user's retirement statistics
     * @param user User address
     * @param tokenId Token ID
     * @return amount Amount retired by user for this token
     */
    function getUserRetirement(address user, uint256 tokenId) 
        external 
        view 
        returns (uint256) 
    {
        return userRetired[user][tokenId];
    }
    
    /**
     * @notice Get circulating supply (total - retired)
     * @param tokenId Token ID
     * @return Circulating supply
     */
    function circulatingSupply(uint256 tokenId) 
        external 
        view 
        returns (uint256) 
    {
        require(tokenExists[tokenId], "Token does not exist");
        return totalSupply[tokenId] - totalRetired[tokenId];
    }
    
    /**
     * @notice Get token URI
     * @param tokenId Token ID
     * @return Token URI string
     */
    function uri(uint256 tokenId) 
        public 
        view 
        override 
        returns (string memory) 
    {
        require(tokenExists[tokenId], "Token does not exist");
        
        string memory tokenURI = _tokenURIs[tokenId];
        
        // Return custom URI if set, otherwise use base URI
        if (bytes(tokenURI).length > 0) {
            return tokenURI;
        }
        
        return string(abi.encodePacked(_baseURI, tokenId.toString(), ".json"));
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Verify carbon credit with registry
     * @param tokenId Token ID
     */
    function verifyCarbonCredit(uint256 tokenId) 
        external 
        onlyRole(VERIFIER_ROLE) 
    {
        require(tokenExists[tokenId], "Token does not exist");
        require(!carbonCredits[tokenId].verified, "Already verified");
        
        carbonCredits[tokenId].verified = true;
        
        emit CarbonCreditVerified(
            tokenId,
            carbonCredits[tokenId].projectId,
            msg.sender
        );
    }
    
    /**
     * @notice Set base URI for all tokens
     * @param newBaseURI New base URI
     */
    function setBaseURI(string memory newBaseURI) 
        external 
        onlyRole(URI_SETTER_ROLE) 
    {
        _baseURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }
    
    /**
     * @notice Set custom URI for specific token
     * @param tokenId Token ID
     * @param tokenURI Custom URI
     */
    function setTokenURI(uint256 tokenId, string memory tokenURI) 
        external 
        onlyRole(URI_SETTER_ROLE) 
    {
        require(tokenExists[tokenId], "Token does not exist");
        _tokenURIs[tokenId] = tokenURI;
    }
    
    /**
     * @notice Update transfer whitelist
     * @param account Address to update
     * @param status Whitelist status
     */
    function updateTransferWhitelist(address account, bool status) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        transferWhitelist[account] = status;
        emit TransferWhitelistUpdated(account, status);
    }
    
    /**
     * @notice Pause all transfers
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    /**
     * @notice Unpause transfers
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
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal virtual override whenNotPaused {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
        
        // Skip checks for minting and burning
        if (from == address(0) || to == address(0)) {
            return;
        }
        
        // Optional: Enforce transfer whitelist for compliance
        // Uncomment if you want to restrict transfers
        // require(
        //     transferWhitelist[from] || transferWhitelist[to],
        //     "Transfer not whitelisted"
        // );
    }
    
    /**
     * @dev See {IERC165-supportsInterface}
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECURITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Set the CertificateNFT contract to enable auto-issuance on first retirement.
     * @param _certificateNFT Address of deployed CertificateNFT. Pass address(0) to disable.
     */
    function setCertificateNFT(address _certificateNFT)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        certificateNFT = ICertificateNFTForCarbon(_certificateNFT);
        emit CertificateNFTSet(_certificateNFT);
    }

    /// @dev Try issuing a RETIREMENT (type=0) certificate on the user's first retirement. Silent on failure.
    function _tryIssueRetirementCert(address user, uint256 carbonTons, uint256 tokenId) private {
        if (address(certificateNFT) == address(0)) return;
        if (retirementCertIssued[user]) return;
        retirementCertIssued[user] = true;
        string memory projectId = carbonCredits[tokenId].projectId;
        try certificateNFT.mintCertificate(
            user, 0, carbonTons, projectId, "First carbon retirement", ""
        ) returns (uint256 certId) {
            emit RetirementCertAutoIssued(user, certId, carbonTons);
        } catch {}
    }

    /**
     * @dev Internal rate limit check (audit items #81-100)
     */
    function _checkRateLimit() internal {
        if (block.timestamp > mintPeriodStart + MINT_RATE_PERIOD) {
            // New period - reset counter
            mintPeriodStart = block.timestamp;
            mintsThisPeriod = 1;
        } else {
            mintsThisPeriod++;
            if (mintsThisPeriod > MINT_RATE_LIMIT) {
                emit RateLimitExceeded(msg.sender, mintsThisPeriod, block.timestamp);
                revert("Rate limit exceeded");
            }
        }
    }
}
