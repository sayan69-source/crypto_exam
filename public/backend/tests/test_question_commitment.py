"""
Golden vectors for the question commitment — the cross-language contract.

There are FOUR independent implementations of this one scheme:

  public/backend/crypto/question_sealing.py         (the production sealer)
  public/frontend/lib/exam/question-pipeline.ts     (the /pipeline demo)
  private/edge-server/src/lib/question-seal.ts      (LAN staging)
  private/exam-terminal/lib/question-crypto.ts      (the verifier at the seat)

The redundancy is deliberate — the terminal has to be able to check the sealer
without sharing its code — but it means a one-sided change breaks delivery
across the public↔private boundary with nothing to notice it until a real
candidate's paper is refused. Two such divergences had already happened:

  1. The leaf was `id ‖ iv ‖ ct ‖ tag` with no length prefixes, so sliding the
     id/iv boundary yielded a different question with the SAME leaf.
  2. The public side padded the tree to a power of two with ZERO leaves while
     the private side duplicated the last node — different roots for any count
     that is not a power of two.

These vectors pin the construction. The same constants are asserted from
TypeScript in edge-server's `question-commitment.test.ts`; if either side is
edited alone, one of the two suites goes red.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crypto.question_sealing import (  # noqa: E402
    build_question_tree,
    question_leaf,
    verify_question_inclusion,
)

# Deliberately an ODD count with VARIABLE-length ciphertexts — the two shapes
# that used to expose the divergence.
ITEMS = [
    {"id": "Q1", "iv": "11" * 12, "ct": "22" * 20, "tag": "33" * 16},
    {"id": "Q17", "iv": "44" * 12, "ct": "55" * 31, "tag": "66" * 16},
    {"id": "Q3", "iv": "77" * 12, "ct": "88" * 9, "tag": "99" * 16},
]

GOLDEN_LEAVES = [
    "0b65d1f51cc427c7",
    "fd17748babd4cd83",
    "cf431fd340ae77d2",
]
GOLDEN_ROOT = "82924401175822a92a0440745fd2c237bd23f381ed15531eb61b3cfabc35c4b0"


def _leaves():
    return [question_leaf(i["id"], i) for i in ITEMS]


def test_leaf_matches_the_cross_language_golden_vector():
    assert [leaf.hex()[:16] for leaf in _leaves()] == GOLDEN_LEAVES


def test_root_matches_the_cross_language_golden_vector():
    root, _ = build_question_tree(_leaves())
    assert root.hex() == GOLDEN_ROOT


def test_every_item_verifies_against_the_root():
    leaves = _leaves()
    root, proofs = build_question_tree(leaves)
    for idx, leaf in enumerate(leaves):
        assert verify_question_inclusion(leaf, proofs[idx], root), f"item {idx} did not verify"


def test_sliding_the_id_boundary_no_longer_collides():
    """The concrete forgery the old construction admitted."""
    honest = question_leaf("Q17", {"iv": "11" * 12, "ct": "22" * 40, "tag": "33" * 16})
    # "Q17" → "Q1", with the displaced "7" absorbed into iv and iv's last byte
    # into ct. Both tuples are structurally valid sealed items.
    forged = question_leaf("Q1", {"iv": "37" + "11" * 11, "ct": "11" + "22" * 40, "tag": "33" * 16})
    assert honest != forged


def test_a_leaf_preimage_cannot_impersonate_an_internal_node():
    """Merkle second preimage: a 64-byte leaf preimage must not equal a node."""
    import hashlib

    left = hashlib.sha256(b"L").digest()
    right = hashlib.sha256(b"R").digest()
    # id="" (0) + iv(12) + ct(36) + tag(16) = exactly 64 bytes = left‖right
    as_leaf = question_leaf(
        "",
        {
            "iv": left[:12].hex(),
            "ct": (left[12:] + right[:16]).hex(),
            "tag": right[16:32].hex(),
        },
    )
    assert as_leaf != hashlib.sha256(b"\x01" + left + right).digest()


def test_duplicate_last_node_does_not_alias_two_papers():
    """CVE-2012-2459: [A,B,C] and [A,B,C,C] must not share a root."""
    leaves = _leaves()
    three, _ = build_question_tree(leaves)
    four, _ = build_question_tree([*leaves, leaves[-1]])
    assert three != four
