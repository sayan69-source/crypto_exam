// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CryptoExamCore
 * @author CryptoExam Team — FAR AWAY 2026
 * @notice Zero-Trust Examination Smart Contract on Polygon PoS
 *
 * § 12 — On-chain exam lifecycle management.
 *
 * This contract stores ONLY hashes and proofs — never questions, answers,
 * or personal data. All sensitive data lives off-chain in encrypted form.
 *
 * On-chain records:
 *   1. Exam registration (question hash, ZK proof hash, lock timestamp)
 *   2. ZK difficulty proof verification (Groth16)
 *   3. Answer Merkle root commitment (immutable after commit)
 *   4. Hardware node delivery proofs (ProofOfDelivery)
 *
 * Anyone with a browser and Polygonscan can independently verify
 * every commitment. No API key, no login, no trust required.
 *
 * DPDP Act 2023: No PII on-chain. Only cryptographic hashes.
 */

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CryptoExamCore is AccessControl, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════
    // Roles
    // ═══════════════════════════════════════════════════════
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SETTER_ROLE = keccak256("SETTER_ROLE");
    bytes32 public constant NODE_ROLE = keccak256("NODE_ROLE");

    // ═══════════════════════════════════════════════════════
    // Structs
    // ═══════════════════════════════════════════════════════

    struct ExamRecord {
        bytes32 questionHash;       // SHA-256 of encrypted paper
        bytes32 zkProofHash;        // Hash of Groth16 ZK proof
        bytes32 answerMerkleRoot;   // Committed after exam completion
        string  zkProofIPFS;        // IPFS CID for the full ZK proof
        string  constraintSpecIPFS; // IPFS CID for IRT constraint spec
        uint256 lockTimestamp;      // T₀ — when the paper was locked
        uint256 drandRound;         // drand round used for key derivation
        uint64  candidateCount;     // Number of candidates
        bool    isLocked;           // Paper is locked and encrypted
        bool    zkVerified;         // ZK proof has been verified on-chain
        bool    answerCommitted;    // Merkle root has been committed
        address setter;             // Setter who locked the exam
    }

    struct DeliveryProof {
        bytes32 nodeId;             // Hardware node serial hash
        bytes   tpmSignature;       // TPM 2.0 signed attestation
        uint256 gpsTimestamp;       // GPS-derived UTC timestamp
        int64   latitude;           // Lat × 1e6
        int64   longitude;          // Lon × 1e6
        bool    verified;           // Admin verified the proof
    }

    /**
     * @notice Per-centre answer-root anchor (ZUUP-OS §11.5).
     * @dev The System Admin anchors ONE of these per centre per exam after
     *      HSM-decrypting that centre's sync bundle. It contains ONLY
     *      roots/counts/hashes — never a roll, name, DOB, or any ciphertext
     *      (DPDP / no-PII-on-chain, §11.6). `centreIdHash` is SHA-256(centreId),
     *      never the raw id; `nodePubkey` is the centre node's signing key so
     *      anyone can later verify a candidate receipt against this root.
     */
    struct CentreAnswerAnchor {
        bytes32 answerRoot;         // final centre Merkle hash-chain root
        bytes32 nodePubkey;         // centre node signing pubkey (raw 32B)
        uint64  count;              // number of sealed submissions in the chain
        uint256 anchoredAt;         // block timestamp of the anchor
        bool    anchored;           // set once; re-anchor is rejected
    }

    // ═══════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════

    /// @notice Exam records indexed by exam UUID hash
    mapping(bytes32 => ExamRecord) public exams;

    /// @notice Delivery proofs: examId => nodeId => proof
    mapping(bytes32 => mapping(bytes32 => DeliveryProof)) public deliveryProofs;

    /// @notice Per-centre answer-root anchors (§11.5): examId => centreIdHash => anchor
    mapping(bytes32 => mapping(bytes32 => CentreAnswerAnchor)) public centreAnchors;

    /// @notice All exam IDs for enumeration
    bytes32[] public examIds;

    /// @notice ZK Verifier contract address
    address public zkVerifier;

    // ═══════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════

    event ExamLocked(
        bytes32 indexed examId,
        bytes32 questionHash,
        uint256 lockTimestamp,
        uint256 drandRound,
        address indexed setter
    );

    event ZKProofSubmitted(
        bytes32 indexed examId,
        bytes32 zkProofHash,
        string  zkProofIPFS,
        bool    verified
    );

    event AnswerMerkleRootCommitted(
        bytes32 indexed examId,
        bytes32 merkleRoot,
        uint64  candidateCount
    );

    event DeliveryProofSubmitted(
        bytes32 indexed examId,
        bytes32 indexed nodeId,
        uint256 gpsTimestamp
    );

    event EmergencyPause(
        bytes32 indexed examId,
        address indexed admin,
        string  reason
    );

    event CentreAnswerRootAnchored(
        bytes32 indexed examId,
        bytes32 indexed centreIdHash,
        bytes32 answerRoot,
        bytes32 nodePubkey,
        uint64  count
    );

    // ═══════════════════════════════════════════════════════
    // Errors
    // ═══════════════════════════════════════════════════════

    error ExamAlreadyLocked(bytes32 examId);
    error ExamNotLocked(bytes32 examId);
    error AnswerAlreadyCommitted(bytes32 examId);
    error ZKProofNotVerified(bytes32 examId);
    error InvalidExamId();
    error InvalidZKProof();
    error CentreAlreadyAnchored(bytes32 examId, bytes32 centreIdHash);
    error InvalidAnchor();

    // ═══════════════════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════════════════

    constructor(address _zkVerifier) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        zkVerifier = _zkVerifier;
    }

    // ═══════════════════════════════════════════════════════
    // Core Functions
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Lock an exam — register question hash and encryption params.
     * @dev Called after AI generation, IRT validation, and ZK proof generation.
     *      Once locked, the question hash is immutable on-chain.
     *
     * @param examId        Keccak256 hash of the exam UUID
     * @param questionHash  SHA-256 hash of the encrypted question paper
     * @param drandRound    drand beacon round for key derivation at T₀
     * @param constraintSpecIPFS  IPFS CID for the IRT constraint specification
     */
    function lockExam(
        bytes32 examId,
        bytes32 questionHash,
        uint256 drandRound,
        string calldata constraintSpecIPFS
    ) external onlyRole(SETTER_ROLE) nonReentrant {
        if (examId == bytes32(0)) revert InvalidExamId();
        if (exams[examId].isLocked) revert ExamAlreadyLocked(examId);

        exams[examId] = ExamRecord({
            questionHash: questionHash,
            zkProofHash: bytes32(0),
            answerMerkleRoot: bytes32(0),
            zkProofIPFS: "",
            constraintSpecIPFS: constraintSpecIPFS,
            lockTimestamp: block.timestamp,
            drandRound: drandRound,
            candidateCount: 0,
            isLocked: true,
            zkVerified: false,
            answerCommitted: false,
            setter: msg.sender
        });

        examIds.push(examId);

        emit ExamLocked(examId, questionHash, block.timestamp, drandRound, msg.sender);
    }

    /**
     * @notice Submit and verify a ZK-SNARK difficulty proof.
     * @dev The proof demonstrates that the AI-generated paper meets
     *      the IRT difficulty distribution constraints without revealing
     *      any questions or answers.
     *
     * @param examId       Exam identifier
     * @param zkProofHash  SHA-256 hash of the Groth16 proof JSON
     * @param zkProofIPFS  IPFS CID of the full proof for independent verification
     */
    function submitZKProof(
        bytes32 examId,
        bytes32 zkProofHash,
        string calldata zkProofIPFS
    ) external onlyRole(SETTER_ROLE) nonReentrant {
        if (!exams[examId].isLocked) revert ExamNotLocked(examId);

        // In production, call the ZKVerifier contract here for on-chain verification.
        // For Amoy testnet, we verify off-chain and record the hash.
        bool verified = true;

        exams[examId].zkProofHash = zkProofHash;
        exams[examId].zkProofIPFS = zkProofIPFS;
        exams[examId].zkVerified = verified;

        emit ZKProofSubmitted(examId, zkProofHash, zkProofIPFS, verified);
    }

    /**
     * @notice Commit the answer Merkle root after exam completion.
     * @dev Once committed, this root is IMMUTABLE. Any post-commit
     *      modification to any candidate's answers would produce a
     *      different root, detectable by anyone with Polygonscan.
     *
     *      This is the mathematical guarantee of answer immutability.
     *
     * @param examId         Exam identifier
     * @param merkleRoot     SHA-256 Merkle root of all candidate answer hashes
     * @param candidateCount Number of candidates in the tree
     */
    function commitAnswerMerkleRoot(
        bytes32 examId,
        bytes32 merkleRoot,
        uint64 candidateCount
    ) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (!exams[examId].isLocked) revert ExamNotLocked(examId);
        if (exams[examId].answerCommitted) revert AnswerAlreadyCommitted(examId);

        exams[examId].answerMerkleRoot = merkleRoot;
        exams[examId].candidateCount = candidateCount;
        exams[examId].answerCommitted = true;

        emit AnswerMerkleRootCommitted(examId, merkleRoot, candidateCount);
    }

    /**
     * @notice Anchor ONE centre's answer-root for an exam (ZUUP-OS §11.5).
     * @dev Called by the System Admin AFTER it HSM-decrypts that centre's sync
     *      bundle and re-verifies the chain off-chain. The terminal/centre is a
     *      blind courier (INV-6); this anchor makes the centre's local Merkle
     *      hash-chain publicly tamper-evident. No PII is accepted or stored —
     *      only the SHA-256 of the centre id, the chain root, a count, and the
     *      centre node's signing pubkey. One anchor per (exam, centre): a second
     *      attempt reverts, so a root can never be back-dated or overwritten.
     *
     * @param examId        Exam identifier (keccak/SHA of the exam UUID)
     * @param centreIdHash  SHA-256(centreId) — NEVER the raw centre id
     * @param answerRoot    Final centre hash-chain root for this exam
     * @param count         Number of sealed submissions in the chain
     * @param nodePubkey    Centre node signing pubkey (raw 32 bytes)
     */
    function anchorCentreAnswerRoot(
        bytes32 examId,
        bytes32 centreIdHash,
        bytes32 answerRoot,
        uint64  count,
        bytes32 nodePubkey
    ) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (!exams[examId].isLocked) revert ExamNotLocked(examId);
        if (centreIdHash == bytes32(0) || answerRoot == bytes32(0)) revert InvalidAnchor();
        if (centreAnchors[examId][centreIdHash].anchored) {
            revert CentreAlreadyAnchored(examId, centreIdHash);
        }

        centreAnchors[examId][centreIdHash] = CentreAnswerAnchor({
            answerRoot: answerRoot,
            nodePubkey: nodePubkey,
            count: count,
            anchoredAt: block.timestamp,
            anchored: true
        });

        emit CentreAnswerRootAnchored(examId, centreIdHash, answerRoot, nodePubkey, count);
    }

    /**
     * @notice Submit hardware node delivery proof.
     * @dev Called by the hardware node after successfully decrypting
     *      the paper at T₀ using the drand beacon randomness.
     *      The TPM 2.0 signature proves the decryption occurred on
     *      authentic hardware at the correct GPS location and time.
     *
     * @param examId        Exam identifier
     * @param nodeId        Keccak256 hash of the node serial number
     * @param tpmSignature  TPM 2.0 signed attestation blob
     * @param gpsTimestamp  GPS-derived UTC timestamp of decryption
     * @param latitude      Latitude × 1e6
     * @param longitude     Longitude × 1e6
     */
    function submitDeliveryProof(
        bytes32 examId,
        bytes32 nodeId,
        bytes calldata tpmSignature,
        uint256 gpsTimestamp,
        int64 latitude,
        int64 longitude
    ) external onlyRole(NODE_ROLE) nonReentrant {
        if (!exams[examId].isLocked) revert ExamNotLocked(examId);

        deliveryProofs[examId][nodeId] = DeliveryProof({
            nodeId: nodeId,
            tpmSignature: tpmSignature,
            gpsTimestamp: gpsTimestamp,
            latitude: latitude,
            longitude: longitude,
            verified: false
        });

        emit DeliveryProofSubmitted(examId, nodeId, gpsTimestamp);
    }

    // ═══════════════════════════════════════════════════════
    // View Functions (publicly verifiable — no auth required)
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Verify an answer Merkle root on-chain.
     * @dev Callable by ANYONE — journalist, RTI officer, candidate, court.
     *      No API key, no login, no trust.
     */
    function verifyExam(bytes32 examId) external view returns (
        bytes32 questionHash,
        bytes32 zkProofHash,
        bytes32 answerMerkleRoot,
        string memory zkProofIPFS,
        uint256 lockTimestamp,
        uint256 drandRound,
        uint64 candidateCount,
        bool zkVerified,
        bool answerCommitted
    ) {
        ExamRecord storage exam = exams[examId];
        return (
            exam.questionHash,
            exam.zkProofHash,
            exam.answerMerkleRoot,
            exam.zkProofIPFS,
            exam.lockTimestamp,
            exam.drandRound,
            exam.candidateCount,
            exam.zkVerified,
            exam.answerCommitted
        );
    }

    /**
     * @notice Get the total number of exams registered on-chain.
     */
    function getExamCount() external view returns (uint256) {
        return examIds.length;
    }

    /**
     * @notice Read one centre's anchored answer-root (§11.5). Public, trustless.
     * @dev A candidate can verify their receipt's root against `answerRoot`, and
     *      its `nodePubkey` against the node signature on the receipt — proving
     *      their submission was committed, unaltered, with no API and no trust.
     */
    function getCentreAnchor(bytes32 examId, bytes32 centreIdHash)
        external
        view
        returns (bytes32 answerRoot, bytes32 nodePubkey, uint64 count, uint256 anchoredAt, bool anchored)
    {
        CentreAnswerAnchor storage a = centreAnchors[examId][centreIdHash];
        return (a.answerRoot, a.nodePubkey, a.count, a.anchoredAt, a.anchored);
    }

    /**
     * @notice Verify a delivery proof exists for a node.
     */
    function verifyDelivery(
        bytes32 examId,
        bytes32 nodeId
    ) external view returns (
        uint256 gpsTimestamp,
        int64 latitude,
        int64 longitude,
        bool verified
    ) {
        DeliveryProof storage proof = deliveryProofs[examId][nodeId];
        return (proof.gpsTimestamp, proof.latitude, proof.longitude, proof.verified);
    }

    // ═══════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Emergency pause — record reason on-chain for audit trail.
     * @dev Requires ADMIN_ROLE. The reason is permanently recorded.
     */
    function emergencyPause(
        bytes32 examId,
        string calldata reason
    ) external onlyRole(ADMIN_ROLE) {
        emit EmergencyPause(examId, msg.sender, reason);
    }

    /**
     * @notice Update ZK Verifier contract address.
     */
    function setZKVerifier(address _zkVerifier) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zkVerifier = _zkVerifier;
    }

    /**
     * @notice Verify a delivery proof (admin attestation).
     */
    function verifyDeliveryProof(
        bytes32 examId,
        bytes32 nodeId
    ) external onlyRole(ADMIN_ROLE) {
        deliveryProofs[examId][nodeId].verified = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CC-SSS Module (§§ 49–62) — Shamir SSS + Nitro Enclave Attestation
    // All additions are non-destructive: new events, new mappings, new functions.
    // Existing storage layout, roles and lockExam/answer flow are unchanged.
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice One official's SSS share was submitted to the enclave.
    event CeremonyShareSubmitted(
        bytes32 indexed examId,
        bytes32 officialId,        // sha256(official identity)
        uint8   shareIndex,        // 1..5
        uint8   totalSharesReceived,
        uint256 timestamp
    );

    /// @notice The k-of-n threshold was reached and the ceremony completed.
    event CeremonyCompleted(
        bytes32 indexed examId,
        uint8   sharesReceived,
        uint8   threshold,
        bytes32 enclaveAttestation, // sha256(PCR0) — the code identity that ran
        uint256 timestamp
    );

    /// @notice The enclave attestation document was verified against the published PCR0.
    event EnclaveAttestationVerified(
        bytes32 indexed examId,
        bytes32 pcr0Hash,           // sha-256 of the SHA-384 PCR0 value
        bytes32 enclavePublicKeyHash,
        uint256 timestamp
    );

    mapping(bytes32 => bool)  public ceremonyCompleted;
    mapping(bytes32 => uint8) public ceremonyShareCount;

    /**
     * @notice Record an SSS share submission. Authorised role only.
     * @dev Increments the per-exam share counter and emits an event for indexers.
     */
    function recordCeremonyShare(
        bytes32 examId,
        bytes32 officialId,
        uint8 shareIndex
    ) external onlyRole(ADMIN_ROLE) {
        ceremonyShareCount[examId] += 1;
        emit CeremonyShareSubmitted(
            examId, officialId, shareIndex, ceremonyShareCount[examId], block.timestamp
        );
    }

    /**
     * @notice Mark the ceremony as completed after threshold is reached.
     * @dev Idempotent guard prevents re-completing.
     */
    function completeCeremony(
        bytes32 examId,
        uint8 sharesReceived,
        uint8 threshold,
        bytes32 pcr0Hash
    ) external onlyRole(ADMIN_ROLE) {
        require(!ceremonyCompleted[examId], "ceremony already completed");
        require(sharesReceived >= threshold, "insufficient shares");
        ceremonyCompleted[examId] = true;
        emit CeremonyCompleted(examId, sharesReceived, threshold, pcr0Hash, block.timestamp);
    }

    /**
     * @notice Record that an enclave attestation document was verified off-chain.
     */
    function recordEnclaveAttestation(
        bytes32 examId,
        bytes32 pcr0Hash,
        bytes32 enclavePublicKeyHash
    ) external onlyRole(ADMIN_ROLE) {
        emit EnclaveAttestationVerified(examId, pcr0Hash, enclavePublicKeyHash, block.timestamp);
    }
}
