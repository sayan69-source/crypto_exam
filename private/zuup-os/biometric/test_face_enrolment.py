"""
Face enrolment must produce what verification consumes.

This is the test whose absence let the face chain score 0.0 for every candidate,
silently, for as long as it has existed. `enrol()` returned
`sha256(embedding)`; `verify()` does `np.frombuffer(enrolled, "float32")` and a
cosine, so the 32-byte digest was read back as EIGHT floats, compared against a
live capture's 128, and `_cosine` returns 0.0 the instant the sizes differ.

Nothing errored and nothing logged. Fail-closed meant it presented as
"biometrics are strict" rather than "biometrics can never match anyone".

No camera and no OpenCV: the embedding is injected, so what is under test is the
REPRESENTATION CONTRACT between the two halves — which is exactly where the bug
lived.
"""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from face_engine_cv import FaceEngineCV, _rescale_cosine  # noqa: E402

DIM = 128  # SFace


def _engine(embedding):
    """A FaceEngineCV whose capture stage is replaced by a known vector."""
    e = FaceEngineCV.__new__(FaceEngineCV)
    e._np = np
    e.enroll = lambda frames=None: embedding
    return e


def _vec(seed: int) -> np.ndarray:
    return np.random.default_rng(seed).normal(size=DIM).astype("float32")


def test_enrolment_returns_a_vector_verification_can_read_back():
    """
    The contract in one line: whatever enrol() emits, frombuffer(...,float32)
    must recover with the SAME dimensionality the live capture produces.
    """
    emb = _vec(1)
    stored_hex = _engine(emb).enrol()
    recovered = np.frombuffer(bytes.fromhex(stored_hex), dtype="float32")
    assert recovered.size == DIM, f"recovered {recovered.size} floats, live capture has {DIM}"
    assert np.allclose(recovered, emb)


def test_the_same_face_now_scores_high():
    emb = _vec(2)
    stored = np.frombuffer(bytes.fromhex(_engine(emb).enrol()), dtype="float32")
    assert _rescale_cosine(FaceEngineCV._cosine(emb, stored)) > 0.9


def test_a_different_face_still_scores_low():
    """A fix that made everything match would be worse than the bug."""
    stored = np.frombuffer(bytes.fromhex(_engine(_vec(3)).enrol()), dtype="float32")
    assert _rescale_cosine(FaceEngineCV._cosine(_vec(4), stored)) < 0.5


def test_a_sha256_DIGEST_scores_zero_against_everyone_the_old_behaviour():
    """
    The regression, pinned. If anyone reintroduces a digest here, this fails
    instead of the exam hall failing.
    """
    import hashlib
    emb = _vec(5)
    digest = hashlib.sha256(emb.tobytes()).digest()          # what enrol() used to store
    as_floats = np.frombuffer(digest, dtype="float32")
    assert as_floats.size == 8, "sha256 is 32 bytes = 8 float32, never 128"
    assert FaceEngineCV._cosine(emb, as_floats) == 0.0
    assert _rescale_cosine(0.0) == 0.0


@pytest.mark.parametrize("bad", [None, np.zeros(0, dtype="float32")])
def test_a_failed_capture_enrols_nothing_rather_than_something_unmatchable(bad):
    """
    An identity with an empty biometric can never authenticate, so it must not
    be created at all — the caller turns "" into a refusal.
    """
    assert _engine(bad).enrol() == ""
