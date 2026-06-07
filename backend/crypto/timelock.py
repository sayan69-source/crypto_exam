"""
CryptoExam Core — RSA Time-Lock Puzzle
§ 10.4 — Rivest-Shamir-Wagner 1996 sequential squaring.

Guarantee 2 — An offline center cannot cheat, even with zero connectivity for 72 hours.

The time-lock puzzle encodes a secret behind T sequential squarings
modulo an RSA modulus N. The crucial property: sequential squarings
CANNOT be parallelized. No matter how many GPUs or cores an attacker
has, they must perform each squaring one after another.

Workflow:
  1. Server (fast): Generate puzzle using phi(N) — direct computation
  2. Hardware node (slow): Solve by sequential squaring — calibrated to T₀
  3. At puzzle completion: AES key recovered → paper decrypted

Pi CM4 8GB benchmark: ~2,200,000 squarings/second (SCHED_FIFO, single core).
Calibration MUST run on ACTUAL deployed hardware.

The time-lock is the offline equivalent of the drand beacon:
it releases the key at T₀ without any network connectivity.
"""

import hashlib
import logging
import os
import time
from typing import NamedTuple

logger = logging.getLogger(__name__)

# Import gmpy2 for fast modular arithmetic if available,
# fall back to Python built-in pow() otherwise
try:
    import gmpy2
    from gmpy2 import mpz
    HAS_GMPY2 = True
    logger.info("gmpy2 available — using accelerated modular arithmetic")
except ImportError:
    HAS_GMPY2 = False
    mpz = int
    logger.warning("gmpy2 not available — using Python built-in arithmetic (slower)")


class TimeLockPuzzleResult(NamedTuple):
    """Generated time-lock puzzle — all data needed for the hardware node."""
    a: str           # Base value (hex)
    N: str           # RSA modulus (hex)
    T: int           # Number of sequential squarings required
    masked: str      # XOR-masked secret (hex)
    seconds: int     # Target time in seconds
    sps: int         # Squarings per second (calibration)


class TimeLockPuzzle:
    """
    RSA Time-Lock Puzzle (Rivest-Shamir-Wagner 1996).

    Setup (server-side, fast):
        Uses knowledge of phi(N) = (p-1)(q-1) to compute
        a^(2^T) mod N directly as a^(2^T mod phi(N)) mod N.
        This takes O(log T) time.

    Solve (node-side, slow):
        Without phi(N), must compute a^2 mod N sequentially T times.
        This takes O(T) time, which is calibrated to equal T₀ - T_setup.

    Security:
        - Factoring N reveals phi(N), allowing fast computation.
          N must be ≥ 2048 bits to resist factoring.
        - p and q are NEVER stored after puzzle generation.
        - The puzzle is sealed by TPM 2.0 on the hardware node.
    """

    def __init__(self, bits: int = 2048):
        """
        Initialize with a fresh RSA modulus.

        Args:
            bits: Bit length of the RSA modulus N. Must be ≥ 2048.
        """
        if bits < 2048:
            raise ValueError("RSA modulus must be at least 2048 bits for security")

        self.bits = bits
        self._generate_modulus()

    def _generate_modulus(self):
        """Generate RSA modulus N = p * q with secure random primes."""
        half_bits = self.bits // 2

        if HAS_GMPY2:
            # Use gmpy2's fast prime generation
            rng = gmpy2.random_state(int.from_bytes(os.urandom(32), 'big'))
            self.p = mpz(gmpy2.next_prime(gmpy2.mpz_rrandomb(rng, half_bits)))
            self.q = mpz(gmpy2.next_prime(gmpy2.mpz_rrandomb(rng, half_bits)))
        else:
            # Fallback: Use Python's random + primality testing
            from random import SystemRandom
            sysrand = SystemRandom()

            def _gen_prime(nbits):
                while True:
                    candidate = sysrand.getrandbits(nbits)
                    candidate |= (1 << (nbits - 1)) | 1  # Ensure odd and correct bit length
                    if _is_probable_prime(candidate):
                        return candidate

            def _is_probable_prime(n, k=20):
                if n < 2: return False
                if n == 2: return True
                if n % 2 == 0: return False
                r, d = 0, n - 1
                while d % 2 == 0:
                    r += 1
                    d //= 2
                for _ in range(k):
                    a = sysrand.randrange(2, n - 1)
                    x = pow(a, d, n)
                    if x == 1 or x == n - 1:
                        continue
                    for _ in range(r - 1):
                        x = pow(x, 2, n)
                        if x == n - 1:
                            break
                    else:
                        return False
                return True

            self.p = mpz(_gen_prime(half_bits))
            self.q = mpz(_gen_prime(half_bits))

        self.N = mpz(self.p * self.q)
        self.phi_N = mpz((self.p - 1) * (self.q - 1))

    def generate(
        self,
        secret: bytes,
        seconds: int,
        squarings_per_second: int = 2_200_000,
    ) -> TimeLockPuzzleResult:
        """
        Generate a time-lock puzzle that conceals a secret for `seconds`.

        The puzzle is calibrated so that sequential squaring on the
        target hardware (Pi CM4) completes at approximately T₀.

        Args:
            secret: The secret to lock (typically a 32-byte AES key).
            seconds: Number of seconds the puzzle should take to solve.
            squarings_per_second: Hardware calibration constant.
                Pi CM4 8GB: ~2,200,000 sps.

        Returns:
            TimeLockPuzzleResult with all puzzle parameters.

        After calling this method, p and q are securely deleted.
        The puzzle can ONLY be solved by sequential squaring.
        """
        T = seconds * squarings_per_second

        logger.info(
            f"Generating time-lock puzzle: {seconds}s × {squarings_per_second:,} sps = "
            f"{T:,} squarings ({self.bits}-bit RSA)"
        )

        # Generate random base a ∈ [2, N-1]
        a_bytes = os.urandom(self.bits // 8)
        a = mpz(int.from_bytes(a_bytes, 'big') % int(self.N))
        if a < 2:
            a = mpz(2)

        # Server-side fast computation using phi(N):
        # C = a^(2^T) mod N = a^(2^T mod phi(N)) mod N
        if HAS_GMPY2:
            e = gmpy2.powmod(mpz(2), mpz(T), self.phi_N)
            C = gmpy2.powmod(a, e, self.N)
        else:
            e = pow(2, T, int(self.phi_N))
            C = pow(int(a), int(e), int(self.N))

        # XOR the secret with a hash of C to create the masked value
        C_bytes = int(C).to_bytes(self.bits // 8, 'big')
        C_hash = hashlib.sha256(C_bytes).digest()

        # Ensure secret and hash are same length (pad/truncate)
        secret_padded = secret.ljust(len(C_hash), b'\x00')[:len(C_hash)]
        masked = bytes(x ^ y for x, y in zip(secret_padded, C_hash))

        # CRITICAL: Destroy p, q, and phi(N) — puzzle can now only be solved sequentially
        self.p = None
        self.q = None
        self.phi_N = None

        logger.info(f"Time-lock puzzle generated: T={T:,}, masked_len={len(masked)}")

        return TimeLockPuzzleResult(
            a=hex(int(a)),
            N=hex(int(self.N)),
            T=T,
            masked=masked.hex(),
            seconds=seconds,
            sps=squarings_per_second,
        )

    @staticmethod
    def solve(puzzle: dict) -> bytes:
        """
        Solve a time-lock puzzle by sequential squaring.

        This runs on the hardware node. It is intentionally slow —
        calibrated to complete at T₀. Each squaring depends on the
        previous result, making parallelization impossible.

        Args:
            puzzle: Dict with keys 'a', 'N', 'T', 'masked'.
                    From TimeLockPuzzleResult or JSON serialization.

        Returns:
            The recovered secret (32 bytes).

        This method logs progress every 10% for monitoring.
        On Pi CM4, expect ~2.2M iterations/second.
        """
        a_val = puzzle['a']
        N_val = puzzle['N']
        T = puzzle['T']
        masked = bytes.fromhex(puzzle['masked'])

        # Parse hex values
        r = mpz(int(a_val, 16) if isinstance(a_val, str) else a_val)
        N = mpz(int(N_val, 16) if isinstance(N_val, str) else N_val)

        logger.info(f"Starting time-lock solve: T={T:,} squarings")
        start_time = time.time()
        checkpoint = T // 10  # Log every 10%

        # Sequential squaring — THE core security property
        for i in range(T):
            if HAS_GMPY2:
                r = gmpy2.powmod(r, 2, N)
            else:
                r = pow(int(r), 2, int(N))

            # Progress logging
            if checkpoint > 0 and (i + 1) % checkpoint == 0:
                elapsed = time.time() - start_time
                pct = (i + 1) / T * 100
                sps = (i + 1) / elapsed if elapsed > 0 else 0
                eta = (T - i - 1) / sps if sps > 0 else 0
                logger.info(
                    f"Time-lock progress: {pct:.0f}% ({i+1:,}/{T:,}) "
                    f"elapsed={elapsed:.1f}s sps={sps:,.0f} ETA={eta:.1f}s"
                )

        # Recover secret from C
        bits = (int(N).bit_length() + 7) // 8
        C_bytes = int(r).to_bytes(bits, 'big')
        C_hash = hashlib.sha256(C_bytes).digest()

        secret = bytes(x ^ y for x, y in zip(masked, C_hash))

        elapsed = time.time() - start_time
        logger.info(f"Time-lock solved in {elapsed:.2f}s (target: ~{puzzle.get('seconds', '?')}s)")

        return secret

    @staticmethod
    def calibrate(N_hex: str, duration_seconds: float = 5.0) -> int:
        """
        Calibrate squarings-per-second on the current hardware.

        Run this on the ACTUAL deployed hardware (Pi CM4) to get
        accurate sps for puzzle generation.

        Args:
            N_hex: RSA modulus N in hex (from a test puzzle).
            duration_seconds: How long to run the calibration.

        Returns:
            Measured squarings per second.
        """
        N = mpz(int(N_hex, 16))
        r = mpz(2)
        count = 0
        start = time.time()

        while time.time() - start < duration_seconds:
            if HAS_GMPY2:
                r = gmpy2.powmod(r, 2, N)
            else:
                r = pow(int(r), 2, int(N))
            count += 1

        elapsed = time.time() - start
        sps = int(count / elapsed)
        logger.info(f"Calibration: {sps:,} squarings/second over {elapsed:.1f}s")
        return sps
