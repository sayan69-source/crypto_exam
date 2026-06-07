"""
CryptoExam Core — RSA Time-Lock Puzzle Unit Tests
§ 14.2 — test_timelock.py

Tests the core invariants:
  1. Generate → solve roundtrip recovers the secret
  2. Puzzle parameters are valid
  3. p/q are destroyed after generation
  4. Calibration produces reasonable values
  5. Small T puzzles complete within expected time bounds
"""

import time
import pytest
from crypto.timelock import TimeLockPuzzle, TimeLockPuzzleResult


class TestTimeLockGenerate:
    """Tests for puzzle generation."""

    def test_puzzle_structure(self):
        """Generated puzzle must contain all required fields."""
        puzzle_gen = TimeLockPuzzle(bits=2048)
        secret = b"A" * 32

        result = puzzle_gen.generate(secret, seconds=1, squarings_per_second=100)

        assert isinstance(result, TimeLockPuzzleResult)
        assert result.a.startswith("0x")
        assert result.N.startswith("0x")
        assert result.T == 100  # 1 second × 100 sps
        assert len(result.masked) > 0
        assert result.seconds == 1
        assert result.sps == 100

    def test_factors_destroyed(self):
        """p, q, and phi_N must be None after generate()."""
        puzzle_gen = TimeLockPuzzle(bits=2048)
        secret = b"B" * 32

        puzzle_gen.generate(secret, seconds=1, squarings_per_second=100)

        assert puzzle_gen.p is None, "p must be destroyed after generation"
        assert puzzle_gen.q is None, "q must be destroyed after generation"
        assert puzzle_gen.phi_N is None, "phi_N must be destroyed after generation"

    def test_modulus_size(self):
        """RSA modulus must be at least 2048 bits."""
        puzzle_gen = TimeLockPuzzle(bits=2048)
        N_bits = int(puzzle_gen.N).bit_length()
        assert N_bits >= 2040, f"N is only {N_bits} bits, expected ~2048"

    def test_small_modulus_rejected(self):
        """Modulus < 2048 bits must raise ValueError."""
        with pytest.raises(ValueError, match="at least 2048"):
            TimeLockPuzzle(bits=1024)

    def test_different_secrets_different_puzzles(self):
        """Different secrets must produce different masked values."""
        gen1 = TimeLockPuzzle(bits=2048)
        gen2 = TimeLockPuzzle(bits=2048)

        r1 = gen1.generate(b"secret_one_padding_here_32bytes!", seconds=1, squarings_per_second=100)
        r2 = gen2.generate(b"secret_two_padding_here_32bytes!", seconds=1, squarings_per_second=100)

        assert r1.masked != r2.masked


class TestTimeLockSolve:
    """Tests for sequential squaring solution."""

    def test_solve_recovers_secret(self):
        """Generate → solve must recover the original secret."""
        puzzle_gen = TimeLockPuzzle(bits=2048)
        secret = b"CryptoExam_AES_Key_Material!!!!!"  # 32 bytes

        result = puzzle_gen.generate(
            secret,
            seconds=1,
            squarings_per_second=500,  # T=500, very fast for test
        )

        puzzle_dict = {
            'a': result.a,
            'N': result.N,
            'T': result.T,
            'masked': result.masked,
            'seconds': result.seconds,
        }

        recovered = TimeLockPuzzle.solve(puzzle_dict)
        assert recovered == secret

    def test_solve_small_puzzle(self):
        """Small T puzzle (T=100) must solve in under 5 seconds."""
        puzzle_gen = TimeLockPuzzle(bits=2048)
        secret = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"  # 32 bytes

        result = puzzle_gen.generate(
            secret,
            seconds=1,
            squarings_per_second=100,  # T=100
        )

        puzzle_dict = {
            'a': result.a,
            'N': result.N,
            'T': result.T,
            'masked': result.masked,
        }

        start = time.time()
        recovered = TimeLockPuzzle.solve(puzzle_dict)
        elapsed = time.time() - start

        assert recovered == secret
        assert elapsed < 5.0, f"T=100 puzzle took {elapsed:.2f}s — too slow"


class TestTimeLockCalibrate:
    """Tests for hardware calibration."""

    def test_calibration_returns_positive(self):
        """Calibration must return a positive squarings-per-second value."""
        puzzle_gen = TimeLockPuzzle(bits=2048)
        N_hex = hex(int(puzzle_gen.N))

        sps = TimeLockPuzzle.calibrate(N_hex, duration_seconds=1.0)

        assert sps > 0, "Calibration must return positive sps"
        assert sps > 1000, f"sps={sps} seems too low — check hardware"

    def test_calibration_consistent(self):
        """Two calibration runs should produce similar results (within 50%)."""
        puzzle_gen = TimeLockPuzzle(bits=2048)
        N_hex = hex(int(puzzle_gen.N))

        sps1 = TimeLockPuzzle.calibrate(N_hex, duration_seconds=1.0)
        sps2 = TimeLockPuzzle.calibrate(N_hex, duration_seconds=1.0)

        ratio = max(sps1, sps2) / min(sps1, sps2)
        assert ratio < 1.5, (
            f"Calibration inconsistent: {sps1:,} vs {sps2:,} (ratio {ratio:.2f})"
        )
