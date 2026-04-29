// ==============================================================================
// EcoCoin V — Polygon Mainnet Deployment (Full Suite)
// Phase 1: ECCToken, ECCStaking, ECCFarming, ECCVesting, ECCMultiSig
// Phase 2: ECCLaunchpad, ECCAutoCompounder
// Phase 3: ECCLottery, ECCSwap, ECCBridge
// + NFTs: CarbonCreditNFT, CertificateNFT, RewardsDistributor
// + DAO:  TimelockController, ECCGovernance
// Chain ID: 137 | Native token: POL
// Run: npm run deploy:mainnet
// CAUTION: This costs real money. Test on Amoy first.
// ==============================================================================
const { ethers } = require("hardhat");
const fs = require("fs");
const readline = require("readline");

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🌿 EcoCoin V — Polygon MAINNET Deployment (Phase 1 + 2 + 3)");
  console.log("=".repeat(80) + "\n");
  console.log("⚠️  WARNING: This deploys to Polygon MAINNET using REAL POL tokens!");
  console.log("   Make sure you have tested everything on Amoy testnet first.\n");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  if (Number(network.chainId) !== 137) {
    console.error("❌ Wrong network! Expected Polygon mainnet (137), got:", network.chainId);
    process.exit(1);
  }

  console.log(`📡 Network: Polygon Mainnet (Chain ID: ${network.chainId})`);
  console.log(`💼 Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  const balanceEther = ethers.formatEther(balance);
  console.log(`💰 Balance: ${balanceEther} POL\n`);

  if (parseFloat(balanceEther) < 10) {
    console.error("❌ Insufficient POL! Need at least 10 POL for full suite deployment.");
    console.error("   Current balance:", balanceEther, "POL");
    process.exit(1);
  }

  // Validate required env variables for mainnet
  const requiredEnvVars = [
    "CARBON_REWARDS_WALLET",
    "COMMUNITY_WALLET",
    "DEVELOPMENT_WALLET",
    "MARKETING_WALLET",
    "LIQUIDITY_WALLET",
    "TEAM_WALLET",
    "ADVISORS_WALLET",
    "RESERVE_WALLET",
  ];

  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach((v) => console.error(`   - ${v}`));
    console.error("\n   Set these in your .env file before mainnet deployment.");
    process.exit(1);
  }

  const wallets = {
    carbonRewards: process.env.CARBON_REWARDS_WALLET,
    community:     process.env.COMMUNITY_WALLET,
    development:   process.env.DEVELOPMENT_WALLET,
    marketing:     process.env.MARKETING_WALLET,
    liquidity:     process.env.LIQUIDITY_WALLET,
    team:          process.env.TEAM_WALLET,
    advisors:      process.env.ADVISORS_WALLET,
    reserve:       process.env.RESERVE_WALLET,
  };

  // Treasury = deployer by default; update after deployment via setTreasury()
  const treasury = process.env.TREASURY_WALLET || deployer.address;

  console.log("📬 Distribution wallets:");
  Object.entries(wallets).forEach(([k, v]) => console.log(`   ${k}: ${v}`));
  console.log(`   treasury: ${treasury}`);
  console.log();

  const ok = await confirm("Type 'yes' to confirm mainnet deployment: ");
  if (!ok) {
    console.log("❌ Deployment cancelled.");
    process.exit(0);
  }

  const deployed = {};
  const CONFIRMS = 5; // mainnet confirmations

  // ── Phase 1: ECCToken ───────────────────────────────────────────────────
  console.log("\n📦 [1] Deploying ECCToken (ERC-20 + carbon minting + fee distribution)...");
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
  await eccToken.deploymentTransaction().wait(CONFIRMS);
  deployed.ECCToken = await eccToken.getAddress();
  console.log(`   ✅ ECCToken: ${deployed.ECCToken}`);

  // ── Phase 1: ECCStaking ─────────────────────────────────────────────────
  console.log("📦 [2] Deploying ECCStaking (tiered APY staking vault)...");
  const ECCStaking = await ethers.getContractFactory("ECCStaking");
  const eccStaking = await ECCStaking.deploy(deployed.ECCToken, deployer.address);
  await eccStaking.deploymentTransaction().wait(CONFIRMS);
  deployed.ECCStaking = await eccStaking.getAddress();
  console.log(`   ✅ ECCStaking: ${deployed.ECCStaking}`);

  // ── Phase 1: ECCFarming ─────────────────────────────────────────────────
  console.log("📦 [3] Deploying ECCFarming (MasterChef LP farming)...");
  const ECCFarming = await ethers.getContractFactory("ECCFarming");
  const eccFarming = await ECCFarming.deploy(deployed.ECCToken, deployer.address);
  await eccFarming.deploymentTransaction().wait(CONFIRMS);
  deployed.ECCFarming = await eccFarming.getAddress();
  console.log(`   ✅ ECCFarming: ${deployed.ECCFarming}`);

  // ── Phase 1: Wire Token → Staking/Farming ──────────────────────────────
  console.log("🔗 initializeContracts() — 10M ECC → Staking, 3M ECC → Farming...");
  await (await eccToken.initializeContracts(deployed.ECCStaking, deployed.ECCFarming)).wait(CONFIRMS);
  await (await eccStaking.syncPoolBalance()).wait(CONFIRMS);
  await (await eccFarming.syncPoolBalance()).wait(CONFIRMS);
  console.log("   ✅ Reserves transferred and synced");

  // ── NFTs ────────────────────────────────────────────────────────────────
  console.log("📦 [4] Deploying CarbonCreditNFT...");
  const CarbonNFT = await ethers.getContractFactory("CarbonCreditNFT");
  const carbonNFT = await CarbonNFT.deploy("https://api.ecocoin.io/carbon-credits/");
  await carbonNFT.deploymentTransaction().wait(CONFIRMS);
  deployed.CarbonCreditNFT = await carbonNFT.getAddress();
  console.log(`   ✅ CarbonCreditNFT: ${deployed.CarbonCreditNFT}`);

  console.log("📦 [5] Deploying CertificateNFT...");
  const CertNFT = await ethers.getContractFactory("CertificateNFT");
  const certNFT = await CertNFT.deploy(
    "EcoCoin Certificate", "ECERT",
    "https://api.ecocoin.io/certificates/", true
  );
  await certNFT.deploymentTransaction().wait(CONFIRMS);
  deployed.CertificateNFT = await certNFT.getAddress();
  console.log(`   ✅ CertificateNFT: ${deployed.CertificateNFT}`);

  console.log("📦 [6] Deploying RewardsDistributor...");
  const Rewards = await ethers.getContractFactory("RewardsDistributor");
  const rewards = await Rewards.deploy();
  await rewards.deploymentTransaction().wait(CONFIRMS);
  deployed.RewardsDistributor = await rewards.getAddress();
  console.log(`   ✅ RewardsDistributor: ${deployed.RewardsDistributor}`);

  // ── DAO ─────────────────────────────────────────────────────────────────
  console.log("📦 [7] Deploying TimelockController (2-day delay)...");
  const Timelock = await ethers.getContractFactory("TimelockController");
  const timelock = await Timelock.deploy(2 * 24 * 60 * 60, [], [], deployer.address);
  await timelock.deploymentTransaction().wait(CONFIRMS);
  deployed.TimelockController = await timelock.getAddress();
  console.log(`   ✅ TimelockController: ${deployed.TimelockController}`);

  console.log("📦 [8] Deploying ECCGovernance (DAO voting)...");
  const Governance = await ethers.getContractFactory("ECCGovernance");
  const governance = await Governance.deploy(deployed.ECCToken, deployed.TimelockController);
  await governance.deploymentTransaction().wait(CONFIRMS);
  deployed.ECCGovernance = await governance.getAddress();
  console.log(`   ✅ ECCGovernance: ${deployed.ECCGovernance}`);

  // ── Phase 1: ECCVesting ─────────────────────────────────────────────────
  console.log("📦 [9] Deploying ECCVesting...");
  const Vesting = await ethers.getContractFactory("ECCVesting");
  const vesting = await Vesting.deploy(deployed.ECCToken);
  await vesting.deploymentTransaction().wait(CONFIRMS);
  deployed.ECCVesting = await vesting.getAddress();
  console.log(`   ✅ ECCVesting: ${deployed.ECCVesting}`);

  // ── Phase 1: ECCMultiSig ────────────────────────────────────────────────
  console.log("📦 [10] Deploying ECCMultiSig (2-of-3)...");
  const MultiSig = await ethers.getContractFactory("ECCMultiSig");
  const multisig = await MultiSig.deploy(
    [deployer.address, wallets.community, wallets.development], 2
  );
  await multisig.deploymentTransaction().wait(CONFIRMS);
  deployed.ECCMultiSig = await multisig.getAddress();
  console.log(`   ✅ ECCMultiSig: ${deployed.ECCMultiSig}`);

  // ── Phase 2: ECCLaunchpad ───────────────────────────────────────────────
  console.log("📦 [11] Deploying ECCLaunchpad (IDO platform)...");
  const Launchpad = await ethers.getContractFactory("ECCLaunchpad");
  const launchpad = await Launchpad.deploy();
  await launchpad.deploymentTransaction().wait(CONFIRMS);
  deployed.ECCLaunchpad = await launchpad.getAddress();
  console.log(`   ✅ ECCLaunchpad: ${deployed.ECCLaunchpad}`);

  // ── Phase 2: ECCAutoCompounder ──────────────────────────────────────────
  console.log("📦 [12] Deploying ECCAutoCompounder...");
  const AutoCompounder = await ethers.getContractFactory("ECCAutoCompounder");
  const autoCompounder = await AutoCompounder.deploy(
    deployed.ECCToken, deployed.ECCStaking, treasury
  );
  await autoCompounder.deploymentTransaction().wait(CONFIRMS);
  deployed.ECCAutoCompounder = await autoCompounder.getAddress();
  console.log(`   ✅ ECCAutoCompounder: ${deployed.ECCAutoCompounder}`);

  // ── Phase 3: ECCLottery ─────────────────────────────────────────────────
  console.log("📦 [13] Deploying ECCLottery...");
  const Lottery = await ethers.getContractFactory("ECCLottery");
  const lottery = await Lottery.deploy(deployed.ECCToken, treasury);
  await lottery.deploymentTransaction().wait(CONFIRMS);
  deployed.ECCLottery = await lottery.getAddress();
  console.log(`   ✅ ECCLottery: ${deployed.ECCLottery}`);

  // ── Phase 3: ECCSwap ────────────────────────────────────────────────────
  console.log("📦 [14] Deploying ECCSwap (AMM DEX)...");
  const Swap = await ethers.getContractFactory("ECCSwap");
  const swap = await Swap.deploy(treasury);
  await swap.deploymentTransaction().wait(CONFIRMS);
  deployed.ECCSwap = await swap.getAddress();
  console.log(`   ✅ ECCSwap: ${deployed.ECCSwap}`);

  // ── Phase 3: ECCBridge ──────────────────────────────────────────────────
  console.log("📦 [15] Deploying ECCBridge (cross-chain bridge)...");
  const Bridge = await ethers.getContractFactory("ECCBridge");
  const bridge = await Bridge.deploy(deployed.ECCToken, treasury);
  await bridge.deploymentTransaction().wait(CONFIRMS);
  deployed.ECCBridge = await bridge.getAddress();
  console.log(`   ✅ ECCBridge: ${deployed.ECCBridge}`);

  // ── Wiring ──────────────────────────────────────────────────────────────
  console.log("\n🔗 Wiring all contracts...");

  // NFT roles
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  await (await carbonNFT.grantRole(MINTER_ROLE, deployed.ECCToken)).wait(CONFIRMS);
  await (await certNFT.grantRole(MINTER_ROLE, deployed.ECCToken)).wait(CONFIRMS);
  await (await certNFT.grantRole(MINTER_ROLE, deployed.CarbonCreditNFT)).wait(CONFIRMS);
  await (await eccToken.setNFTContracts(deployed.CarbonCreditNFT, deployed.CertificateNFT)).wait(CONFIRMS);
  await (await carbonNFT.setCertificateNFT(deployed.CertificateNFT)).wait(CONFIRMS);
  console.log("   ✅ NFT MINTER_ROLE wired");

  // DAO roles
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
  await (await timelock.grantRole(PROPOSER_ROLE, deployed.ECCGovernance)).wait(CONFIRMS);
  await (await timelock.grantRole(EXECUTOR_ROLE, ethers.ZeroAddress)).wait(CONFIRMS);
  console.log("   ✅ DAO governance wired");

  // AutoCompounder keeper role
  const KEEPER_ROLE     = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
  const COMPOUNDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("COMPOUNDER_ROLE"));
  await (await autoCompounder.grantRole(KEEPER_ROLE, deployer.address)).wait(CONFIRMS);
  console.log("   ✅ AutoCompounder KEEPER_ROLE granted");

  // ECCStaking: grant COMPOUNDER_ROLE to ECCAutoCompounder
  const eccStakingObj = await ethers.getContractAt("ECCStaking", deployed.ECCStaking);
  await (await eccStakingObj.grantRole(COMPOUNDER_ROLE, deployed.ECCAutoCompounder)).wait(CONFIRMS);
  console.log("   ✅ ECCStaking: COMPOUNDER_ROLE granted to ECCAutoCompounder");

  // Bridge: configure destination chains
  const eccTokenObj = await ethers.getContractAt("ECCToken", deployed.ECCToken);
  const bridgeObj   = await ethers.getContractAt("ECCBridge", deployed.ECCBridge);

  await (await bridgeObj.setChainConfig(56, true, ethers.parseEther("1"), ethers.parseEther("100000"), ethers.parseEther("500000"), 30)).wait(CONFIRMS);
  await (await bridgeObj.setChainConfig(1,  true, ethers.parseEther("1"), ethers.parseEther("100000"), ethers.parseEther("500000"), 50)).wait(CONFIRMS);
  await (await bridgeObj.setChainConfig(97, true, ethers.parseEther("1"), ethers.parseEther("100000"), ethers.parseEther("500000"), 30)).wait(CONFIRMS);
  console.log("   ✅ ECCBridge: BSC (56), Ethereum (1), BSC testnet (97) configured");

  // Fee exemptions for DeFi contracts (no double-taxation)
  await (await eccTokenObj.setFeeExempt(deployed.ECCLottery,       true)).wait(CONFIRMS);
  await (await eccTokenObj.setFeeExempt(deployed.ECCBridge,        true)).wait(CONFIRMS);
  await (await eccTokenObj.setFeeExempt(deployed.ECCSwap,          true)).wait(CONFIRMS);
  await (await eccTokenObj.setFeeExempt(deployed.ECCStaking,       true)).wait(CONFIRMS);
  await (await eccTokenObj.setFeeExempt(deployed.ECCFarming,       true)).wait(CONFIRMS);
  await (await eccTokenObj.setFeeExempt(deployed.ECCAutoCompounder,true)).wait(CONFIRMS);
  console.log("   ✅ Fee exemptions applied to all DeFi contracts");

  // Transfer DEFAULT_ADMIN_ROLE to ECCMultiSig (deployer should not hold it long-term)
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  await (await eccTokenObj.grantRole(DEFAULT_ADMIN_ROLE, deployed.ECCMultiSig)).wait(CONFIRMS);
  console.log("   ✅ ECCToken: DEFAULT_ADMIN_ROLE granted to ECCMultiSig");
  console.log("   ⚠️  Deployer still holds DEFAULT_ADMIN_ROLE — renounce manually after verifying multisig");

  // Chainlink POL/USD price feed on Polygon mainnet
  const POL_USD_FEED = "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0"; // official Polygon feed
  await (await eccTokenObj.setPriceFeed(POL_USD_FEED, true)).wait(CONFIRMS);
  console.log("   ✅ Chainlink POL/USD price feed enabled");

  // Set paymentRecipient to Development wallet — all POL from mintRetailOffset() withdrawals go here
  const paymentRecipient = process.env.DEVELOPMENT_WALLET;
  if (!paymentRecipient) {
    console.warn("   ⚠️  DEVELOPMENT_WALLET not set — paymentRecipient remains deployer");
  } else {
    await (await eccTokenObj.setPaymentRecipient(paymentRecipient)).wait(CONFIRMS);
    console.log(`   ✅ paymentRecipient set to Development wallet: ${paymentRecipient}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log("✅ DEPLOYMENT COMPLETE — POLYGON MAINNET (Phase 1 + 2 + 3)");
  console.log("=".repeat(80) + "\n");

  console.log("📋 Contract Addresses:");
  Object.entries(deployed).forEach(([name, addr]) => {
    console.log(`   ${name.padEnd(22)}: ${addr}`);
  });

  console.log("\n🔗 PolygonScan Links:");
  Object.entries(deployed).forEach(([name, addr]) => {
    console.log(`   ${name.padEnd(22)}: https://polygonscan.com/address/${addr}`);
  });

  console.log("\n🔍 Verify commands:");
  console.log(`   npx hardhat verify --network polygon ${deployed.ECCToken} ${wallets.carbonRewards} ${wallets.community} ${wallets.development} ${wallets.marketing} ${wallets.liquidity} ${wallets.team} ${wallets.advisors} ${wallets.reserve}`);
  console.log(`   npx hardhat verify --network polygon ${deployed.ECCStaking} ${deployed.ECCToken} ${deployer.address}`);
  console.log(`   npx hardhat verify --network polygon ${deployed.ECCFarming} ${deployed.ECCToken} ${deployer.address}`);
  console.log(`   npx hardhat verify --network polygon ${deployed.ECCVesting} ${deployed.ECCToken}`);
  console.log(`   npx hardhat verify --network polygon ${deployed.ECCLaunchpad}`);
  console.log(`   npx hardhat verify --network polygon ${deployed.ECCAutoCompounder} ${deployed.ECCToken} ${deployed.ECCStaking} ${treasury}`);
  console.log(`   npx hardhat verify --network polygon ${deployed.ECCLottery} ${deployed.ECCToken} ${treasury}`);
  console.log(`   npx hardhat verify --network polygon ${deployed.ECCSwap} ${treasury}`);
  console.log(`   npx hardhat verify --network polygon ${deployed.ECCBridge} ${deployed.ECCToken} ${treasury}`);

  const deploymentData = {
    network: "polygonMainnet",
    chainId: 137,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    treasury,
    contracts: deployed,
    wallets,
    polygonscanLinks: Object.fromEntries(
      Object.entries(deployed).map(([k, v]) => [k, `https://polygonscan.com/address/${v}`])
    ),
  };

  if (!fs.existsSync("deployments")) fs.mkdirSync("deployments");
  const filename = `deployments/polygon-mainnet-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentData, null, 2));
  console.log(`\n💾 Saved to ${filename}`);

  console.log("\n⚠️  POST-DEPLOYMENT CHECKLIST:");
  console.log("   1. Verify all contracts on PolygonScan (commands above)");
  console.log("   2. Call setTreasury() on ECCBridge, ECCLottery, ECCSwap if treasury address changes");
  console.log("   3. Update ECCMultiSig owners from deployer to real signers via multisig");
  console.log("   4. Transfer DEFAULT_ADMIN_ROLE to ECCMultiSig after verifying setup");
  console.log("   5. Create first LP pool: ECCSwap.createPool(ECCToken, WMATIC)");
  console.log("   6. Set up relayer for ECCBridge: grantRole(RELAYER_ROLE, relayerAddress)");
  console.log("   7. POL revenue from purchases goes to Development wallet — withdraw via withdrawPayments()");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
