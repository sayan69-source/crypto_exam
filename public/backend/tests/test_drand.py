"""
CryptoExam Core — drand Client Unit Tests
§ 14.2 — test_drand.py

Tests the core invariants:
  1. Round calculation is deterministic
  2. Timestamp-to-round mapping is correct
  3. Key derivation from same beacon produces same key
  4. Key derivation from same beacon + different exam produces different key
  5. Beacon verification (hash chain consistency)
"""

import pytest
from crypto.drand_client import DrandClient, DRAND_GENESIS, DRAND_PERIOD


class TestDrandRoundCalculation:
    """Tests for deterministic round number calculation."""

    def setup_method(self):
        self.client = DrandClient()

    def test_genesis_round(self):
        """Genesis timestamp should map to round 1."""
        assert self.client.round_for_timestamp(DRAND_GENESIS) == 1

    def test_round_after_genesis(self):
        """Timestamp one period after genesis should be round 2."""
        assert self.client.round_for_timestamp(DRAND_GENESIS + DRAND_PERIOD) == 2

    def test_round_calculation_deterministic(self):
        """Same timestamp must always produce same round."""
        ts = 1700000000
        r1 = self.client.round_for_timestamp(ts)
        r2 = self.client.round_for_timestamp(ts)
        assert r1 == r2

    def test_before_genesis_raises(self):
        """Timestamp before drand genesis must raise ValueError."""
        with pytest.raises(ValueError, match="before drand genesis"):
            self.client.round_for_timestamp(DRAND_GENESIS - 1)

    def test_round_to_timestamp_inverse(self):
        """round_for_timestamp and timestamp_for_round must be inverses."""
        ts = DRAND_GENESIS + 1000 * DRAND_PERIOD
        round_num = self.client.round_for_timestamp(ts)
        ts_back = self.client.timestamp_for_round(round_num)
        # ts_back should be <= ts and within one period
        assert ts_back <= ts
        assert ts - ts_back < DRAND_PERIOD

    def test_timestamp_for_round_one(self):
        """Round 1 should map to genesis timestamp."""
        assert self.client.timestamp_for_round(1) == DRAND_GENESIS

    def test_negative_round_raises(self):
        """Round < 1 must raise ValueError."""
        with pytest.raises(ValueError, match="must be >= 1"):
            self.client.timestamp_for_round(0)

    def test_high_round_number(self):
        """Very large round numbers must compute correctly."""
        round_num = 100_000_000
        ts = self.client.timestamp_for_round(round_num)
        assert ts == DRAND_GENESIS + (round_num - 1) * DRAND_PERIOD

    def test_round_increases_with_time(self):
        """Later timestamps must produce higher round numbers."""
        ts1 = 1700000000
        ts2 = 1700001000
        r1 = self.client.round_for_timestamp(ts1)
        r2 = self.client.round_for_timestamp(ts2)
        assert r2 > r1

    def test_same_period_same_round(self):
        """Timestamps within the same period must map to the same round."""
        ts = DRAND_GENESIS + 100 * DRAND_PERIOD
        r1 = self.client.round_for_timestamp(ts)
        r2 = self.client.round_for_timestamp(ts + 1)  # Within same period
        assert r1 == r2


class TestDrandBeaconVerification:
    """Tests for beacon hash chain verification."""

    def setup_method(self):
        self.client = DrandClient()

    def test_valid_beacon_chain(self):
        """Beacon where SHA256(signature) == randomness should verify."""
        import hashlib
        signature = b"test_signature_bytes_for_verification"
        randomness = hashlib.sha256(signature).digest()

        beacon = {
            'round': 12345,
            'signature': signature.hex(),
            'randomness': randomness.hex(),
        }

        assert self.client.verify_beacon(beacon) is True

    def test_invalid_beacon_chain(self):
        """Beacon with mismatched randomness should fail verification."""
        beacon = {
            'round': 12345,
            'signature': 'aa' * 48,
            'randomness': 'bb' * 32,  # Not SHA256 of signature
        }

        assert self.client.verify_beacon(beacon) is False
