# CryptoExam Core

<div align="center">

### Zero-Trust Examination Infrastructure for India

> **The math cannot be bribed. The blockchain cannot forget. The hardware cannot lie.**

**FAR AWAY 2026 · Examinations Track · Built for India's 40M+ annual candidates**

[![Polygon Amoy](https://img.shields.io/badge/Polygon-Amoy%20Testnet-8247E5?logo=polygon&logoColor=white)](https://amoy.polygonscan.com/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636?logo=solidity)](https://soliditylang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

[**Live Demo**](#live-demo) · [**Verify on Blockchain**](#verify-on-blockchain) · [**Quick Start**](#quick-start) · [**Architecture**](#architecture) · [**Hardware**](#hardware-security-node)

</div>

---

## The Problem

In May 2024, **NEET UG** — India's medical entrance exam for **2.4 million students** — was compromised by a paper leak. The retest cost **₹900+ Crore**. The NTA chief was arrested. The Supreme Court intervened.

This is not an isolated incident:

| Incident | Candidates Affected | Cost |
|----------|-------------------|------|
| **NEET UG 2024** — Bihar-Gujarat paper leak | 2.4M | ₹900+ Cr retest |
| **West Bengal SSC 2022** — OMR sheet tampering | 26,000 fraudulent appointments | CBI investigation |
| **REET 2021** — WhatsApp leak 12h before exam | 1.6M invalidated | Full re-examination |
| **UP Police 2024** — Paper circulated on Telegram | 1M+ affected | Cancelled |
| **NTA NEET 2024** — Grace marks manipulation | 1,563 unearned marks | Supreme Court ruling |

**Root cause:** Every layer of the examination system trusts humans. CryptoExam Core replaces human trust with **mathematical enforcement** at every layer.

---

## The Solution

### Five Cryptographic Guarantees

| # | Guarantee | Enforced By |
|---|-----------|-------------|
| 1 | **No human sees the paper before T₀** | AES-GCM-256 encryption → HKDF key derivation → key released only at drand beacon T₀ |
| 2 | **Offline centers cannot cheat** | RSA time-lock puzzle on custom PCB with TPM 2.0 + GPS UTC — no parallel speedup possible |
| 3 | **Answer records are immutable** | SHA-256 Merkle root committed to Polygon PoS — any modification changes the root |
| 4 | **Paper difficulty is machine-verifiable** | ZK-SNARK (CIRCOM + Groth16) proof on-chain — proves IRT compliance without revealing questions |
| 5 | **Delivery is provable** | TPM 2.0 signed ProofOfDelivery with GPS timestamp submitted to blockchain |

---

## Live Demo

| Interface | URL | Role |
|-----------|-----|------|
| 🎓 **Candidate Portal** | `[demo-url]/exam` | Light theme · Calm institutional design |
| 🔬 **Setter Workbench** | `[demo-url]/setter` | Dark theme · Bloomberg-style data density |
| 🛡️ **Admin Control Centre** | `[demo-url]/admin` | Darkest theme · Real-time mission control |
| 📋 **Public Audit** | `[demo-url]/exam/audit` | No login required · Court-ready evidence |

---

## Verify on Blockchain

**No login. No API key. No trust required.**

```
Contract:  [address] on Polygon Amoy (Chain ID: 80002)
Demo TX:   [hash]
```

Open [amoy.polygonscan.com](https://amoy.polygonscan.com/), paste the TX hash, and verify the `ZKProofSubmitted` event — timestamped **hours before any candidate saw a question**.

---

## Quick Start

### One-Command Setup

```bash
git clone https://github.com/[team]/cryptoexam-core
cd cryptoexam-core
cp .env.example .env
docker compose up -d
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000/docs |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### Manual Setup

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend (the public website)
cd public/frontend
npm install && npm run dev

# Smart Contracts
cd contracts
npm install
npx hardhat compile
npx hardhat test

# AI Pipeline Test
cd backend
python -m app.agents.test_pipeline

# Hardware Firmware (emulated)
python hardware/firmware/main.py
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        CRYPTOEXAM CORE PLATFORM                              │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐   │
│  │  INTERFACE  A     │  │    INTERFACE  B       │  │     INTERFACE  C     │   │
│  │  CANDIDATE        │  │  QUESTION SETTER      │  │  ADMIN CONTROL       │   │
│  │  EXAM PORTAL      │  │  WORKBENCH            │  │  CENTRE              │   │
│  │  Next.js 16       │  │  Next.js 16           │  │  Next.js 16          │   │
│  │  /exam/*          │  │  /setter/*            │  │  /admin/*            │   │
│  └──────────────────┘  └──────────────────────┘  └──────────────────────┘   │
│           │                      │                         │                 │
│                          ▼ REST + WebSocket                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │                  FASTAPI BACKEND (Python 3.12)                          ││
│  │   Auth · ExamMgmt · QuestionEngine · CryptoService · AgentOrchestrator ││
│  │   BlockchainService · NodeOrchestrator · AadhaarBridge                  ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│      │              │             │             │            │               │
│  ┌────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌────────────────┐   │
│  │Postgres│  │Redis     │  │AI Agents │  │  IPFS   │  │ Polygon PoS    │   │
│  │primary │  │+Celery   │  │IRT+LLM   │  │ Storage │  │ + CIRCOM ZK    │   │
│  └────────┘  └──────────┘  └──────────┘  └─────────┘  └────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │              HARDWARE SECURITY NODE (FIELD DEPLOYED)                    ││
│  │  Pi CM4 · Infineon TPM 2.0 · u-blox GPS · ATECC608A · Tamper Mesh     ││
│  └──────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16 (App Router) · TypeScript · CSS Modules · 3 interfaces · 24 routes |
| **Backend** | FastAPI · Python 3.12 · SQLAlchemy 2.0 (async) · Pydantic v2 |
| **Database** | PostgreSQL 16 · Redis 7 |
| **Task Queue** | Celery + Redis |
| **Blockchain** | Polygon PoS (Amoy testnet) · Solidity 0.8.20 · Hardhat · OpenZeppelin |
| **ZK Proofs** | CIRCOM 2.1.6 · snarkjs · Groth16 |
| **Cryptography** | AES-GCM-256 · HKDF · SHA-256 Merkle · Shamir SSS · RSA Time-Lock |
| **AI Agents** | 6-agent pipeline · Instructor + LLM · IRT 3PL Scoring · Bloom's Taxonomy |
| **Hardware** | Raspberry Pi CM4 · Infineon TPM 2.0 · u-blox NEO-M9N GPS · ATECC608A · KiCad 4-layer PCB |
| **Infrastructure** | Docker Compose · Nginx reverse proxy · IPFS |

---

## AI Agent Pipeline

6 specialized agents generate IRT-calibrated, Bloom's-verified exam questions:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Generator   │────▶│  IRT Scorer  │────▶│   Bloom's    │────▶│  Validator   │
│  Agent       │     │  Agent       │     │   Agent      │     │  Agent       │
│              │     │              │     │              │     │              │
│ Instructor + │     │ 3PL params   │     │ L1-6 keyword │     │ Accept if    │
│ OpenAI/Mock  │     │ b/a/c        │     │ EN + HI      │     │ IRT ∈ range  │
└──────────────┘     └──────────────┘     └──────────────┘     └──────┬───────┘
                                                                      │
                                                              ┌───────▼───────┐
                                                              │   Balancer    │
                                                              │   Agent       │
                                                              │              │
                                                              │ Set A/B/C/D  │
                                                              │ equivalence  │
                                                              └──────────────┘
```

- **50+ mock questions** across NEET/JEE/SSC/UPSC with Hindi translations
- **SSE streaming** for real-time progress in Setter dashboard
- **Set equivalence** prevents "set advantage" fraud vector

---

## Hardware Security Node

**PCB design files in `/hardware/`. KiCad 4-layer Gerbers ready for fabrication.**

| Component | Part | Purpose |
|-----------|------|---------|
| **Compute** | Raspberry Pi CM4 (4GB/32GB) | Main controller |
| **TPM 2.0** | Infineon SLB9670 | Hardware attestation, key sealing, PCR extend |
| **GPS** | u-blox NEO-M9N | GPS-derived UTC time (1PPS), tamper-resistant clock |
| **Secure Element** | ATECC608A | Hardware ECDSA signing, cannot be extracted even with chip decap |
| **Display** | ST7789 240x320 TFT | Status, exam countdown, tamper alerts |
| **Ethernet** | LAN8720A PHY | 10/100 Mbps for local exam delivery |
| **UPS** | 50F Supercapacitor | 30s graceful shutdown on power loss |
| **Tamper** | Kapton flex mesh | Serpentine Cu trace — break triggers key zeroisation |
| **Enclosure** | CNC 6061-T6 Aluminum | IP54, tamper-evident, anodized black |

**BOM cost:** $138.50/unit (prototype) → $85-95/unit (1000+ qty)

### Firmware Demo

```bash
python hardware/firmware/main.py
# Output:
# TPM 2.0 initialized (EMULATED)
# GPS: 28.6139, 77.2090 (12 sats)
# Tamper mesh: OK (47.0 ohms)
# Boot complete. State: idle
# Proof of Delivery generated: 88b1d60f...
```

---

## Smart Contract

**`CryptoExamCore.sol`** on Polygon Amoy — 362 lines, fully auditable.

| Function | Role | Gas Cost |
|----------|------|----------|
| `lockExam()` | Register question hash + ZK proof | ~120K gas |
| `submitZKProof()` | Record Groth16 verification | ~80K gas |
| `commitAnswerMerkleRoot()` | Immutable answer commitment | ~65K gas |
| `submitDeliveryProof()` | TPM-signed delivery attestation | ~95K gas |
| `verifyExam()` | Public view — no auth needed | 0 gas |
| `emergencyPause()` | Admin emergency with on-chain reason | ~45K gas |

**Anyone with a browser can verify:** `verifyExam()` is public, permissionless, and free.

---

## DPDP Act 2023 Compliance

Built from the schema level — not retrofitted.

| Requirement | Implementation |
|-------------|---------------|
| **Section 4** (Consent) | Explicit consent flow with IP, timestamp, version |
| **Section 8** (Security) | AES-GCM-256, TPM 2.0, no plaintext on disk |
| **Section 9** (Minors) | Parental consent for candidates under 18 |
| **Section 16** (Data Rights) | Access, correction, erasure API endpoints |
| **No PII on-chain** | Only cryptographic hashes — never names, IDs, or answers |
| **Biometric data** | Never stored — only hash of facial embedding |
| **Retention** | 7-year policy for exam records, automated purge |

---

## Project Structure

```
cryptoexam-core/
├── public/                # PUBLIC — everything anyone may reach over the web
│   └── frontend/          # Next.js 16 — marketing site + setter/admin/audit interfaces
│       ├── app/           # App Router
│       │   ├── (auth)/    #   Login + verification
│       │   ├── exam/      #   Candidate portal (public explainer + audit)
│       │   ├── setter/    #   Setter Workbench
│       │   └── admin/     #   Admin Control Centre
│       ├── components/    # Shared components (UI + crypto + layout)
│       └── lib/           # API client, mock data, types
├── private/               # PRIVATE — the secure centre stack (runs only on centre OS)
│   └── exam-terminal/     # Candidate + invigilator portals; future OS + hardened Firefox
├── backend/               # FastAPI — API, crypto engine, AI agents (shared by both)
│   └── app/
│       ├── agents/        # 6-agent AI pipeline (Generator, IRT, Blooms, Validator, Balancer, Orchestrator)
│       ├── api/           # REST endpoints + SSE streaming
│       ├── services/      # Auth, Blockchain, Crypto
│       ├── tasks/         # Celery async tasks
│       └── models/        # SQLAlchemy ORM
├── contracts/             # Hardhat — Solidity smart contracts
│   └── src/
│       └── CryptoExamCore.sol  # 362 lines, AccessControl + ReentrancyGuard
├── circuits/              # CIRCOM — ZK-SNARK difficulty proof
├── hardware/              # KiCad — PCB design + firmware
│   ├── kicad/             #   Schematic + PCB layout (4-layer)
│   ├── gerbers/           #   Manufacturing files
│   ├── firmware/          #   Python firmware (TPM + GPS + ATECC608A)
│   ├── bom/               #   Bill of Materials (30+ components)
│   └── 3d/                #   CNC enclosure specification
├── docs/                  # Architecture, compliance, deployment
├── docker-compose.yml     # Full stack: Postgres + Redis + IPFS + backend + frontend
└── nginx.conf             # Reverse proxy with SSL termination
```

---

## Exams We Address

| Exam | Body | Candidates/Year | Our Solution |
|------|------|-----------------|-------------|
| NEET UG | NTA | 2.4M | ZK proof + hardware delivery |
| JEE Main/Advanced | NTA/IITs | 1.4M | ZK proof + online CBT |
| CUET UG/PG | NTA | 1.4M | ZK proof + online CBT |
| UPSC Civil Services | UPSC | 1.3M | ZK proof + OMR-equivalent |
| SSC CGL/CHSL | SSC | 3M+ | ZK proof + hardware |
| GATE | IITs/NIT | 900K | ZK proof + online CBT |
| State PSC Exams | 28 States | 10M+ | Hardware node offline path |
| CBSE Class 10/12 | CBSE | 35M+ | Blockchain audit trail |

**Total addressable:** 40M+ candidates/year across 1,000+ examinations.

---

## What Makes This Different

| We Built | Others Build |
|----------|-------------|
| 3 production interfaces with distinct UX personalities | 1 MVP screen |
| ZK-SNARK (Groth16) + RSA time-lock + TPM 2.0 + Shamir SSS | "We used blockchain" |
| 6-agent AI pipeline with IRT scoring + Bloom's classification | Basic LLM API call |
| KiCad 4-layer PCB with Gerbers ready for fabrication | Arduino + jumper wires |
| DPDP Act 2023 compliant from schema level | Not mentioned |
| Every claim verifiable on Polygon Amoy from your phone | "Trust us, it works" |

---

<div align="center">

**CryptoExam Core · FAR AWAY 2026 · Examinations Track**

*Built for the 40 million students who deserve a system where the math protects them.*

</div>
