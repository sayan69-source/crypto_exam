/**
 * CryptoExam Core — Deployment Script
 * Deploys CryptoExamCore.sol to Polygon Amoy testnet.
 *
 * Usage: npx hardhat run deploy/01_deploy.ts --network amoy
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ethers, network } from "hardhat";

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      `No account configured for network "${network.name}". Set DEPLOYER_PRIVATE_KEY in public/.env ` +
      `to a funded 32-byte hex key (get test MATIC from https://faucet.polygon.technology).`,
    );
  }
  const [deployer] = signers;
  console.log("═══════════════════════════════════════════════");
  console.log(`CryptoExam Core — Deploying to ${network.name}`);
  console.log("═══════════════════════════════════════════════");
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MATIC`);
  console.log("");

  // The Groth16 verifier goes first: CryptoExamCore.submitZKProof CALLS it, so
  // a core deployed pointing at anything else (an EOA, address(0)) can never
  // record a verified proof. It is generated from the proving key by
  // `circuits/build.sh` — regenerate both together if the circuit changes.
  console.log("[1/3] Deploying Groth16Verifier (from circuits/difficulty_proof.circom)...");
  const Verifier = await ethers.getContractFactory("Groth16Verifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log(`  ✓ Groth16Verifier deployed at: ${verifierAddress}`);

  console.log("[2/3] Deploying CryptoExamCore...");
  const CryptoExamCore = await ethers.getContractFactory("CryptoExamCore");
  const core = await CryptoExamCore.deploy(verifierAddress);
  await core.waitForDeployment();
  const coreAddress = await core.getAddress();
  console.log(`  ✓ CryptoExamCore deployed at: ${coreAddress}`);

  // Grant SETTER_ROLE to deployer for demo
  console.log("[3/3] Configuring roles...");
  const SETTER_ROLE = await core.SETTER_ROLE();
  const NODE_ROLE = await core.NODE_ROLE();
  await core.grantRole(SETTER_ROLE, deployer.address);
  await core.grantRole(NODE_ROLE, deployer.address);
  console.log(`  ✓ SETTER_ROLE granted to deployer`);
  console.log(`  ✓ NODE_ROLE granted to deployer`);

  // Record the deployment. Without this file the address lives only in this
  // console output: the backend cannot find the contract, the terminal's chain
  // reader has nothing to point at, and the README's "verify on chain" claim
  // has no address behind it. Committed per network so a deployment is a fact
  // in the repo rather than something someone has to remember.
  const deployTx = core.deploymentTransaction();
  const record = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    address: coreAddress,
    zkVerifier: verifierAddress,
    deployer: deployer.address,
    deployTx: deployTx?.hash ?? null,
    blockNumber: deployTx ? (await deployTx.wait())?.blockNumber ?? null : null,
    deployedAt: new Date().toISOString(),
  };
  const dir = join(__dirname, "..", "deployments");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${network.name}.json`), JSON.stringify(record, null, 2) + "\n");
  console.log(`  ✓ recorded → deployments/${network.name}.json`);

  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("Deployment complete!");
  console.log(`  CryptoExamCore:   ${coreAddress}`);
  console.log(`  Groth16Verifier:  ${verifierAddress}`);
  console.log("");
  console.log("  Wire it up:");
  console.log(`    public/.env                 CRYPTOEXAM_CONTRACT_ADDRESS=${coreAddress}`);
  console.log(`    exam-terminal (.env.local)  NEXT_PUBLIC_CHAIN_CONTRACT=${coreAddress}`);
  console.log("");
  console.log("Verify on Polygonscan:");
  console.log(`  npx hardhat verify --network amoy ${verifierAddress}`);
  console.log(`  npx hardhat verify --network amoy ${coreAddress} ${verifierAddress}`);
  console.log("═══════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
