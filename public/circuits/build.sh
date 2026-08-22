#!/bin/bash
# CryptoExam Core — CIRCOM Circuit Build Script
# § 10.5 — ZK-SNARK Difficulty Proof (Groth16)
#
# Everything is local and free — no ceremony file to download, no toolchain to
# install by hand. `npm install` here brings a WASM build of circom 2, so this
# runs the same on Windows/macOS/Linux without a Rust toolchain.
#
#   cd public/circuits && ./build.sh
#
# Outputs (git-ignored — they are large and reproducible from this script):
#   build/difficulty_proof.r1cs
#   build/difficulty_proof_js/difficulty_proof.wasm     ← witness calculator
#   build/difficulty_proof_final.zkey                   ← proving key
#   build/verification_key.json                         ← verifying key
#   build/poseidon_commit_js/…                          ← commitment helper
#   ../contracts/src/ZKVerifier.sol                     ← on-chain verifier
#
# TRUST NOTE: the phase-1 and phase-2 contributions below are generated on this
# machine from /dev/urandom. That is fine for development and for a demo, but a
# single-contributor setup means whoever ran it could, in principle, forge
# proofs. A production deployment must use a multi-party ceremony (or a public
# perpetual-powers-of-tau file) for phase 1 and collect independent phase-2
# contributions. See README-ZK.md.

set -e
cd "$(dirname "$0")"

CIRCOM=./node_modules/.bin/circom2
SNARKJS=./node_modules/.bin/snarkjs
POT=14   # 2^14 = 16384 constraints; difficulty_proof(10) uses ~1.9k

echo "═══ CryptoExam Core — ZK Circuit Build ═══"

if [ ! -x "$CIRCOM" ]; then
  echo "[0/8] Installing the circuit toolchain (circom2 + circomlib + snarkjs)..."
  npm install
fi

mkdir -p build

echo "[1/8] Compiling difficulty_proof.circom..."
$CIRCOM difficulty_proof.circom --r1cs --wasm --sym -l node_modules -o build/

echo "[2/8] Compiling the Poseidon commitment helper..."
# The proof circuit constrains Poseidon(question_enc) === committed_hash, so the
# backend needs that digest before it can prove anything. Exposing circomlib's
# own Poseidon as a circuit means there is one implementation, not two.
$CIRCOM poseidon_commit.circom --r1cs --wasm -l node_modules -o build/

echo "[3/8] Powers of Tau — phase 1 (local, single contributor)..."
$SNARKJS powersoftau new bn128 $POT build/pot${POT}_0000.ptau -v
$SNARKJS powersoftau contribute build/pot${POT}_0000.ptau build/pot${POT}_0001.ptau \
  --name="CryptoExam Team" -v -e="$(head -c 64 /dev/urandom | xxd -p | tr -d '\n')"
$SNARKJS powersoftau prepare phase2 build/pot${POT}_0001.ptau build/pot${POT}_final.ptau -v

echo "[4/8] Groth16 setup — phase 2..."
$SNARKJS groth16 setup build/difficulty_proof.r1cs build/pot${POT}_final.ptau \
  build/difficulty_proof_0000.zkey
$SNARKJS zkey contribute build/difficulty_proof_0000.zkey \
  build/difficulty_proof_final.zkey \
  --name="CryptoExam Phase2" -v -e="$(head -c 64 /dev/urandom | xxd -p | tr -d '\n')"

echo "[5/8] Exporting the verification key..."
$SNARKJS zkey export verificationkey build/difficulty_proof_final.zkey \
  build/verification_key.json

echo "[6/8] Generating the Solidity verifier..."
# CryptoExamCore.submitZKProof calls into this contract, so it must be
# redeployed alongside any change to the proving key.
$SNARKJS zkey export solidityverifier build/difficulty_proof_final.zkey \
  ../contracts/src/ZKVerifier.sol

echo "[7/8] Verifying the setup..."
$SNARKJS zkey verify build/difficulty_proof.r1cs build/pot${POT}_final.ptau \
  build/difficulty_proof_final.zkey

echo "[8/8] Proving a compliant paper — and failing to prove four bad ones..."
node tools/selftest.mjs

echo
echo "✅ Circuit build complete."
echo "  Proving key:  build/difficulty_proof_final.zkey"
echo "  Verifying key: build/verification_key.json"
echo "  Verifier:     ../contracts/src/ZKVerifier.sol  (redeploy after any change)"
echo
echo "  Refresh the contract-test fixture too:"
echo "    node tools/emit-fixture.mjs > ../contracts/test/fixtures/zk-proof.json"
