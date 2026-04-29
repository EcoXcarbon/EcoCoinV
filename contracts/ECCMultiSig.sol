// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @dev Minimal ReentrancyGuard (equivalent to OpenZeppelin's).
 */
abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;
    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

/**
 * @title ECCMultiSig
 * @notice Multi-signature wallet for EcoCoin admin operations.
 *
 * Features:
 *   - N-of-M confirmations required to execute transactions
 *   - Add / remove owners (requires multisig itself)
 *   - Change required confirmations threshold
 *   - ETH + ERC-20 token support
 *   - Transaction expiry (auto-expire after 7 days)
 *   - Full event log for transparency
 */
contract ECCMultiSig is ReentrancyGuard {

    // ── Events ─────────────────────────────────────────────────────────────
    event Deposit(address indexed sender, uint256 amount);
    event TransactionSubmitted(uint256 indexed txId, address indexed owner, address to, uint256 value, bytes data);
    event TransactionConfirmed(uint256 indexed txId, address indexed owner);
    event ConfirmationRevoked(uint256 indexed txId, address indexed owner);
    event TransactionExecuted(uint256 indexed txId, address indexed executor);
    event TransactionFailed(uint256 indexed txId);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event RequirementChanged(uint256 required);

    // ── State ──────────────────────────────────────────────────────────────
    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public required;           // confirmations needed
    uint256 public constant EXPIRY = 7 days;

    struct Transaction {
        address to;
        uint256 value;
        bytes   data;
        bool    executed;
        bool    failed;
        bool    cancelled;
        uint256 confirmations;
        uint256 submittedAt;
        string  description;
    }

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmed;

    // ── Modifiers ──────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }
    modifier onlySelf() {
        require(msg.sender == address(this), "Only multisig");
        _;
    }
    modifier txExists(uint256 txId) {
        require(txId < transactions.length, "Tx not found");
        _;
    }
    modifier notExecuted(uint256 txId) {
        require(!transactions[txId].executed, "Already executed");
        _;
    }
    modifier notExpired(uint256 txId) {
        require(block.timestamp <= transactions[txId].submittedAt + EXPIRY, "Tx expired");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────
    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length >= 2,            "Min 2 owners");
        require(_required >= 2,                 "Min 2 required");
        require(_required <= _owners.length,    "Required > owners");

        for (uint256 i = 0; i < _owners.length; i++) {
            address o = _owners[i];
            require(o != address(0), "Zero owner");
            require(!isOwner[o],     "Duplicate owner");
            isOwner[o] = true;
            owners.push(o);
            emit OwnerAdded(o);
        }
        required = _required;
    }

    // ── Receive ETH ────────────────────────────────────────────────────────
    receive() external payable {
        if (msg.value > 0) emit Deposit(msg.sender, msg.value);
    }

    // ── Submit transaction ─────────────────────────────────────────────────
    function submitTransaction(
        address to,
        uint256 value,
        bytes   calldata data,
        string  calldata description
    ) external onlyOwner nonReentrant returns (uint256 txId) {
        require(to != address(0), "Zero address");

        txId = transactions.length;
        transactions.push(Transaction({
            to:            to,
            value:         value,
            data:          data,
            executed:      false,
            failed:        false,
            cancelled:     false,
            confirmations: 0,
            submittedAt:   block.timestamp,
            description:   description
        }));

        emit TransactionSubmitted(txId, msg.sender, to, value, data);

        // Auto-confirm by submitter
        _confirm(txId);
    }

    // ── Confirm transaction ─────────────────────────────────────────────────
    function confirmTransaction(uint256 txId)
        external onlyOwner txExists(txId) notExecuted(txId) notExpired(txId) nonReentrant
    {
        require(!transactions[txId].cancelled, "Tx cancelled");
        require(!confirmed[txId][msg.sender], "Already confirmed");
        _confirm(txId);
    }

    function _confirm(uint256 txId) internal {
        confirmed[txId][msg.sender] = true;
        transactions[txId].confirmations++;
        emit TransactionConfirmed(txId, msg.sender);

        if (transactions[txId].confirmations >= required) {
            _execute(txId);
        }
    }

    // ── Revoke confirmation ────────────────────────────────────────────────
    function revokeConfirmation(uint256 txId)
        external onlyOwner txExists(txId) notExecuted(txId) notExpired(txId) nonReentrant
    {
        require(confirmed[txId][msg.sender], "Not confirmed");
        confirmed[txId][msg.sender] = false;
        transactions[txId].confirmations--;
        emit ConfirmationRevoked(txId, msg.sender);
    }

    // ── Cancel expired transaction ─────────────────────────────────────────
    // MS-05 fix: Use cancelled flag instead of setting executed=true
    function cancelExpiredTransaction(uint256 txId)
        external onlyOwner txExists(txId) notExecuted(txId) nonReentrant
    {
        require(block.timestamp > transactions[txId].submittedAt + EXPIRY, "Not expired");
        require(!transactions[txId].cancelled, "Already cancelled");
        transactions[txId].cancelled = true;
        transactions[txId].failed    = true;
        emit TransactionFailed(txId);
    }

    // ── Execute transaction ────────────────────────────────────────────────
    function executeTransaction(uint256 txId)
        external onlyOwner txExists(txId) notExecuted(txId) notExpired(txId) nonReentrant
    {
        require(!transactions[txId].cancelled, "Tx cancelled");
        require(transactions[txId].confirmations >= required, "Not enough confirmations");
        _execute(txId);
    }

    // ── Internal execute ──────────────────────────────────────────────────
    // MS-01/MS-02 fix: No retry mechanism. If execution fails, the transaction
    // stays permanently failed. executed is only set to true AFTER success.
    function _execute(uint256 txId) internal {
        Transaction storage txn = transactions[txId];

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        if (success) {
            txn.executed = true;
            emit TransactionExecuted(txId, msg.sender);
        } else {
            txn.failed = true;
            txn.executed = true; // Mark as executed so it cannot be retried
            emit TransactionFailed(txId);
        }
    }

    // ── Owner management (onlySelf) ────────────────────────────────────────
    // M-10 fix: no nonReentrant — these are called via _execute which
    // already holds the reentrancy lock. onlySelf is sufficient protection.
    function addOwner(address owner) external onlySelf {
        require(owner != address(0), "Zero address");
        require(!isOwner[owner], "Already owner");
        isOwner[owner] = true;
        owners.push(owner);
        emit OwnerAdded(owner);
    }

    function removeOwner(address owner) external onlySelf {
        require(isOwner[owner], "Not owner");
        require(owners.length - 1 >= 2, "Min 2 owners");            // M-4 fix
        require(owners.length - 1 >= required, "Would break quorum");
        isOwner[owner] = false;
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }

        // MS-03 fix: revoke removed owner's confirmations on ALL pending txns
        uint256 total = transactions.length;
        for (uint256 i = 0; i < total; i++) {
            if (!transactions[i].executed && !transactions[i].cancelled && confirmed[i][owner]) {
                confirmed[i][owner] = false;
                transactions[i].confirmations--;
            }
        }

        emit OwnerRemoved(owner);
    }

    function changeRequirement(uint256 _required) external onlySelf {
        require(_required >= 2, "Min 2 required");                   // M-2 fix
        require(_required <= owners.length, "Required > owners");
        required = _required;
        emit RequirementChanged(_required);
    }

    // ── Views ──────────────────────────────────────────────────────────────
    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function getTransaction(uint256 txId)
        external view txExists(txId)
        returns (
            address to,
            uint256 value,
            bytes memory data,
            bool executed,
            bool failed,
            bool cancelled,
            uint256 confirmations,
            uint256 submittedAt,
            string memory description
        )
    {
        Transaction storage txn = transactions[txId];
        return (
            txn.to,
            txn.value,
            txn.data,
            txn.executed,
            txn.failed,
            txn.cancelled,
            txn.confirmations,
            txn.submittedAt,
            txn.description
        );
    }

    /// @notice Returns true if `owner` has confirmed transaction `txId`.
    function isConfirmed(uint256 txId, address owner) external view txExists(txId) returns (bool) {
        return confirmed[txId][owner];
    }

    /// @notice Returns true if transaction `txId` has passed its 7-day expiry.
    function isExpired(uint256 txId) external view txExists(txId) returns (bool) {
        return block.timestamp > transactions[txId].submittedAt + EXPIRY;
    }
}
