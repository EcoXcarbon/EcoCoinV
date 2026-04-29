// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ECCToken
 * @notice EcoCoin (ECC) — Core ERC-20 token with transfer fee, governance votes,
 *         and staking/farming reserve distribution.
 * @dev Carbon offset minting, referral system, NFT integration, and oracle logic
 *      have been extracted to ECCCarbonOffset.sol to stay under the 24KB contract
 *      size limit (Spurious Dragon / EIP-170).
 *
 * Architecture:
 *   - ECCToken:          Core ERC-20, fee distribution, wallet mgmt, reserve setup
 *   - ECCCarbonOffset:   Retail/enterprise minting, referrals, NFT auto-mint, oracle
 *   - ECCStaking:        Tiered APR staking vault (10M reserve)
 *   - ECCFarming:        MasterChef LP farming (3M reserve)
 *
 * Deployment order:
 *   1. Deploy ECCToken
 *   2. Deploy ECCCarbonOffset(eccTokenAddress)
 *   3. Grant MINTER_ROLE on ECCToken to ECCCarbonOffset
 *   4. Deploy ECCStaking, ECCFarming
 *   5. Call ECCToken.initializeContracts(staking, farming)
 */
contract ECCToken is ERC20Pausable, AccessControl, ERC20Burnable, ERC20Votes, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    // ROLES
    // ═══════════════════════════════════════════════════════════════════════

    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant ADMIN_ROLE    = keccak256("ADMIN_ROLE");

    // ═══════════════════════════════════════════════════════════════════════
    // SUPPLY CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant INITIAL_SUPPLY        = 100_000_000 * 10 ** 18;
    uint256 public constant MAX_SUPPLY            = 1_000_000_000 * 10 ** 18;

    uint256 public constant CARBON_REWARDS_ALLOCATION = 25_000_000 * 10 ** 18;
    uint256 public constant COMMUNITY_ALLOCATION      = 18_000_000 * 10 ** 18;
    uint256 public constant TEAM_ALLOCATION           = 15_000_000 * 10 ** 18;
    uint256 public constant DEVELOPMENT_ALLOCATION    = 13_000_000 * 10 ** 18;
    uint256 public constant LIQUIDITY_ALLOCATION      = 10_000_000 * 10 ** 18;
    uint256 public constant STAKING_REWARDS_RESERVE   = 10_000_000 * 10 ** 18;
    uint256 public constant MARKETING_ALLOCATION      =  4_000_000 * 10 ** 18;
    uint256 public constant FARMING_REWARDS_RESERVE   =  3_000_000 * 10 ** 18;
    uint256 public constant ADVISORS_ALLOCATION       =  1_000_000 * 10 ** 18;
    uint256 public constant RESERVE_ALLOCATION        =  1_000_000 * 10 ** 18;

    // ── Withdrawal security ───────────────────────────────────────────────
    uint256 public constant MAX_SINGLE_WITHDRAWAL  = 100 ether;
    uint256 public constant WITHDRAWAL_COOLDOWN    = 1 hours;
    uint256 public constant MAX_DAILY_WITHDRAWAL   = 1000 ether;

    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════

    // Distribution wallets
    address public carbonRewardsWallet;
    address public communityWallet;
    address public developmentWallet;
    address public marketingWallet;
    address public liquidityWallet;
    address public teamWallet;
    address public advisorsWallet;
    address public reserveWallet;

    // POL withdrawal security
    uint256 public lastWithdrawalTime;
    uint256 public withdrawnInPeriod;
    uint256 public withdrawalPeriodStart;

    // External contract addresses
    address public stakingContract;
    address public farmingContract;
    bool    public contractsInitialized;

    // Fee Distribution
    uint256 public transferFeeBps = 0;
    address public feeRecipient;
    address public paymentRecipient;
    mapping(address => bool) public feeExempt;
    uint256 public constant MAX_TRANSFER_FEE = 500; // 5%

    // RT-4: Transfer fee timelock
    uint256 public constant FEE_CHANGE_DELAY = 48 hours;
    struct PendingFeeChange {
        uint256 feeBps;
        address feeRecipient;
        uint256 effectiveTime;
        bool    pending;
    }
    PendingFeeChange public pendingFeeChange;

    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event WalletUpdated(string walletType, address indexed newWallet);
    event PaymentsWithdrawn(address indexed to, uint256 amount);
    event EmergencyWithdrawal(address indexed to, uint256 amount);
    event CircuitBreakerTriggered(address indexed triggeredBy, uint256 timestamp);
    event CircuitBreakerReset(address indexed resetBy, uint256 timestamp);
    event ContractsInitialized(address indexed staking, address indexed farming);
    event TransferFeeUpdated(uint256 newFeeBps, address feeRecipient);
    event FeeExemptUpdated(address indexed account, bool exempt);
    event TransferFeeChangeProposed(uint256 feeBps, address feeRecipient, uint256 effectiveTime);
    event TransferFeeChangeCancelled(uint256 feeBps, address feeRecipient);
    event TransferFeeChangeExecuted(uint256 feeBps, address feeRecipient);
    event Deposit(address indexed sender, uint256 amount);

    // ═══════════════════════════════════════════════════════════════════════
    // CUSTOM ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidAddress();
    error ExceedsMaxSupply();
    error WithdrawalCooldownActive();
    error ExceedsMaxWithdrawal();
    error ContractsAlreadyInitialized();

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _carbonRewardsWallet,
        address _communityWallet,
        address _developmentWallet,
        address _marketingWallet,
        address _liquidityWallet,
        address _teamWallet,
        address _advisorsWallet,
        address _reserveWallet
    ) ERC20("EcoCoin", "ECC") ERC20Permit("EcoCoin") {
        if (_carbonRewardsWallet == address(0)) revert InvalidAddress();
        if (_communityWallet     == address(0)) revert InvalidAddress();
        if (_developmentWallet   == address(0)) revert InvalidAddress();
        if (_marketingWallet     == address(0)) revert InvalidAddress();
        if (_liquidityWallet     == address(0)) revert InvalidAddress();
        if (_teamWallet          == address(0)) revert InvalidAddress();
        if (_advisorsWallet      == address(0)) revert InvalidAddress();
        if (_reserveWallet       == address(0)) revert InvalidAddress();
        if (_carbonRewardsWallet == address(this)) revert InvalidAddress();
        if (_communityWallet     == address(this)) revert InvalidAddress();
        if (_developmentWallet   == address(this)) revert InvalidAddress();
        if (_marketingWallet     == address(this)) revert InvalidAddress();
        if (_liquidityWallet     == address(this)) revert InvalidAddress();
        if (_teamWallet          == address(this)) revert InvalidAddress();
        if (_advisorsWallet      == address(this)) revert InvalidAddress();
        if (_reserveWallet       == address(this)) revert InvalidAddress();

        carbonRewardsWallet = _carbonRewardsWallet;
        communityWallet     = _communityWallet;
        developmentWallet   = _developmentWallet;
        marketingWallet     = _marketingWallet;
        liquidityWallet     = _liquidityWallet;
        teamWallet          = _teamWallet;
        advisorsWallet      = _advisorsWallet;
        reserveWallet       = _reserveWallet;

        paymentRecipient = msg.sender;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE,         msg.sender);
        _grantRole(MINTER_ROLE,        msg.sender);
        _grantRole(PAUSER_ROLE,        msg.sender);

        _mint(_carbonRewardsWallet, CARBON_REWARDS_ALLOCATION);
        _mint(_communityWallet,     COMMUNITY_ALLOCATION);
        _mint(_developmentWallet,   DEVELOPMENT_ALLOCATION);
        _mint(_liquidityWallet,     LIQUIDITY_ALLOCATION);
        _mint(_teamWallet,          TEAM_ALLOCATION);
        _mint(_marketingWallet,     MARKETING_ALLOCATION);
        _mint(_advisorsWallet,      ADVISORS_ALLOCATION);
        _mint(_reserveWallet,       RESERVE_ALLOCATION);

        _mint(address(this), STAKING_REWARDS_RESERVE);
        _mint(address(this), FARMING_REWARDS_RESERVE);

        feeExempt[address(this)] = true;

    }

    // ═══════════════════════════════════════════════════════════════════════
    // EXTERNAL MINT (for ECCCarbonOffset module)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Mint new ECC tokens. Only callable by MINTER_ROLE holders
     *         (ECCCarbonOffset contract, admin for setup).
     * @param to     Recipient address
     * @param amount Amount to mint (18 decimals)
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (totalSupply() + amount > MAX_SUPPLY) revert ExceedsMaxSupply();
        _mint(to, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ONE-TIME INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════

    function initializeContracts(address _staking, address _farming)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (contractsInitialized) revert ContractsAlreadyInitialized();
        if (_staking == address(0)) revert InvalidAddress();
        if (_farming == address(0)) revert InvalidAddress();
        require(_staking.code.length > 0, "Staking not contract");
        require(_farming.code.length > 0, "Farming not contract");

        (bool okStaking,) = _staking.staticcall(abi.encodeWithSignature("poolSynced()"));
        require(okStaking, "Staking: invalid interface");
        (bool okFarming,) = _farming.staticcall(abi.encodeWithSignature("poolSynced()"));
        require(okFarming, "Farming: invalid interface");

        contractsInitialized = true;
        stakingContract      = _staking;
        farmingContract      = _farming;

        _transfer(address(this), _staking, STAKING_REWARDS_RESERVE);
        _transfer(address(this), _farming, FARMING_REWARDS_RESERVE);

        emit ContractsInitialized(_staking, _farming);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function withdrawPayments(uint256 amount)
        external onlyRole(ADMIN_ROLE) nonReentrant
    {
        require(amount > 0, "Zero amount");
        if (block.timestamp < lastWithdrawalTime + WITHDRAWAL_COOLDOWN)
            revert WithdrawalCooldownActive();
        if (amount > MAX_SINGLE_WITHDRAWAL) revert ExceedsMaxWithdrawal();

        uint256 bal = address(this).balance;
        require(bal >= amount, "Insufficient balance");

        if (block.timestamp > withdrawalPeriodStart + 1 days) {
            withdrawalPeriodStart = block.timestamp;
            withdrawnInPeriod     = 0;
        }

        uint256 newWithdrawnInPeriod = withdrawnInPeriod + amount;
        require(newWithdrawnInPeriod <= MAX_DAILY_WITHDRAWAL, "Exceeds daily withdrawal limit");
        withdrawnInPeriod = newWithdrawnInPeriod;

        lastWithdrawalTime = block.timestamp;

        address payable recipient = payable(paymentRecipient);
        if (recipient == address(0)) revert InvalidAddress();

        (bool success, bytes memory returnData) = recipient.call{value: amount}("");
        if (!success) {
            if (returnData.length > 0) {
                assembly { revert(add(32, returnData), mload(returnData)) }
            }
            revert("POL transfer failed");
        }

        emit PaymentsWithdrawn(recipient, amount);
    }

    function emergencyWithdrawAll()
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant whenPaused
    {
        uint256 bal = address(this).balance;
        require(bal > 0, "No balance");
        address payable to = payable(paymentRecipient);
        (bool success, ) = to.call{value: bal}("");
        require(success, "Transfer failed");
        emit EmergencyWithdrawal(to, bal);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
        emit CircuitBreakerTriggered(msg.sender, block.timestamp);
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
        emit CircuitBreakerReset(msg.sender, block.timestamp);
    }

    // ── Wallet updates ────────────────────────────────────────────────────

    function updateCarbonRewardsWallet(address w) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (w == address(0) || w == address(this)) revert InvalidAddress();
        carbonRewardsWallet = w; emit WalletUpdated("carbonRewards", w);
    }
    function updateCommunityWallet(address w) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (w == address(0) || w == address(this)) revert InvalidAddress();
        communityWallet = w; emit WalletUpdated("community", w);
    }
    function updateDevelopmentWallet(address w) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (w == address(0) || w == address(this)) revert InvalidAddress();
        developmentWallet = w; emit WalletUpdated("development", w);
    }
    function updateMarketingWallet(address w) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (w == address(0) || w == address(this)) revert InvalidAddress();
        marketingWallet = w; emit WalletUpdated("marketing", w);
    }
    function updateLiquidityWallet(address w) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (w == address(0) || w == address(this)) revert InvalidAddress();
        liquidityWallet = w; emit WalletUpdated("liquidity", w);
    }
    function updateTeamWallet(address w) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (w == address(0) || w == address(this)) revert InvalidAddress();
        teamWallet = w; emit WalletUpdated("team", w);
    }
    function updateAdvisorsWallet(address w) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (w == address(0) || w == address(this)) revert InvalidAddress();
        advisorsWallet = w; emit WalletUpdated("advisors", w);
    }
    function updateReserveWallet(address w) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (w == address(0) || w == address(this)) revert InvalidAddress();
        reserveWallet = w; emit WalletUpdated("reserve", w);
    }

    // ── Role management ───────────────────────────────────────────────────

    function grantMinterRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, account);
    }
    function revokeMinterRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, account);
    }

    // ── Payment recipient ─────────────────────────────────────────────────

    function setPaymentRecipient(address payable recipient)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (recipient == address(0)) revert InvalidAddress();
        paymentRecipient = recipient;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FEE DISTRIBUTION
    // ═══════════════════════════════════════════════════════════════════════

    function setFeeExempt(address account, bool exempt)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        feeExempt[account] = exempt;
        emit FeeExemptUpdated(account, exempt);
    }

    // RT-4: Transfer fee changes require 48h timelock
    function proposeTransferFee(uint256 feeBps, address _feeRecipient)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(feeBps <= MAX_TRANSFER_FEE, "Fee too high");
        require(_feeRecipient != address(0) || feeBps == 0, "Zero recipient");
        uint256 effectiveTime = block.timestamp + FEE_CHANGE_DELAY;
        pendingFeeChange = PendingFeeChange({
            feeBps:        feeBps,
            feeRecipient:  _feeRecipient,
            effectiveTime: effectiveTime,
            pending:       true
        });
        emit TransferFeeChangeProposed(feeBps, _feeRecipient, effectiveTime);
    }

    function executeTransferFee() external onlyRole(DEFAULT_ADMIN_ROLE) {
        PendingFeeChange storage p = pendingFeeChange;
        require(p.pending, "No pending change");
        require(block.timestamp >= p.effectiveTime, "Timelock not expired");
        transferFeeBps = p.feeBps;
        feeRecipient   = p.feeRecipient;
        p.pending      = false;
        emit TransferFeeChangeExecuted(p.feeBps, p.feeRecipient);
        emit TransferFeeUpdated(p.feeBps, p.feeRecipient);
    }

    function cancelTransferFeeChange() external onlyRole(DEFAULT_ADMIN_ROLE) {
        PendingFeeChange storage p = pendingFeeChange;
        require(p.pending, "No pending change");
        emit TransferFeeChangeCancelled(p.feeBps, p.feeRecipient);
        p.pending = false;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getRemainingMintableSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ERC-20 OVERRIDES (OpenZeppelin 4.9.6)
    // ═══════════════════════════════════════════════════════════════════════

    function _beforeTokenTransfer(address from, address to, uint256 amount)
        internal virtual override(ERC20, ERC20Pausable)
    {
        super._beforeTokenTransfer(from, to, amount);
    }

    function _afterTokenTransfer(address from, address to, uint256 amount)
        internal override(ERC20, ERC20Votes)
    {
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address to, uint256 amount)
        internal override(ERC20, ERC20Votes)
    {
        super._mint(to, amount);
    }

    function _burn(address from, uint256 amount)
        internal override(ERC20, ERC20Votes)
    {
        super._burn(from, amount);
    }

    function _transfer(address from, address to, uint256 amount)
        internal override
    {
        if (
            transferFeeBps > 0 &&
            feeRecipient != address(0) &&
            !feeExempt[from] &&
            !feeExempt[to] &&
            from != address(0) &&
            to   != address(0)
        ) {
            uint256 fee = (amount * transferFeeBps) / 10000;
            if (fee > 0) {
                super._transfer(from, feeRecipient, fee);
                amount -= fee;
            }
        }
        super._transfer(from, to, amount);
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }
}
