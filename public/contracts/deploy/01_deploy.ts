/**
 * CryptoExam Core — Deployment Script
 * Deploys CryptoExamCore.sol to Polygon Amoy testnet.
 *
 * Usage: npx hardhat run deploy/01_deploy.ts --network amoy
 */

import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("═══════════════════════════════════════════════");
  console.log("CryptoExam Core — Deploying to Polygon Amoy");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MATIC`);
  console.log("");

  // Deploy CryptoExamCore with deployer as initial ZK verifier
  // (ZKVerifier address will be updated after separate deployment)
  console.log("[1/2] Deploying CryptoExamCore...");
  const CryptoExamCore = await ethers.getContractFactory("CryptoExamCore");
  const core = await CryptoExamCore.deploy(deployer.address);
  await core.waitForDeployment();
  const coreAddress = await core.getAddress();
  console.log(`  ✓ CryptoExamCore deployed at: ${coreAddress}`);

  // Grant SETTER_ROLE to deployer for demo
  console.log("[2/2] Configuring roles...");
  const SETTER_ROLE = await core.SETTER_ROLE();
  const NODE_ROLE = await core.NODE_ROLE();
  await core.grantRole(SETTER_ROLE, deployer.address);
  await core.grantRole(NODE_ROLE, deployer.address);
  console.log(`  ✓ SETTER_ROLE granted to deployer`);
  console.log(`  ✓ NODE_ROLE granted to deployer`);

  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("Deployment complete!");
  console.log(`  CryptoExamCore: ${coreAddress}`);
  console.log("");
  console.log("Verify on Polygonscan:");
  console.log(`  npx hardhat verify --network amoy ${coreAddress} ${deployer.address}`);
  console.log("═══════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
