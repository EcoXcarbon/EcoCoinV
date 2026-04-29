// ==============================================================================
// EcoCoin V — Polygon Amoy Testnet Deployment (Full Suite)
// Phase 1: ECCToken, ECCStaking, ECCFarming, ECCVesting, ECCMultiSig
// Phase 2: ECCLaunchpad, ECCAutoCompounder
// Phase 3: ECCLottery, ECCSwap, ECCBridge
// + NFTs: CarbonCreditNFT, CertificateNFT, RewardsDistributor
// + DAO:  TimelockController, ECCGovernance
// Chain ID: 80002 | Native token: POL
// Run: npm run deploy:amoy
// ==============================================================================
const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🌿 EcoCoin V — Polygon Amoy Testnet Deployment (3-contract split)");
  console.log("=".repeat(80) + "\n");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(`📡 Network: Polygon Amoy Testnet (Chain ID: ${network.chainId})`);
  console.log(`💼 Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} POL\n`);

  if (balance < ethers.parseEther("2")) {
    console.warn("⚠️  Low balance! Get free POL from https://faucet.polygon.technology/");
    console.warn("    Deploying 14 contracts — recommend at least 2 POL.\n");
  }

  // ── Distribution wallets (testnet = all deployer) ──────────────────────
  const wallets = {
    carbonRewards: process.env.CARBON_REWARDS_WALLET || deployer.address,
    community:     process.env.COMMUNITY_WALLET      || deployer.address,
    development:   process.env.DEVELOPMENT_WALLET    || deployer.address,
    marketing:     process.env.MARKETING_WALLET      || deployer.address,
    liquidity:     process.env.LIQUIDITY_WALLET      || deployer.address,
    team:          process.env.TEAM_WALLET           || deployer.address,
    advisors:      process.env.ADVISORS_WALLET       || deployer.address,
    reserve:       process.env.RESERVE_WALLET        || deployer.address,
  };

  const deployed = {};

  // ── 1. ECCToken ────────────────────────────────────────────────────────
  console.log("📦 [1/6] Deploying ECCToken (core ERC-20)...");
  const ECCToken = await ethers.getContractFactory("ECCToken");
  const eccToken = await ECCToken.deploy(
    wallets.carbonRewards,
    wallets.community,
    wallets.development,
    wallets.marketing,
    wallets.liquidity,
    wallets.team,
    wallets.advisors,
    wallets.reserve
  );
  await eccToken.deploymentTransaction().wait(1);
  deployed.ECCToken = await eccToken.getAddress();
  console.log(`   ✅ ECCToken: ${deployed.ECCToken}\n`);

  // ── 1b. ECCCarbonOffset ───────────────────────────────────────────────
  console.log("📦 [2/6] Deploying ECCCarbonOffset (carbon offset minting module)...");
  const ECCCarbonOffset = await ethers.getContractFactory("ECCCarbonOffset");
  const eccCarbonOffset = await ECCCarbonOffset.deploy(deployed.ECCToken);
  await eccCarbonOffset.deploymentTransaction().wait(1);
  deployed.ECCCarbonOffset = await eccCarbonOffset.getAddress();
  console.log(`   ✅ ECCCarbonOffset: ${deployed.ECCCarbonOffset}`);

  // Grant MINTER_ROLE on ECCToken to ECCCarbonOffset
  await (await eccToken.grantMinterRole(deployed.ECCCarbonOffset)).wait(1);
  console.log(`   ✅ MINTER_ROLE on ECCToken → ECCCarbonOffset\n`);

  // ── 2. ECCStaking ──────────────────────────────────────────────────────
  console.log("📦 [3/6] Deploying ECCStaking (tiered APY staking vault)...");
  const ECCStaking = await ethers.getContractFactory("ECCStaking");
  const eccStaking = await ECCStaking.deploy(deployed.ECCToken, deployer.address);
  await eccStaking.deploymentTransaction().wait(1);
  deployed.ECCStaking = await eccStaking.getAddress();
  console.log(`   ✅ ECCStaking: ${deployed.ECCStaking}\n`);

  // ── 3. ECCFarming ──────────────────────────────────────────────────────
  console.log("📦 [4/6] Deploying ECCFarming (MasterChef LP farming)...");
  const ECCFarming = await ethers.getContractFactory("ECCFarming");
  const eccFarming = await ECCFarming.deploy(deployed.ECCToken, deployer.address);
  await eccFarming.deploymentTransaction().wait(1);
  deployed.ECCFarming = await eccFarming.getAddress();
  console.log(`   ✅ ECCFarming: ${deployed.ECCFarming}\n`);

  // ── 4. Wire up — push 10M ECC → Staking, 3M ECC → Farming ────────────
  console.log("🔗 [5/6] Initializing contracts (transferring reserves)...");
  const initTx = await eccToken.initializeContracts(deployed.ECCStaking, deployed.ECCFarming);
  await initTx.wait(1);
  console.log(`   ✅ initializeContracts() done — 10M ECC → Staking, 3M ECC → Farming\n`);

  // ── 5. Sync pool balances ──────────────────────────────────────────────
  console.log("🔄 [6/6] Syncing pool balances...");
  const syncStaking = await eccStaking.syncPoolBalance();
  await syncStaking.wait(1);
  const syncFarming = await eccFarming.syncPoolBalance();
  await syncFarming.wait(1);

  const stakingPool = await eccStaking.stakingPoolBalance();
  const farmingPool = await eccFarming.farmingPoolBalance();
  console.log(`   ✅ Staking pool: ${ethers.formatEther(stakingPool)} ECC`);
  console.log(`   ✅ Farming pool: ${ethers.formatEther(farmingPool)} ECC\n`);

  // ── Also deploy NFT contracts ──────────────────────────────────────────
  console.log("📦 Deploying CarbonCreditNFT (ERC-1155)...");
  const CarbonNFT = await ethers.getContractFactory("CarbonCreditNFT");
  const carbonNFT = await CarbonNFT.deploy("https://api.ecocoin.io/carbon-credits/");
  await carbonNFT.deploymentTransaction().wait(1);
  deployed.CarbonCreditNFT = await carbonNFT.getAddress();
  console.log(`   ✅ CarbonCreditNFT: ${deployed.CarbonCreditNFT}\n`);

  console.log("📦 Deploying CertificateNFT (ERC-721 Soulbound)...");
  const CertNFT = await ethers.getContractFactory("CertificateNFT");
  const certNFT = await CertNFT.deploy(
    "EcoCoin Certificate", "ECERT",
    "https://api.ecocoin.io/certificates/",
    true
  );
  await certNFT.deploymentTransaction().wait(1);
  deployed.CertificateNFT = await certNFT.getAddress();
  console.log(`   ✅ CertificateNFT: ${deployed.CertificateNFT}\n`);

  console.log("📦 Deploying RewardsDistributor (Merkle airdrop engine)...");
  const Rewards = await ethers.getContractFactory("RewardsDistributor");
  const rewards = await Rewards.deploy();
  await rewards.deploymentTransaction().wait(1);
  deployed.RewardsDistributor = await rewards.getAddress();
  console.log(`   ✅ RewardsDistributor: ${deployed.RewardsDistributor}\n`);

  // ── 6. Deploy TimelockController + Governance ─────────────────────────
  console.log("📦 Deploying TimelockController (2-day delay)...");
  const Timelock = await ethers.getContractFactory("TimelockController");
  // minDelay=2days, proposers=[], executors=[], admin=deployer
  const timelock = await Timelock.deploy(
    2 * 24 * 60 * 60,   // 2 days
    [],                  // proposers — granted to Governance below
    [],                  // executors — open (anyone can execute after delay)
    deployer.address     // admin
  );
  await timelock.deploymentTransaction().wait(1);
  deployed.TimelockController = await timelock.getAddress();
  console.log(`   ✅ TimelockController: ${deployed.TimelockController}\n`);

  console.log("📦 Deploying ECCGovernance (DAO voting)...");
  const Governance = await ethers.getContractFactory("ECCGovernance");
  const governance = await Governance.deploy(deployed.ECCToken, deployed.TimelockController);
  await governance.deploymentTransaction().wait(1);
  deployed.ECCGovernance = await governance.getAddress();
  console.log(`   ✅ ECCGovernance: ${deployed.ECCGovernance}\n`);

  // Grant Governance the PROPOSER + EXECUTOR roles on Timelock
  console.log("🔗 Wiring Governance roles on TimelockController...");
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
  await (await timelock.grantRole(PROPOSER_ROLE, deployed.ECCGovernance)).wait(1);
  // RT-10: EXECUTOR_ROLE only to Governor — prevents arbitrary execution after timelock delay
  await (await timelock.grantRole(EXECUTOR_ROLE, deployed.ECCGovernance)).wait(1);
  console.log("   ✅ PROPOSER → Governance, EXECUTOR → Governance (restricted)\n");

  // ── 7. Wire NFT contracts ─────────────────────────────────────────────
  console.log("🔗 Wiring NFT contracts...");

  // Grant MINTER_ROLE on CarbonCreditNFT to ECCCarbonOffset (auto-mint on offset)
  const MINTER_ROLE_NFT = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  await (await carbonNFT.grantRole(MINTER_ROLE_NFT, deployed.ECCCarbonOffset)).wait(1);
  console.log("   ✅ MINTER_ROLE on CarbonCreditNFT → ECCCarbonOffset");

  // Grant MINTER_ROLE on CertificateNFT to ECCCarbonOffset (milestone awards)
  await (await certNFT.grantRole(MINTER_ROLE_NFT, deployed.ECCCarbonOffset)).wait(1);
  console.log("   ✅ MINTER_ROLE on CertificateNFT → ECCCarbonOffset");

  // Grant MINTER_ROLE on CertificateNFT to CarbonCreditNFT (retirement certs)
  await (await certNFT.grantRole(MINTER_ROLE_NFT, deployed.CarbonCreditNFT)).wait(1);
  console.log("   ✅ MINTER_ROLE on CertificateNFT → CarbonCreditNFT");

  // Tell ECCCarbonOffset where the NFT contracts are
  await (await eccCarbonOffset.setNFTContracts(deployed.CarbonCreditNFT, deployed.CertificateNFT)).wait(1);
  console.log("   ✅ ECCCarbonOffset.setNFTContracts(carbonNFT, certNFT)");

  // Tell CarbonCreditNFT where the CertificateNFT is
  await (await carbonNFT.setCertificateNFT(deployed.CertificateNFT)).wait(1);
  console.log("   ✅ CarbonCreditNFT.setCertificateNFT(certNFT)");

  // Grant VERIFIER_ROLE on CarbonCreditNFT to deployer (transfer to Verra verifier later)
  const VERIFIER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VERIFIER_ROLE"));
  // Constructor already grants to deployer — also grant to multisig for production
  await (await carbonNFT.grantRole(VERIFIER_ROLE, deployed.ECCMultiSig)).wait(1);
  console.log("   ✅ VERIFIER_ROLE on CarbonCreditNFT → ECCMultiSig");

  // Grant DISTRIBUTOR_ROLE on RewardsDistributor to deployer + multisig
  const DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
  await (await rewards.grantRole(DISTRIBUTOR_ROLE, deployed.ECCMultiSig)).wait(1);
  console.log("   ✅ DISTRIBUTOR_ROLE on RewardsDistributor → ECCMultiSig\n");

  // ── 8. Deploy ECCVesting ───────────────────────────────────────────────
  console.log("📦 Deploying ECCVesting (team/investor token vesting)...");
  const Vesting = await ethers.getContractFactory("ECCVesting");
  const vesting = await Vesting.deploy(deployed.ECCToken);
  await vesting.deploymentTransaction().wait(1);
  deployed.ECCVesting = await vesting.getAddress();
  console.log(`   ✅ ECCVesting: ${deployed.ECCVesting}\n`);

  // ── 9. Deploy ECCMultiSig ─────────────────────────────────────────────
  console.log("📦 Deploying ECCMultiSig (2-of-3 admin multisig)...");
  const MultiSig = await ethers.getContractFactory("ECCMultiSig");
  // 2-of-3 multisig: deployer + 2 placeholder owners (update after deploy)
  const multisig = await MultiSig.deploy(
    [deployer.address, wallets.community, wallets.development],
    2  // 2-of-3 required
  );
  await multisig.deploymentTransaction().wait(1);
  deployed.ECCMultiSig = await multisig.getAddress();
  console.log(`   ✅ ECCMultiSig: ${deployed.ECCMultiSig}\n`);

  console.log("   ✅ ECCVesting ready — use createSchedule() to set up team/investor vesting\n");

  // ── Phase 2: ECCLaunchpad ────────────────────────────────────────────────
  console.log("📦 [P2-1] Deploying ECCLaunchpad (IDO / token sale platform)...");
  const Launchpad = await ethers.getContractFactory("ECCLaunchpad");
  const launchpad = await Launchpad.deploy();
  await launchpad.deploymentTransaction().wait(1);
  deployed.ECCLaunchpad = await launchpad.getAddress();
  console.log(`   ✅ ECCLaunchpad: ${deployed.ECCLaunchpad}\n`);

  // ── Phase 2: ECCAutoCompounder ───────────────────────────────────────────
  console.log("📦 [P2-2] Deploying ECCAutoCompounder (auto-compound staking rewards)...");
  const AutoCompounder = await ethers.getContractFactory("ECCAutoCompounder");
  const autoCompounder = await AutoCompounder.deploy(
    deployed.ECCToken,
    deployed.ECCStaking,
    deployer.address   // treasury
  );
  await autoCompounder.deploymentTransaction().wait(1);
  deployed.ECCAutoCompounder = await autoCompounder.getAddress();
  console.log(`   ✅ ECCAutoCompounder: ${deployed.ECCAutoCompounder}\n`);

  // ── Phase 3: ECCLottery ──────────────────────────────────────────────────
  console.log("📦 [P3-1] Deploying ECCLottery (community lottery with prize tiers)...");
  const Lottery = await ethers.getContractFactory("ECCLottery");
  const lottery = await Lottery.deploy(deployed.ECCToken, deployer.address);
  await lottery.deploymentTransaction().wait(1);
  deployed.ECCLottery = await lottery.getAddress();
  console.log(`   ✅ ECCLottery: ${deployed.ECCLottery}\n`);

  // ── Phase 3: ECCSwap ────────────────────────────────────────────────────
  console.log("📦 [P3-2] Deploying ECCSwap (AMM constant-product DEX)...");
  const Swap = await ethers.getContractFactory("ECCSwap");
  const swap = await Swap.deploy(deployer.address);
  await swap.deploymentTransaction().wait(1);
  deployed.ECCSwap = await swap.getAddress();
  console.log(`   ✅ ECCSwap: ${deployed.ECCSwap}\n`);

  // ── Phase 3: ECCBridge ──────────────────────────────────────────────────
  console.log("📦 [P3-3] Deploying ECCBridge (lock-and-release cross-chain bridge)...");
  const Bridge = await ethers.getContractFactory("ECCBridge");
  const bridge = await Bridge.deploy(deployed.ECCToken, deployer.address);
  await bridge.deploymentTransaction().wait(1);
  deployed.ECCBridge = await bridge.getAddress();
  console.log(`   ✅ ECCBridge: ${deployed.ECCBridge}\n`);

  // ── Wire Phase 2 & 3 ───────────────────────────────────────────────────
  console.log("🔗 Wiring Phase 2 & 3 contracts...");

  // ECCLaunchpad: grant SALE_ADMIN_ROLE to deployer (already granted in constructor)
  console.log("   ✅ ECCLaunchpad: admin is deployer — use createSale() to launch IDOs");

  // ECCAutoCompounder: grant KEEPER_ROLE to deployer for automated compounding
  const KEEPER_ROLE      = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
  const COMPOUNDER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("COMPOUNDER_ROLE"));
  await (await autoCompounder.grantRole(KEEPER_ROLE, deployer.address)).wait(1);
  console.log("   ✅ ECCAutoCompounder: KEEPER_ROLE granted to deployer");

  // ECCStaking: grant COMPOUNDER_ROLE to ECCAutoCompounder so it can call compoundFor()
  await (await eccStaking.grantRole(COMPOUNDER_ROLE, deployed.ECCAutoCompounder)).wait(1);
  console.log("   ✅ ECCStaking: COMPOUNDER_ROLE granted to ECCAutoCompounder");

  // ECCBridge: configure BSC testnet (97) as a supported destination
  await (await bridge.setChainConfig(
    97,                              // BSC testnet
    true,                            // supported
    ethers.parseEther("1"),          // minAmount: 1 ECC
    ethers.parseEther("100000"),     // maxAmount: 100k ECC
    ethers.parseEther("500000"),     // dailyLimit: 500k ECC
    30                               // bridgeFee: 0.3%
  )).wait(1);
  console.log("   ✅ ECCBridge: BSC testnet (chainId 97) configured as destination");

  // ECCBridge: configure BSC mainnet (56) as a supported destination
  await (await bridge.setChainConfig(
    56,
    true,
    ethers.parseEther("1"),
    ethers.parseEther("100000"),
    ethers.parseEther("500000"),
    30
  )).wait(1);
  console.log("   ✅ ECCBridge: BSC mainnet (chainId 56) configured as destination");

  // ECCBridge: configure Ethereum mainnet (1) as a supported destination
  await (await bridge.setChainConfig(
    1,
    true,
    ethers.parseEther("1"),
    ethers.parseEther("100000"),
    ethers.parseEther("500000"),
    50  // 0.5% — higher fee for ETH bridge
  )).wait(1);
  console.log("   ✅ ECCBridge: Ethereum mainnet (chainId 1) configured as destination");

  // ECCSwap: create ECC/POL-wrapped pool (using WMATIC as tokenB placeholder)
  // Note: real pool creation requires a WMATIC/WETH address — skipped on testnet
  // Admin can call createPool(eccToken, wmatic) after deployment
  console.log("   ✅ ECCSwap: ready — use createPool(tokenA, tokenB) to open trading pairs");

  // ECCLottery: exempt from transfer fee (prize payouts shouldn't be taxed)
  const eccTokenFeeExempt = await ethers.getContractAt("ECCToken", deployed.ECCToken);
  await (await eccTokenFeeExempt.setFeeExempt(deployed.ECCLottery, true)).wait(1);
  console.log("   ✅ ECCLottery: fee-exempt on ECC transfers");

  // ECCBridge: exempt from transfer fee (cross-chain locks shouldn't be double-taxed)
  await (await eccTokenFeeExempt.setFeeExempt(deployed.ECCBridge, true)).wait(1);
  console.log("   ✅ ECCBridge: fee-exempt on ECC transfers");

  // ECCSwap: exempt from transfer fee (LP/swap flows shouldn't be double-taxed)
  await (await eccTokenFeeExempt.setFeeExempt(deployed.ECCSwap, true)).wait(1);
  console.log("   ✅ ECCSwap: fee-exempt on ECC transfers");

  // Transfer DEFAULT_ADMIN_ROLE to ECCMultiSig — deployer EOA should not hold it long-term
  // Renounce deployer's DEFAULT_ADMIN_ROLE AFTER verifying multisig is set up correctly
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  await (await eccTokenFeeExempt.grantRole(DEFAULT_ADMIN_ROLE, deployed.ECCMultiSig)).wait(1);
  console.log("   ✅ ECCToken: DEFAULT_ADMIN_ROLE granted to ECCMultiSig");
  console.log("   ⚠️  Deployer still holds DEFAULT_ADMIN_ROLE — renounce manually after verifying multisig\n");

  // ── Post-deploy: set Chainlink oracle addresses ───────────────────────
  console.log("🔗 Post-deploy configuration (Chainlink feeds)...");
  console.log("   ⚠️  Set Chainlink POL/USD feed on ECCCarbonOffset:");
  console.log("       eccCarbonOffset.setPriceFeed('0x001382149eBa3441043c1c66972b4772963f5D43', true)");
  console.log("   ⚠️  Set Chainlink VRF config on ECCLottery:");
  console.log("       lottery.setVRFConfig(coordinator, keyHash, subId, confirmations, gasLimit)");
  console.log("       Polygon Amoy VRF coordinator: 0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf0\n");

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("=".repeat(80));
  console.log("✅ DEPLOYMENT COMPLETE — POLYGON AMOY TESTNET (Phase 1 + 2 + 3)");
  console.log("=".repeat(80) + "\n");

  console.log("📋 Contract Addresses:");
  Object.entries(deployed).forEach(([name, addr]) => {
    console.log(`   ${name.padEnd(22)}: ${addr}`);
  });

  console.log("\n🔗 PolygonScan (Amoy):");
  Object.entries(deployed).forEach(([name, addr]) => {
    console.log(`   ${name.padEnd(22)}: https://amoy.polygonscan.com/address/${addr}`);
  });

  console.log("\n🔍 Verify commands:");
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCToken} ${wallets.carbonRewards} ${wallets.community} ${wallets.development} ${wallets.marketing} ${wallets.liquidity} ${wallets.team} ${wallets.advisors} ${wallets.reserve}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCCarbonOffset} ${deployed.ECCToken}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCStaking} ${deployed.ECCToken} ${deployer.address}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCFarming} ${deployed.ECCToken} ${deployer.address}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCVesting} ${deployed.ECCToken}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCMultiSig} "[${deployer.address},${wallets.community},${wallets.development}]" 2`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.CarbonCreditNFT} "https://api.ecocoin.io/carbon-credits/"`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.CertificateNFT} "EcoCoin Certificate" "ECERT" "https://api.ecocoin.io/certificates/" true`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.RewardsDistributor}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.TimelockController} ${2 * 24 * 60 * 60} "[]" "[]" ${deployer.address}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCGovernance} ${deployed.ECCToken} ${deployed.TimelockController}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCLaunchpad}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCAutoCompounder} ${deployed.ECCToken} ${deployed.ECCStaking} ${deployer.address}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCLottery} ${deployed.ECCToken} ${deployer.address}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCSwap} ${deployer.address}`);
  console.log(`   npx hardhat verify --network polygonAmoy ${deployed.ECCBridge} ${deployed.ECCToken} ${deployer.address}`);

  // ── RT-10: Role Transfer & Renounce Checklist ────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log("🔐 SECURITY CHECKLIST — Role Transfers (DO BEFORE MAINNET)");
  console.log("=".repeat(80));
  console.log(`
  Step 1: Transfer DEFAULT_ADMIN_ROLE on ALL contracts to ECCMultiSig:
    - ECCToken:          grantRole(DEFAULT_ADMIN_ROLE, multisig) ✅ done above
    - ECCCarbonOffset:   grantRole(DEFAULT_ADMIN_ROLE, multisig)
    - ECCStaking:        grantRole(DEFAULT_ADMIN_ROLE, multisig)
    - ECCFarming:        grantRole(DEFAULT_ADMIN_ROLE, multisig)
    - ECCBridge:         grantRole(DEFAULT_ADMIN_ROLE, multisig)
    - ECCSwap:           grantRole(DEFAULT_ADMIN_ROLE, multisig)
    - ECCLottery:        grantRole(DEFAULT_ADMIN_ROLE, multisig)
    - ECCAutoCompounder: grantRole(DEFAULT_ADMIN_ROLE, multisig)
    - ECCLaunchpad:      grantRole(DEFAULT_ADMIN_ROLE, multisig)
    - CarbonCreditNFT:   grantRole(DEFAULT_ADMIN_ROLE, multisig)
    - CertificateNFT:    grantRole(DEFAULT_ADMIN_ROLE, multisig)
    - RewardsDistributor:grantRole(DEFAULT_ADMIN_ROLE, multisig)
    - TimelockController:grantRole(TIMELOCK_ADMIN_ROLE, multisig)

  Step 2: Renounce deployer's DEFAULT_ADMIN_ROLE on ALL contracts:
    - eccToken.renounceRole(DEFAULT_ADMIN_ROLE, deployer)
    - eccStaking.renounceRole(DEFAULT_ADMIN_ROLE, deployer)
    - ... (repeat for all contracts)

  Step 3: Renounce deployer's TIMELOCK_ADMIN_ROLE on TimelockController:
    - timelock.renounceRole(TIMELOCK_ADMIN_ROLE, deployer)

  Step 4: Transfer VERIFIER_ROLE to dedicated Verra verifier:
    - carbonNFT.grantRole(VERIFIER_ROLE, verifierAddress)
    - carbonNFT.renounceRole(VERIFIER_ROLE, deployer) (keep multisig)

  Step 5: Transfer ECCBridge RELAYER_ROLE to dedicated relayer addresses:
    - bridge.grantRole(RELAYER_ROLE, relayer1)
    - bridge.grantRole(RELAYER_ROLE, relayer2)
    - bridge.grantRole(RELAYER_ROLE, relayer3) (minimum 3 required)
    - bridge.renounceRole(RELAYER_ROLE, deployer)

  Step 5: Verify guardian on ECCGovernance:
    - governance.guardian() should return deployer (or multisig)
    - Renounce guardian once DAO matures: governance.renounceGuardian()

  Step 6: Rotate private key in .env (NEVER use deploy key for operations)

  ⚠️  CRITICAL: Do NOT deploy to mainnet until steps 1-4 are complete!
  `);

  const deploymentData = {
    network: "polygonAmoy",
    chainId: Number(network.chainId),
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: deployed,
    wallets,
    polygonscanLinks: Object.fromEntries(
      Object.entries(deployed).map(([k, v]) => [k, `https://amoy.polygonscan.com/address/${v}`])
    ),
  };

  if (!fs.existsSync("deployments")) fs.mkdirSync("deployments");
  const filename = `deployments/polygon-amoy-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentData, null, 2));
  console.log(`\n💾 Saved to ${filename}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
