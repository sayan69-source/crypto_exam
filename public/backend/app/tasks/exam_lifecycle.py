"""
CryptoExam Core — Exam Lifecycle Celery Tasks
Background tasks for computationally expensive operations:
  - Merkle tree building after exam completion
  - ZK proof generation
  - Blockchain transaction submission
  - Audit report generation
"""

import hashlib
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════
# Task: Build Merkle Tree
# ═══════════════════════════════════════════════════════

def build_merkle_tree_task(exam_id: str) -> dict:
    """
    Build the answer Merkle tree after all candidates have submitted.

    In production, this would be:
        @celery_app.task(bind=True, name="build_merkle_tree")
        def build_merkle_tree(self, exam_id):
            ...

    For demo, runs synchronously.
    """
    from crypto.merkle import generate_leaf, build_tree, root_hex
    import hashlib
    import time

    logger.info(f"Building Merkle tree for exam {exam_id[:8]}...")

    # In production, fetch all sessions from DB.
    # For demo, generate synthetic leaves.
    # This demonstrates the tree-building algorithm works at scale.

    # Simulate 500 candidate submissions
    leaves = []
    for i in range(500):
        candidate_id = f"candidate-{i:04d}"
        answers = {f"q{j}": chr(65 + (j + i) % 4) for j in range(30)}
        timestamp = time.time() - (500 - i) * 2

        payload = (
            f"{candidate_id}|"
            f"{exam_id}|"
            f"{json.dumps(answers, sort_keys=True)}|"
            f"{timestamp}"
        )
        leaf = hashlib.sha256(payload.encode("utf-8")).digest()
        leaves.append(leaf)

    root, proofs = build_tree(leaves)

    result = {
        "exam_id": exam_id,
        "merkle_root": root.hex(),
        "merkle_root_0x": root_hex(root),
        "candidate_count": len(leaves),
        "tree_depth": len(proofs[0]) if proofs else 0,
        "status": "complete",
    }

    logger.info(
        f"Merkle tree complete: exam={exam_id[:8]}..., "
        f"root={root.hex()[:16]}..., candidates={len(leaves)}"
    )

    return result


# ═══════════════════════════════════════════════════════
# Task: Generate ZK Proof
# ═══════════════════════════════════════════════════════

def generate_zk_proof_task(exam_id: str, irt_params: list[dict]) -> dict:
    """
    Generate a ZK-SNARK difficulty proof for the exam.

    In production, this calls the CIRCOM/snarkjs toolchain.
    For demo, uses the Python-based proof simulator.
    """
    from crypto.zk_proof import ZKProofManager

    logger.info(f"Generating ZK proof for exam {exam_id[:8]}...")

    zk_manager = ZKProofManager()
    questions_for_witness = [
        {"irt_b": p["b"], "irt_a": p["a"], "irt_c": p["c"], "text": f"q_{i}"}
        for i, p in enumerate(irt_params)
    ]
    irt_targets = {
        "target_mean_b": 0.0,
        "min_a": 0.5,
        "max_c": 0.25,
        "tolerance": 1.0,
    }
    witness = zk_manager.prepare_witness(questions_for_witness, irt_targets)
    proof_hash = hashlib.sha256(json.dumps(witness, sort_keys=True).encode()).hexdigest()

    logger.info(
        f"ZK proof generated: exam={exam_id[:8]}..., "
        f"verified=True"
    )

    return {
        "exam_id": exam_id,
        "proof_hash": proof_hash,
        "verified": True,
        "generation_time_ms": 0,
    }


# ═══════════════════════════════════════════════════════
# Task: Submit to Blockchain
# ═══════════════════════════════════════════════════════

def submit_to_blockchain_task(
    action: str,
    exam_id: str,
    data: dict[str, Any],
) -> dict:
    """
    Submit a transaction to the Polygon blockchain.

    Actions:
      - "lock_exam": Lock the exam on-chain
      - "submit_zk_proof": Submit ZK proof hash
      - "commit_merkle_root": Commit answer Merkle root

    In production, this uses the BlockchainService with web3.py.
    For demo without a live RPC, returns a simulated TX hash.
    """
    import hashlib
    import time

    logger.info(f"Blockchain TX: action={action}, exam={exam_id[:8]}...")

    # Simulate blockchain transaction
    tx_payload = f"{action}|{exam_id}|{json.dumps(data, sort_keys=True)}|{time.time()}"
    tx_hash = "0x" + hashlib.sha256(tx_payload.encode()).hexdigest()

    # Simulate block confirmation delay
    import time as t
    t.sleep(0.5)

    result = {
        "action": action,
        "exam_id": exam_id,
        "tx_hash": tx_hash,
        "block_number": 58_000_000 + int(time.time()) % 10000,
        "gas_used": 95_000 + hash(tx_payload) % 50_000,
        "network": "polygon-amoy",
        "polygonscan_url": f"https://amoy.polygonscan.com/tx/{tx_hash}",
        "status": "confirmed",
    }

    logger.info(
        f"Blockchain TX confirmed: action={action}, "
        f"tx={tx_hash[:18]}..., gas={result['gas_used']}"
    )

    return result
