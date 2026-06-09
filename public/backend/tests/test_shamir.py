"""
CryptoExam Core — Shamir's Secret Sharing Unit Tests
§ 14.2 — test_shamir.py

Tests the core invariants:
  1. K shards reconstruct the original key
  2. Fewer than K shards cannot reconstruct
  3. Any K-subset of N shards works
  4. Shard hashes are deterministic
  5. Shard verification works
  6. Edge cases: minimum threshold, maximum shards
"""

import os
import itertools
import pytest
from crypto.shamir import ShamirPaperGuardian, ShamirShard


class TestShamirSplit:
    """Tests for secret splitting."""

    def test_split_produces_n_shards(self):
        """Split must produce exactly N shards."""
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=5, k=3)
        assert len(shards) == 5

    def test_shard_structure(self):
        """Each shard must have index, value, and hash."""
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=5, k=3)
        for shard in shards:
            assert isinstance(shard, ShamirShard)
            assert isinstance(shard.index, int)
            assert isinstance(shard.value, str)
            assert isinstance(shard.hash, bytes)
            assert len(shard.hash) == 32  # SHA-256

    def test_shard_indices_one_indexed(self):
        """Shard indices must be 1 through N."""
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=7, k=4)
        indices = [s.index for s in shards]
        assert indices == list(range(1, 8))

    def test_invalid_threshold_exceeds_total(self):
        """k > n must raise ValueError."""
        with pytest.raises(ValueError, match="cannot exceed"):
            ShamirPaperGuardian.split(os.urandom(32), n=3, k=5)

    def test_invalid_threshold_too_low(self):
        """k < 2 must raise ValueError."""
        with pytest.raises(ValueError, match="at least 2"):
            ShamirPaperGuardian.split(os.urandom(32), n=5, k=1)

    def test_empty_key_rejected(self):
        """Empty key must raise ValueError."""
        with pytest.raises(ValueError, match="empty"):
            ShamirPaperGuardian.split(b"", n=5, k=3)


class TestShamirCombine:
    """Tests for secret reconstruction."""

    def test_k_shards_reconstruct(self):
        """Exactly K shards must reconstruct the original key."""
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=5, k=3)

        # Use first K shards
        shard_tuples = [(s.index, s.value) for s in shards[:3]]
        recovered = ShamirPaperGuardian.combine(shard_tuples, key_length=32)

        assert recovered == key

    def test_all_n_shards_reconstruct(self):
        """All N shards must also reconstruct the original key."""
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=5, k=3)

        shard_tuples = [(s.index, s.value) for s in shards]
        recovered = ShamirPaperGuardian.combine(shard_tuples, key_length=32)

        assert recovered == key

    def test_any_k_subset_works(self):
        """Any combination of K shards from N must work."""
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=5, k=3)

        # Try all C(5,3) = 10 combinations
        for combo in itertools.combinations(shards, 3):
            shard_tuples = [(s.index, s.value) for s in combo]
            recovered = ShamirPaperGuardian.combine(shard_tuples, key_length=32)
            assert recovered == key, (
                f"Failed with shard indices: {[s.index for s in combo]}"
            )

    def test_fewer_than_k_fails(self):
        """Fewer than K shards must NOT reconstruct the correct key.

        With insufficient shards, Lagrange interpolation produces a
        garbage integer that is either:
          (a) too large to fit in key_length bytes (OverflowError), or
          (b) fits but is the wrong value.
        Both outcomes confirm the security property holds.
        """
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=5, k=3)

        # Only 2 shards (below threshold of 3)
        shard_tuples = [(s.index, s.value) for s in shards[:2]]

        try:
            recovered = ShamirPaperGuardian.combine(shard_tuples, key_length=32)
            # If it didn't overflow, the value must be wrong
            assert recovered != key, (
                "CRITICAL: Fewer than K shards reconstructed the key — SSS is broken"
            )
        except OverflowError:
            # Expected: garbage value too large for 32 bytes — SSS is secure
            pass

    def test_minimum_threshold_2_of_2(self):
        """Minimum valid split: 2-of-2."""
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=2, k=2)

        shard_tuples = [(s.index, s.value) for s in shards]
        recovered = ShamirPaperGuardian.combine(shard_tuples, key_length=32)

        assert recovered == key

    def test_large_split_7_of_10(self):
        """Larger split: 7-of-10."""
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=10, k=7)

        # Use first 7 shards
        shard_tuples = [(s.index, s.value) for s in shards[:7]]
        recovered = ShamirPaperGuardian.combine(shard_tuples, key_length=32)

        assert recovered == key

    def test_different_keys_different_shards(self):
        """Different keys must produce different shard values."""
        key1 = os.urandom(32)
        key2 = os.urandom(32)

        shards1 = ShamirPaperGuardian.split(key1, n=5, k=3)
        shards2 = ShamirPaperGuardian.split(key2, n=5, k=3)

        # At least one shard value must differ
        values1 = [s.value for s in shards1]
        values2 = [s.value for s in shards2]
        assert values1 != values2


class TestShamirVerification:
    """Tests for shard hash verification."""

    def test_shard_hash_matches(self):
        """Shard hash in the struct must match computed hash."""
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=5, k=3)

        for shard in shards:
            computed = ShamirPaperGuardian.shard_hash(shard.value)
            assert computed == shard.hash

    def test_verify_shard_correct(self):
        """verify_shard must return True for correct shard."""
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=5, k=3)

        for shard in shards:
            assert ShamirPaperGuardian.verify_shard(shard.value, shard.hash)

    def test_verify_shard_wrong_value(self):
        """verify_shard must return False for wrong value."""
        key = os.urandom(32)
        shards = ShamirPaperGuardian.split(key, n=5, k=3)

        assert not ShamirPaperGuardian.verify_shard("wrong_value", shards[0].hash)

    def test_shard_hash_deterministic(self):
        """Same shard value must always produce same hash."""
        h1 = ShamirPaperGuardian.shard_hash("test_shard_value")
        h2 = ShamirPaperGuardian.shard_hash("test_shard_value")
        assert h1 == h2
