// ==============================================================================
// EcoCoin V — Polygon Airdrop Script
// Uses direct ERC-20 transfer (no merkle needed for straightforward airdrops)
// For merkle-based claims, use RewardsDistributor contract instead.
//
// Usage:
//   1. Set ECC_TOKEN_ADDRESS in .env
//   2. Edit AIRDROP_LIST below (or load from airdrop-list.json)
//   3. npm run airdrop:amoy   (testnet)
//   4. npm run airdrop:mainnet (mainnet — after testing)
// ==============================================================================
const { ethers } = require("hardhat");
const fs = require("fs");

// ── Airdrop list ──────────────────────────────────────────────────────────────
// Format: { address: "0x...", amount: "1000" }  (amount in ECC tokens, NOT wei)
// Load from file if it exists, otherwise use the inline list below.

function loadAirdropList() {
  if (fs.existsSync("airdrop-list.json")) {
    console.log("📂 Loading airdrop list from airdrop-list.json...");
    return JSON.parse(fs.readFileSync("airdrop-list.json", "utf8"));
  }

  // Inline list — replace with real addresses before running
  return [
    // { address: "0xRecipient1", amount: "500" },
    // { address: "0xRecipient2", amount: "250" },
    // { address: "0xRecipient3", amount: "100" },
  ];
}

// Minimal ERC-20 ABI for transfer
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🌿 EcoCoin V — Polygon Airdrop");
  console.log("=".repeat(80) + "\n");

  const [sender] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const isMainnet = Number(network.chainId) === 137;

  console.log(`📡 Network: ${isMainnet ? "Polygon MAINNET" : "Polygon Amoy Testnet"} (Chain ID: ${network.chainId})`);
  console.log(`💼 Sender: ${sender.address}\n`);

  // ── Token contract ──────────────────────────────────────────────────────
  const tokenAddress = process.env.ECC_TOKEN_ADDRESS;
  if (!tokenAddress || tokenAddress === "0xDeployedEccTokenAddressHere") {
    console.error("❌ Set ECC_TOKEN_ADDRESS in your .env file first.");
    console.error("   Run deploy script first, then copy the EcoCoinV7Secured address.");
    process.exit(1);
  }

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, sender);
  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const senderBalance = await token.balanceOf(sender.address);
  const senderBalanceFormatted = ethers.formatUnits(senderBalance, decimals);

  console.log(`🪙 Token: ${symbol} at ${tokenAddress}`);
  console.log(`💰 Sender balance: ${Number(senderBalanceFormatted).toLocaleString()} ${symbol}\n`);

  // ── Load list ───────────────────────────────────────────────────────────
  const airdropList = loadAirdropList();

  if (airdropList.length === 0) {
    console.error("❌ Airdrop list is empty!");
    console.error("   Either edit the inline list in airdrop.js,");
    console.error("   or create airdrop-list.json with [{address, amount}, ...]");
    process.exit(1);
  }

  // ── Validate list ───────────────────────────────────────────────────────
  console.log(`📋 Validating ${airdropList.length} recipients...`);
  let totalAmount = BigInt(0);
  const validated = [];

  for (const entry of airdropList) {
    if (!ethers.isAddress(entry.address)) {
      console.warn(`   ⚠️  Invalid address skipped: ${entry.address}`);
      continue;
    }
    if (!entry.amount || parseFloat(entry.amount) <= 0) {
      console.warn(`   ⚠️  Invalid amount skipped for: ${entry.address}`);
      continue;
    }
    const amountWei = ethers.parseUnits(entry.amount.toString(), decimals);
    totalAmount += amountWei;
    validated.push({ address: entry.address, amountWei, amountDisplay: entry.amount });
  }

  console.log(`   ✅ ${validated.length} valid recipients`);
  console.log(`   📦 Total to airdrop: ${ethers.formatUnits(totalAmount, decimals)} ${symbol}\n`);

  if (senderBalance < totalAmount) {
    console.error(`❌ Insufficient balance!`);
    console.error(`   Have: ${senderBalanceFormatted} ${symbol}`);
    console.error(`   Need: ${ethers.formatUnits(totalAmount, decimals)} ${symbol}`);
    process.exit(1);
  }

  if (isMainnet) {
    console.log("⚠️  MAINNET AIRDROP — This will send REAL tokens!");
    console.log("   Starting in 5 seconds... Press Ctrl+C to cancel.\n");
    await new Promise((r) => setTimeout(r, 5000));
  }

  // ── Execute airdrop ─────────────────────────────────────────────────────
  console.log("🚀 Starting airdrop...\n");

  const results = { success: [], failed: [] };
  const BATCH_DELAY_MS = 1000; // 1 second between txs to avoid nonce issues

  for (let i = 0; i < validated.length; i++) {
    const { address, amountWei, amountDisplay } = validated[i];
    process.stdout.write(`   [${i + 1}/${validated.length}] ${address} ← ${amountDisplay} ${symbol} ... `);

    try {
      const tx = await token.transfer(address, amountWei);
      const receipt = await tx.wait(1);
      console.log(`✅ tx: ${receipt.hash}`);
      results.success.push({ address, amount: amountDisplay, txHash: receipt.hash });
    } catch (err) {
      console.log(`❌ FAILED: ${err.message}`);
      results.failed.push({ address, amount: amountDisplay, error: err.message });
    }

    if (i < validated.length - 1) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log(`✅ Airdrop complete: ${results.success.length} sent, ${results.failed.length} failed`);
  console.log("=".repeat(80));

  const finalBalance = await token.balanceOf(sender.address);
  console.log(`\n💰 Remaining balance: ${ethers.formatUnits(finalBalance, decimals)} ${symbol}`);

  const reportFile = `deployments/airdrop-report-${Date.now()}.json`;
  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      {
        network: isMainnet ? "polygonMainnet" : "polygonAmoy",
        chainId: Number(network.chainId),
        timestamp: new Date().toISOString(),
        tokenAddress,
        sender: sender.address,
        totalRecipients: validated.length,
        successCount: results.success.length,
        failedCount: results.failed.length,
        results,
      },
      null,
      2
    )
  );
  console.log(`\n💾 Report saved to ${reportFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Airdrop failed:", error);
    process.exit(1);
  });
