"""
CryptoExam Core — SHA-256 Merkle Tree Unit Tests
§ 14.2 — test_merkle.py

Tests the core invariants:
  1. Tree construction is deterministic
  2. Inclusion proofs verify correctly for all leaves
  3. Modified answers produce different leaf hashes
  4. Tampered proofs fail verification
  5. Single-leaf tree works correctly
  6. Power-of-2 padding is correct
  7. Root changes when any leaf changes (immutability guarantee)
"""

import hashlib
import json
import pytest
from crypto.merkle import (
    generate_leaf,
    build_tree,
    verify_inclusion,
    get_merkle_proof,
    root_hex,
    _hash_pair,
)


# ── Sample Data ──

CANDIDATES = [
    {
        "candidate_id": f"cand-{i:04d}",
        "exam_id": "exam-neet-2025",
        "answers": {f"q{j}": ["A", "B", "C", "D"][j % 4] for j in range(1, 31)},
        "timestamp": 1700000000.0 + i,
    }
    for i in range(20)
]


class TestGenerateLeaf:
    """Tests for Merkle leaf generation."""

    def test_deterministic(self):
        """Same inputs must produce the same leaf hash."""
        c = CANDIDATES[0]
        leaf1 = generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
        leaf2 = generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
        assert leaf1 == leaf2

    def test_leaf_is_32_bytes(self):
        """Leaf hash must be 32 bytes (SHA-256)."""
        c = CANDIDATES[0]
        leaf = generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
        assert len(leaf) == 32

    def test_different_answers_different_leaf(self):
        """Different answers must produce different leaf hashes."""
        c = CANDIDATES[0]
        leaf1 = generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])

        modified_answers = dict(c["answers"])
        modified_answers["q1"] = "D"  # Change one answer
        leaf2 = generate_leaf(c["candidate_id"], c["exam_id"], modified_answers, c["timestamp"])

        assert leaf1 != leaf2, "Modified answers must produce different leaf"

    def test_different_candidate_different_leaf(self):
        """Different candidate IDs must produce different leaves."""
        c = CANDIDATES[0]
        leaf1 = generate_leaf("cand-0001", c["exam_id"], c["answers"], c["timestamp"])
        leaf2 = generate_leaf("cand-9999", c["exam_id"], c["answers"], c["timestamp"])
        assert leaf1 != leaf2

    def test_different_timestamp_different_leaf(self):
        """Different timestamps must produce different leaves."""
        c = CANDIDATES[0]
        leaf1 = generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], 1700000000.0)
        leaf2 = generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], 1700000001.0)
        assert leaf1 != leaf2

    def test_answer_order_independence(self):
        """Answer dict order must not affect leaf hash (sort_keys=True)."""
        c = CANDIDATES[0]
        answers_a = {"q1": "A", "q2": "B", "q3": "C"}
        answers_b = {"q3": "C", "q1": "A", "q2": "B"}

        leaf1 = generate_leaf(c["candidate_id"], c["exam_id"], answers_a, c["timestamp"])
        leaf2 = generate_leaf(c["candidate_id"], c["exam_id"], answers_b, c["timestamp"])
        assert leaf1 == leaf2


class TestBuildTree:
    """Tests for Merkle tree construction."""

    def test_single_leaf(self):
        """Tree with one leaf must still work."""
        c = CANDIDATES[0]
        leaf = generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
        root, proofs = build_tree([leaf])

        assert len(root) == 32
        assert 0 in proofs

    def test_two_leaves(self):
        """Tree with two leaves — simplest meaningful tree."""
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES[:2]
        ]
        root, proofs = build_tree(leaves)

        assert len(root) == 32
        assert 0 in proofs
        assert 1 in proofs

        # Root should be hash of the two leaves
        expected_root = _hash_pair(leaves[0], leaves[1])
        assert root == expected_root

    def test_power_of_two_padding(self):
        """Non-power-of-2 leaf count must be padded correctly."""
        # 3 leaves → padded to 4
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES[:3]
        ]
        root, proofs = build_tree(leaves)

        assert len(root) == 32
        assert len(proofs) == 3

    def test_twenty_candidates(self):
        """Tree with 20 candidates (padded to 32)."""
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES
        ]
        root, proofs = build_tree(leaves)

        assert len(root) == 32
        assert len(proofs) == 20

    def test_deterministic_root(self):
        """Same leaves must produce the same root."""
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES[:5]
        ]
        root1, _ = build_tree(leaves)
        root2, _ = build_tree(leaves)
        assert root1 == root2

    def test_root_changes_with_modified_leaf(self):
        """Changing any single leaf must change the root (immutability guarantee)."""
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES[:8]
        ]
        root_original, _ = build_tree(leaves)

        # Modify one candidate's answers
        modified_answers = dict(CANDIDATES[3]["answers"])
        modified_answers["q5"] = "D"
        leaves_modified = list(leaves)
        leaves_modified[3] = generate_leaf(
            CANDIDATES[3]["candidate_id"],
            CANDIDATES[3]["exam_id"],
            modified_answers,
            CANDIDATES[3]["timestamp"],
        )
        root_modified, _ = build_tree(leaves_modified)

        assert root_original != root_modified, (
            "Root must change when any leaf changes — "
            "this is the core immutability guarantee"
        )

    def test_empty_leaves_rejected(self):
        """Empty leaf list must raise ValueError."""
        with pytest.raises(ValueError, match="empty"):
            build_tree([])


class TestVerifyInclusion:
    """Tests for Merkle inclusion proof verification."""

    def test_all_leaves_verify(self):
        """Every leaf must have a valid inclusion proof."""
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES
        ]
        root, proofs = build_tree(leaves)

        for idx, leaf in enumerate(leaves):
            assert verify_inclusion(leaf, proofs[idx], root), (
                f"Inclusion proof failed for leaf {idx}"
            )

    def test_tampered_leaf_fails(self):
        """Tampered leaf must fail inclusion verification."""
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES[:8]
        ]
        root, proofs = build_tree(leaves)

        # Tamper with a leaf
        tampered_leaf = bytes([b ^ 0xFF for b in leaves[0]])
        assert not verify_inclusion(tampered_leaf, proofs[0], root)

    def test_wrong_proof_path_fails(self):
        """Using another candidate's proof path must fail."""
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES[:8]
        ]
        root, proofs = build_tree(leaves)

        # Leaf 0 with proof path of leaf 3
        assert not verify_inclusion(leaves[0], proofs[3], root)

    def test_wrong_root_fails(self):
        """Verification against a different root must fail."""
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES[:4]
        ]
        root, proofs = build_tree(leaves)

        fake_root = bytes(32)  # All zeros
        assert not verify_inclusion(leaves[0], proofs[0], fake_root)

    def test_tampered_proof_sibling_fails(self):
        """Modifying a sibling hash in the proof path must fail."""
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES[:4]
        ]
        root, proofs = build_tree(leaves)

        tampered_path = list(proofs[0])
        tampered_path[0] = {
            'hash': '00' * 32,  # Fake sibling hash
            'position': tampered_path[0]['position'],
        }
        assert not verify_inclusion(leaves[0], tampered_path, root)


class TestGetMerkleProof:
    """Tests for the high-level proof generation function."""

    def test_proof_verifies(self):
        """get_merkle_proof result must verify against the tree root."""
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES[:10]
        ]

        proof = get_merkle_proof(
            CANDIDATES[5]["candidate_id"],
            CANDIDATES[5]["exam_id"],
            CANDIDATES[5]["answers"],
            CANDIDATES[5]["timestamp"],
            leaves,
        )

        assert verify_inclusion(proof.leaf, proof.path, proof.root)
        assert proof.leaf_index == 5

    def test_missing_candidate_raises(self):
        """Requesting proof for a non-existent candidate must raise."""
        leaves = [
            generate_leaf(c["candidate_id"], c["exam_id"], c["answers"], c["timestamp"])
            for c in CANDIDATES[:5]
        ]

        with pytest.raises(ValueError, match="not found"):
            get_merkle_proof("nonexistent", "exam-neet-2025", {}, 0.0, leaves)


class TestRootHex:
    """Tests for root formatting."""

    def test_hex_format(self):
        """root_hex must return 0x-prefixed 64-char hex string."""
        root = bytes(range(32))
        hex_str = root_hex(root)
        assert hex_str.startswith("0x")
        assert len(hex_str) == 66  # 0x + 64 hex chars
