"""
CryptoExam Core — ZK Proof Manager
§ 10.5 — Python interface for CIRCOM/snarkjs Groth16 proof generation.

Guarantee 4 — AI-generated papers have machine-verifiable difficulty distribution.

This module handles:
  1. Preparing the witness (private + public inputs) for the CIRCOM circuit
  2. Invoking snarkjs for proof generation
  3. Parsing and formatting the proof for on-chain submission
  4. Local proof verification before committing to blockchain

The proof is generated server-side, then submitted to the Polygon smart
contract's lockExam() function along with the question hash.
"""

import hashlib
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import NamedTuple, Optional

logger = logging.getLogger(__name__)

# Paths relative to the project root
CIRCUITS_DIR = Path(__file__).parent.parent.parent / "circuits"
BUILD_DIR = CIRCUITS_DIR / "build"
WASM_PATH = BUILD_DIR / "difficulty_proof_js" / "difficulty_proof.wasm"
ZKEY_PATH = BUILD_DIR / "difficulty_proof_final.zkey"
VKEY_PATH = BUILD_DIR / "verification_key.json"
POSEIDON_TOOL = CIRCUITS_DIR / "tools" / "poseidon-commit.mjs"

# IRT difficulty (b) is signed — roughly -3..+3 — but the circuit's range
# comparators read field elements, where a negative value is a number just under
# the field modulus and every comparison against it is nonsense. So b is carried
# shifted by this offset, and target_mean_b is shifted by exactly the same
# amount, which leaves `|mean(b) - target| <= tolerance` unchanged.
#
# This is part of the public statement: signal [1] on-chain is the SHIFTED
# target. Anyone re-deriving the claim subtracts IRT_B_OFFSET. Keep in step with
# B_OFFSET in circuits/tools/selftest.mjs.
IRT_B_OFFSET = 4000

# The comparators are GreaterEqThan(16)/LessEqThan(16) on a and c, and
# GreaterEqThan(32)/LessEqThan(32) on the difficulty sum. Feeding them anything
# wider silently produces a witness that cannot be satisfied, with no useful
# error, so the ranges are checked before proving.
_A_C_MAX = 2 ** 16 - 1
_SUM_MAX = 2 ** 32 - 1


class ZKProofResult(NamedTuple):
    """Generated ZK proof with all data needed for on-chain submission."""
    proof: dict          # Groth16 proof {pi_a, pi_b, pi_c, protocol, curve}
    public_signals: list # Public inputs [committed_hash, target_mean_b, min_a, max_c, tolerance]
    proof_hash: str      # SHA-256 hash of the proof JSON (for DB storage)
    verified: bool       # Whether the proof passed local verification


class ZKProofManager:
    """
    Interface between the Python backend and snarkjs CLI.

    Prepares circuit inputs, generates Groth16 proofs, and
    formats them for Polygon smart contract submission.
    """

    def __init__(
        self,
        wasm_path: Optional[Path] = None,
        zkey_path: Optional[Path] = None,
        vkey_path: Optional[Path] = None,
    ):
        self.wasm_path = wasm_path or WASM_PATH
        self.zkey_path = zkey_path or ZKEY_PATH
        self.vkey_path = vkey_path or VKEY_PATH

    def prepare_witness(
        self,
        questions: list[dict],
        irt_targets: dict,
    ) -> dict:
        """
        Prepare the circuit witness from question data.

        Maps IRT parameters to scaled integers (×1000) for the circuit,
        computes the Poseidon-compatible question encodings, and
        assembles both private and public inputs.

        Args:
            questions: List of question dicts with IRT parameters.
                Each must have: irt_b, irt_a, irt_c, and a unique identifier.
            irt_targets: Dict with target_mean_b, min_a, max_c, tolerance.
                All values as floats (will be scaled ×1000).

        Returns:
            Dict of circuit inputs ready for snarkjs witness generation.
        """
        n = len(questions)

        # Scale IRT parameters to integers (×1000); difficulty is shifted so the
        # circuit's unsigned comparators see a sane value (see IRT_B_OFFSET).
        irt_b = [int(round(q['irt_b'] * 1000)) + IRT_B_OFFSET for q in questions]
        irt_a = [int(round(q['irt_a'] * 1000)) for q in questions]
        irt_c = [int(round(q['irt_c'] * 1000)) for q in questions]

        for label, values in (("irt_b", irt_b), ("irt_a", irt_a), ("irt_c", irt_c)):
            bad = [v for v in values if v < 0 or v > _A_C_MAX]
            if bad:
                raise ValueError(
                    f"{label} out of the range the circuit can prove over "
                    f"(0..{_A_C_MAX} after scaling): {bad[:3]}. "
                    f"Difficulty must lie within ±{IRT_B_OFFSET / 1000} logits."
                )
        if sum(irt_b) > _SUM_MAX:
            raise ValueError(
                f"Summed difficulty {sum(irt_b)} exceeds the circuit's 32-bit "
                f"comparator range — too many questions for this circuit."
            )

        # Encode questions as field elements for Poseidon hash
        # Use a deterministic encoding: hash of question text → truncated to field element
        question_enc = []
        for q in questions:
            q_hash = hashlib.sha256(
                json.dumps(q, sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()
            # Truncate to 31 bytes to fit in bn128 field (< 2^254)
            field_element = int(q_hash[:62], 16)
            question_enc.append(str(field_element))

        # The circuit constrains Poseidon(question_enc) === committed_hash, so
        # this has to be the real Poseidon digest — anything else yields a
        # witness that cannot be satisfied.
        committed_hash = self._compute_poseidon_hash(question_enc)

        # Scale public inputs. The target carries the same difficulty offset as
        # the private b values, so the comparison is unaffected.
        target_mean_b = int(round(irt_targets['target_mean_b'] * 1000)) + IRT_B_OFFSET
        min_a = int(round(irt_targets['min_a'] * 1000))
        max_c = int(round(irt_targets['max_c'] * 1000))
        tolerance = int(round(irt_targets['tolerance'] * 1000))

        witness = {
            # Private inputs
            "irt_b": [str(b) for b in irt_b],
            "irt_a": [str(a) for a in irt_a],
            "irt_c": [str(c) for c in irt_c],
            "question_enc": question_enc,
            # Public inputs
            "committed_hash": str(committed_hash),
            "target_mean_b": str(target_mean_b),
            "min_a": str(min_a),
            "max_c": str(max_c),
            "tolerance": str(tolerance),
        }

        logger.info(
            f"Witness prepared: {n} questions, "
            f"mean_b={sum(irt_b)/n/1000:.3f}, "
            f"target={irt_targets['target_mean_b']:.3f}"
        )

        return witness

    def _compute_poseidon_hash(self, inputs: list[str]) -> int:
        """
        Poseidon digest of the question encodings — circomlib's, not a second one.

        The circuit asserts `Poseidon(question_enc) === committed_hash`, so this
        must agree with circomlib exactly. Rather than carry a Python port of the
        round constants and MDS matrix (which would fail silently on any drift),
        this runs the witness calculator of circuits/poseidon_commit.circom,
        which instantiates the same circomlib Poseidon the proof circuit does.

        Raises if the helper circuit is not built — a wrong digest would only
        surface later as an unprovable witness.
        """
        if not POSEIDON_TOOL.exists():
            raise RuntimeError(
                f"Poseidon commitment helper missing at {POSEIDON_TOOL}. "
                "Build the circuits first: cd public/circuits && ./build.sh"
            )

        result = subprocess.run(
            ["node", str(POSEIDON_TOOL), json.dumps(inputs)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"Poseidon commitment failed: {result.stderr.strip() or result.stdout.strip()}"
            )
        return int(result.stdout.strip())

    async def generate_proof(
        self,
        witness: dict,
        working_dir: Optional[str] = None,
    ) -> ZKProofResult:
        """
        Generate a Groth16 ZK proof using snarkjs.

        Steps:
          1. Write witness JSON to temp file
          2. Generate WASM witness (.wtns)
          3. Generate Groth16 proof
          4. Verify proof locally
          5. Parse and return result

        Args:
            witness: Circuit inputs from prepare_witness().
            working_dir: Optional directory for intermediate files.

        Returns:
            ZKProofResult with proof, public signals, hash, and verification status.
        """
        work_dir = working_dir or tempfile.mkdtemp(prefix="zk_proof_")
        os.makedirs(work_dir, exist_ok=True)

        input_path = os.path.join(work_dir, "input.json")
        witness_path = os.path.join(work_dir, "witness.wtns")
        proof_path = os.path.join(work_dir, "proof.json")
        public_path = os.path.join(work_dir, "public.json")

        try:
            # Step 1: Write witness
            with open(input_path, 'w') as f:
                json.dump(witness, f)

            logger.info("ZK proof generation starting...")

            # Step 2: Generate witness
            self._run_snarkjs([
                "snarkjs", "wtns", "calculate",
                str(self.wasm_path), input_path, witness_path,
            ])
            logger.info("  ✓ Witness calculated")

            # Step 3: Generate Groth16 proof
            self._run_snarkjs([
                "snarkjs", "groth16", "prove",
                str(self.zkey_path), witness_path,
                proof_path, public_path,
            ])
            logger.info("  ✓ Groth16 proof generated")

            # Step 4: Load proof and public signals
            with open(proof_path, 'r') as f:
                proof = json.load(f)
            with open(public_path, 'r') as f:
                public_signals = json.load(f)

            # Step 5: Local verification
            verified = self._verify_proof_local(proof_path, public_path)
            logger.info(f"  {'✓' if verified else '✗'} Local verification: {'PASSED' if verified else 'FAILED'}")

            # Compute proof hash
            proof_json = json.dumps(proof, sort_keys=True)
            proof_hash = hashlib.sha256(proof_json.encode()).hexdigest()

            return ZKProofResult(
                proof=proof,
                public_signals=public_signals,
                proof_hash=proof_hash,
                verified=verified,
            )

        except Exception as e:
            logger.error(f"ZK proof generation failed: {e}")
            raise

    def _verify_proof_local(self, proof_path: str, public_path: str) -> bool:
        """Verify a proof locally using the verification key."""
        try:
            result = self._run_snarkjs([
                "snarkjs", "groth16", "verify",
                str(self.vkey_path), public_path, proof_path,
            ])
            return "OK" in result or "valid" in result.lower()
        except Exception as e:
            logger.warning(f"Local verification failed: {e}")
            return False

    @staticmethod
    def circuit_size() -> Optional[int]:
        """
        How many questions the compiled circuit proves over, or None if unbuilt.

        Read from the circuit source rather than hard-coded, so it cannot drift
        from what was actually compiled. Note the ceiling: the commitment is a
        single circomlib Poseidon, which takes at most 16 inputs — papers larger
        than that need a chunked commitment, not a bigger N.
        """
        src = CIRCUITS_DIR / "difficulty_proof.circom"
        if not src.exists():
            return None
        import re

        m = re.search(r"=\s*DifficultyProof\(\s*(\d+)\s*\)", src.read_text(encoding="utf-8"))
        return int(m.group(1)) if m else None

    @staticmethod
    def _snarkjs_command() -> list[str]:
        """
        How to invoke snarkjs on this host.

        `build.sh` installs it into circuits/node_modules, so prefer that over a
        global install: it is the version the proving key was produced with, and
        it means the backend works without anyone running `npm i -g`. Falls back
        to whatever is on PATH.
        """
        local_js = CIRCUITS_DIR / "node_modules" / "snarkjs" / "build" / "cli.cjs"
        if local_js.exists():
            return ["node", str(local_js)]
        return ["snarkjs"]

    def _run_snarkjs(self, cmd: list[str]) -> str:
        """Run a snarkjs CLI command and return stdout."""
        # Callers write the command starting with the literal "snarkjs"; swap it
        # for however this host actually reaches it.
        resolved = self._snarkjs_command() + list(cmd[1:])
        try:
            result = subprocess.run(
                resolved,
                capture_output=True,
                text=True,
                timeout=300,  # 5 min timeout for proof generation
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"snarkjs command failed: {' '.join(resolved)}\n"
                    f"stderr: {result.stderr}"
                )
            return result.stdout
        except FileNotFoundError:
            raise RuntimeError(
                "snarkjs not found. Build the circuits first: "
                "cd public/circuits && ./build.sh"
            )

    @staticmethod
    def format_for_contract(proof: dict) -> tuple:
        """
        Format a Groth16 proof for the Solidity verifier contract.

        Converts snarkjs proof format to the format expected by
        the on-chain verifyProof() function.

        Args:
            proof: Proof dict from snarkjs.

        Returns:
            Tuple of (a, b, c) matching the Solidity function signature:
                a: uint256[2]
                b: uint256[2][2]
                c: uint256[2]
        """
        a = [int(proof['pi_a'][0]), int(proof['pi_a'][1])]
        b = [
            [int(proof['pi_b'][0][1]), int(proof['pi_b'][0][0])],
            [int(proof['pi_b'][1][1]), int(proof['pi_b'][1][0])],
        ]
        c = [int(proof['pi_c'][0]), int(proof['pi_c'][1])]
        return a, b, c
