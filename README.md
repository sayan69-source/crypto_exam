# CryptoExam Core

## Zero-Trust Examination Infrastructure for India

> **The math cannot be bribed. The blockchain cannot forget. The hardware cannot lie.**

**FAR AWAY 2026 · Examinations Track**

---

### Live Demo

| Interface | URL |
|---|---|
| Candidate Portal | `[demo-url]/exam` |
| Setter Workbench | `[demo-url]/setter` |
| Admin Console | `[demo-url]/admin` |
| Public Audit | `[demo-url]/exam/audit` |

### Verify on Blockchain (No Login Required)

- **Contract:** `[address]` on Polygon Amoy
- **Demo exam ZK proof TX:** `[hash]` — [View on Polygonscan ↗](#)

---

### One-Command Setup

```bash
git clone https://github.com/[team]/cryptoexam-core
cd cryptoexam-core
cp .env.example .env
docker compose up -d
# Frontend: http://localhost:3000 | Backend: http://localhost:8000/docs
```

---

### The Problem We Solve

In May 2024, NEET UG — India's medical entrance exam for 2.4 million students — was compromised by a paper leak. The retest cost ₹900+ Crore. The NTA chief was arrested. The Supreme Court intervened. **The system failed because it trusted humans at every layer.**

CryptoExam Core replaces human trust with mathematical enforcement at every layer of the examination lifecycle.

---

### Five Cryptographic Guarantees

1. **No human sees the paper before T₀** — AES-GCM-256 encryption + HKDF key derivation from drand beacon
2. **Offline centers cannot cheat** — RSA time-lock puzzle on custom PCB with TPM 2.0 + GPS UTC
3. **Answer records are immutable** — SHA-256 Merkle root committed to Polygon PoS
4. **Paper difficulty is machine-verifiable** — ZK-SNARK (CIRCOM + Groth16) proof on-chain
5. **Delivery is provable** — TPM 2.0 signed ProofOfDelivery submitted to blockchain

---

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) · TypeScript · Vanilla CSS |
| Backend | FastAPI · Python 3.12 · SQLAlchemy 2.0 (async) |
| Database | PostgreSQL 16 · Redis 7 |
| Task Queue | Celery + Redis |
| Blockchain | Polygon PoS (Amoy testnet) · Solidity 0.8.20 · Hardhat |
| ZK Proofs | CIRCOM 2.1.6 · snarkjs · Groth16 |
| Cryptography | AES-GCM-256 · HKDF · Shamir SSS · RSA Time-Lock |
| AI Agents | LLM + Instructor · IRT Scoring · Bloom's Classification |
| Hardware | Raspberry Pi CM4 · Infineon TPM 2.0 · u-blox GPS · KiCad PCB |
| Infrastructure | Docker Compose · Nginx · IPFS |

---

### Hardware

PCB design files in `/hardware/`. KiCad 4-layer Gerbers ready for fabrication.

- **TPM 2.0** (Infineon SLB 9670) — Hardware attestation + key sealing
- **GPS** (u-blox NEO-M9N) — UTC time reference for offline T₀
- **ATECC608A** — Hardware ECDSA signing
- **Tamper mesh** — Physical breach detection → key zeroisation

---

### DPDP Act 2023 Compliance

Built from the schema level — not retrofitted.

- Biometric data NEVER stored (only hash of facial embedding)
- Explicit consent tracking with IP, timestamp, and version
- Data subject rights: access, correction, erasure endpoints
- 7-year retention policy for exam records

---

### Project Structure

```
cryptoexam-core/
├── frontend/          # Next.js 14 — 3 interfaces (Candidate, Setter, Admin)
├── backend/           # FastAPI — API, crypto engine, AI agents
├── contracts/         # Hardhat — Solidity smart contracts
├── circuits/          # CIRCOM — ZK-SNARK difficulty proof
├── hardware/          # KiCad — PCB design + Gerbers
└── docs/              # Architecture, compliance, deployment
```

---

*CryptoExam Core · FAR AWAY 2026 · Built for India*
