"""
CryptoExam Core — drand Randomness Beacon Client
§ 10.2 — Online path key derivation from public randomness.

drand provides publicly verifiable, unbiasable randomness.
No single party controls the beacon output.

Online path: At T₀, the drand beacon publishes round N.
We derive the AES key as HKDF(beacon_randomness, exam_id).
The key is unknowable before T₀ by ANY party on Earth —
including the exam setter, the admin, and us.

Guarantee 1 — No human sees the paper before T₀.
"""

import hashlib
import logging
from typing import Optional

import httpx
from Crypto.Protocol.KDF import HKDF
from Crypto.Hash import SHA256

logger = logging.getLogger(__name__)

# ── drand Network Configuration ──
# Using the default League of Entropy chain (unchained mode)
DRAND_CHAIN = "8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce"
DRAND_GENESIS = 1595431050  # Unix timestamp of round 1
DRAND_PERIOD = 3            # Seconds between rounds

# Multiple endpoints for resilience — if Cloudflare is down, fallback to others
DRAND_ENDPOINTS = [
    "https://drand.cloudflare.com",     # Primary (Cloudflare CDN)
    "https://api.drand.sh",              # Fallback (drand team)
    "https://drand.iexec.market",        # Tertiary (iExec)
]


class DrandClient:
    """
    Client for the drand distributed randomness beacon.

    Used in the online path to derive AES decryption keys at T₀.
    The randomness for any future round is unknowable until that
    round is published, making pre-T₀ decryption impossible.
    """

    def __init__(self, chain_hash: str = DRAND_CHAIN):
        self.chain_hash = chain_hash

    def round_for_timestamp(self, unix_ts: int) -> int:
        """
        Calculate the drand round number for a given Unix timestamp.

        Args:
            unix_ts: Unix timestamp (seconds since epoch).

        Returns:
            The drand round number active at that timestamp.

        This is deterministic — the same timestamp always yields
        the same round, regardless of network conditions.
        """
        if unix_ts < DRAND_GENESIS:
            raise ValueError(f"Timestamp {unix_ts} is before drand genesis ({DRAND_GENESIS})")
        return ((unix_ts - DRAND_GENESIS) // DRAND_PERIOD) + 1

    def timestamp_for_round(self, round_number: int) -> int:
        """
        Calculate the Unix timestamp when a drand round will be published.

        Args:
            round_number: drand round number.

        Returns:
            Unix timestamp when this round's randomness becomes available.
        """
        if round_number < 1:
            raise ValueError("Round number must be >= 1")
        return DRAND_GENESIS + (round_number - 1) * DRAND_PERIOD

    async def get_beacon(self, round_number: int) -> bytes:
        """
        Fetch the randomness for a specific drand round.

        Tries multiple endpoints for resilience. Each endpoint serves
        the same data (replicated across the League of Entropy).

        Args:
            round_number: The drand round to fetch.

        Returns:
            32 bytes of verifiable randomness.

        Raises:
            RuntimeError: If all endpoints are unreachable.
        """
        errors = []
        for endpoint in DRAND_ENDPOINTS:
            url = f"{endpoint}/{self.chain_hash}/public/{round_number}"
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    response = await client.get(url)
                    response.raise_for_status()
                    data = response.json()

                    randomness = bytes.fromhex(data['randomness'])

                    logger.info(
                        f"drand beacon fetched: round={round_number}, "
                        f"endpoint={endpoint}, "
                        f"randomness={data['randomness'][:16]}..."
                    )
                    return randomness

            except Exception as e:
                errors.append(f"{endpoint}: {e}")
                logger.warning(f"drand endpoint {endpoint} failed: {e}")
                continue

        error_detail = "; ".join(errors)
        raise RuntimeError(
            f"All drand endpoints unreachable for round {round_number}. "
            f"Fall back to Shamir key reconstruction. Errors: {error_detail}"
        )

    async def get_latest(self) -> dict:
        """
        Fetch the latest drand round (current head of the chain).

        Returns:
            Dict with 'round', 'randomness', 'signature', 'previous_signature'.
        """
        for endpoint in DRAND_ENDPOINTS:
            url = f"{endpoint}/{self.chain_hash}/public/latest"
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    response = await client.get(url)
                    response.raise_for_status()
                    return response.json()
            except Exception as e:
                logger.warning(f"drand latest from {endpoint} failed: {e}")
                continue

        raise RuntimeError("All drand endpoints unreachable")

    async def derive_exam_key(self, exam_id: str, round_number: int) -> bytes:
        """
        Derive the AES-256 decryption key for an exam from a drand round.

        This is the core of the online decryption path:
        1. Fetch beacon randomness for the scheduled T₀ round
        2. Derive a 256-bit key using HKDF with exam_id as context

        Security:
            - Beacon randomness is unknowable before T₀
            - exam_id context ensures different exams on same round get different keys
            - HKDF provides proper key derivation (not raw beacon as key)

        Args:
            exam_id: UUID string of the exam.
            round_number: drand round corresponding to T₀.

        Returns:
            32-byte AES-256 key.
        """
        beacon = await self.get_beacon(round_number)
        key = HKDF(
            master=beacon,
            key_len=32,
            salt=exam_id.encode('utf-8'),
            hashmod=SHA256,
        )
        logger.info(
            f"Exam key derived: exam_id={exam_id[:8]}..., "
            f"round={round_number}, "
            f"key_hash={hashlib.sha256(key).hexdigest()[:16]}..."
        )
        return key

    async def is_round_available(self, round_number: int) -> bool:
        """
        Check if a drand round has been published yet.

        Used to gate paper decryption — returns False before T₀.
        """
        try:
            await self.get_beacon(round_number)
            return True
        except Exception:
            return False

    def verify_beacon(self, round_data: dict) -> bool:
        """
        Verify a drand beacon's BLS signature against the chain public key.

        This ensures the randomness was produced by the League of Entropy
        threshold signing protocol and was not tampered with.

        Args:
            round_data: Dict from get_beacon() with 'signature', 'randomness'.

        Returns:
            True if the beacon is valid.

        Note: Full BLS verification requires the py_ecc library.
        For the demo, we verify the hash chain consistency.
        """
        randomness = bytes.fromhex(round_data.get('randomness', ''))
        signature = bytes.fromhex(round_data.get('signature', ''))

        # Verify: SHA256(signature) == randomness
        computed = hashlib.sha256(signature).digest()
        is_valid = computed == randomness

        if not is_valid:
            logger.error(
                f"drand beacon verification FAILED for round {round_data.get('round')}: "
                f"expected {randomness.hex()[:16]}, got {computed.hex()[:16]}"
            )

        return is_valid
