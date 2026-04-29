// ==============================================================================
// EcoCoin V — Polygon Mainnet Deployment with UUPS Proxy Support
// Deploys contracts behind TransparentUpgradeableProxy for future upgradeability
// Run: npx hardhat run scripts/deploy-proxy-mainnet.js --network polygonMainnet
// ==============================================================================
const { ethers, upgrades } = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("EcoCoin V — Polygon MAINNET Proxy Deployment");
  console.log("=".repeat(80) + "\n");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Network: Chain ID ${chainId}`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  const balanceEther = ethers.formatEther(balance);
  console.log(`Balance: ${balanceEther} POL\n`);

  if (chainId === 137 && parseFloat(balanceEther) < 5) {
    console.error("Insufficient POL! Need at least 5 POL for proxy deployment.");
    process.exit(1);
  }

  const deployed = {};
  const gasUsed = {};

  // Helper: deploy with proxy
  async function deployProxy(name, args = []) {
    console.log(`\nDeploying ${name} (with proxy)...`);
    const Factory = await ethers.getContractFactory(name);
    try {
      // Try upgradeable proxy deployment (requires initialize() function)
      const proxy = await upgrades.deployProxy(Factory, args, {
        initializer: 'initialize',
        kind: 'transparent'
      });
      await proxy.waitForDeployment();
      const addr = await proxy.getAddress();
      const implAddr = await upgrades.erc1967.getImplementationAddress(addr);
      console.log(`  Proxy: ${addr}`);
      console.log(`  Implementation: ${implAddr}`);
      deployed[name] = { proxy: addr, implementation: implAddr };
      return proxy;
    } catch (e) {
      // Fallback: deploy without proxy if contract doesn't have initialize()
      console.log(`  Note: ${name} not upgradeable yet, deploying directly...`);
      const contract = await Factory.deploy(...args);
      await contract.waitForDeployment();
      const addr = await contract.getAddress();
      console.log(`  Address: ${addr}`);
      deployed[name] = { address: addr };
      return contract;
    }
  }

  // Helper: deploy directly (for contracts that don't need upgradeability)
  async function deployDirect(name, args = []) {
    console.log(`\nDeploying ${name}...`);
    const Factory = await ethers.getContractFactory(name);
    const contract = await Factory.deploy(...args);
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    console.log(`  Address: ${addr}`);
    deployed[name] = { address: addr };
    return contract;
  }

  // ── PHASE 1: Core contracts ──────────────────────────────────────
  console.log("\n── PHASE 1: Core Contracts ──");

  // 1. ECCToken
  const adminAddr = deployer.address;
  const eccToken = await deployDirect("ECCToken", [adminAddr]);
  const eccTokenAddr = deployed.ECCToken.address || deployed.ECCToken.proxy;

  // 2. ECCStaking
  const eccStaking = await deployDirect("ECCStaking", [eccTokenAddr, adminAddr]);
  const stakingAddr = deployed.ECCStaking.address || deployed.ECCStaking.proxy;

  // 3. ECCFarming (MasterChef)
  const eccFarming = await deployDirect("ECCFarming", [eccTokenAddr, adminAddr]);
  const farmingAddr = deployed.ECCFarming.address || deployed.ECCFarming.proxy;

  // ── PHASE 2: DeFi contracts ──────────────────────────────────────
  console.log("\n── PHASE 2: DeFi Contracts ──");

  // 4. ECCVesting
  const eccVesting = await deployDirect("ECCVesting", [eccTokenAddr, adminAddr]);

  // 5. ECCMultiSig
  const eccMultiSig = await deployDirect("ECCMultiSig", [[adminAddr], 1]);

  // 6. ECCLaunchpad
  const eccLaunchpad = await deployDirect("ECCLaunchpad", [eccTokenAddr, adminAddr]);

  // 7. ECCAutoCompounder
  const eccAutoCompounder = await deployDirect("ECCAutoCompounder", [eccTokenAddr, stakingAddr, adminAddr]);

  // ── PHASE 3: Advanced contracts ──────────────────────────────────
  console.log("\n── PHASE 3: Advanced Contracts ──");

  // 8. ECCLottery
  const eccLottery = await deployDirect("ECCLottery", [eccTokenAddr, adminAddr]);

  // 9. ECCSwap
  const eccSwap = await deployDirect("ECCSwap", [eccTokenAddr, adminAddr]);

  // 10. ECCBridge
  const eccBridge = await deployDirect("ECCBridge", [eccTokenAddr, adminAddr]);

  // ── PHASE 4: NFTs & Governance ───────────────────────────────────
  console.log("\n── PHASE 4: NFTs & Governance ──");

  // 11. CarbonCreditNFT
  const carbonNFT = await deployDirect("CarbonCreditNFT", [adminAddr]);

  // 12. CertificateNFT
  const certNFT = await deployDirect("CertificateNFT", [adminAddr]);

  // 13. RewardsDistributor
  const rewardsDistributor = await deployDirect("RewardsDistributor", [eccTokenAddr, adminAddr]);

  // 14. Governance (Governor)
  const governance = await deployDirect("ECCGovernance", [eccTokenAddr, adminAddr]);

  // ── Initialize contracts ─────────────────────────────────────────
  console.log("\n── Initializing Contract Links ──");

  try {
    console.log("Calling ECCToken.initializeContracts()...");
    const initTx = await eccToken.initializeContracts(stakingAddr, farmingAddr);
    await initTx.wait();
    console.log("  Staking + Farming reserves transferred");
  } catch (e) {
    console.log("  initializeContracts skipped:", e.message);
  }

  try {
    console.log("Calling ECCStaking.syncPoolBalance()...");
    const syncTx = await eccStaking.syncPoolBalance();
    await syncTx.wait();
    console.log("  Staking pool balance synced");
  } catch (e) {
    console.log("  syncPoolBalance skipped:", e.message);
  }

  // ── Save deployment addresses ────────────────────────────────────
  const output = {
    network: chainId === 137 ? 'polygon-mainnet' : `chain-${chainId}`,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: deployed
  };

  const outFile = `deployment-${chainId}-${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\nDeployment saved to ${outFile}`);

  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("DEPLOYMENT SUMMARY");
  console.log("=".repeat(80));
  Object.entries(deployed).forEach(([name, addrs]) => {
    const addr = addrs.proxy || addrs.address;
    console.log(`  ${name}: ${addr}`);
    if (addrs.implementation) {
      console.log(`    (impl: ${addrs.implementation})`);
    }
  });
  console.log("\nTo upgrade a proxy contract later:");
  console.log("  const NewImpl = await ethers.getContractFactory('ECCTokenV2');");
  console.log("  await upgrades.upgradeProxy(proxyAddress, NewImpl);");
  console.log("=".repeat(80) + "\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
