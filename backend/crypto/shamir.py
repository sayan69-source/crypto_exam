"""
CryptoExam Core — Shamir's Secret Sharing (SSS)
§ 10.3 — K-of-N key splitting for exam paper master key.

Workflow:
  1. AI generates paper in-memory → AES-256 master key created
  2. Master key split into N shards (default: 5)
  3. Each shard given to one designated official (NTA/exam board member)
  4. K officials (default: 3) authenticate simultaneously
  5. Shards combined → master key recovered → paper decrypted for ZK commitment

Security properties:
  - Even if (K-1) officials collude, they cannot recover the key
  - Even if 1 official's device is compromised, it is useless without K-1 more
  - Each shard is independently random — no information about the secret leaks
  - Only the HASH of each shard is stored in the database — never the raw shard

Implementation: GF(2^256) polynomial evaluation over a finite field.
This is a pure Python implementation avoiding the dependency on the
`secretsharing` PyPI package which has compatibility issues with Python 3.12.
"""

import hashlib
import os
import secrets
from typing import NamedTuple


# Mersenne prime for our finite field — large enough for 256-bit secrets
_PRIME = 2**521 - 1  # 13th Mersenne prime (M521)


class ShamirShard(NamedTuple):
    """A single shard of a Shamir split."""
    index: int       # 1-indexed shard number
    value: str       # Hex-encoded shard value
    hash: bytes      # SHA-256 hash of the shard (stored in DB, never the raw value)


class ShamirPaperGuardian:
    """
    Shamir's Secret Sharing for exam paper key management.

    Splits a master key into N shards such that any K shards
    can reconstruct the key, but fewer than K shards reveal
    nothing about the key.

    Based on polynomial interpolation over GF(p) where p is
    a large Mersenne prime.
    """

    @staticmethod
    def _mod_inverse(a: int, p: int) -> int:
        """Modular multiplicative inverse using extended Euclidean algorithm."""
        if a < 0:
            a = a % p
        g, x, _ = ShamirPaperGuardian._extended_gcd(a, p)
        if g != 1:
            raise ValueError("Modular inverse does not exist")
        return x % p

    @staticmethod
    def _extended_gcd(a: int, b: int) -> tuple[int, int, int]:
        """Extended Euclidean Algorithm."""
        if a == 0:
            return b, 0, 1
        gcd, x1, y1 = ShamirPaperGuardian._extended_gcd(b % a, a)
        x = y1 - (b // a) * x1
        y = x1
        return gcd, x, y

    @staticmethod
    def _eval_polynomial(coefficients: list[int], x: int, prime: int) -> int:
        """Evaluate polynomial at point x over GF(prime)."""
        result = 0
        for coeff in reversed(coefficients):
            result = (result * x + coeff) % prime
        return result

    @staticmethod
    def split(key: bytes, n: int = 5, k: int = 3) -> list[ShamirShard]:
        """
        Split a secret key into N shards with threshold K.

        Args:
            key: The master key to split (any length, typically 32 bytes).
            n: Total number of shards to generate.
            k: Minimum shards required to reconstruct (threshold).

        Returns:
            List of N ShamirShard objects.

        Raises:
            ValueError: If k > n or k < 2.
        """
        if k > n:
            raise ValueError(f"Threshold {k} cannot exceed total shards {n}")
        if k < 2:
            raise ValueError("Threshold must be at least 2")
        if not key:
            raise ValueError("Key cannot be empty")

        # Convert key to integer (secret = coefficients[0])
        secret = int.from_bytes(key, 'big')

        # Generate random coefficients for polynomial of degree (k-1)
        # coefficients[0] = secret, rest are random
        coefficients = [secret]
        for _ in range(k - 1):
            coefficients.append(secrets.randbelow(_PRIME))

        # Evaluate polynomial at points x=1, x=2, ..., x=n
        shards = []
        for i in range(1, n + 1):
            value = ShamirPaperGuardian._eval_polynomial(coefficients, i, _PRIME)
            value_hex = hex(value)[2:]  # Remove '0x' prefix
            shard_hash = hashlib.sha256(value_hex.encode()).digest()
            shards.append(ShamirShard(
                index=i,
                value=value_hex,
                hash=shard_hash,
            ))

        return shards

    @staticmethod
    def combine(shards: list[tuple[int, str]], key_length: int = 32) -> bytes:
        """
        Reconstruct the secret key from K or more shards.

        Uses Lagrange interpolation over GF(prime) to recover
        the polynomial's constant term (the secret).

        Args:
            shards: List of (index, value_hex) tuples. At least K required.
            key_length: Expected length of the key in bytes.

        Returns:
            The reconstructed master key.

        Raises:
            ValueError: If fewer than 2 shards provided.
        """
        if len(shards) < 2:
            raise ValueError("At least 2 shards required for reconstruction")

        # Parse shards
        points = [(idx, int(val, 16)) for idx, val in shards]

        # Lagrange interpolation at x=0 to recover the secret
        secret = 0
        for i, (xi, yi) in enumerate(points):
            # Compute Lagrange basis polynomial at x=0
            numerator = 1
            denominator = 1
            for j, (xj, _) in enumerate(points):
                if i != j:
                    numerator = (numerator * (-xj)) % _PRIME
                    denominator = (denominator * (xi - xj)) % _PRIME

            lagrange = (
                yi * numerator * ShamirPaperGuardian._mod_inverse(denominator, _PRIME)
            ) % _PRIME
            secret = (secret + lagrange) % _PRIME

        return secret.to_bytes(key_length, 'big')

    @staticmethod
    def shard_hash(shard_value: str) -> bytes:
        """
        Compute SHA-256 hash of a shard value.
        This hash is stored in the database — never the raw shard.
        """
        return hashlib.sha256(shard_value.encode()).digest()

    @staticmethod
    def verify_shard(shard_value: str, expected_hash: bytes) -> bool:
        """
        Verify a shard against its stored hash.
        Used when an official submits their shard for key reconstruction.
        """
        return hashlib.sha256(shard_value.encode()).digest() == expected_hash
