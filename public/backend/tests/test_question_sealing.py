"""
Tests for the per-question sealing / lazy-decryption pipeline.

Runnable standalone (no DB / no network):
    python -m pytest backend/tests/test_question_sealing.py -q
    # or, without pytest:
    python backend/tests/test_question_sealing.py

Proves the full chain of custody:
  seal ─► commit(root) ─► deliver(keyless bundle) ─► lazy open ─► verify
and that any tampering (with the ciphertext, the proof, or the key) is caught.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# allow `import crypto.*` whether run from repo root or backend/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from crypto.question_sealing import (  # noqa: E402
    derive_master_seed,
    derive_question_key,
    seal_exam_questions,
    open_question,
    question_leaf,
)

EXAM_ID = "e1a2b3c4-5678-90ab-cdef-1234567890ab"


def _questions(n: int = 5) -> list[dict]:
    return [
        {
            "id": f"q{i}-0000-0000-0000-00000000000{i}",
            "sequence_number": i,
            "text": f"Question {i}: what is {i} + {i}?",
            "options": {"A": str(2 * i), "B": str(2 * i + 1), "C": "0", "D": "9"},
            "correct_option": "A",          # MUST NOT appear in the sealed bundle
            "subject": "Mathematics",
            "irt_b": 0.5,                    # internal — MUST NOT leak
        }
        for i in range(1, n + 1)
    ]


def _fresh_seed() -> tuple[bytes, bytes, bytes]:
    """Return (beacon, salt, master_seed) for a simulated T₀."""
    beacon = os.urandom(32)
    salt = os.urandom(16)
    seed = derive_master_seed(beacon, salt, EXAM_ID)
    return beacon, salt, seed


def test_seed_is_deterministic_from_beacon():
    beacon, salt, seed = _fresh_seed()
    again = derive_master_seed(beacon, salt, EXAM_ID)
    assert seed == again
    # different exam ⇒ different seed (context binding)
    assert derive_master_seed(beacon, salt, "other-exam") != seed


def test_per_question_keys_are_distinct():
    _, _, seed = _fresh_seed()
    qs = _questions(4)
    keys = {derive_question_key(seed, EXAM_ID, q["id"]) for q in qs}
    assert len(keys) == 4, "each question must get a unique key"


def test_bundle_carries_no_secrets():
    _, _, seed = _fresh_seed()
    qs = _questions(5)
    bundle = seal_exam_questions(qs, seed, EXAM_ID)
    blob = json.dumps(bundle.to_dict())
    # the answer and internal IRT data must never appear in the delivered bundle
    assert "correct_option" not in blob
    assert '"A"' not in json.dumps([i for i in bundle.items])  # no plaintext option leaked as answer
    assert "irt_b" not in blob
    assert "what is" not in blob, "question text must be ciphertext, not plaintext"
    assert bundle.questions_root.startswith("0x") and len(bundle.questions_root) == 66


def test_full_roundtrip_lazy_open():
    _, _, seed = _fresh_seed()
    qs = _questions(6)
    bundle = seal_exam_questions(qs, seed, EXAM_ID)

    # candidate opens questions one-by-one, in arbitrary order
    for idx in (3, 0, 5, 1):  # not sequential — like a real candidate jumping around
        item = bundle.items[idx]
        opened = open_question(item, seed, EXAM_ID, bundle.questions_root)
        assert opened["text"] == qs[idx]["text"]
        assert opened["options"] == qs[idx]["options"]
        # the answer is NOT in what the candidate receives
        assert "correct_option" not in opened
        assert "irt_b" not in opened


def test_tampered_ciphertext_is_rejected():
    _, _, seed = _fresh_seed()
    bundle = seal_exam_questions(_questions(3), seed, EXAM_ID)
    item = dict(bundle.items[1])

    # flip one byte of the ciphertext
    ct = bytearray.fromhex(item["ct"])
    ct[0] ^= 0x01
    item["ct"] = ct.hex()

    # the Merkle proof now fails (leaf changed) → refused before decryption
    try:
        open_question(item, seed, EXAM_ID, bundle.questions_root)
        assert False, "tampered question must be rejected"
    except ValueError as e:
        assert "Merkle proof failed" in str(e)


def test_wrong_seed_cannot_decrypt():
    """A terminal without the genuine T₀ beacon cannot open any question."""
    _, _, seed = _fresh_seed()
    bundle = seal_exam_questions(_questions(3), seed, EXAM_ID)
    _, _, wrong_seed = _fresh_seed()  # a different beacon

    item = bundle.items[0]
    try:
        open_question(item, wrong_seed, EXAM_ID, bundle.questions_root)
        assert False, "decryption with the wrong T₀ seed must fail"
    except ValueError as e:
        assert "tag mismatch" in str(e)


def test_question_cannot_be_swapped_in():
    """An attacker swapping in a question that was never sealed is caught."""
    _, _, seed = _fresh_seed()
    bundle = seal_exam_questions(_questions(3), seed, EXAM_ID)

    # forge a brand-new sealed question with a valid-looking structure
    forged_key = derive_question_key(seed, EXAM_ID, "forged-id")
    from crypto.question_sealing import seal_one
    forged = seal_one({"id": "forged-id", "text": "leaked?"}, forged_key)
    forged_item = {
        "question_id": "forged-id", "sequence_number": 99, **forged,
        "leaf": question_leaf("forged-id", forged).hex(),
        "proof": bundle.items[0]["proof"],  # borrow someone else's proof
    }
    try:
        open_question(forged_item, seed, EXAM_ID, bundle.questions_root)
        assert False, "a question outside the committed set must be rejected"
    except ValueError as e:
        assert "Merkle proof failed" in str(e)


# ── allow running without pytest ────────────────────────────────────────
if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  PASS  {fn.__name__}")
    print(f"\n{passed}/{len(fns)} question-sealing tests passed.")
