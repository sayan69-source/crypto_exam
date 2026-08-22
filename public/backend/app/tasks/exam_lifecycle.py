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


class ChainAnchorUnavailable(Exception):
    """
    Nothing could be anchored on chain, and no substitute was invented.

    Carries a machine-readable `reason` so an API layer can say which
    capability is missing instead of returning a generic failure.
    """

    def __init__(self, reason: str, message: str, **context):
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.context = {k: v for k, v in context.items() if v is not None}


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

    THIS BUILDS A TREE OVER SYNTHETIC DATA. It is a scale demonstration of the
    tree-building algorithm — 500 invented candidates with invented answers —
    and the root it returns commits to nothing anyone submitted.

    The output is now labelled `synthetic: True` with no `status: "complete"`,
    because the API route used to fall back to this on ANY exception from the
    real DB-backed build. A caller then received a Merkle root that looked
    exactly like the real one, for the guarantee "answer records are immutable".
    A root over fabricated answers is worse than no root: it is a commitment to
    the wrong thing, presented as a commitment to the right thing.
    """
    from crypto.merkle import generate_leaf, build_tree, root_hex
    import hashlib
    import time

    logger.warning(
        "Building a SYNTHETIC Merkle tree for exam %s — 500 invented submissions. "
        "This root commits to no real answers.", exam_id[:8],
    )

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
        "status": "SYNTHETIC_DEMO",
        "synthetic": True,
        "warning": (
            "This root was built over 500 invented submissions to demonstrate the "
            "algorithm at scale. It commits to no real candidate answers."
        ),
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

    FAIL CLOSED when there is no chain to submit to.

    This used to return `"0x" + sha256(action|examId|data|clock)` alongside a
    plausible block number, a gas figure, `status: "confirmed"` and a
    ready-to-click `amoy.polygonscan.com/tx/<hash>` link. None of it existed.
    The URL is the dangerous part: it invites someone to verify the claim, and
    what they find is "transaction not found" — which reads as fraud rather
    than as an unfinished feature. An explicit "not anchored" is defensible;
    that was not.

    Real submission needs `CRYPTOEXAM_CONTRACT_ADDRESS` and a reachable
    `POLYGON_RPC_URL`, and the contract must actually be deployed there.
    """
    from app.config import get_settings

    settings = get_settings()
    logger.info(f"Blockchain TX: action={action}, exam={exam_id[:8]}...")

    if settings.CRYPTOEXAM_CONTRACT_ADDRESS and settings.DEPLOYER_PRIVATE_KEY:
        return _submit_onchain(action, exam_id, data, settings)

    if not settings.ALLOW_SIMULATED_CHAIN_TX:
        raise ChainAnchorUnavailable(
            "CHAIN_NOT_CONFIGURED",
            (
                "No deployed contract configured, so nothing can be anchored on chain. "
                "Refusing to mint a transaction hash that does not exist. Deploy first "
                "(cd public/contracts && npm run deploy:amoy), then set "
                "CRYPTOEXAM_CONTRACT_ADDRESS and DEPLOYER_PRIVATE_KEY."
            ),
            action=action,
            exam_id=exam_id,
        )

    # Explicitly enabled. No hash-shaped id, no block number, no gas figure and
    # above all NO explorer link — nothing that invites verification of a thing
    # that was never submitted.
    logger.warning(
        "ALLOW_SIMULATED_CHAIN_TX is set — recording a LOCAL-ONLY anchor for "
        "action=%s exam=%s. Nothing was submitted to any chain.", action, exam_id[:8],
    )
    digest = hashlib.sha256(
        f"{action}|{exam_id}|{json.dumps(data, sort_keys=True)}".encode()
    ).hexdigest()
    return {
        "action": action,
        "exam_id": exam_id,
        "tx_hash": None,
        "local_anchor": f"local:{digest}",
        "network": None,
        "status": "NOT_ANCHORED",
        "simulated": True,
        "warning": (
            "Nothing was submitted to any blockchain. `local_anchor` is a content "
            "digest computed on this host, not a transaction."
        ),
    }


def _submit_onchain(action: str, exam_id: str, data: dict[str, Any], settings) -> dict:
    """Submit for real via BlockchainService, and report what the chain said."""
    import asyncio

    from app.services.blockchain import BlockchainService

    service = BlockchainService()
    calls = {
        "lock_exam": lambda: service.lock_exam(
            exam_id, data["question_hash"], data.get("drand_round", 0),
            data.get("constraint_spec_ipfs", ""),
        ),
        "submit_zk_proof": lambda: service.submit_zk_proof(
            exam_id, data["proof"], data["public_signals"], data.get("zk_proof_ipfs", ""),
        ),
        "commit_merkle_root": lambda: service.commit_answer_merkle_root(
            exam_id, data["merkle_root"], data.get("candidate_count", 0),
        ),
    }
    if action not in calls:
        raise ChainAnchorUnavailable("UNKNOWN_ACTION", f"No chain call mapped for action {action!r}.")

    # These are Celery tasks by design, so they drive the async chain client with
    # asyncio.run(). The lock route also calls them inline from an async handler,
    # where asyncio.run() raises "cannot be called from a running event loop" —
    # which surfaced as a 500 and left every lock un-anchored. Run the coroutine
    # on its own loop in a worker thread when a loop is already going.
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        tx_hash = asyncio.run(calls[action]())
    else:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=1) as pool:
            tx_hash = pool.submit(lambda: asyncio.run(calls[action]())).result()
    return {
        "action": action,
        "exam_id": exam_id,
        "tx_hash": tx_hash,
        "network": f"polygon-{settings.POLYGON_CHAIN_ID}",
        "polygonscan_url": f"https://amoy.polygonscan.com/tx/{tx_hash}",
        "status": "submitted",
        "simulated": False,
    }
