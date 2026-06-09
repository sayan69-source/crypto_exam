"""
CryptoExam Core — Per-Question Sealing & Lazy Decryption
§ 10.7 — TCS-iON-style on-demand question delivery.

WHY THIS EXISTS
---------------
The original pipeline (`engine.crypto_engine.encrypt_paper`) seals the *whole*
paper as a single AES-GCM blob and decrypts it all at once at T₀. That is fine
for integrity, but it means the entire paper is in plaintext in the candidate's
RAM for the whole exam.

This module adds a finer-grained layer used by the candidate terminal: every
question is sealed under its **own** key, and a question is decrypted **only at
the moment the candidate opens it** — exactly how TCS iON reveals one question
at a time. At any instant only the question currently on screen need exist in
plaintext; the rest stay as ciphertext the terminal physically cannot read yet.

THE CHAIN OF CUSTODY (setter ──► chain ──► candidate)
-----------------------------------------------------
  1. SEAL    — for each question i:  k_i = HKDF(masterSeed, info="q:"+id)
               sealed_i = AES-GCM-256(k_i, plaintext_i)
               leaf_i   = SHA256(id ‖ iv ‖ ct ‖ tag)
               questionsRoot = MerkleRoot({leaf_i})
  2. COMMIT  — questionsRoot is committed on-chain (see services/blockchain.py
               → contract `lockExam`). The blockchain is the transfer ledger:
               anyone can later prove the delivered set is exactly the sealed set.
  3. DELIVER — the bundle {sealed_i, proof_i, questionsRoot} is pre-positioned
               on the terminal. It carries NO keys — it is inert before T₀.
  4. DECRYPT — at T₀ the terminal derives `masterSeed` from the public drand
               beacon (same online path the whole-paper flow already uses). When
               the candidate selects question i, and ONLY then, the terminal
               derives k_i, decrypts sealed_i, and verifies leaf_i against the
               on-chain questionsRoot before rendering.

KEY-DERIVATION SCHEME (must match the WebCrypto implementation in
`public/frontend/lib/exam/question-pipeline.ts`)
  masterSeed   = HKDF-SHA256(master=beacon, salt=hkdfSalt, info="cryptoexam:"+examId, L=32)
  questionKey  = HKDF-SHA256(master=masterSeed, salt=examId, info="cryptoexam:q:"+id, L=32)
  cipher       = AES-GCM-256, 12-byte IV, 16-byte tag
  leaf         = SHA256(utf8(id) ‖ iv ‖ ct ‖ tag)

INVARIANTS
  • The correct answer is NEVER part of a sealed question — grading material
    stays server-side. Only candidate-facing fields are sealed.
  • `masterSeed` and any `questionKey` are transient; callers must not persist
    them. Only hashes/commitments are safe to store.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Any

from Crypto.Cipher import AES
from Crypto.Protocol.KDF import HKDF
from Crypto.Hash import SHA256

from crypto.merkle import build_tree, verify_inclusion

# Fields a candidate is allowed to see. Everything else (correct_option,
# rejection_reason, irt_*, internal flags) is stripped before sealing.
CANDIDATE_FIELDS = (
    "id", "sequence_number", "set_label",
    "text", "text_hi", "text_regional",
    "options", "options_hi", "options_regional",
    "subject", "topic", "marks",
)

MASTER_INFO = "cryptoexam:"
QUESTION_INFO = "cryptoexam:q:"


# ════════════════════════════════════════════════════════════════════════
# Key derivation
# ════════════════════════════════════════════════════════════════════════

def derive_master_seed(beacon: bytes, hkdf_salt: bytes, exam_id: str) -> bytes:
    """
    Derive the 32-byte exam master seed from the T₀ drand beacon material.

    This is the single secret released at T₀. Before T₀ the beacon does not
    exist, so the master seed — and therefore every per-question key — is
    underivable. This mirrors the online path in `crypto_engine`.
    """
    return HKDF(
        master=beacon,
        key_len=32,
        salt=hkdf_salt,
        hashmod=SHA256,
        context=(MASTER_INFO + exam_id).encode("utf-8"),
    )


def derive_question_key(master_seed: bytes, exam_id: str, question_id: str) -> bytes:
    """Derive the per-question 32-byte AES key. Unique per (exam, question)."""
    return HKDF(
        master=master_seed,
        key_len=32,
        salt=exam_id.encode("utf-8"),
        hashmod=SHA256,
        context=(QUESTION_INFO + question_id).encode("utf-8"),
    )


# ════════════════════════════════════════════════════════════════════════
# Single-question seal / unseal
# ════════════════════════════════════════════════════════════════════════

def _candidate_view(question: dict) -> dict:
    """Project a question down to the fields a candidate may see."""
    return {k: question[k] for k in CANDIDATE_FIELDS if k in question}


def seal_one(plaintext: dict, key: bytes) -> dict:
    """AES-GCM-256 seal a single question payload. Returns hex components."""
    iv = os.urandom(12)
    cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
    data = json.dumps(plaintext, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ct, tag = cipher.encrypt_and_digest(data)
    return {"iv": iv.hex(), "ct": ct.hex(), "tag": tag.hex()}


def unseal_one(sealed: dict, key: bytes) -> dict:
    """
    Decrypt a single sealed question. Raises ValueError on tag mismatch
    (i.e. the ciphertext was altered in transit / at rest).
    """
    iv = bytes.fromhex(sealed["iv"])
    ct = bytes.fromhex(sealed["ct"])
    tag = bytes.fromhex(sealed["tag"])
    cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
    try:
        plaintext = cipher.decrypt_and_verify(ct, tag)
    except ValueError as e:
        raise ValueError(
            "Question decryption failed: authentication tag mismatch — "
            "the sealed question was tampered with."
        ) from e
    return json.loads(plaintext.decode("utf-8"))


def question_leaf(question_id: str, sealed: dict) -> bytes:
    """
    Merkle leaf binding the question id to its exact ciphertext.

    leaf = SHA256(utf8(id) ‖ iv ‖ ct ‖ tag)

    Any change to the delivered ciphertext changes the leaf, which breaks the
    inclusion proof against the on-chain root — tamper-evident delivery.
    """
    h = hashlib.sha256()
    h.update(question_id.encode("utf-8"))
    h.update(bytes.fromhex(sealed["iv"]))
    h.update(bytes.fromhex(sealed["ct"]))
    h.update(bytes.fromhex(sealed["tag"]))
    return h.digest()


# ════════════════════════════════════════════════════════════════════════
# Whole-exam sealing → deliverable bundle
# ════════════════════════════════════════════════════════════════════════

@dataclass
class SealedBundle:
    """The inert, keyless artifact that is pre-positioned on the terminal."""
    exam_id: str
    questions_root: str                 # 0x-prefixed hex — committed on-chain
    count: int
    items: list[dict] = field(default_factory=list)
    # items[i] = {question_id, sequence_number, iv, ct, tag, leaf, proof}

    def to_dict(self) -> dict:
        return {
            "examId": self.exam_id,
            "questionsRoot": self.questions_root,
            "count": self.count,
            "items": self.items,
        }


def seal_exam_questions(
    questions: list[dict],
    master_seed: bytes,
    exam_id: str,
) -> SealedBundle:
    """
    Seal every question and assemble the deliverable bundle.

    `questions` are the setter's full question dicts (must include a unique
    "id"). Only candidate-facing fields are sealed; grading material is dropped.

    Returns a `SealedBundle` whose `questions_root` is the value to commit
    on-chain. The bundle contains, per question, the ciphertext and its Merkle
    inclusion proof — everything the terminal needs to verify a question at the
    moment it is opened, and nothing it could use to read ahead.
    """
    if not questions:
        raise ValueError("Cannot seal an empty question set")

    sealed_list: list[dict] = []
    leaves: list[bytes] = []
    for q in questions:
        qid = str(q["id"])
        key = derive_question_key(master_seed, exam_id, qid)
        sealed = seal_one(_candidate_view(q), key)
        # best-effort: drop the derived key reference promptly
        del key
        leaf = question_leaf(qid, sealed)
        sealed_list.append({
            "question_id": qid,
            "sequence_number": q.get("sequence_number"),
            **sealed,
            "leaf": leaf.hex(),
        })
        leaves.append(leaf)

    root, proofs = build_tree(leaves)

    items = []
    for idx, s in enumerate(sealed_list):
        items.append({**s, "proof": proofs[idx]})

    return SealedBundle(
        exam_id=exam_id,
        questions_root="0x" + root.hex(),
        count=len(items),
        items=items,
    )


def open_question(
    bundle_item: dict,
    master_seed: bytes,
    exam_id: str,
    questions_root: str,
) -> dict:
    """
    The lazy-decryption entry point — called once, when the candidate opens
    a single question.

    Steps (all client-side on the terminal):
      1. Verify the sealed ciphertext is part of the on-chain `questions_root`.
      2. Derive this question's key from the T₀ master seed.
      3. Decrypt and return the plaintext question.

    Raises ValueError if the question fails its Merkle proof (it is not part of
    the committed set) or fails AES-GCM verification (it was altered).
    """
    qid = str(bundle_item["question_id"])

    # 1. integrity: does this exact ciphertext belong to the committed set?
    leaf = question_leaf(qid, bundle_item)
    root_bytes = bytes.fromhex(questions_root[2:] if questions_root.startswith("0x") else questions_root)
    if not verify_inclusion(leaf, bundle_item["proof"], root_bytes):
        raise ValueError(
            f"Question {qid[:8]}… is not part of the on-chain committed set "
            "(Merkle proof failed). Refusing to render a question the chain "
            "never sealed."
        )

    # 2 + 3: derive key on demand and decrypt just this one question
    key = derive_question_key(master_seed, exam_id, qid)
    try:
        return unseal_one(bundle_item, key)
    finally:
        del key
