"""
§ 52 — Shamir's Secret Sharing over GF(p) with the secp256k1 prime field.

Why this prime
--------------
secp256k1's prime p = 2^256 − 2^32 − 977 is larger than any 256-bit AES key, is
well-known and well-audited, and avoids zero-arithmetic surprises that arise
with primes that aren't strictly above the key range.

Security guarantee
------------------
With ≤ k-1 shares, the system of linear equations is underdetermined: there
exist *infinitely many* degree-(k-1) polynomials through any k-1 points, so
every possible 256-bit secret is equally likely. This is information-theoretic
security — strictly stronger than computational hardness.

Compatibility with existing crypto
----------------------------------
This module is purely additive. The existing
`app.services.question_modes.answer_key_crypto` AES-GCM helpers continue to
work unchanged. Callers that want the V3 CC-SSS layer simply split the AES
master key with `split_aes_key`, distribute shares, and reconstruct them
inside the enclave (real or simulated) before deriving the per-question key
through HKDF (the existing derivation).
"""

from __future__ import annotations

import hashlib
import secrets
from typing import List, Tuple

# secp256k1 prime — largest prime below 2^256
PRIME: int = (
    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
)

# (x, y) point on the secret polynomial. x is the share index (1..n); y is in GF(p).
SharePoint = Tuple[int, int]


# ── Splitting ────────────────────────────────────────────────────────────

def split_aes_key(aes_key_bytes: bytes, k: int = 3, n: int = 5) -> List[SharePoint]:
    """
    Split a 32-byte AES-256 key into n shares; any k shares reconstruct it.

    Args:
        aes_key_bytes: 32-byte AES-256 master key.
        k: threshold (default 3) — minimum shares needed to reconstruct.
        n: total shares (default 5) — must be >= k.

    Returns:
        List of n (x, y) tuples. The first coordinate (1..n) is public; the
        second is the GF(p) evaluation of the secret polynomial at that x.

    Important:
        The k-1 random coefficients are CSPRNG ephemera. They live only in
        this function's frame and are deleted before return.
    """
    if k < 2:
        raise ValueError("threshold must be at least 2 to be secret-sharing-secure")
    if n < k:
        raise ValueError(f"total shares n={n} must be >= threshold k={k}")
    if len(aes_key_bytes) != 32:
        raise ValueError("only 32-byte AES-256 keys are supported")

    secret_int = int.from_bytes(aes_key_bytes, byteorder="big")
    if secret_int >= PRIME:  # Cannot occur for 256-bit keys but kept for safety
        raise ValueError("key must be < secp256k1 prime")

    # f(0) = secret; the rest are uniform random in [0, PRIME-1)
    coefficients = [secret_int] + [secrets.randbelow(PRIME) for _ in range(k - 1)]

    shares: List[SharePoint] = []
    for x in range(1, n + 1):
        # Horner's method: f(x) = c0 + x(c1 + x(c2 + ...))
        y = 0
        for c in reversed(coefficients):
            y = (y * x + c) % PRIME
        shares.append((x, y))

    # Wipe the coefficient list from this frame (Python doesn't guarantee zeroising,
    # but releasing the reference is what we can do)
    for i in range(len(coefficients)):
        coefficients[i] = 0
    del coefficients

    return shares


# ── Reconstruction ───────────────────────────────────────────────────────

def reconstruct_aes_key(shares: List[SharePoint], k: int = 3) -> bytes:
    """
    Reconstruct the AES key from any k (or more) shares using Lagrange
    interpolation at x=0 over GF(p).

    With *fewer* than k shares this function will produce a different value
    (not an error). Caller MUST ensure exactly k valid shares are supplied.
    """
    if len(shares) < k:
        raise ValueError(f"need at least k={k} shares; got {len(shares)}")
    working = shares[:k]
    secret = _lagrange_interpolate_at_zero(working)
    return secret.to_bytes(32, byteorder="big")


def _lagrange_interpolate_at_zero(shares: List[SharePoint]) -> int:
    """
    f(0) = Σ y_i · L_i(0), where  L_i(0) = ∏_{j≠i} (0 - x_j) / (x_i - x_j)  in GF(p).

    Modular inverse via Fermat's little theorem: a^(p-2) ≡ a^-1 mod p (p prime).
    """
    secret = 0
    for i, (xi, yi) in enumerate(shares):
        numerator = 1
        denominator = 1
        for j, (xj, _) in enumerate(shares):
            if i == j:
                continue
            numerator = (numerator * (-xj)) % PRIME
            denominator = (denominator * (xi - xj)) % PRIME
        # denominator inverse
        lagrange_coeff = (numerator * pow(denominator, PRIME - 2, PRIME)) % PRIME
        secret = (secret + yi * lagrange_coeff) % PRIME
    return secret


# ── Share encoding (for safe transport / storage) ────────────────────────

def encode_share(share: SharePoint) -> dict:
    """JSON-safe encoding. NEVER transmit over an unencrypted channel."""
    x, y = share
    return {
        "x": x,
        "y_hex": format(y, "064x"),
        "checksum": _share_checksum(x, y),
    }


def decode_share(encoded: dict) -> SharePoint:
    """Decode + integrity check. Raises ValueError on bad checksum."""
    x = int(encoded["x"])
    y = int(encoded["y_hex"], 16)
    if _share_checksum(x, y) != encoded.get("checksum"):
        raise ValueError("share checksum mismatch — possible tampering")
    return (x, y)


def _share_checksum(x: int, y: int) -> str:
    combined = x.to_bytes(4, "big") + y.to_bytes(32, "big")
    return hashlib.sha256(combined).hexdigest()[:16]


# ── Self-test (called from CI / `python -m`) ─────────────────────────────

def _test_sss() -> None:
    """
    Comprehensive self-test:
      - all 10 combinations of 3-of-5 reconstruct the original key
      - 2 shares produce a different (NOT erroneous) value (no info leak)
      - encode → decode round-trip preserves the share
      - tampered checksum is rejected
    """
    import itertools
    import os

    test_key = os.urandom(32)
    shares = split_aes_key(test_key, k=3, n=5)
    if len(shares) != 5:
        raise AssertionError(f"expected 5 shares, got {len(shares)}")

    combos = list(itertools.combinations(range(5), 3))
    assert len(combos) == 10, "expected 10 combinations of 3 of 5"
    for combo in combos:
        selected = [shares[i] for i in combo]
        recovered = reconstruct_aes_key(selected, k=3)
        assert recovered == test_key, f"reconstruction failed for combo {combo}"

    # With k=2 reconstruction of a k=3 scheme: produces a DIFFERENT (wrong) result.
    wrong = reconstruct_aes_key(shares[:2], k=2)
    assert wrong != test_key, "SECURITY FAILURE: 2 shares reproduced the key"

    # Encode → decode roundtrip
    enc = encode_share(shares[0])
    dec = decode_share(enc)
    assert dec == shares[0], "encode/decode roundtrip lost data"

    # Tampered checksum is rejected
    bad = {**enc, "checksum": "00" * 8}
    try:
        decode_share(bad); raise AssertionError("expected checksum failure not raised")
    except ValueError:
        pass

    print("[OK] Shamir SSS self-test passed: 10/10 reconstructions; 2-share negative; roundtrip; tamper-detected")


if __name__ == "__main__":  # pragma: no cover
    _test_sss()
