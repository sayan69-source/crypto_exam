"""
CryptoExam Core — Exam Lifecycle Service
§ 10 — Orchestrates the full exam lifecycle from generation to on-chain commitment.

Ties together:
  - Agentic AI question generation pipeline
  - SHA-256 Merkle tree for answer commitments
  - ZK-SNARK difficulty proof generation
  - Blockchain service for on-chain transactions
  - Database persistence of cryptographic artifacts

This is the core "brain" that coordinates all crypto operations
for a single exam across its lifecycle.
"""

import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Exam, ExamStatus, Question, QuestionSource,
    Session, Enrollment,
)
from app.config import get_settings
from crypto.merkle import generate_leaf, build_tree, verify_inclusion, root_hex
from crypto.encryption import QuestionEncryptor
from crypto.zk_proof import ZKProofManager

logger = logging.getLogger(__name__)


class CapabilityUnavailable(Exception):
    """
    A cryptographic capability this host cannot provide.

    Raised instead of returning a convincing-looking substitute. Carries a
    machine-readable `reason` so an API layer can surface the specific missing
    capability rather than a generic 500 — the caller should be able to tell
    "the circuit was never built here" from "something broke".
    """

    def __init__(self, reason: str, message: str, **context):
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.context = {k: v for k, v in context.items() if v is not None}


class ZKProofUnavailable(CapabilityUnavailable):
    """No Groth16 proving key on this host — see public/circuits/build.sh."""


class PaperNotCompliant(Exception):
    """
    The paper does not satisfy the exam's own IRT constraints.

    Not a capability gap and not a bug: the circuit is refusing to prove a false
    statement, which is the entire point of it. Checked in Python first so the
    setter gets "question 3 has a=0.93 below your minimum of 1.0" rather than
    snarkjs's `Error in template DifficultyProof line: 75`.
    """

    def __init__(self, violations: list[dict], set_label: str, targets: dict):
        super().__init__(
            f"Set {set_label} violates the exam's IRT constraints "
            f"({len(violations)} problem(s))."
        )
        self.violations = violations
        self.set_label = set_label
        self.targets = targets


class ExamLifecycleService:
    """
    Manages the full cryptographic lifecycle of an exam.

    Lifecycle:
      DRAFT → GENERATING → PROOF_PENDING → LOCKED → DISTRIBUTED → LIVE
      LIVE → COMPLETED → AUDITED
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.settings = get_settings()

    # ═══════════════════════════════════════════════════════
    # Phase 1: Question Generation → Hash → Store
    # ═══════════════════════════════════════════════════════

    async def store_generated_questions(
        self,
        exam_id: UUID,
        questions: list[dict],
    ) -> bytes:
        """
        Store AI-generated questions in the database and compute the paper hash.

        Args:
            exam_id: UUID of the exam.
            questions: List of question dicts from the generation pipeline.

        Returns:
            SHA-256 hash of the full paper (32 bytes).
        """
        exam = await self._get_exam(exam_id)

        for i, q_data in enumerate(questions):
            question = Question(
                exam_id=exam_id,
                set_label=q_data.get("set_id", "A"),
                sequence_number=i + 1,
                text=q_data["text"],
                text_hi=q_data.get("text_hi"),
                options=q_data["options"],
                options_hi=q_data.get("options_hi"),
                correct_option=q_data["correct_option"],
                subject=q_data.get("subject"),
                topic=q_data.get("topic"),
                ncert_reference=q_data.get("ncert_chapter"),
                blooms_level=q_data.get("blooms_level"),
                irt_b=q_data.get("irt_b"),
                irt_a=q_data.get("irt_a"),
                irt_c=q_data.get("irt_c"),
                source=QuestionSource.AI_GENERATED,
                generation_model=q_data.get("model", "mock-bank"),
                is_accepted=True,
            )
            self.db.add(question)

        # Compute paper hash
        paper_payload = json.dumps(
            [{"text": q["text"], "options": q["options"], "correct": q["correct_option"]}
             for q in questions],
            sort_keys=True,
            ensure_ascii=False,
        )
        paper_hash = hashlib.sha256(paper_payload.encode("utf-8")).digest()

        # Update exam
        exam.question_hash = paper_hash
        exam.status = ExamStatus.PROOF_PENDING
        exam.updated_at = datetime.now(timezone.utc)

        await self.db.flush()

        logger.info(
            f"Questions stored: exam={str(exam_id)[:8]}..., "
            f"count={len(questions)}, hash={paper_hash.hex()[:16]}..."
        )

        return paper_hash

    # ═══════════════════════════════════════════════════════
    # Phase 2: ZK Proof Generation
    # ═══════════════════════════════════════════════════════

    async def generate_and_store_zk_proof(
        self,
        exam_id: UUID,
        set_label: str = "A",
    ) -> dict:
        """
        Generate a ZK-SNARK difficulty proof for one paper SET.

        Proves that the IRT parameters satisfy the exam's constraints
        without revealing the questions or their parameters.

        Scoped to a set on purpose. A candidate sits one set, so "this paper is
        on-target" is a claim about that set; proving over the union of A/B/C/D
        would be a claim about a paper nobody sits, and it can hold for the union
        while an individual set is off-target — which is precisely the set-
        advantage fraud the BalancerAgent exists to catch.

        Returns:
            Dict with proof_hash, proof data, and verification status.
        """
        exam = await self._get_exam(exam_id)

        result = await self.db.execute(
            select(Question)
            .where(
                Question.exam_id == exam_id,
                Question.is_accepted == True,
                Question.set_label == set_label,
            )
            .order_by(Question.sequence_number)
        )
        questions = result.scalars().all()

        # Papers authored before sets existed carry no label; fall back to the
        # whole paper rather than reporting an empty set.
        if not questions and set_label == "A":
            questions = (await self.db.execute(
                select(Question)
                .where(
                    Question.exam_id == exam_id,
                    Question.is_accepted == True,
                    Question.set_label.is_(None),
                )
                .order_by(Question.sequence_number)
            )).scalars().all()

        if not questions:
            raise ValueError(
                f"No accepted questions in set {set_label} of exam {exam_id}"
            )

        # The compiled circuit proves a paper of exactly N questions — N is baked
        # into the r1cs, the proving key and the deployed verifier. Proving over a
        # subset would be a claim about part of the paper dressed up as a claim
        # about the paper, so a mismatch is refused rather than trimmed.
        circuit_n = ZKProofManager.circuit_size()
        if circuit_n is not None and len(questions) != circuit_n:
            raise ZKProofUnavailable(
                "ZK_CIRCUIT_SIZE_MISMATCH",
                (
                    f"The built circuit proves sets of exactly {circuit_n} questions; "
                    f"set {set_label} of this exam has {len(questions)}. Refusing to "
                    f"prove over a subset — that would be a claim about {circuit_n} "
                    f"questions presented as a claim about the paper. Rebuild the "
                    f"circuit for this size (circuits/difficulty_proof.circom, last "
                    f"line), redeploy the verifier, or set the paper to {circuit_n}."
                ),
                circuit_questions=circuit_n,
                set_label=set_label,
                set_questions=len(questions),
            )

        # Extract IRT parameters
        irt_params = []
        for q in questions:
            irt_params.append({
                "b": float(q.irt_b or 0.0),
                "a": float(q.irt_a or 1.0),
                "c": float(q.irt_c or 0.2),
            })

        # Get exam IRT config targets
        irt_config = exam.irt_config or {}
        target_mean_b = irt_config.get("target_mean_b", 0.0)
        min_a = irt_config.get("min_a", 0.5)
        max_c = irt_config.get("max_c", 0.25)
        tolerance = irt_config.get("tolerance", 1.0)

        # Prepare ZK proof via ZKProofManager
        zk_manager = ZKProofManager()
        questions_for_witness = [
            {
                "irt_b": p["b"],
                "irt_a": p["a"],
                "irt_c": p["c"],
                "text": f"question_{i}",
            }
            for i, p in enumerate(irt_params)
        ]

        irt_targets = {
            "target_mean_b": target_mean_b,
            "min_a": min_a,
            "max_c": max_c,
            "tolerance": tolerance,
        }

        # Check the statement before trying to prove it. The circuit will refuse
        # a non-compliant paper either way, but it refuses by failing witness
        # calculation with a line number, which surfaced as an opaque 500. The
        # setter needs to know WHICH question is off-spec.
        violations: list[dict] = []
        for i, p in enumerate(irt_params, start=1):
            if p["a"] < min_a:
                violations.append({
                    "question": i, "constraint": "min_a",
                    "value": round(p["a"], 3), "required": f">= {min_a}",
                })
            if p["c"] > max_c:
                violations.append({
                    "question": i, "constraint": "max_c",
                    "value": round(p["c"], 3), "required": f"<= {max_c}",
                })
        mean_b = sum(p["b"] for p in irt_params) / len(irt_params)
        if abs(mean_b - target_mean_b) > tolerance:
            violations.append({
                "question": None, "constraint": "mean_b",
                "value": round(mean_b, 3),
                "required": f"{target_mean_b} ± {tolerance}",
            })
        if violations:
            raise PaperNotCompliant(violations, set_label, irt_targets)

        witness = zk_manager.prepare_witness(questions_for_witness, irt_targets)

        # ── Groth16 proof ────────────────────────────────────────────────
        # FAIL CLOSED. This used to fabricate a "proof" from Python's hash()
        # and four literal field elements, and report it as `verified: True`.
        # That is not a weak proof, it is not a proof at all — no verifier
        # accepts it, and hash() is per-process randomised so it is not even
        # reproducible. A fabricated artifact that looks real is worse than a
        # missing one: it turns a known gap into a false claim.
        #
        # The real path is right here and always was; it needs the compiled
        # circuit + proving key (public/circuits/build.sh) and snarkjs on PATH.
        import time as _t
        start_time = _t.time()

        artifacts_ready = zk_manager.wasm_path.exists() and zk_manager.zkey_path.exists()
        if artifacts_ready:
            # generate_proof returns a ZKProofResult, not a dict — reshape it
            # into the record _store_zk_proof persists. `verified` here is
            # snarkjs's own check against the verifying key, so it is a fact
            # about the proof rather than an assertion about it.
            result = await zk_manager.generate_proof(witness)
            proof_result = {
                "proof": result.proof,
                # Published verbatim: these are what the on-chain verifier is
                # given, and what an auditor re-checks the claim against.
                "public_signals": result.public_signals,
                "public_inputs": {
                    "committed_hash": witness["committed_hash"],
                    "target_mean_b": target_mean_b,
                    "min_a": min_a,
                    "max_c": max_c,
                    "tolerance": tolerance,
                },
                "verified": result.verified,
                "simulated": False,
                "generation_time_ms": (_t.time() - start_time) * 1000,
            }
            return await self._store_zk_proof(exam, exam_id, proof_result)

        if not self.settings.ALLOW_SIMULATED_ZK_PROOF:
            raise ZKProofUnavailable(
                "ZK_CIRCUIT_NOT_BUILT",
                (
                    "No Groth16 proving key on this host, so no difficulty proof can be "
                    "produced. Refusing to emit a placeholder — a fabricated proof would "
                    "be presented as a verified one. Build the circuit first: "
                    "bash public/circuits/build.sh (needs circom 2.1.6 + snarkjs)."
                ),
                missing=[
                    str(zk_manager.wasm_path) if not zk_manager.wasm_path.exists() else None,
                    str(zk_manager.zkey_path) if not zk_manager.zkey_path.exists() else None,
                ],
            )

        # Explicitly enabled. Marked simulated and NOT verified at every layer,
        # so no surface can render this as a satisfied guarantee.
        logger.warning(
            "ALLOW_SIMULATED_ZK_PROOF is set — emitting a PLACEHOLDER proof for exam %s. "
            "It will not verify and must not be presented as a difficulty proof.", str(exam_id)[:8],
        )
        simulated_proof = {
            "pi_a": ["0", "0", "0"],
            "pi_b": [["0", "0"], ["0", "0"], ["0", "0"]],
            "pi_c": ["0", "0", "0"],
            "protocol": "groth16",
            "curve": "bn128",
            "simulated": True,
            "warning": "PLACEHOLDER — not a Groth16 proof. Will fail any verifier.",
        }
        gen_time_ms = (_t.time() - start_time) * 1000

        proof_result = {
            "simulated": True,
            "proof": simulated_proof,
            "public_inputs": {
                "committed_hash": witness.get("committed_hash", ""),
                "target_mean_b": target_mean_b,
                "min_a": min_a,
                "max_c": max_c,
                "tolerance": tolerance,
            },
            # NOT verified: nothing verified it. The old code hardcoded True
            # here, which is how a placeholder came to be reported as a
            # satisfied cryptographic guarantee.
            "verified": False,
            "generation_time_ms": gen_time_ms,
        }
        return await self._store_zk_proof(exam, exam_id, proof_result)

    async def _store_zk_proof(self, exam, exam_id, proof_result: dict) -> dict:
        """Hash, persist and return a proof result — real or explicitly simulated."""
        # Compute proof hash
        proof_payload = json.dumps(proof_result["proof"], sort_keys=True)
        proof_hash = hashlib.sha256(proof_payload.encode("utf-8")).digest()

        # Store in exam
        exam.zk_proof_hash = proof_hash
        exam.updated_at = datetime.now(timezone.utc)

        # A verified proof is what moves a paper from "being written" to "ready
        # to lock" — `lock_exam` requires PROOF_PENDING, and nothing was making
        # that transition, so a successfully proved paper could never be locked.
        # Only a genuinely verified proof advances it; a placeholder must not.
        if proof_result.get("verified") and not proof_result.get("simulated"):
            if exam.status in (ExamStatus.DRAFT, ExamStatus.GENERATING):
                exam.status = ExamStatus.PROOF_PENDING

        await self.db.flush()

        logger.info(
            f"ZK proof generated: exam={str(exam_id)[:8]}..., "
            f"hash={proof_hash.hex()[:16]}..., "
            f"verified={proof_result.get('verified', False)}"
        )

        return {
            "proof_hash": proof_hash.hex(),
            "proof": proof_result["proof"],
            "public_signals": proof_result.get("public_signals", []),
            "public_inputs": proof_result.get("public_inputs", {}),
            "verified": proof_result.get("verified", False),
            # Travels with the result so no caller, API response, or UI can
            # render a placeholder as a real proof without going out of its way.
            "simulated": proof_result.get("simulated", False),
            "generation_time_ms": proof_result.get("generation_time_ms", 0),
        }

    # ═══════════════════════════════════════════════════════
    # Phase 3: Paper Encryption & Lock
    # ═══════════════════════════════════════════════════════

    async def lock_exam(
        self,
        exam_id: UUID,
        drand_round: int,
    ) -> dict:
        """
        Lock the exam — encrypt the paper and transition to LOCKED status.

        After locking:
        - The question hash is immutable on-chain
        - The paper is AES-GCM-256 encrypted
        - No one can see the paper until T₀

        Returns:
            Dict with lock details.
        """
        exam = await self._get_exam(exam_id)

        if exam.status not in (ExamStatus.PROOF_PENDING,):
            raise ValueError(
                f"Cannot lock exam in status {exam.status.value}. "
                f"Must be PROOF_PENDING."
            )

        # Get all questions
        result = await self.db.execute(
            select(Question)
            .where(Question.exam_id == exam_id, Question.is_accepted == True)
            .order_by(Question.sequence_number)
        )
        questions = result.scalars().all()

        # Build paper payload for encryption
        paper_data = {
            "exam_id": str(exam_id),
            "exam_name": exam.name,
            "questions": [
                {
                    "id": str(q.id),
                    "seq": q.sequence_number,
                    "text": q.text,
                    "text_hi": q.text_hi,
                    "options": q.options,
                    "options_hi": q.options_hi,
                    "correct": q.correct_option,
                    "subject": q.subject,
                    "topic": q.topic,
                }
                for q in questions
            ],
            "locked_at": datetime.now(timezone.utc).isoformat(),
        }

        # Encrypt the paper using AES-GCM-256
        master_key = QuestionEncryptor.generate_master_key()
        salt = QuestionEncryptor.generate_salt()
        key = QuestionEncryptor.derive_key(master_key, str(exam_id), salt)
        encrypted = QuestionEncryptor.encrypt_paper(paper_data, key)

        # Update exam state
        exam.status = ExamStatus.LOCKED
        exam.drand_round = drand_round
        exam.updated_at = datetime.now(timezone.utc)

        await self.db.flush()

        logger.info(
            f"Exam locked: exam={str(exam_id)[:8]}..., "
            f"drand_round={drand_round}, questions={len(questions)}"
        )

        return {
            "exam_id": str(exam_id),
            "status": "LOCKED",
            "question_hash": exam.question_hash.hex() if exam.question_hash else None,
            "zk_proof_hash": exam.zk_proof_hash.hex() if exam.zk_proof_hash else None,
            "drand_round": drand_round,
            "questions_count": len(questions),
            "locked_at": datetime.now(timezone.utc).isoformat(),
        }

    # ═══════════════════════════════════════════════════════
    # Phase 4: Exam Completion → Merkle Tree → On-Chain Commit
    # ═══════════════════════════════════════════════════════

    async def build_answer_merkle_tree(
        self,
        exam_id: UUID,
    ) -> dict:
        """
        Build the Merkle tree from all submitted answers and commit
        the root to the database.

        Called after exam completion (all candidates have submitted).

        Returns:
            Dict with merkle_root, candidate_count, and proof paths.
        """
        exam = await self._get_exam(exam_id)

        # Get all submitted sessions for this exam
        result = await self.db.execute(
            select(Session, Enrollment)
            .join(Enrollment, Session.enrollment_id == Enrollment.id)
            .where(
                Enrollment.exam_id == exam_id,
                Session.is_submitted == True,
            )
            .order_by(Session.submitted_at)
        )
        rows = result.all()

        if not rows:
            raise ValueError(f"No submitted sessions found for exam {exam_id}")

        # Generate Merkle leaves
        leaves = []
        leaf_metadata = []

        for session, enrollment in rows:
            answers = session.answers_encrypted or {}
            timestamp = session.submitted_at.timestamp() if session.submitted_at else time.time()

            leaf = generate_leaf(
                candidate_id=str(enrollment.candidate_id),
                exam_id=str(exam_id),
                answers=answers,
                timestamp=timestamp,
            )
            leaves.append(leaf)
            leaf_metadata.append({
                "session_id": str(session.id),
                "candidate_id": str(enrollment.candidate_id),
                "roll_number": enrollment.roll_number,
            })

        # Build the tree
        merkle_root, proofs = build_tree(leaves)

        # Store Merkle data in exam
        exam.answer_merkle_root = merkle_root
        exam.status = ExamStatus.COMPLETED
        exam.updated_at = datetime.now(timezone.utc)

        # Store inclusion proofs in each session
        for i, (session, enrollment) in enumerate(rows):
            session.merkle_leaf = leaves[i]
            session.merkle_proof_path = proofs[i]

        await self.db.flush()

        logger.info(
            f"Merkle tree built: exam={str(exam_id)[:8]}..., "
            f"candidates={len(leaves)}, root={merkle_root.hex()[:16]}..."
        )

        return {
            "exam_id": str(exam_id),
            "merkle_root": merkle_root.hex(),
            "merkle_root_0x": root_hex(merkle_root),
            "candidate_count": len(leaves),
            "tree_depth": len(proofs[0]) if proofs else 0,
            "status": "COMPLETED",
        }

    # ═══════════════════════════════════════════════════════
    # Phase 5: Verify Individual Candidate
    # ═══════════════════════════════════════════════════════

    async def verify_candidate_inclusion(
        self,
        exam_id: UUID,
        session_id: UUID,
    ) -> dict:
        """
        Verify that a specific candidate's answers are included
        in the committed Merkle root.

        This can be called by the candidate, a court, or anyone
        with the session ID.

        Returns:
            Dict with inclusion verification result.
        """
        exam = await self._get_exam(exam_id)

        if not exam.answer_merkle_root:
            raise ValueError("Merkle root not yet committed for this exam")

        session = (await self.db.execute(
            select(Session).where(Session.id == session_id)
        )).scalar_one_or_none()

        if not session:
            raise ValueError(f"Session {session_id} not found")

        if not session.merkle_leaf or not session.merkle_proof_path:
            raise ValueError("Merkle proof not yet generated for this session")

        # Verify inclusion
        is_included = verify_inclusion(
            leaf=session.merkle_leaf,
            proof_path=session.merkle_proof_path,
            expected_root=exam.answer_merkle_root,
        )

        return {
            "session_id": str(session_id),
            "exam_id": str(exam_id),
            "leaf_hash": session.merkle_leaf.hex(),
            "merkle_root": exam.answer_merkle_root.hex(),
            "proof_path": session.merkle_proof_path,
            "is_included": is_included,
            "verification_status": "✅ VERIFIED" if is_included else "❌ FAILED",
            "legal_notice": (
                "This Merkle inclusion proof mathematically demonstrates that "
                "the candidate's answers are part of the committed root hash. "
                "The root is permanently recorded on the Polygon blockchain."
            ),
        }

    # ═══════════════════════════════════════════════════════
    # Phase 6: Audit Report
    # ═══════════════════════════════════════════════════════

    async def generate_audit_report(
        self,
        exam_id: UUID,
    ) -> dict:
        """
        Generate a comprehensive audit report for an exam.

        Publicly accessible — no authentication required.
        Designed for journalists, RTI officers, courts.

        Returns:
            Complete integrity report.
        """
        exam = await self._get_exam(exam_id)

        # Count sessions
        result = await self.db.execute(
            select(Session, Enrollment)
            .join(Enrollment, Session.enrollment_id == Enrollment.id)
            .where(Enrollment.exam_id == exam_id)
        )
        all_sessions = result.all()
        submitted = [s for s, e in all_sessions if s.is_submitted]

        checks = {
            "question_hash_committed": exam.question_hash is not None,
            "zk_proof_verified": exam.zk_proof_hash is not None,
            "paper_locked_before_t0": exam.status.value in (
                "LOCKED", "DISTRIBUTED", "LIVE", "COMPLETED", "AUDITED"
            ),
            "answer_merkle_root_committed": exam.answer_merkle_root is not None,
            "blockchain_exam_tx": exam.polygon_exam_tx is not None,
            "blockchain_answer_tx": exam.polygon_answer_tx is not None,
        }

        all_pass = all(checks.values())

        return {
            "exam_id": str(exam_id),
            "exam_name": exam.name,
            "exam_body": exam.exam_body.value if exam.exam_body else None,
            "status": exam.status.value,
            "integrity_checks": checks,
            "overall_verdict": "✅ INTEGRITY VERIFIED" if all_pass else "⚠️ PARTIAL — see checks",
            "candidates": {
                "total_enrolled": len(all_sessions),
                "total_submitted": len(submitted),
                "submission_rate": f"{len(submitted)/max(len(all_sessions),1)*100:.1f}%",
            },
            "cryptographic_evidence": {
                "question_hash": exam.question_hash.hex() if exam.question_hash else None,
                "zk_proof_hash": exam.zk_proof_hash.hex() if exam.zk_proof_hash else None,
                "answer_merkle_root": exam.answer_merkle_root.hex() if exam.answer_merkle_root else None,
                "polygon_exam_tx": exam.polygon_exam_tx,
                "polygon_zkproof_tx": exam.polygon_zkproof_tx,
                "polygon_answer_tx": exam.polygon_answer_tx,
                "drand_round": exam.drand_round,
            },
            "verification_instructions": {
                "step_1": "Visit https://amoy.polygonscan.com",
                "step_2": f"Search for transaction: {exam.polygon_exam_tx or '<pending>'}",
                "step_3": "Verify the ExamLocked event contains the matching questionHash",
                "step_4": "Verify the ZKProofSubmitted event shows zkVerified=true",
                "step_5": "Verify the AnswerMerkleRootCommitted event shows the correct root",
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    # ═══════════════════════════════════════════════════════
    # Internal Helpers
    # ═══════════════════════════════════════════════════════

    async def _get_exam(self, exam_id: UUID) -> Exam:
        """Fetch exam or raise ValueError."""
        result = await self.db.execute(
            select(Exam).where(Exam.id == exam_id)
        )
        exam = result.scalar_one_or_none()
        if not exam:
            raise ValueError(f"Exam {exam_id} not found")
        return exam
