// Test deploy — ECCToken only
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Network: ${network.chainId}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} POL\n`);

  console.log("Deploying ECCToken...");
  const ECCToken = await ethers.getContractFactory("ECCToken");
  const eccToken = await ECCToken.deploy(
    deployer.address, deployer.address, deployer.address, deployer.address,
    deployer.address, deployer.address, deployer.address, deployer.address
  );
  await eccToken.deploymentTransaction().wait(2);
  const address = await eccToken.getAddress();
  console.log(`✅ ECCToken deployed: ${address}`);

  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  console.log(`\nBalance after: ${ethers.formatEther(balanceAfter)} POL`);
  console.log(`Gas used: ${ethers.formatEther(balance - balanceAfter)} POL`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
