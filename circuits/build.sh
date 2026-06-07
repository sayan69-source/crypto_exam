#!/bin/bash
# CryptoExam Core — CIRCOM Circuit Build Script
# § 10.5 — ZK-SNARK Difficulty Proof (Groth16)
#
# Prerequisites: circom 2.1.6, snarkjs
# npm install -g circom snarkjs

set -e

echo "═══ CryptoExam Core — ZK Circuit Build ═══"

# 1. Compile CIRCOM circuit
echo "[1/7] Compiling CIRCOM circuit..."
circom difficulty_proof.circom --r1cs --wasm --sym -o build/

# 2. Powers of Tau ceremony (Phase 1)
echo "[2/7] Powers of Tau — Phase 1..."
snarkjs powersoftau new bn128 16 build/pot16_0000.ptau -v
snarkjs powersoftau contribute build/pot16_0000.ptau build/pot16_0001.ptau \
  --name="CryptoExam Team" -v -e="$(head -c 64 /dev/urandom | xxd -p)"
snarkjs powersoftau prepare phase2 build/pot16_0001.ptau build/pot16_final.ptau -v

# 3. Groth16 setup (Phase 2)
echo "[3/7] Groth16 trusted setup..."
snarkjs groth16 setup build/difficulty_proof.r1cs build/pot16_final.ptau \
  build/difficulty_proof_0000.zkey
snarkjs zkey contribute build/difficulty_proof_0000.zkey \
  build/difficulty_proof_final.zkey \
  --name="CryptoExam Phase2" -v -e="$(head -c 64 /dev/urandom | xxd -p)"

# 4. Export verification key
echo "[4/7] Exporting verification key..."
snarkjs zkey export verificationkey build/difficulty_proof_final.zkey \
  build/verification_key.json

# 5. Export Solidity verifier
echo "[5/7] Generating Solidity verifier..."
snarkjs zkey export solidityverifier build/difficulty_proof_final.zkey \
  ../contracts/src/ZKVerifier.sol

# 6. Verify setup
echo "[6/7] Verifying setup..."
snarkjs zkey verify build/difficulty_proof.r1cs build/pot16_final.ptau \
  build/difficulty_proof_final.zkey

echo "[7/7] ✅ Circuit build complete!"
echo "  R1CS:     build/difficulty_proof.r1cs"
echo "  WASM:     build/difficulty_proof_js/difficulty_proof.wasm"
echo "  ZKey:     build/difficulty_proof_final.zkey"
echo "  VK:       build/verification_key.json"
echo "  Verifier: ../contracts/src/ZKVerifier.sol"
