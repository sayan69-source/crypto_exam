/**
 * CryptoExam Core — Smart Contract Tests
 * § 12 — Full lifecycle test coverage for CryptoExamCore.sol
 *
 * Tests cover:
 *   1. Deployment and role configuration
 *   2. Exam locking with question hash + drand round
 *   3. ZK proof submission
 *   4. Answer Merkle root commitment (immutability)
 *   5. Hardware node delivery proofs
 *   6. Public verification (no auth)
 *   7. Emergency pause
 *   8. Access control (role-based rejections)
 *   9. Replay protection and edge cases
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("CryptoExamCore", function () {
  let core: Contract;
  let admin: Signer;
  let setter: Signer;
  let nodeOperator: Signer;
  let unauthorized: Signer;
  let adminAddr: string;
  let setterAddr: string;
  let nodeAddr: string;
  let unauthAddr: string;

  // Roles
  let ADMIN_ROLE: string;
  let SETTER_ROLE: string;
  let NODE_ROLE: string;

  // Test data
  const examId = ethers.keccak256(ethers.toUtf8Bytes("e1a2b3c4-5678-90ab-cdef-1234567890ab"));
  const questionHash = ethers.keccak256(ethers.toUtf8Bytes("NEET-2026-Paper-Set-A"));
  const drandRound = 12345678;
  const constraintSpecIPFS = "QmExampleConstraintSpecIPFSHash";
  const zkProofHash = ethers.keccak256(ethers.toUtf8Bytes("groth16-proof-neet-2026"));
  const zkProofIPFS = "QmExampleZKProofIPFSHash";
  const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("merkle-root-240000-candidates"));
  const candidateCount = 240000;

  beforeEach(async function () {
    [admin, setter, nodeOperator, unauthorized] = await ethers.getSigners();
    adminAddr = await admin.getAddress();
    setterAddr = await setter.getAddress();
    nodeAddr = await nodeOperator.getAddress();
    unauthAddr = await unauthorized.getAddress();

    // Deploy contract
    const CryptoExamCore = await ethers.getContractFactory("CryptoExamCore");
    core = await CryptoExamCore.deploy(adminAddr); // admin as ZK verifier placeholder
    await core.waitForDeployment();

    // Get role hashes
    ADMIN_ROLE = await core.ADMIN_ROLE();
    SETTER_ROLE = await core.SETTER_ROLE();
    NODE_ROLE = await core.NODE_ROLE();

    // Grant roles
    await core.grantRole(SETTER_ROLE, setterAddr);
    await core.grantRole(NODE_ROLE, nodeAddr);
  });

  // ═══════════════════════════════════════════════════════
  // § 1 — Deployment & Configuration
  // ═══════════════════════════════════════════════════════

  describe("Deployment", function () {
    it("Should deploy with correct initial state", async function () {
      expect(await core.getExamCount()).to.equal(0);
      expect(await core.zkVerifier()).to.equal(adminAddr);
    });

    it("Should grant DEFAULT_ADMIN_ROLE to deployer", async function () {
      const DEFAULT_ADMIN = await core.DEFAULT_ADMIN_ROLE();
      expect(await core.hasRole(DEFAULT_ADMIN, adminAddr)).to.be.true;
    });

    it("Should grant ADMIN_ROLE to deployer", async function () {
      expect(await core.hasRole(ADMIN_ROLE, adminAddr)).to.be.true;
    });

    it("Should have SETTER_ROLE configured", async function () {
      expect(await core.hasRole(SETTER_ROLE, setterAddr)).to.be.true;
    });

    it("Should have NODE_ROLE configured", async function () {
      expect(await core.hasRole(NODE_ROLE, nodeAddr)).to.be.true;
    });
  });

  // ═══════════════════════════════════════════════════════
  // § 2 — Exam Locking (Guarantee 1)
  // ═══════════════════════════════════════════════════════

  describe("lockExam", function () {
    it("Should lock an exam with correct parameters", async function () {
      const tx = await core.connect(setter).lockExam(
        examId, questionHash, drandRound, constraintSpecIPFS
      );

      await expect(tx)
        .to.emit(core, "ExamLocked")
        .withArgs(examId, questionHash, (arg: any) => true, drandRound, setterAddr);

      expect(await core.getExamCount()).to.equal(1);
    });

    it("Should store correct exam data on-chain", async function () {
      await core.connect(setter).lockExam(examId, questionHash, drandRound, constraintSpecIPFS);

      const result = await core.verifyExam(examId);
      expect(result.questionHash).to.equal(questionHash);
      expect(result.drandRound).to.equal(drandRound);
      expect(result.zkVerified).to.be.false;
      expect(result.answerCommitted).to.be.false;
    });

    it("Should reject locking the same exam twice", async function () {
      await core.connect(setter).lockExam(examId, questionHash, drandRound, constraintSpecIPFS);

      await expect(
        core.connect(setter).lockExam(examId, questionHash, drandRound, constraintSpecIPFS)
      ).to.be.revertedWithCustomError(core, "ExamAlreadyLocked");
    });

    it("Should reject zero examId", async function () {
      await expect(
        core.connect(setter).lockExam(ethers.ZeroHash, questionHash, drandRound, constraintSpecIPFS)
      ).to.be.revertedWithCustomError(core, "InvalidExamId");
    });

    it("Should reject unauthorized callers", async function () {
      await expect(
        core.connect(unauthorized).lockExam(examId, questionHash, drandRound, constraintSpecIPFS)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════
  // § 3 — ZK Proof Submission (Guarantee 4)
  // ═══════════════════════════════════════════════════════

  describe("submitZKProof", function () {
    beforeEach(async function () {
      await core.connect(setter).lockExam(examId, questionHash, drandRound, constraintSpecIPFS);
    });

    it("Should submit and verify ZK proof", async function () {
      const tx = await core.connect(setter).submitZKProof(examId, zkProofHash, zkProofIPFS);

      await expect(tx)
        .to.emit(core, "ZKProofSubmitted")
        .withArgs(examId, zkProofHash, zkProofIPFS, true);

      const result = await core.verifyExam(examId);
      expect(result.zkProofHash).to.equal(zkProofHash);
      expect(result.zkVerified).to.be.true;
    });

    it("Should reject ZK proof for unlocked exam", async function () {
      const otherExamId = ethers.keccak256(ethers.toUtf8Bytes("nonexistent-exam"));
      await expect(
        core.connect(setter).submitZKProof(otherExamId, zkProofHash, zkProofIPFS)
      ).to.be.revertedWithCustomError(core, "ExamNotLocked");
    });

    it("Should reject unauthorized ZK proof submission", async function () {
      await expect(
        core.connect(unauthorized).submitZKProof(examId, zkProofHash, zkProofIPFS)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════
  // § 4 — Answer Merkle Root Commitment (Guarantee 3)
  // ═══════════════════════════════════════════════════════

  describe("commitAnswerMerkleRoot", function () {
    beforeEach(async function () {
      await core.connect(setter).lockExam(examId, questionHash, drandRound, constraintSpecIPFS);
    });

    it("Should commit Merkle root with candidate count", async function () {
      const tx = await core.connect(admin).commitAnswerMerkleRoot(
        examId, merkleRoot, candidateCount
      );

      await expect(tx)
        .to.emit(core, "AnswerMerkleRootCommitted")
        .withArgs(examId, merkleRoot, candidateCount);

      const result = await core.verifyExam(examId);
      expect(result.answerMerkleRoot).to.equal(merkleRoot);
      expect(result.candidateCount).to.equal(candidateCount);
      expect(result.answerCommitted).to.be.true;
    });

    it("Should reject double commitment (immutability guarantee)", async function () {
      await core.connect(admin).commitAnswerMerkleRoot(examId, merkleRoot, candidateCount);

      const otherRoot = ethers.keccak256(ethers.toUtf8Bytes("tampered-root"));
      await expect(
        core.connect(admin).commitAnswerMerkleRoot(examId, otherRoot, candidateCount)
      ).to.be.revertedWithCustomError(core, "AnswerAlreadyCommitted");
    });

    it("Should reject commitment for unlocked exam", async function () {
      const otherExamId = ethers.keccak256(ethers.toUtf8Bytes("unlocked-exam"));
      await expect(
        core.connect(admin).commitAnswerMerkleRoot(otherExamId, merkleRoot, candidateCount)
      ).to.be.revertedWithCustomError(core, "ExamNotLocked");
    });

    it("Should reject unauthorized commitment", async function () {
      await expect(
        core.connect(setter).commitAnswerMerkleRoot(examId, merkleRoot, candidateCount)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════
  // § 5 — Hardware Node Delivery Proofs (Guarantee 5)
  // ═══════════════════════════════════════════════════════

  describe("submitDeliveryProof", function () {
    const nodeId = ethers.keccak256(ethers.toUtf8Bytes("NODE-MUM-042"));
    const tpmSig = ethers.toUtf8Bytes("TPM2.0-attestation-signature-placeholder");
    const gpsTimestamp = 1717747200; // 2024-06-07 12:00:00 UTC
    const latitude = 19076100; // Mumbai 19.0761°N × 1e6
    const longitude = 72877600; // Mumbai 72.8776°E × 1e6

    beforeEach(async function () {
      await core.connect(setter).lockExam(examId, questionHash, drandRound, constraintSpecIPFS);
    });

    it("Should submit delivery proof from hardware node", async function () {
      const tx = await core.connect(nodeOperator).submitDeliveryProof(
        examId, nodeId, tpmSig, gpsTimestamp, latitude, longitude
      );

      await expect(tx)
        .to.emit(core, "DeliveryProofSubmitted")
        .withArgs(examId, nodeId, gpsTimestamp);
    });

    it("Should store delivery proof data correctly", async function () {
      await core.connect(nodeOperator).submitDeliveryProof(
        examId, nodeId, tpmSig, gpsTimestamp, latitude, longitude
      );

      const result = await core.verifyDelivery(examId, nodeId);
      expect(result.gpsTimestamp).to.equal(gpsTimestamp);
      expect(result.latitude).to.equal(latitude);
      expect(result.longitude).to.equal(longitude);
      expect(result.verified).to.be.false; // Not admin-verified yet
    });

    it("Should allow admin to verify delivery proof", async function () {
      await core.connect(nodeOperator).submitDeliveryProof(
        examId, nodeId, tpmSig, gpsTimestamp, latitude, longitude
      );

      await core.connect(admin).verifyDeliveryProof(examId, nodeId);

      const result = await core.verifyDelivery(examId, nodeId);
      expect(result.verified).to.be.true;
    });

    it("Should reject unauthorized delivery proof", async function () {
      await expect(
        core.connect(unauthorized).submitDeliveryProof(
          examId, nodeId, tpmSig, gpsTimestamp, latitude, longitude
        )
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════
  // § 6 — Public Verification (No Auth Required)
  // ═══════════════════════════════════════════════════════

  describe("Public Verification", function () {
    beforeEach(async function () {
      await core.connect(setter).lockExam(examId, questionHash, drandRound, constraintSpecIPFS);
      await core.connect(setter).submitZKProof(examId, zkProofHash, zkProofIPFS);
      await core.connect(admin).commitAnswerMerkleRoot(examId, merkleRoot, candidateCount);
    });

    it("Should allow ANYONE to verify exam (no auth)", async function () {
      const result = await core.connect(unauthorized).verifyExam(examId);
      expect(result.questionHash).to.equal(questionHash);
      expect(result.zkProofHash).to.equal(zkProofHash);
      expect(result.answerMerkleRoot).to.equal(merkleRoot);
      expect(result.zkVerified).to.be.true;
      expect(result.answerCommitted).to.be.true;
      expect(result.candidateCount).to.equal(candidateCount);
    });

    it("Should return correct exam count", async function () {
      expect(await core.getExamCount()).to.equal(1);

      // Lock another exam
      const examId2 = ethers.keccak256(ethers.toUtf8Bytes("second-exam"));
      await core.connect(setter).lockExam(
        examId2, questionHash, drandRound, ""
      );
      expect(await core.getExamCount()).to.equal(2);
    });
  });

  // ═══════════════════════════════════════════════════════
  // § 7 — Emergency Pause
  // ═══════════════════════════════════════════════════════

  describe("Emergency Pause", function () {
    it("Should emit EmergencyPause event with reason", async function () {
      const tx = await core.connect(admin).emergencyPause(
        examId, "Paper leak detected in Bihar center cluster"
      );

      await expect(tx)
        .to.emit(core, "EmergencyPause")
        .withArgs(examId, adminAddr, "Paper leak detected in Bihar center cluster");
    });

    it("Should reject unauthorized emergency pause", async function () {
      await expect(
        core.connect(unauthorized).emergencyPause(examId, "Unauthorized attempt")
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════
  // § 8 — Admin Configuration
  // ═══════════════════════════════════════════════════════

  describe("Admin Configuration", function () {
    it("Should update ZK verifier address", async function () {
      const newVerifier = await setter.getAddress();
      await core.connect(admin).setZKVerifier(newVerifier);
      expect(await core.zkVerifier()).to.equal(newVerifier);
    });

    it("Should reject unauthorized ZK verifier update", async function () {
      await expect(
        core.connect(setter).setZKVerifier(unauthAddr)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════
  // § 9 — Full Lifecycle Integration Test
  // ═══════════════════════════════════════════════════════

  describe("Full Lifecycle", function () {
    it("Should complete the entire exam lifecycle on-chain", async function () {
      // Step 1: Lock exam
      await core.connect(setter).lockExam(examId, questionHash, drandRound, constraintSpecIPFS);
      let result = await core.verifyExam(examId);
      expect(result[8]).to.be.false; // answerCommitted

      // Step 2: Submit ZK proof
      await core.connect(setter).submitZKProof(examId, zkProofHash, zkProofIPFS);
      result = await core.verifyExam(examId);
      expect(result[7]).to.be.true; // zkVerified

      // Step 3: Submit delivery proofs from multiple nodes
      const nodes = ["NODE-DEL-001", "NODE-MUM-042", "NODE-CHN-017"];
      for (const serial of nodes) {
        const nid = ethers.keccak256(ethers.toUtf8Bytes(serial));
        const sig = ethers.toUtf8Bytes(`TPM-SIG-${serial}`);
        await core.connect(nodeOperator).submitDeliveryProof(
          examId, nid, sig, 1717747200, 28644800, 77216700
        );
      }

      // Step 4: Commit Merkle root
      await core.connect(admin).commitAnswerMerkleRoot(examId, merkleRoot, candidateCount);
      result = await core.verifyExam(examId);
      expect(result[8]).to.be.true; // answerCommitted

      // Step 5: Verify everything publicly
      const publicResult = await core.connect(unauthorized).verifyExam(examId);
      expect(publicResult.questionHash).to.equal(questionHash);
      expect(publicResult.zkProofHash).to.equal(zkProofHash);
      expect(publicResult.answerMerkleRoot).to.equal(merkleRoot);
      expect(publicResult.zkVerified).to.be.true;
      expect(publicResult.answerCommitted).to.be.true;
      expect(publicResult.candidateCount).to.equal(candidateCount);

      // The math is the proof. ✅
    });
  });
});
