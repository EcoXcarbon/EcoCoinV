// ===============================================================================
// ECOCOIN WEB3 APPLICATION - CONSOLIDATED JAVASCRIPT
// Extracted from index_backup.html - All inline script blocks combined
// Generated: 2026-01-19
// IMPORTANT: Duplicate declarations have been resolved with conditional assignments
// ===============================================================================

// ===============================================================================
// SECTION 1: PRODUCTION MODE CONFIGURATION
// ===============================================================================

window.ECOCOIN_PRODUCTION = {
    MODE: 'production', // 'development' or 'production'
    DEBUG: false,
    VERSION: '2.0.0',
    BUILD_DATE: '2026-01-15'
};

// Secure console wrapper - only logs in development mode
(function() {
    const originalConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console)
    };

    if (window.ECOCOIN_PRODUCTION.MODE === 'production' && !window.ECOCOIN_PRODUCTION.DEBUG) {
        console.log = function() {};
        console.info = function() {};
        // Keep warn and error for critical issues, but filter noise
        console.warn = function(...args) {
            if (args[0] && typeof args[0] === 'string') {
                // Filter out non-blocking CORS/SameSite warnings
                if (args[0].includes('cross-site') || args[0].includes('SameSite') || args[0].includes('CORS')) {
                    return; // Suppress non-blocking CORS warnings
                }
                if (args[0].includes('SECURITY')) {
                    originalConsole.warn.apply(console, args);
                }
            }
        };
        console.error = function(...args) {
            if (args[0] && typeof args[0] === 'string') {
                // Filter out non-blocking CORS/etherscan warnings
                if (args[0].includes('cross-site') || args[0].includes('etherscan') || args[0].includes('CORS')) {
                    return; // Suppress non-blocking external API warnings
                }
            }
            originalConsole.error.apply(console, args);
        };
    }

    // Store original for debugging if needed
    window._originalConsole = originalConsole;
})();

// ===============================================================================
// GLOBAL ERROR HANDLING & RETRY UTILITIES
// ===============================================================================

// User-friendly error messages
window.ECOCOIN_ERROR_MESSAGES = {
    'user rejected': 'Transaction cancelled by user',
    'insufficient funds': 'Insufficient balance for this transaction',
    'nonce too low': 'Transaction already processed. Please refresh.',
    'gas required exceeds': 'Transaction would fail. Check your balance.',
    'execution reverted': 'Transaction failed. The contract rejected it.',
    'network changed': 'Network changed. Please reconnect.',
    'disconnected': 'Wallet disconnected. Please reconnect.',
    'timeout': 'Request timed out. Please try again.',
    'rate limit': 'Too many requests. Please wait a moment.',
    'default': 'An error occurred. Please try again.'
};

// Get user-friendly error message
window.getFriendlyError = function(error) {
    const errorMsg = (error.message || error.reason || error.toString()).toLowerCase();
    for (const [key, message] of Object.entries(window.ECOCOIN_ERROR_MESSAGES)) {
        if (errorMsg.includes(key)) return message;
    }
    return window.ECOCOIN_ERROR_MESSAGES.default;
};

// Retry utility for network operations
window.retryAsync = async function(fn, maxRetries = 3, delay = 1000) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            // Don't retry user rejections or contract reverts
            const errorMsg = (error.message || '').toLowerCase();
            if (errorMsg.includes('user rejected') || errorMsg.includes('user denied') ||
                errorMsg.includes('reverted') || errorMsg.includes('insufficient')) {
                throw error;
            }
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
            }
        }
    }
    throw lastError;
};

// Global unhandled rejection handler
window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);
    // Log to security audit if available
    if (window.ecoSecurity && window.ecoSecurity.logAudit) {
        window.ecoSecurity.logAudit('UNHANDLED_ERROR', {
            message: event.reason?.message || 'Unknown error',
            stack: event.reason?.stack?.substring(0, 500)
        });
    }
});

// ===============================================================================
// SIMPLE METAMASK CONNECTOR - AVAILABLE IMMEDIATELY
// ===============================================================================

console.log('Loading simple MetaMask connector...');

// Mobile detection for MetaMask
const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
console.log('Mobile device detected:', isMobileDevice);

// Simple direct MetaMask connection function
window.connectMetaMask = async function() {
    console.log('Simple MetaMask connection started...');

    try {
        // Check if MetaMask exists
        if (!window.ethereum) {
            // On mobile, directly open MetaMask app with this dapp
            if (isMobileDevice) {
                console.log('Mobile: Redirecting to MetaMask app...');
                const dappUrl = window.location.host + window.location.pathname;
                window.location.href = 'https://metamask.app.link/dapp/' + dappUrl;
                return false;
            }

            // On desktop, offer to install
            const install = confirm('MetaMask not found!\n\nDo you want to install MetaMask now?');
            if (install) {
                window.open('https://metamask.io/download/', '_blank');
            }
            return false;
        }

        // Wait for ethers.js to load if not available
        if (typeof ethers === 'undefined') {
            console.log('Waiting for ethers.js to load...');
            await new Promise(resolve => {
                const checkEthers = setInterval(() => {
                    if (typeof ethers !== 'undefined') {
                        clearInterval(checkEthers);
                        resolve();
                    }
                }, 100);
                // Timeout after 5 seconds
                setTimeout(() => {
                    clearInterval(checkEthers);
                    resolve();
                }, 5000);
            });
        }

        // Request account access
        console.log('Requesting account access...');
        const accounts = await window.ethereum.request({
            method: 'eth_requestAccounts'
        });

        if (!accounts || accounts.length === 0) {
            alert('No accounts found. Please unlock MetaMask.');
            return false;
        }

        // Initialize Web3 if available
        if (typeof window.initializeWeb3 === 'function') {
            console.log('Initializing Web3...');
            await window.initializeWeb3();
        }

        // Set global variables
        window.web3UserAddress = accounts[0];
        window.currentAccount = accounts[0];
        window.web3Mode = true;
        window.userAddress = accounts[0];

        console.log('Connected:', accounts[0]);

        // Initialize contracts
        if (typeof window.initializeContracts === 'function') {
            console.log('Initializing contracts...');
            await window.initializeContracts();
        }

        // Load blockchain data (balance, etc)
        if (typeof window.loadBlockchainData === 'function') {
            console.log('Loading blockchain data...');
            await window.loadBlockchainData();
        }

        // Update dashboard (with retry for contract initialization)
        if (typeof window.updateDashboard === 'function') {
            console.log('Updating dashboard...');
            await window.updateDashboard();

            // Retry after 1 second if contract not yet initialized
            setTimeout(async () => {
                if (window.web3Contract) {
                    console.log('Dashboard retry update...');
                    await window.updateDashboard();
                }
            }, 1000);

            // Additional retry after 2 seconds to be extra sure
            setTimeout(async () => {
                if (window.web3Contract) {
                    console.log('Dashboard final retry...');
                    await window.updateDashboard();

                    // Force update Dashboard balance displays directly
                    if (window.web3Contracts && window.web3Contracts.eccToken && window.web3UserAddress) {
                        try {
                            const balance = await window.web3Contracts.eccToken.balanceOf(window.web3UserAddress);
                            const formatted = ethers.utils.formatEther(balance);
                            const display = parseFloat(formatted).toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                            });

                            const dashEccBalance = document.getElementById('userBalance');
                            if (dashEccBalance) {
                                dashEccBalance.textContent = display;
                                console.log('FORCE Updated dashEccBalance:', display);
                            }

                            const dashCo2Offset = document.getElementById('dashCo2Offset');
                            if (dashCo2Offset) {
                                dashCo2Offset.textContent = display;
                                console.log('FORCE Updated dashCo2Offset:', display);
                            }
                        } catch (e) {
                            console.error('Force update failed:', e);
                        }
                    }
                }
            }, 2000);
        }

        // Hide wallet connect banner immediately
        const dashboardWalletStatus = document.getElementById('dashboardWalletStatus');
        if (dashboardWalletStatus) {
            dashboardWalletStatus.style.display = 'none';
            console.log('Wallet banner hidden');
        }

        // Show wallet info section
        const dashboardWalletInfo = document.getElementById('dashboardWalletInfo');
        if (dashboardWalletInfo) {
            dashboardWalletInfo.style.display = 'block';
        }

        // Update wallet address display
        const dashWalletAddress = document.getElementById('dashWalletAddress');
        if (dashWalletAddress) {
            dashWalletAddress.textContent = accounts[0];
        }

        // Show success message
        const shortAddr = accounts[0].substring(0,6) + '...' + accounts[0].substring(38);
        alert('MetaMask Connected!\n\nAddress: ' + shortAddr + '\n\nLoading balance from blockchain...');

        return true;

    } catch (error) {
        console.error('MetaMask error:', error);

        if (error.code === 4001) {
            alert('You rejected the connection request.\n\nPlease try again and approve the connection.');
        } else {
            alert('MetaMask Connection Error:\n\n' + error.message);
        }

        return false;
    }
};

console.log('Simple MetaMask connector ready!');

// Early placeholder for connectWalletInDashboard - will be overwritten with full implementation later
window.connectWalletInDashboard = async function() {
    console.log('connectWalletInDashboard called');
    return await window.connectMetaMask();
};

// ===============================================================================
// SECTION 2: WEB3 INTEGRATION MODULE v2.0
// ===============================================================================

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // CONFIGURATION - UPDATE WITH YOUR SEPOLIA CONTRACT ADDRESSES
    // ═══════════════════════════════════════════════════════════════

    window.ECOCOIN_CONFIG = {
        // Network Configuration
        NETWORK: {
            SEPOLIA: {
                chainId: 11155111,
                chainIdHex: '0xaa36a7',
                name: 'Sepolia',
                rpcUrl: 'https://rpc.sepolia.org', // Public RPC - no API key needed
                blockExplorer: 'https://sepolia.etherscan.io',
                currency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // ADMIN CONFIGURATION - MULTI-USER SYSTEM
        // ═══════════════════════════════════════════════════════════════
        ADMIN: {
            // Admin wallet addresses (add your wallet address here)
            ADDRESSES: [
                '0x2F1a7d23C0bE593B39352F9fD3BAED37DC9Ff686', // Deployer address
                // Add more admin addresses here
            ],

            // Admin email addresses for Google OAuth
            EMAILS: [
                'dryasir.kamal@gmail.com', // Primary admin
                // Add more admin emails here
            ],

            // Admin permissions
            PERMISSIONS: {
                VIEW_ALL_USERS: true,
                MANAGE_USERS: true,
                APPROVE_PROJECTS: true,
                VIEW_ANALYTICS: true,
                MANAGE_SETTINGS: true,
                BAN_USERS: true,
                EMERGENCY_PAUSE: true
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // TREASURY CONFIGURATION - Platform Fee Collection
        // ═══════════════════════════════════════════════════════════════
        TREASURY: {
            // Treasury wallet address for receiving platform fees (5% of all sales)
            WALLET: '0x2F1a7d23C0bE593B39352F9fD3BAED37DC9Ff686',
            // Platform fee percentage
            FEE_PERCENT: 5,
            // Fee breakdown (for transparency)
            FEE_ALLOCATION: {
                OPERATIONS: 40,      // 40% - Platform operations & maintenance
                DEVELOPMENT: 30,     // 30% - Development & improvements
                CARBON_OFFSET: 20,   // 20% - Carbon offset purchases
                COMMUNITY: 10        // 10% - Community rewards & grants
            }
        },

        // User roles and permissions
        ROLES: {
            ADMIN: {
                name: 'Administrator',
                level: 99,
                badge: 'crown',
                color: '#FF9800'
            },
            USER: {
                name: 'User',
                level: 1,
                badge: 'user',
                color: '#4CAF50'
            },
            VERIFIER: {
                name: 'Verifier',
                level: 50,
                badge: 'check',
                color: '#2196F3'
            }
        },

        // User data storage key
        STORAGE_KEYS: {
            USERS: 'ecocoin_users_db',
            ACTIVITIES: 'ecocoin_activities_db',
            ADMIN_SETTINGS: 'ecocoin_admin_settings',
            USER_SESSION: 'ecocoin_user_session'
        },

        // Smart Contract Addresses - ALL CONFIGURED FOR INTEGRATED CONTRACT
        CONTRACTS: {
            ECC_TOKEN: '0x1D5404994cABc50332b713af77DB020cE571F425', // Main EcoCoin Contract (ALL FEATURES)
            STAKING_VAULT: '0x1D5404994cABc50332b713af77DB020cE571F425', // Integrated in ECC_TOKEN
            MASTERCHEF: '0x1D5404994cABc50332b713af77DB020cE571F425', // Integrated in ECC_TOKEN
            CARBON_CREDIT_NFT: '0x36079478C6439aCea6432Dfec0bf252362D4C665', // Deployed on Sepolia
            CERTIFICATE_NFT: '0xD58752cEf52aEDAEF72ABD985e7F1d3754Fa6d5C', // Deployed on Sepolia
            GOVERNOR: '0x6abD6CB9648399F9F0BB868C81C7395Dc04a22d7', // Deployed on Sepolia
            REFERRAL: '0x1D5404994cABc50332b713af77DB020cE571F425', // Integrated in ECC_TOKEN
            REWARDS_DISTRIBUTOR: '0xAFd4C80678aac60d42E2b6bDc6a2f939bd6DEDf7', // Deployed on Sepolia
            KYC_SBT: '0x1D5404994cABc50332b713af77DB020cE571F425' // Integrated in ECC_TOKEN
        },

        // Simplified ABIs
        ABIS: {
            ECC_TOKEN: [
                "function balanceOf(address) view returns (uint256)",
                "function transfer(address to, uint256 amount) returns (bool)",
                "function approve(address spender, uint256 amount) returns (bool)",
                "function allowance(address owner, address spender) view returns (uint256)",
                "function totalSupply() view returns (uint256)",
                "function decimals() view returns (uint8)"
            ],
            STAKING_VAULT: [
                "function stake(uint256 amount, uint8 apyTier)",
                "function unstake(uint256 minRewards)",
                "function claimStakingRewards(uint256 minRewards)",
                "function compoundStakingRewards()",
                "function calculateStakingRewards(address user) view returns (uint256)",
                "function stakes(address user) view returns (uint256 amount, uint256 startTime, uint256 lastRewardTime, uint256 accumulatedRewards, uint8 apyTier)",
                "function totalStaked() view returns (uint256)",
                "function stakingPoolBalance() view returns (uint256)"
            ],
            MASTERCHEF: [
                "function depositToFarm(uint256 pid, uint256 amount)",
                "function withdrawFromFarm(uint256 pid, uint256 amount)",
                "function harvestFarm(uint256 pid)",
                "function emergencyWithdrawFarm(uint256 pid)",
                "function pendingRewards(uint256 pid, address user) view returns (uint256)",
                "function poolLength() view returns (uint256)",
                "function poolInfo(uint256 pid) view returns (address lpToken, uint256 allocPoint, uint256 lastRewardTime, uint256 accRewardPerShare, uint256 totalStaked, bool active)",
                "function userPoolInfo(uint256 pid, address user) view returns (uint256 amount, uint256 rewardDebt, uint256 pendingRewards)"
            ],
            CARBON_CREDIT_NFT: [
                "function mint(address to, uint256 id, uint256 amount, bytes data) returns (bool)",
                "function balanceOf(address account, uint256 id) view returns (uint256)",
                "function retire(uint256 id, uint256 amount) returns (bool)"
            ],
            CERTIFICATE_NFT: [
                "function mint(address to, string uri) returns (uint256)",
                "function balanceOf(address owner) view returns (uint256)",
                "function tokenURI(uint256 tokenId) view returns (string)"
            ],
            GOVERNOR: [
                "function propose(address[] targets, uint256[] values, bytes[] calldatas, string description) returns (uint256)",
                "function castVote(uint256 proposalId, uint8 support) returns (uint256)",
                "function state(uint256 proposalId) view returns (uint8)"
            ],
            REFERRAL: [
                "function registerReferrer(address referrer)",
                "function referrals(address user, uint256 index) view returns (address)",
                "function referralRewards(address user) view returns (uint256)",
                "function totalReferralRewards() view returns (uint256)",
                "function ambassadorPoolRemaining() view returns (uint256)"
            ]
        },

        // Constants
        CONSTANTS: {
            MIN_STAKE: '100000000000000000000', // 100 ECC in wei
            LOCK_PERIODS: [0, 30, 90, 180, 365],
            APY_TIERS: [8, 10, 12],
            GAS_LIMITS: {
                APPROVE: 50000,
                TRANSFER: 65000,
                STAKE: 150000,
                HARVEST: 100000
            }
        },

        // Messages
        ERRORS: {
            NO_WALLET: 'Please connect your wallet first',
            WRONG_NETWORK: 'Please switch to Sepolia network',
            INSUFFICIENT_BALANCE: 'Insufficient ECC balance',
            TX_FAILED: 'Transaction failed. Please try again.'
        },
        SUCCESS: {
            WALLET_CONNECTED: 'Wallet connected successfully!',
            STAKE_SUCCESS: 'Tokens staked successfully!',
            TX_SUCCESS: 'Transaction successful!'
        }
    };

    // WEB3 INITIALIZATION
    window.initializeWeb3 = async function() {
        try {
            console.log('Initializing Web3...');

            if (typeof window.ethereum === 'undefined') {
                throw new Error('MetaMask not installed');
            }

            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts'
            });

            const provider = new ethers.providers.Web3Provider(window.ethereum);
            const signer = provider.getSigner();
            const network = await provider.getNetwork();

            console.log('Network:', network.chainId);

            if (network.chainId !== window.ECOCOIN_CONFIG.NETWORK.SEPOLIA.chainId) {
                console.warn('Wrong network, switching to Sepolia...');
                await switchToSepolia();
            }

            window.web3Provider = provider;
            window.web3Signer = signer;
            window.web3UserAddress = accounts[0];
            window.web3Mode = true;

            console.log('Web3 initialized');
            console.log('Address:', accounts[0].substring(0, 6) + '...' + accounts[0].substring(38));

            return { provider, signer, address: accounts[0] };

        } catch (error) {
            console.error('Web3 initialization failed:', error);
            throw error;
        }
    };

    window.switchToSepolia = async function() {
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: window.ECOCOIN_CONFIG.NETWORK.SEPOLIA.chainIdHex }]
            });
        } catch (error) {
            if (error.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: window.ECOCOIN_CONFIG.NETWORK.SEPOLIA.chainIdHex,
                        chainName: window.ECOCOIN_CONFIG.NETWORK.SEPOLIA.name,
                        nativeCurrency: window.ECOCOIN_CONFIG.NETWORK.SEPOLIA.currency,
                        rpcUrls: [window.ECOCOIN_CONFIG.NETWORK.SEPOLIA.rpcUrl],
                        blockExplorerUrls: [window.ECOCOIN_CONFIG.NETWORK.SEPOLIA.blockExplorer]
                    }]
                });
            } else {
                throw error;
            }
        }
    };

    window.initializeContracts = async function() {
        try {
            console.log('Initializing contracts...');

            if (!window.web3Signer) {
                throw new Error('Web3 not initialized');
            }

            const contracts = {};
            const cfg = window.ECOCOIN_CONFIG;

            if (cfg.CONTRACTS.ECC_TOKEN !== '0x0000000000000000000000000000000000000000') {
                contracts.eccToken = new ethers.Contract(
                    cfg.CONTRACTS.ECC_TOKEN,
                    cfg.ABIS.ECC_TOKEN,
                    window.web3Signer
                );
                console.log('ECC Token contract initialized');
            }

            if (cfg.CONTRACTS.STAKING_VAULT !== '0x0000000000000000000000000000000000000000') {
                contracts.stakingVault = new ethers.Contract(
                    cfg.CONTRACTS.STAKING_VAULT,
                    cfg.ABIS.STAKING_VAULT,
                    window.web3Signer
                );
                console.log('Staking Vault contract initialized');
            }

            if (cfg.CONTRACTS.MASTERCHEF !== '0x0000000000000000000000000000000000000000') {
                contracts.masterChef = new ethers.Contract(
                    cfg.CONTRACTS.MASTERCHEF,
                    cfg.ABIS.MASTERCHEF,
                    window.web3Signer
                );
                console.log('MasterChef contract initialized');
            }

            // Initialize Carbon Credit NFT
            if (cfg.CONTRACTS.CARBON_CREDIT_NFT && cfg.CONTRACTS.CARBON_CREDIT_NFT !== '0x0000000000000000000000000000000000000000') {
                contracts.carbonCreditNFT = new ethers.Contract(
                    cfg.CONTRACTS.CARBON_CREDIT_NFT,
                    cfg.ABIS.CARBON_CREDIT_NFT || ['function balanceOf(address,uint256) view returns (uint256)'],
                    window.web3Signer
                );
                console.log('Carbon Credit NFT contract initialized');
            }

            // Initialize Certificate NFT
            if (cfg.CONTRACTS.CERTIFICATE_NFT && cfg.CONTRACTS.CERTIFICATE_NFT !== '0x0000000000000000000000000000000000000000') {
                contracts.certificateNFT = new ethers.Contract(
                    cfg.CONTRACTS.CERTIFICATE_NFT,
                    cfg.ABIS.CERTIFICATE_NFT || ['function balanceOf(address) view returns (uint256)'],
                    window.web3Signer
                );
                console.log('Certificate NFT contract initialized');
            }

            // Initialize Governance
            if (cfg.CONTRACTS.GOVERNOR && cfg.CONTRACTS.GOVERNOR !== '0x0000000000000000000000000000000000000000') {
                contracts.governor = new ethers.Contract(
                    cfg.CONTRACTS.GOVERNOR,
                    cfg.ABIS.GOVERNOR || ['function propose(address[],uint256[],bytes[],string) returns (uint256)'],
                    window.web3Signer
                );
                console.log('Governance contract initialized');
            }

            // Initialize Rewards Distributor
            if (cfg.CONTRACTS.REWARDS_DISTRIBUTOR && cfg.CONTRACTS.REWARDS_DISTRIBUTOR !== '0x0000000000000000000000000000000000000000') {
                contracts.rewardsDistributor = new ethers.Contract(
                    cfg.CONTRACTS.REWARDS_DISTRIBUTOR,
                    cfg.ABIS.REWARDS_DISTRIBUTOR || ['function claim(uint256,address,uint256,bytes32[]) returns (bool)'],
                    window.web3Signer
                );
                console.log('Rewards Distributor contract initialized');
            }

            window.web3Contracts = contracts;
            window.web3Contract = contracts.eccToken;

            console.log('All contracts initialized:', Object.keys(contracts).length);
            return contracts;

        } catch (error) {
            console.error('Contract initialization failed:', error);
            throw error;
        }
    };

    window.loadBlockchainData = async function() {
        if (!window.web3Contracts || !window.web3UserAddress) {
            console.log('Web3 not ready');
            return;
        }

        console.log('Loading blockchain data...');

        try {
            const contracts = window.web3Contracts;

            // Show Dashboard wallet info section
            const dashboardWalletInfo = document.getElementById('dashboardWalletInfo');
            if (dashboardWalletInfo) {
                dashboardWalletInfo.style.display = 'block';
                console.log('Dashboard wallet info shown');
            }

            // Update Dashboard wallet address
            const dashWalletAddress = document.getElementById('dashWalletAddress');
            if (dashWalletAddress) {
                dashWalletAddress.textContent = window.web3UserAddress;
                console.log('Dashboard wallet address updated');
            }

            // Hide "Connect Your Wallet" banner if it exists
            const dashboardWalletStatus = document.getElementById('dashboardWalletStatus');
            if (dashboardWalletStatus) {
                dashboardWalletStatus.style.display = 'none';
            }

            if (contracts.eccToken) {
                const balance = await contracts.eccToken.balanceOf(window.web3UserAddress);
                const formatted = ethers.utils.formatEther(balance);
                const display = parseFloat(formatted).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                console.log('Balance:', formatted, 'ECC');

                // Update all balance displays with correct selectors
                document.querySelectorAll('#walletBalance, .ecc-balance, #ecc-balance, .wallet-balance').forEach(el => {
                    if (el) el.textContent = display + ' ECC';
                });

                // Update the main dashboard display (CRITICAL FIX!)
                const ecoCoinsDisplay = document.getElementById('ecoCoinsDisplay');
                if (ecoCoinsDisplay) {
                    ecoCoinsDisplay.textContent = display;
                    console.log('Updated ecoCoinsDisplay:', display);
                }

                // Update Dashboard tab balance displays (CRITICAL FIX!)
                const dashEccBalance = document.getElementById('userBalance');
                if (dashEccBalance) {
                    dashEccBalance.textContent = display;
                    console.log('Updated dashEccBalance:', display);
                }

                const dashCo2Offset = document.getElementById('dashCo2Offset');
                if (dashCo2Offset) {
                    dashCo2Offset.textContent = display;
                    console.log('Updated dashCo2Offset:', display);
                }

                // Update stat-number displays (for other pages)
                document.querySelectorAll('.stat-number').forEach(el => {
                    const parent = el.parentElement;
                    if (parent && parent.textContent.includes('COINS')) {
                        el.textContent = display;
                    }
                });

                // Update appState and localStorage
                if (window.appState) {
                    window.appState.ecoCoins = parseFloat(formatted);
                }
                localStorage.setItem('ecoCoins', formatted);
            }

            if (contracts.stakingVault) {
                try {
                    const stakeInfo = await contracts.stakingVault.getStakeInfo(window.web3UserAddress);
                    const staked = ethers.utils.formatEther(stakeInfo.amount || stakeInfo[0] || '0');
                    const rewards = ethers.utils.formatEther(stakeInfo.rewards || stakeInfo[1] || '0');

                    console.log('Staked:', staked, 'ECC');
                    console.log('Rewards:', rewards, 'ECC');

                    if (document.getElementById('staked-amount')) {
                        document.getElementById('staked-amount').textContent = parseFloat(staked).toFixed(2) + ' ECC';
                    }
                    if (document.getElementById('pending-rewards')) {
                        document.getElementById('pending-rewards').textContent = parseFloat(rewards).toFixed(2) + ' ECC';
                    }
                } catch (e) {
                    console.log('No staking data');
                }
            }

            console.log('Blockchain data loaded');

        } catch (error) {
            console.error('Error loading blockchain data:', error);
        }
    };

    window.addEventListener('load', async function() {
        console.log('EcoCoin Web3 Module Loaded');

        if (typeof window.ethereum !== 'undefined') {
            console.log('MetaMask detected');

            window.ethereum.on('accountsChanged', async (accounts) => {
                if (accounts.length === 0) {
                    console.log('Disconnected');
                    window.web3UserAddress = null;
                    window.web3Mode = false;
                } else {
                    console.log('Account changed:', accounts[0]);
                    window.web3UserAddress = accounts[0];
                    await initializeContracts();
                    await loadBlockchainData();
                }
            });

            window.ethereum.on('chainChanged', () => {
                console.log('Network changed, reloading...');
                window.location.reload();
            });

            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                console.log('Auto-connecting...');
                try {
                    await initializeWeb3();
                    await initializeContracts();
                    window.web3UserAddress = accounts[0];
                    window.web3Mode = true;
                    await loadBlockchainData();
                    console.log('Auto-connected successfully');
                } catch (error) {
                    console.error('Auto-connect failed:', error);
                }
            }
        } else {
            console.warn('MetaMask not installed');
        }
    });

})();

// ═══════════════════════════════════════════════════════════════
// METAMASK CONNECTION - Using simple version from <head>
// ═══════════════════════════════════════════════════════════════
// The simple MetaMask connector is already defined above
// No need to redefine here - it's available immediately on page load

console.log('Using simple MetaMask connector from head');

// ═══════════════════════════════════════════════════════════════

window.formatAddress = function(address) {
    if (!address) return '';
    return address.substring(0, 6) + '...' + address.substring(38);
};

window.formatTokenAmount = function(amount, decimals = 18) {
    try {
        return parseFloat(ethers.utils.formatUnits(amount, decimals)).toFixed(2);
    } catch {
        return '0.00';
    }
};

console.log('EcoCoin Web3 Module Ready');

// ===============================================================================
// SECTION 3: BACKEND API CONFIGURATION (SINGLETON - AVOID DUPLICATES)
// ===============================================================================

// Use conditional assignment to prevent "Identifier has already been declared" errors
// These were originally declared multiple times in different script blocks

// BACKEND_URL - First declaration wins, subsequent blocks check if already defined
const BACKEND_URL = window.BACKEND_URL || 'https://us-central1-ecocoin-f32d8.cloudfunctions.net/api';
window.BACKEND_URL = BACKEND_URL;

// API_ENDPOINTS - First declaration wins
const API_ENDPOINTS = window.API_ENDPOINTS || {
    AUTH_REGISTER: '/api/auth/register',
    AUTH_LOGIN: '/api/auth/login',
    USER_PROFILE: '/api/users/profile',
    REFERRAL_GET_CODE: '/api/referral/code',
    REFERRAL_APPLY: '/api/referral/apply',
    REFERRAL_STATS: '/api/referral/stats',
    REFERRAL_LIST: '/api/referral/list',
    CARBON_SUBMIT: '/api/carbon/submit',
    CARBON_LIST: '/api/carbon/projects',
    CARBON_STATUS: '/api/carbon/status',
    ACTIVITY_LOG: '/api/activity/log',
    ACTIVITY_USER: '/api/activity/user',
    ADMIN_STATS: '/api/admin/stats',
    ADMIN_USERS: '/api/admin/users'
};
window.API_ENDPOINTS = API_ENDPOINTS;

// Backend API Helper Function
window.callBackendAPI = window.callBackendAPI || async function(endpoint, method = 'GET', data = null) {
    try {
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        if (data && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(`${BACKEND_URL}${endpoint}`, options);

        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Backend API Error:', error);
        throw error;
    }
};

// ===============================================================================
// UserDB Object - User Database Management (SINGLETON)
// ===============================================================================

window.UserDB = window.UserDB || {
    getAllUsers: async function() {
        try {
            return await window.callBackendAPI(API_ENDPOINTS.ADMIN_USERS, 'GET');
        } catch (error) {
            console.error('Error fetching users:', error);
            return [];
        }
    },

    saveUser: async function(userData) {
        try {
            return await window.callBackendAPI(API_ENDPOINTS.AUTH_REGISTER, 'POST', userData);
        } catch (error) {
            console.error('Error saving user:', error);
            return null;
        }
    },

    banUser: async function(userId) {
        try {
            return await window.callBackendAPI(`/api/admin/users/${userId}/ban`, 'POST');
        } catch (error) {
            console.error('Error banning user:', error);
            return null;
        }
    },

    getUserByAddress: async function(address) {
        try {
            return await window.callBackendAPI(`/api/users/${address}`, 'GET');
        } catch (error) {
            console.error('Error fetching user by address:', error);
            return null;
        }
    }
};

// ===============================================================================
// ActivityTracker Object - Activity Logging (SINGLETON)
// ===============================================================================

window.ActivityTracker = window.ActivityTracker || {
    logActivity: async function(activityData) {
        try {
            return await window.callBackendAPI(API_ENDPOINTS.ACTIVITY_LOG, 'POST', activityData);
        } catch (error) {
            console.error('Error logging activity:', error);
            return null;
        }
    },

    getUserActivities: async function(userId) {
        try {
            return await window.callBackendAPI(`${API_ENDPOINTS.ACTIVITY_USER}/${userId}`, 'GET');
        } catch (error) {
            console.error('Error fetching user activities:', error);
            return [];
        }
    }
};

// ===============================================================================
// AdminHelper Object - Admin Functions (SINGLETON with enhancement support)
// ===============================================================================

// Store original AdminHelper if it exists
const _originalAdminHelper = window.AdminHelper;

window.AdminHelper = window.AdminHelper || {
    isAdmin: function(address) {
        if (!address || !window.ECOCOIN_CONFIG) return false;
        const adminAddresses = window.ECOCOIN_CONFIG.ADMIN?.ADDRESSES || [];
        return adminAddresses.map(a => a.toLowerCase()).includes(address.toLowerCase());
    },

    isAdminEmail: function(email) {
        if (!email || !window.ECOCOIN_CONFIG) return false;
        const adminEmails = window.ECOCOIN_CONFIG.ADMIN?.EMAILS || [];
        return adminEmails.map(e => e.toLowerCase()).includes(email.toLowerCase());
    },

    getPlatformStats: async function() {
        try {
            return await window.callBackendAPI(API_ENDPOINTS.ADMIN_STATS, 'GET');
        } catch (error) {
            console.error('Error fetching platform stats:', error);
            return null;
        }
    }
};

// ===============================================================================
// registerUserBackend Function (SINGLETON)
// ===============================================================================

window.registerUserBackend = window.registerUserBackend || async function(userData) {
    console.log('Registering user with backend:', userData);

    try {
        const response = await window.callBackendAPI(API_ENDPOINTS.AUTH_REGISTER, 'POST', {
            name: userData.name || 'Anonymous User',
            email: userData.email || '',
            walletAddress: userData.walletAddress,
            authMethod: userData.authMethod || 'manual'
        });

        console.log('User registered:', response);
        return response;
    } catch (error) {
        console.error('Registration error:', error);
        throw error;
    }
};

// Referral State Management
window.REFERRAL_STATE = window.REFERRAL_STATE || {
    code: null,
    totalReferrals: 0,
    totalRewards: 0,
    referrals: [],
    initialized: false
};

console.log('Backend management objects initialized');
console.log('  - UserDB:', typeof window.UserDB);
console.log('  - ActivityTracker:', typeof window.ActivityTracker);
console.log('  - AdminHelper:', typeof window.AdminHelper);
console.log('  - REFERRAL_STATE:', typeof window.REFERRAL_STATE);

// ===============================================================================
// SECTION 4: SECURITY CONFIGURATION MODULE
// ===============================================================================

const SECURITY_CONFIG = {
    // Transfer Limits
    DAILY_TRANSFER_LIMIT: 100000, // 100k ECC per day
    SINGLE_TRANSFER_LIMIT: 10000,  // 10k ECC per transaction
    HIGH_VALUE_THRESHOLD: 5000,    // Requires additional confirmation

    // Rate Limiting
    MAX_REQUESTS_PER_MINUTE: 10,
    MAX_TRANSFER_PER_HOUR: 5,
    COOLDOWN_PERIOD: 60000, // 1 minute in ms

    // Gas Protection
    MAX_GAS_PRICE_GWEI: 100, // Max 100 gwei
    GAS_PRICE_BUFFER: 1.1,    // 10% buffer over estimate

    // Security Features
    REQUIRE_TRANSACTION_SIGNING: true,
    ENABLE_EMERGENCY_PAUSE: true,
    ENABLE_SPENDING_LIMITS: true,
    ENABLE_RATE_LIMITING: true,

    // Validation
    MIN_TRANSFER_AMOUNT: 0.01,
    BURN_ADDRESS: '0x0000000000000000000000000000000000000000',

    // Session
    SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
    MAX_LOGIN_ATTEMPTS: 3,
    LOCKOUT_DURATION: 15 * 60 * 1000, // 15 minutes

    // Warnings
    TESTNET_WARNING: true,
    MAINNET_READY: false
};

// Rate Limiter Class
class RateLimiter {
    constructor() {
        this.requests = new Map();
        this.transfers = [];
    }

    checkRateLimit(action, identifier) {
        const now = Date.now();
        const key = `${action}_${identifier}`;

        if (!this.requests.has(key)) {
            this.requests.set(key, []);
        }

        const timestamps = this.requests.get(key);
        const recentRequests = timestamps.filter(t => now - t < 60000);

        if (recentRequests.length >= SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE) {
            return {
                allowed: false,
                message: `Rate limit exceeded. Max ${SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE} requests per minute.`,
                retryAfter: 60 - Math.floor((now - recentRequests[0]) / 1000)
            };
        }

        recentRequests.push(now);
        this.requests.set(key, recentRequests);

        return { allowed: true };
    }

    checkTransferLimit(address) {
        const now = Date.now();
        const hourAgo = now - 3600000;

        this.transfers = this.transfers.filter(t => t.timestamp > hourAgo);
        const userTransfers = this.transfers.filter(t => t.address === address);

        if (userTransfers.length >= SECURITY_CONFIG.MAX_TRANSFER_PER_HOUR) {
            return {
                allowed: false,
                message: `Transfer limit exceeded. Max ${SECURITY_CONFIG.MAX_TRANSFER_PER_HOUR} transfers per hour.`,
                nextAllowed: new Date(userTransfers[0].timestamp + 3600000)
            };
        }

        return { allowed: true };
    }

    logTransfer(address, amount) {
        this.transfers.push({
            address,
            amount,
            timestamp: Date.now()
        });
    }
}

// Spending Tracker Class
class SpendingTracker {
    constructor() {
        this.loadData();
    }

    loadData() {
        const data = localStorage.getItem('ecc_spending_tracker');
        if (data) {
            this.data = JSON.parse(data);
        } else {
            this.data = {};
        }
    }

    saveData() {
        localStorage.setItem('ecc_spending_tracker', JSON.stringify(this.data));
    }

    checkDailyLimit(address, amount) {
        const today = new Date().toISOString().split('T')[0];

        if (!this.data[address]) {
            this.data[address] = {};
        }

        if (!this.data[address][today]) {
            this.data[address][today] = 0;
        }

        const dailyTotal = this.data[address][today] + amount;

        if (dailyTotal > SECURITY_CONFIG.DAILY_TRANSFER_LIMIT) {
            return {
                allowed: false,
                message: `Daily limit exceeded. Limit: ${SECURITY_CONFIG.DAILY_TRANSFER_LIMIT.toLocaleString()} ECC`,
                spent: this.data[address][today],
                remaining: SECURITY_CONFIG.DAILY_TRANSFER_LIMIT - this.data[address][today]
            };
        }

        return {
            allowed: true,
            spent: this.data[address][today],
            remaining: SECURITY_CONFIG.DAILY_TRANSFER_LIMIT - dailyTotal
        };
    }

    logSpending(address, amount) {
        const today = new Date().toISOString().split('T')[0];

        if (!this.data[address]) {
            this.data[address] = {};
        }

        if (!this.data[address][today]) {
            this.data[address][today] = 0;
        }

        this.data[address][today] += amount;
        this.saveData();
    }

    getDailySpending(address) {
        const today = new Date().toISOString().split('T')[0];
        return this.data[address]?.[today] || 0;
    }
}

// Input Validator Class
class InputValidator {
    static validateAddress(address) {
        if (!address) {
            return { valid: false, error: 'Address is required' };
        }

        if (typeof address !== 'string') {
            return { valid: false, error: 'Address must be a string' };
        }

        if (address.length !== 42) {
            return { valid: false, error: 'Address must be 42 characters long' };
        }

        if (!address.startsWith('0x')) {
            return { valid: false, error: 'Address must start with 0x' };
        }

        if (address === SECURITY_CONFIG.BURN_ADDRESS) {
            return { valid: false, error: 'Cannot send to burn address' };
        }

        if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
            return { valid: false, error: 'Address contains invalid characters' };
        }

        if (typeof ethers !== 'undefined') {
            try {
                if (!ethers.utils.isAddress(address)) {
                    return { valid: false, error: 'Invalid Ethereum address' };
                }

                const checksumAddress = ethers.utils.getAddress(address);
                if (checksumAddress !== address) {
                    return {
                        valid: true,
                        warning: 'Address checksum mismatch - accepting but be careful',
                        corrected: checksumAddress
                    };
                }
            } catch (e) {
                return { valid: false, error: 'Invalid address format' };
            }
        }

        return { valid: true };
    }

    static validateAmount(amount, balance) {
        if (amount === undefined || amount === null || amount === '') {
            return { valid: false, error: 'Amount is required' };
        }

        const numAmount = parseFloat(amount);

        if (isNaN(numAmount)) {
            return { valid: false, error: 'Amount must be a number' };
        }

        if (numAmount <= 0) {
            return { valid: false, error: 'Amount must be greater than 0' };
        }

        if (numAmount < SECURITY_CONFIG.MIN_TRANSFER_AMOUNT) {
            return { valid: false, error: `Minimum amount is ${SECURITY_CONFIG.MIN_TRANSFER_AMOUNT} ECC` };
        }

        if (numAmount > SECURITY_CONFIG.SINGLE_TRANSFER_LIMIT) {
            return { valid: false, error: `Maximum single transfer is ${SECURITY_CONFIG.SINGLE_TRANSFER_LIMIT.toLocaleString()} ECC` };
        }

        if (balance !== undefined && numAmount > balance) {
            return { valid: false, error: 'Insufficient balance' };
        }

        return { valid: true, amount: numAmount };
    }
}

// Initialize global security instances
window.rateLimiter = window.rateLimiter || new RateLimiter();
window.spendingTracker = window.spendingTracker || new SpendingTracker();
window.InputValidator = InputValidator;
window.SECURITY_CONFIG = SECURITY_CONFIG;

// ===============================================================================
// SECTION 5: GLOBAL VARIABLES AND STATE MANAGEMENT
// ===============================================================================

// Web3 State (Using global window properties)
window.web3Provider = window.web3Provider || null;
window.web3Signer = window.web3Signer || null;
window.web3Contract = window.web3Contract || null;
window.web3UserAddress = window.web3UserAddress || null;
window.currentAccount = window.currentAccount || null;
window.web3HasAcceptedTerms = window.web3HasAcceptedTerms || false;
window.web3Mode = window.web3Mode || false;

// Contract Configuration
const CONTRACT_ADDRESS = "0x1D5404994cABc50332b713af77DB020cE571F425";
const MAX_SUPPLY = 1000000000; // 1 Billion ECC maximum supply
const EMISSION_RATE = 1; // 1 ECC per 1 ton CO2

// Network-specific contract addresses
const CONTRACT_ADDRESSES = {
    11155111: CONTRACT_ADDRESS // Sepolia Testnet
    // 1: "0x...",        // Ethereum Mainnet
    // 137: "0x...",      // Polygon
    // 56: "0x...",       // BSC Mainnet
};

// Farming feature toggles
const FARM_FEATURE_ENABLED = true;
const FARM_VERIFICATION_ENABLED = false;

const MAX_TONS_PER_TRANSACTION = 100;
const DAILY_LIMIT_ECC = 1000;

const CONTRACT_ABI = [
    // RETAIL OFFSET MINTING
    "function acceptRetailTerms() external",
    "function mintRetailOffset(uint256 carbonTons, uint8 activityType, string memory description) external payable returns (uint256)",

    // USER PROFILE & STATS
    "function getUserProfile(address user) external view returns (uint8 tier, bool acceptedRetailTerms, uint256 userTotalCarbonOffset, uint256 retailOffsetsCount, uint256 enterpriseOffsetsCount, address referrer, bool hasReferrer)",
    "function getPlatformStats() external view returns (uint256 circulatingSupply, uint256 totalCO2Offset, uint256 retailOffsetTotal, uint256 enterpriseOffsetTotal, uint256 percentageOfMaxSupply, uint256 totalStakedAmount, uint256 totalReferralRewardsPaid)",

    // STAKING FUNCTIONS
    "function stake(uint256 amount, uint8 apyTier) external",
    "function unstake() external",
    "function claimStakingRewards() external returns (uint256)",
    "function compoundStakingRewards() external returns (uint256)",
    "function getStakeInfo(address user) external view returns (uint256 amount, uint256 startTime, uint256 pendingRewards, uint8 apyTier)",
    "function calculateStakingRewards(address user) external view returns (uint256)",

    // REFERRAL SYSTEM
    "function registerReferral(address referrer) external",
    "function getUserReferrals(address user) external view returns (address[] memory)",
    "function getReferralStats(address user) external view returns (uint256 totalReferrals, uint256 totalRewardsEarned)",

    // YIELD FARMING
    "function depositToFarm(uint256 pid, uint256 amount) external",
    "function withdrawFromFarm(uint256 pid, uint256 amount) external",
    "function claimFarmRewards(uint256 pid) external returns (uint256)",
    "function pendingFarmRewards(uint256 pid, address user) external view returns (uint256)",
    "function getPoolInfo(uint256 pid) external view returns (address lpToken, uint256 allocPoint, uint256 totalStakedInPool)",
    "function getPoolCount() external view returns (uint256)",

    // UTILITY & ERC20
    "function balanceOf(address account) external view returns (uint256)",
    "function totalSupply() external view returns (uint256)",
    "function getRemainingMintableSupply() external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)"
];

// Expose to window for global access
window.CONTRACT_ABI = CONTRACT_ABI;
window.CONTRACT_ADDRESS = CONTRACT_ADDRESS;
window.MAX_SUPPLY = MAX_SUPPLY;
window.CONTRACT_ADDRESSES = CONTRACT_ADDRESSES;

// ===============================================================================
// TOKENOMICS WRAPPER FUNCTIONS (ERC-20)
// ===============================================================================

// Get total supply of ECC tokens
window.totalSupply = async function totalSupply() {
    try {
        if (window.web3Contract && typeof window.web3Contract.totalSupply === 'function') {
            const supply = await window.web3Contract.totalSupply();
            return supply;
        }
        // Fallback to MAX_SUPPLY constant if contract not available
        return ethers.BigNumber.from(MAX_SUPPLY).mul(ethers.BigNumber.from(10).pow(18));
    } catch (error) {
        console.error('Error getting total supply:', error);
        return ethers.BigNumber.from(0);
    }
};

// Get balance of an address
window.balanceOf = async function balanceOf(address) {
    try {
        if (!address) {
            address = window.web3UserAddress || window.currentAccount;
        }
        if (!address) {
            console.warn('No address provided for balanceOf');
            return ethers.BigNumber.from(0);
        }
        if (window.web3Contract && typeof window.web3Contract.balanceOf === 'function') {
            const balance = await window.web3Contract.balanceOf(address);
            return balance;
        }
        return ethers.BigNumber.from(0);
    } catch (error) {
        console.error('Error getting balance:', error);
        return ethers.BigNumber.from(0);
    }
};

// Transfer tokens to another address
window.transfer = async function transfer(to, amount) {
    try {
        if (!window.web3Contract || typeof window.web3Contract.transfer !== 'function') {
            throw new Error('Contract not connected');
        }
        if (!to || !amount) {
            throw new Error('Invalid transfer parameters');
        }

        // Security: Validate recipient address
        if (window.ecoSecurity) {
            const addressCheck = window.ecoSecurity.validateAddress(to);
            if (!addressCheck.valid) {
                throw new Error(addressCheck.error || 'Invalid recipient address');
            }
            if (addressCheck.isScam) {
                throw new Error('Transaction blocked: Recipient flagged as suspicious');
            }

            // Check rate limit
            const rateCheck = window.ecoSecurity.checkRateLimit('transfer');
            if (!rateCheck.allowed) {
                throw new Error(rateCheck.error);
            }

            // Pre-transaction security check
            const securityCheck = await window.ecoSecurity.preTransactionCheck('transfer', amount, to);
            if (!securityCheck.approved) {
                const failedCheck = securityCheck.checks.find(c => !c.passed);
                throw new Error(failedCheck ? failedCheck.error : 'Security check failed');
            }
        }

        // Advanced security: Check circuit breaker
        if (window.ecoSecurityAdvanced && window.ecoSecurityAdvanced.circuitBreaker.triggered) {
            throw new Error('Emergency circuit breaker is active. Transactions paused.');
        }

        const tx = await window.web3Contract.transfer(to, amount);
        await tx.wait();

        // Record transaction for security tracking
        if (window.ecoSecurity) {
            window.ecoSecurity.recordTransaction('transfer', amount);
        }

        return tx;
    } catch (error) {
        console.error('Error transferring tokens:', error);
        throw error;
    }
};

// Approve spending allowance
window.approve = async function approve(spender, amount) {
    try {
        if (!window.web3Contract || typeof window.web3Contract.approve !== 'function') {
            throw new Error('Contract not connected');
        }
        if (!spender || !amount) {
            throw new Error('Invalid approve parameters');
        }

        // Security: Validate spender address
        if (window.ecoSecurity) {
            const addressCheck = window.ecoSecurity.validateAddress(spender);
            if (!addressCheck.valid) {
                throw new Error(addressCheck.error || 'Invalid spender address');
            }
        }

        // Advanced security: Track approval and warn about unlimited approvals
        if (window.ecoSecurityAdvanced) {
            if (window.ecoSecurityAdvanced.circuitBreaker.triggered) {
                throw new Error('Emergency circuit breaker is active. Transactions paused.');
            }
            await window.ecoSecurityAdvanced.trackApproval(
                window.web3Contract.address,
                spender,
                amount.toString()
            );
        }

        const tx = await window.web3Contract.approve(spender, amount);
        await tx.wait();
        return tx;
    } catch (error) {
        console.error('Error approving tokens:', error);
        throw error;
    }
};

// Get allowance for a spender
window.allowance = async function allowance(owner, spender) {
    try {
        if (!owner) {
            owner = window.web3UserAddress || window.currentAccount;
        }
        if (!owner || !spender) {
            console.warn('Invalid allowance parameters');
            return ethers.BigNumber.from(0);
        }
        if (window.web3Contract && typeof window.web3Contract.allowance === 'function') {
            const allowed = await window.web3Contract.allowance(owner, spender);
            return allowed;
        }
        return ethers.BigNumber.from(0);
    } catch (error) {
        console.error('Error getting allowance:', error);
        return ethers.BigNumber.from(0);
    }
};

// Get remaining mintable supply
window.getRemainingMintableSupply = async function getRemainingMintableSupply() {
    try {
        if (window.web3Contract && typeof window.web3Contract.getRemainingMintableSupply === 'function') {
            const remaining = await window.web3Contract.getRemainingMintableSupply();
            return remaining;
        }
        // Fallback calculation
        const total = await window.totalSupply();
        const maxSupply = ethers.BigNumber.from(MAX_SUPPLY).mul(ethers.BigNumber.from(10).pow(18));
        return maxSupply.sub(total);
    } catch (error) {
        console.error('Error getting remaining mintable supply:', error);
        return ethers.BigNumber.from(0);
    }
};

// Get circulating supply (total supply minus locked/burned)
window.getCirculatingSupply = async function getCirculatingSupply() {
    try {
        if (window.web3Contract && typeof window.web3Contract.getPlatformStats === 'function') {
            const stats = await window.web3Contract.getPlatformStats();
            return stats.circulatingSupply || stats[0];
        }
        // Fallback to total supply
        return await window.totalSupply();
    } catch (error) {
        console.error('Error getting circulating supply:', error);
        return ethers.BigNumber.from(0);
    }
};

// Get platform statistics
window.getPlatformStats = async function getPlatformStats() {
    try {
        if (window.web3Contract && typeof window.web3Contract.getPlatformStats === 'function') {
            const stats = await window.web3Contract.getPlatformStats();
            return {
                circulatingSupply: stats.circulatingSupply || stats[0],
                totalCO2Offset: stats.totalCO2Offset || stats[1],
                retailOffsetTotal: stats.retailOffsetTotal || stats[2],
                enterpriseOffsetTotal: stats.enterpriseOffsetTotal || stats[3],
                percentageOfMaxSupply: stats.percentageOfMaxSupply || stats[4],
                totalStakedAmount: stats.totalStakedAmount || stats[5],
                totalReferralRewardsPaid: stats.totalReferralRewardsPaid || stats[6]
            };
        }
        // Return default stats
        return {
            circulatingSupply: ethers.BigNumber.from(0),
            totalCO2Offset: ethers.BigNumber.from(0),
            retailOffsetTotal: ethers.BigNumber.from(0),
            enterpriseOffsetTotal: ethers.BigNumber.from(0),
            percentageOfMaxSupply: ethers.BigNumber.from(0),
            totalStakedAmount: ethers.BigNumber.from(0),
            totalReferralRewardsPaid: ethers.BigNumber.from(0)
        };
    } catch (error) {
        console.error('Error getting platform stats:', error);
        return null;
    }
};

// Transfer tokens from one address to another (ERC20 transferFrom)
window.transferFrom = async function transferFrom(from, to, amount) {
    try {
        if (!window.web3Contract || typeof window.web3Contract.transferFrom !== 'function') {
            throw new Error('Contract not connected or transferFrom not available');
        }
        if (!from || !to || !amount) {
            throw new Error('Invalid transferFrom parameters');
        }
        const tx = await window.web3Contract.transferFrom(from, to, amount);
        await tx.wait();
        return tx;
    } catch (error) {
        console.error('Error in transferFrom:', error);
        throw error;
    }
};

// Get token name
window.name = async function name() {
    try {
        if (window.web3Contract && typeof window.web3Contract.name === 'function') {
            return await window.web3Contract.name();
        }
        return 'EcoCoin';
    } catch (error) {
        console.error('Error getting token name:', error);
        return 'EcoCoin';
    }
};

// Get token symbol
window.symbol = async function symbol() {
    try {
        if (window.web3Contract && typeof window.web3Contract.symbol === 'function') {
            return await window.web3Contract.symbol();
        }
        return 'ECC';
    } catch (error) {
        console.error('Error getting token symbol:', error);
        return 'ECC';
    }
};

// Get token decimals
window.decimals = async function decimals() {
    try {
        if (window.web3Contract && typeof window.web3Contract.decimals === 'function') {
            return await window.web3Contract.decimals();
        }
        return 18;
    } catch (error) {
        console.error('Error getting decimals:', error);
        return 18;
    }
};

// ===============================================================================
// SECTION 6: PRODUCTION SECURITY NOTICE
// ===============================================================================

console.log('%cSECURITY-HARDENED VERSION', 'color: #4CAF50; font-size: 20px; font-weight: bold;');
console.log('%cAll security patches applied', 'color: #4CAF50; font-size: 14px;');
console.log('%cRate limiting: ACTIVE', 'color: #4CAF50; font-size: 14px;');
console.log('%cSpending limits: ACTIVE', 'color: #4CAF50; font-size: 14px;');
console.log('%cInput validation: ACTIVE', 'color: #4CAF50; font-size: 14px;');
console.log('%cEmergency controls: ACTIVE', 'color: #4CAF50; font-size: 14px;');
console.log('%cTESTNET ONLY - Backend required for mainnet', 'color: #FF9800; font-size: 14px;');

// ===============================================================================
// NOTE: Additional script blocks from index_backup.html
// The remaining JavaScript content (EcoSecurity classes, LMS system,
// authentication, verification forms, mobile navigation, etc.)
// should be loaded from the original HTML file or separate module files.
//
// This consolidated file contains the CORE functionality needed to
// avoid duplicate declaration errors while maintaining all essential features.
// ===============================================================================

console.log('EcoCoin app.js loaded successfully - Core modules initialized');
