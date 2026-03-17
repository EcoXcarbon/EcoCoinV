// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title RewardsDistributor
 * @notice Merkle tree-based rewards distribution system
 * @dev Efficient batch reward claims using Merkle proofs
 * 
 * Features:
 * - Merkle tree-based verification
 * - Multiple reward rounds
 * - Multiple token support
 * - Anti-gaming protection
 * - Batch claim support
 * - Expiration mechanism
 * 
 * Use Cases:
 * - Airdrops
 * - Staking rewards distribution
 * - Community rewards
 * - Achievement rewards
 */
contract RewardsDistributor is ReentrancyGuard, Pausable, AccessControl {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════
    
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // Security: Max batch size to prevent DoS attacks (audit item #8 - SWC-113)
    uint256 public constant MAX_BATCH_SIZE = 50;

    // Security: Rate limiting for claims (audit items #81-100)
    uint256 public constant CLAIM_RATE_LIMIT = 10; // Max claims per minute
    uint256 public constant CLAIM_RATE_PERIOD = 1 minutes;

    // Security: Maximum single claim amount (audit items #42, #60)
    uint256 public constant MAX_SINGLE_CLAIM = 1000000 * 10**18; // 1M tokens max

    // ═══════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════
    
    /// @notice Round counter
    uint256 public currentRound;
    
    /// @notice Total rewards distributed
    uint256 public totalDistributed;

    // ═══════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @dev Reward round information
     */
    struct RewardRound {
        bytes32 merkleRoot;        // Merkle root for verification
        IERC20 token;              // Reward token
        uint256 totalAmount;       // Total rewards in round
        uint256 claimedAmount;     // Amount claimed so far
        uint256 startTime;         // Round start timestamp
        uint256 endTime;           // Round end timestamp
        bool active;               // Whether round is active
        string description;        // Round description
    }
    
    /// @notice Reward rounds mapping
    mapping(uint256 => RewardRound) public rounds;
    
    /// @notice Track claimed rewards per round per user
    mapping(uint256 => mapping(address => uint256)) public claimed;
    
    /// @notice Track if user has claimed in a round
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    /// @notice Rate limiting tracking per user (audit items #81-100)
    mapping(address => uint256) public userClaimCount;
    mapping(address => uint256) public userClaimPeriodStart;

    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════
    
    event RoundCreated(
        uint256 indexed roundId,
        address indexed token,
        uint256 totalAmount,
        bytes32 merkleRoot,
        uint256 startTime,
        uint256 endTime
    );
    
    event RewardClaimed(
        uint256 indexed roundId,
        address indexed user,
        uint256 amount
    );
    
    event RoundClosed(
        uint256 indexed roundId,
        uint256 unclaimedAmount
    );
    
    event MerkleRootUpdated(
        uint256 indexed roundId,
        bytes32 oldRoot,
        bytes32 newRoot
    );

    // Security: Events for monitoring (audit items #246-260)
    event RateLimitExceeded(address indexed user, uint256 claimCount, uint256 timestamp);
    event LargeClaimDetected(address indexed user, uint256 roundId, uint256 amount);

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(DISTRIBUTOR_ROLE, msg.sender);
        
        currentRound = 0;
    }

    // ═══════════════════════════════════════════════════════════════
    // DISTRIBUTION FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Create new reward round
     * @param token Reward token address
     * @param totalAmount Total rewards amount
     * @param merkleRoot Merkle root
     * @param duration Duration in seconds
     * @param description Round description
     * @return roundId Created round ID
     */
    function createRound(
        address token,
        uint256 totalAmount,
        bytes32 merkleRoot,
        uint256 duration,
        string memory description
    ) external onlyRole(DISTRIBUTOR_ROLE) returns (uint256) {
        require(token != address(0), "Invalid token");
        require(totalAmount > 0, "Invalid amount");
        require(merkleRoot != bytes32(0), "Invalid merkle root");
        require(duration > 0, "Invalid duration");
        
        uint256 roundId = ++currentRound;
        
        rounds[roundId] = RewardRound({
            merkleRoot: merkleRoot,
            token: IERC20(token),
            totalAmount: totalAmount,
            claimedAmount: 0,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            active: true,
            description: description
        });
        
        // Transfer tokens to contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);
        
        emit RoundCreated(
            roundId,
            token,
            totalAmount,
            merkleRoot,
            block.timestamp,
            block.timestamp + duration
        );
        
        return roundId;
    }
    
    /**
     * @notice Claim rewards for a round
     * @param roundId Round ID
     * @param amount Amount to claim
     * @param merkleProof Merkle proof
     */
    function claim(
        uint256 roundId,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external nonReentrant whenNotPaused {
        require(roundId > 0 && roundId <= currentRound, "Invalid round");

        // Security: Rate limiting check (audit items #81-100)
        _checkRateLimit(msg.sender);

        // Security: Max claim amount check (audit items #42, #60)
        require(amount <= MAX_SINGLE_CLAIM, "Exceeds max claim amount");

        RewardRound storage round = rounds[roundId];

        require(round.active, "Round not active");
        require(block.timestamp >= round.startTime, "Round not started");
        require(block.timestamp <= round.endTime, "Round ended");
        require(!hasClaimed[roundId][msg.sender], "Already claimed");
        require(amount > 0, "Invalid amount");

        // Security: Emit event for large claims (audit items #246-260)
        if (amount >= MAX_SINGLE_CLAIM / 10) {
            emit LargeClaimDetected(msg.sender, roundId, amount);
        }
        
        // Verify merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        require(
            MerkleProof.verify(merkleProof, round.merkleRoot, leaf),
            "Invalid proof"
        );
        
        // Update state
        hasClaimed[roundId][msg.sender] = true;
        claimed[roundId][msg.sender] = amount;
        round.claimedAmount += amount;
        totalDistributed += amount;
        
        // Transfer rewards
        round.token.safeTransfer(msg.sender, amount);
        
        emit RewardClaimed(roundId, msg.sender, amount);
    }
    
    /**
     * @notice Batch claim from multiple rounds
     * @param roundIds Array of round IDs
     * @param amounts Array of amounts
     * @param merkleProofs Array of merkle proofs
     */
    function claimBatch(
        uint256[] calldata roundIds,
        uint256[] calldata amounts,
        bytes32[][] calldata merkleProofs
    ) external nonReentrant whenNotPaused {
        require(roundIds.length == amounts.length, "Length mismatch");
        require(roundIds.length == merkleProofs.length, "Length mismatch");
        // Security: Prevent DoS via unbounded loops (audit item #8 - SWC-113)
        require(roundIds.length <= MAX_BATCH_SIZE, "Batch too large");
        
        for (uint256 i = 0; i < roundIds.length; i++) {
            uint256 roundId = roundIds[i];
            uint256 amount = amounts[i];
            bytes32[] memory proof = merkleProofs[i];
            
            require(roundId > 0 && roundId <= currentRound, "Invalid round");
            
            RewardRound storage round = rounds[roundId];
            
            if (!round.active ||
                block.timestamp < round.startTime ||
                block.timestamp > round.endTime ||
                hasClaimed[roundId][msg.sender] ||
                amount == 0) {
                continue; // Skip invalid claims
            }
            
            // Verify merkle proof
            bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
            if (!MerkleProof.verify(proof, round.merkleRoot, leaf)) {
                continue; // Skip invalid proof
            }
            
            // Update state
            hasClaimed[roundId][msg.sender] = true;
            claimed[roundId][msg.sender] = amount;
            round.claimedAmount += amount;
            totalDistributed += amount;
            
            // Transfer rewards
            round.token.safeTransfer(msg.sender, amount);
            
            emit RewardClaimed(roundId, msg.sender, amount);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Get round information
     * @param roundId Round ID
     * @return Round struct
     */
    function getRound(uint256 roundId) 
        external 
        view 
        returns (RewardRound memory) 
    {
        require(roundId > 0 && roundId <= currentRound, "Invalid round");
        return rounds[roundId];
    }
    
    /**
     * @notice Check if user has claimed in a round
     * @param roundId Round ID
     * @param user User address
     * @return True if claimed
     */
    function hasUserClaimed(uint256 roundId, address user) 
        external 
        view 
        returns (bool) 
    {
        return hasClaimed[roundId][user];
    }
    
    /**
     * @notice Get claimed amount for user in round
     * @param roundId Round ID
     * @param user User address
     * @return Claimed amount
     */
    function getClaimedAmount(uint256 roundId, address user) 
        external 
        view 
        returns (uint256) 
    {
        return claimed[roundId][user];
    }
    
    /**
     * @notice Get unclaimed amount in round
     * @param roundId Round ID
     * @return Unclaimed amount
     */
    function getUnclaimedAmount(uint256 roundId) 
        external 
        view 
        returns (uint256) 
    {
        require(roundId > 0 && roundId <= currentRound, "Invalid round");
        RewardRound storage round = rounds[roundId];
        return round.totalAmount - round.claimedAmount;
    }
    
    /**
     * @notice Check if round is claimable
     * @param roundId Round ID
     * @return True if claimable now
     */
    function isRoundClaimable(uint256 roundId) 
        external 
        view 
        returns (bool) 
    {
        require(roundId > 0 && roundId <= currentRound, "Invalid round");
        RewardRound storage round = rounds[roundId];
        
        return round.active &&
               block.timestamp >= round.startTime &&
               block.timestamp <= round.endTime;
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * @notice Update merkle root for a round
     * @param roundId Round ID
     * @param newMerkleRoot New merkle root
     */
    function updateMerkleRoot(uint256 roundId, bytes32 newMerkleRoot) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        require(roundId > 0 && roundId <= currentRound, "Invalid round");
        require(newMerkleRoot != bytes32(0), "Invalid merkle root");
        
        RewardRound storage round = rounds[roundId];
        bytes32 oldRoot = round.merkleRoot;
        round.merkleRoot = newMerkleRoot;
        
        emit MerkleRootUpdated(roundId, oldRoot, newMerkleRoot);
    }
    
    /**
     * @notice Close a round early
     * @param roundId Round ID
     */
    function closeRound(uint256 roundId) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        require(roundId > 0 && roundId <= currentRound, "Invalid round");
        
        RewardRound storage round = rounds[roundId];
        require(round.active, "Round already closed");
        
        round.active = false;
        round.endTime = block.timestamp;
        
        uint256 unclaimed = round.totalAmount - round.claimedAmount;
        
        emit RoundClosed(roundId, unclaimed);
    }
    
    /**
     * @notice Withdraw unclaimed tokens from closed round
     * @param roundId Round ID
     * @param to Recipient address
     */
    function withdrawUnclaimed(uint256 roundId, address to) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        require(roundId > 0 && roundId <= currentRound, "Invalid round");
        require(to != address(0), "Invalid recipient");
        
        RewardRound storage round = rounds[roundId];
        require(!round.active || block.timestamp > round.endTime, "Round still active");
        
        uint256 unclaimed = round.totalAmount - round.claimedAmount;
        require(unclaimed > 0, "No unclaimed tokens");
        
        round.totalAmount = round.claimedAmount;
        round.token.safeTransfer(to, unclaimed);
    }
    
    /**
     * @notice Extend round duration
     * @param roundId Round ID
     * @param extension Extension duration in seconds
     */
    function extendRound(uint256 roundId, uint256 extension) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        require(roundId > 0 && roundId <= currentRound, "Invalid round");
        require(extension > 0, "Invalid extension");
        
        RewardRound storage round = rounds[roundId];
        require(round.active, "Round not active");
        
        round.endTime += extension;
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
    
    /**
     * @notice Emergency token recovery
     * @dev Security: Only recovers tokens not committed to active rounds (audit item #42)
     * @param token Token address
     * @param to Recipient
     * @param amount Amount to recover
     */
    function emergencyRecover(address token, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(token != address(0), "Invalid token");
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");

        // Security: Calculate reserved tokens for active rounds (audit item #42 - withdrawal security)
        uint256 reservedAmount = 0;
        for (uint256 i = 1; i <= currentRound; i++) {
            RewardRound storage round = rounds[i];
            if (address(round.token) == token && round.active && block.timestamp <= round.endTime) {
                reservedAmount += (round.totalAmount - round.claimedAmount);
            }
        }

        uint256 contractBalance = IERC20(token).balanceOf(address(this));
        uint256 availableToRecover = contractBalance > reservedAmount ? contractBalance - reservedAmount : 0;

        require(amount <= availableToRecover, "Cannot recover reserved funds");

        emit EmergencyRecovery(token, to, amount);
        IERC20(token).safeTransfer(to, amount);
    }

    event EmergencyRecovery(address indexed token, address indexed to, uint256 amount);

    // ═══════════════════════════════════════════════════════════════
    // SECURITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @dev Internal rate limit check per user (audit items #81-100)
     */
    function _checkRateLimit(address user) internal {
        if (block.timestamp > userClaimPeriodStart[user] + CLAIM_RATE_PERIOD) {
            // New period - reset counter
            userClaimPeriodStart[user] = block.timestamp;
            userClaimCount[user] = 1;
        } else {
            userClaimCount[user]++;
            if (userClaimCount[user] > CLAIM_RATE_LIMIT) {
                emit RateLimitExceeded(user, userClaimCount[user], block.timestamp);
                revert("Rate limit exceeded");
            }
        }
    }
}
