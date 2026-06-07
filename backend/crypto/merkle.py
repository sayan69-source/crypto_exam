"""
CryptoExam Core — SHA-256 Binary Merkle Tree
§ 10.6 — Answer commitment with inclusion proofs.

Guarantee 3 — Answer records are mathematically immutable.

After all candidates submit, a Merkle tree is built from answer hashes.
The root is committed to Polygon PoS. Any post-commit modification
changes the root hash. Discrepancy is detectable by any observer
with a browser and the Polygonscan URL.

Each candidate receives a Merkle inclusion proof — cryptographic
evidence that their specific answers are part of the committed root.
This proof is court-admissible: the math is the affidavit.
"""

import hashlib
import json
from typing import NamedTuple


class MerkleProof(NamedTuple):
    """Inclusion proof for a single leaf in the Merkle tree."""
    leaf: bytes
    leaf_index: int
    path: list[dict]  # [{"hash": hex, "position": "left"|"right"}, ...]
    root: bytes


def generate_leaf(
    candidate_id: str,
    exam_id: str,
    answers: dict,
    timestamp: float,
) -> bytes:
    """
    Generate a Merkle leaf from a candidate's exam submission.

    The leaf binds candidate identity, exam identity, answers, and
    submission timestamp into a single SHA-256 hash.

    Args:
        candidate_id: UUID string of the candidate.
        exam_id: UUID string of the exam.
        answers: Dict of {question_id: selected_option}.
        timestamp: Unix timestamp of submission.

    Returns:
        32-byte SHA-256 leaf hash.

    Deterministic: same inputs always produce the same leaf.
    Sorted JSON keys ensure order-independence.
    """
    payload = (
        f"{candidate_id}|"
        f"{exam_id}|"
        f"{json.dumps(answers, sort_keys=True)}|"
        f"{timestamp}"
    )
    return hashlib.sha256(payload.encode('utf-8')).digest()


def _hash_pair(left: bytes, right: bytes) -> bytes:
    """Hash two 32-byte nodes into their parent node."""
    return hashlib.sha256(left + right).digest()


def build_tree(leaves: list[bytes]) -> tuple[bytes, dict[int, list[dict]]]:
    """
    Build a binary SHA-256 Merkle tree from a list of leaf hashes.

    The tree is padded to the next power of 2 with zero-filled leaves.
    This ensures a balanced binary tree for consistent proof paths.

    Args:
        leaves: List of 32-byte leaf hashes (one per candidate).

    Returns:
        Tuple of:
            - root: 32-byte Merkle root hash.
            - proofs: Dict mapping leaf index to inclusion proof path.

    The root is committed to the Polygon smart contract.
    Each candidate's proof path allows independent verification.
    """
    if not leaves:
        raise ValueError("Cannot build Merkle tree from empty leaf list")

    # Pad to next power of 2
    n = 1
    while n < len(leaves):
        n <<= 1
    padded = list(leaves) + [bytes(32)] * (n - len(leaves))

    # Build tree layers bottom-up
    tree_layers: list[list[bytes]] = [padded]
    current = padded
    while len(current) > 1:
        next_layer = []
        for i in range(0, len(current), 2):
            left = current[i]
            right = current[i + 1] if (i + 1) < len(current) else bytes(32)
            next_layer.append(_hash_pair(left, right))
        tree_layers.append(next_layer)
        current = next_layer

    root = tree_layers[-1][0]

    # Generate inclusion proofs for each original leaf
    proofs: dict[int, list[dict]] = {}
    for leaf_idx in range(len(leaves)):
        path: list[dict] = []
        pos = leaf_idx
        for layer in tree_layers[:-1]:
            # Sibling is the node paired with current position
            sibling_idx = pos ^ 1
            if sibling_idx < len(layer):
                sibling_hash = layer[sibling_idx]
            else:
                sibling_hash = bytes(32)

            path.append({
                'hash': sibling_hash.hex(),
                'position': 'right' if pos % 2 == 0 else 'left',
            })
            pos >>= 1

        proofs[leaf_idx] = path

    return root, proofs


def verify_inclusion(
    leaf: bytes,
    proof_path: list[dict],
    expected_root: bytes,
) -> bool:
    """
    Verify that a leaf is included in a Merkle tree with the given root.

    This can be run by ANYONE — candidate, journalist, RTI officer,
    court — without any access to the full tree or other candidates' data.

    Args:
        leaf: 32-byte leaf hash of the candidate's submission.
        proof_path: List of sibling hashes and positions from build_tree().
        expected_root: 32-byte Merkle root committed on-chain.

    Returns:
        True if the leaf is provably included in the committed root.
        False if the proof is invalid (indicating tampering or error).
    """
    current = leaf
    for step in proof_path:
        sibling = bytes.fromhex(step['hash'])
        if step['position'] == 'right':
            # Sibling is on the right; current is on the left
            current = _hash_pair(current, sibling)
        else:
            # Sibling is on the left; current is on the right
            current = _hash_pair(sibling, current)

    return current == expected_root


def get_merkle_proof(
    candidate_id: str,
    exam_id: str,
    answers: dict,
    timestamp: float,
    all_leaves: list[bytes],
) -> MerkleProof:
    """
    Generate a complete Merkle inclusion proof for a candidate.

    This is the proof included in the candidate's cryptographic receipt.
    It proves their specific answers are part of the committed root,
    without revealing any other candidate's data.

    Args:
        candidate_id: UUID of the candidate.
        exam_id: UUID of the exam.
        answers: The candidate's answers.
        timestamp: Submission timestamp.
        all_leaves: All leaf hashes in the tree.

    Returns:
        MerkleProof with leaf, index, path, and root.

    Raises:
        ValueError: If the candidate's leaf is not in the tree.
    """
    leaf = generate_leaf(candidate_id, exam_id, answers, timestamp)
    root, proofs = build_tree(all_leaves)

    # Find this candidate's leaf index
    try:
        leaf_index = all_leaves.index(leaf)
    except ValueError:
        raise ValueError(
            f"Candidate {candidate_id[:8]}... leaf not found in Merkle tree. "
            "This should never happen — investigate immediately."
        )

    return MerkleProof(
        leaf=leaf,
        leaf_index=leaf_index,
        path=proofs[leaf_index],
        root=root,
    )


def root_hex(root: bytes) -> str:
    """Format a Merkle root as a 0x-prefixed hex string (for smart contract)."""
    return '0x' + root.hex()
