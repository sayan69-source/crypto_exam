/**
 * Lock the demo exam on-chain, so the private side has something real to read.
 *
 * The centre terminal's whole trust story is "the root came from the chain, not
 * from the server that handed me the paper". That is unverifiable — and
 * untestable — while no exam has ever been locked. This writes the same
 * commitment the public backend's delivery pipeline writes
 * (`lockExam(keccak(examId), questionsRoot, drandRound, bundleCid)`), using the
 * seeded demo exam id the Edge and the portals already use.
 *
 *   npx hardhat run deploy/02_lock_demo_exam.ts --network localhost
 *
 * Re-running is a no-op: lockExam rejects a second lock for the same exam,
 * which is the immutability guarantee, so this reports and exits cleanly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ethers, network } from "hardhat";

// The seeded demo exam (edge-server/src/seed-demo.ts → DEMO.examId).
const EXAM_ID = process.env.DEMO_EXAM_ID ?? "44444444-4444-4444-4444-444444444444";
const DRAND_ROUND = Number(process.env.DEMO_DRAND_ROUND ?? 4_620_000);
const BUNDLE_CID = process.env.DEMO_BUNDLE_CID ?? "ipfs://bafyDemoSealedBundleCid";

async function main() {
  const deployment = JSON.parse(
    readFileSync(join(__dirname, "..", "deployments", `${network.name}.json`), "utf8"),
  ) as { address: string };

  const core = await ethers.getContractAt("CryptoExamCore", deployment.address);
  const chainKey = ethers.keccak256(ethers.toUtf8Bytes(EXAM_ID));

  // The questions root the Edge serves with the bundle. In a real run this is
  // produced by the sealing pipeline; here it is fixed so the private side can
  // assert an exact match rather than "some root".
  const questionsRoot =
    process.env.DEMO_QUESTIONS_ROOT ??
    ethers.keccak256(ethers.toUtf8Bytes(`zuup-demo-questions-root:${EXAM_ID}`));

  const existing = await core.exams(chainKey);
  if (existing.questionHash !== ethers.ZeroHash) {
    console.log(`Exam ${EXAM_ID} is already locked on ${network.name}.`);
    console.log(`  chainKey      ${chainKey}`);
    console.log(`  questionsRoot ${existing.questionHash}`);
    return;
  }

  console.log(`Locking exam ${EXAM_ID} on ${network.name}…`);
  const tx = await core.lockExam(chainKey, questionsRoot, DRAND_ROUND, BUNDLE_CID);
  const receipt = await tx.wait();
  console.log(`  ✓ lockExam tx ${tx.hash} (block ${receipt?.blockNumber})`);

  // The private side needs the chain COORDINATES, not just the root: the
  // terminal deliberately does not compute keccak, so the key travels with the
  // exam as provisioning data.
  const record = {
    network: network.name,
    contract: deployment.address,
    examId: EXAM_ID,
    chainKey,
    questionsRoot,
    bundleCid: BUNDLE_CID,
    drandRound: DRAND_ROUND,
    lockTx: tx.hash,
  };
  const out = join(__dirname, "..", "deployments", `${network.name}.exam.json`);
  writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
  console.log(`  ✓ recorded → deployments/${network.name}.exam.json`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("Lock failed:", e);
  process.exit(1);
});
