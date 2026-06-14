# crypto_exam

<div align="center">

### Zero-Trust Examination Infrastructure for India

> **The math cannot be bribed. The blockchain cannot forget.**

**FAR AWAY 2026 · Examinations Track · Built for India's 40M+ annual candidates**

[![Polygon Amoy](https://img.shields.io/badge/Polygon-Amoy%20Testnet-8247E5?logo=polygon&logoColor=white)](https://amoy.polygonscan.com/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636?logo=solidity)](https://soliditylang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

[**Verify on Blockchain**](#verify-on-blockchain) · [**Quick Start**](#quick-start) · [**Architecture**](#architecture)

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
| 2 | **Answer records are immutable** | SHA-256 Merkle root committed to Polygon PoS — any modification changes the root |
| 3 | **Paper difficulty is machine-verifiable** | ZK-SNARK (CIRCOM + Groth16) proof on-chain — proves IRT compliance without revealing questions |


## Verify on Blockchain

**No login. No API key. No trust required.**

```
Contract:  [address] on Polygon Amoy (Chain ID: 80002)
Demo TX:   [hash]
```

Open [amoy.polygonscan.com](https://amoy.polygonscan.com/), paste the TX hash, and verify the `ZKProofSubmitted` event — timestamped **hours before any candidate saw a question**.

---

## How to run the full project step by step guide

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

### Manual Setup — runs **fully locally on SQLite** (no Postgres/Redis required)

The public website now talks to a **real** FastAPI backend. The backend
auto-creates and seeds a SQLite DB on first start; the frontend points at it
with `NEXT_PUBLIC_USE_MOCK=false`.

```bash
# 1) Backend (FastAPI + SQLite) — the light dependency set is enough
cd public/backend
python -m venv .venv && source .venv/Scripts/activate   # Windows Git-Bash
pip install "fastapi" "uvicorn[standard]" "sqlalchemy[asyncio]" aiosqlite \
            "pyjwt[crypto]" bcrypt cryptography pycryptodome \
            pydantic pydantic-settings httpx web3 pyotp email-validator numpy pillow
uvicorn app.main:app --host 127.0.0.1 --port 8000     # auto-seeds cryptoexam.db

# 2) Frontend (the public website)
cd public/frontend
printf 'NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1\nNEXT_PUBLIC_USE_MOCK=false\n' > .env.local
npm install && npm run dev                            # http://localhost:3000
```

**Seeded logins** (every portal authenticates for real, then sends a one-time
code to the account's registered phone — *step 2 OTP*):

| Portal | URL | Credentials |
|--------|-----|-------------|
| Admin | `/admin/login` | `admin@cryptoexam.dev` / `CryptoExam2025!` |
| Setter | `/setter/login` | `setter@cryptoexam.dev` / `CryptoExam2025!` |
| Candidate | `/login` | seeded roll number + DOB |

> **Real OTP delivery:** set `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` /
> `TWILIO_FROM_NUMBER` in the backend environment and a real phone on the
> account, and the code is sent by SMS. Without a gateway (dev), the OTP is
> returned in the API response and the login UI shows it — clearly flagged.

```bash
# Optional — Smart Contracts (the public↔private blockchain bridge)
cd public/contracts && npm install && npx hardhat compile && npx hardhat test
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        CRYPTOEXAM CORE PLATFORM                              │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐    │
│  │  INTERFACE  A    │  │    INTERFACE  B      │  │     INTERFACE  C     │    │
│  │  CANDIDATE       │  │  QUESTION SETTER     │  │  ADMIN CONTROL       │    │ 
│  │  EXAM PORTAL     │  │  WORKBENCH           │  │  CENTRE              │    │
│  │  Next.js 16      │  │  Next.js 16          │  │  Next.js 16          │    │
│  │  /exam/*         │  │  /setter/*           │  │  /admin/*            │    │
│  └──────────────────┘  └──────────────────────┘  └──────────────────────┘    │
│           │                      │                         │                 │
│                          ▼ REST + WebSocket                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │                  FASTAPI BACKEND (Python 3.12)                           ││
│  │   Auth · ExamMgmt · QuestionEngine · CryptoService · AgentOrchestrator   ││
│  │   BlockchainService · NodeOrchestrator · AadhaarBridge                   ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│      │              │             │             │            │               │
│  ┌────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌────────────────┐     │
│  │Postgres│  │Redis     │  │AI Agents │  │  IPFS   │  │ Polygon PoS    │     │
│  │primary │  │+Celery   │  │IRT+LLM   │  │ Storage │  │ + CIRCOM ZK    │     │
│  └────────┘  └──────────┘  └──────────┘  └─────────┘  └────────────────┘     │
│                                                                              │
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
| **Cryptography** | AES-GCM-256 · HKDF · SHA-256 Merkle · Shamir SSS |
| **AI Agents** | 6-agent pipeline · Instructor + LLM · IRT 3PL Scoring · Bloom's Taxonomy |
| **Infrastructure** | Docker Compose · Nginx reverse proxy · IPFS |



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

The repo has exactly two top-level halves. They share **no code and no runtime
channel** — the only thing that crosses the boundary is the public blockchain,
over which sealed questions are committed and delivered.

```
Japan_Zuup/
├── public/                    # PUBLIC — everything reachable over the open web
│   ├── frontend/              # Next.js — marketing site, setter/admin/audit UIs,
│   │   │                      #   candidate explainer, and the live /pipeline demo
│   │   ├── app/               # App Router (routes)
│   │   ├── components/        # Shared UI + crypto + layout
│   │   └── lib/               # API client, exam crypto (question-pipeline.ts), types
│   ├── backend/               # FastAPI — API, crypto engine, sealing pipeline, AI agents
│   │   └── app/
│   │       ├── agents/        #   6-agent AI generation pipeline
│   │       ├── api/v1/        #   REST endpoints (incl. delivery.py — §10.7 sealing)
│   │       ├── services/      #   Auth, Blockchain, Crypto
│   │       └── models/        #   SQLAlchemy ORM
│   ├── contracts/             # Hardhat — Solidity (CryptoExamCore.sol = the bridge)
│   ├── circuits/              # CIRCOM — ZK-SNARK difficulty proof
│   ├── docs/                  # Architecture, compliance, deployment, master spec
│   ├── docker-compose.yml     # Public stack: Postgres + Redis + IPFS + backend + frontend
│   └── nginx.conf             # Reverse proxy with SSL termination
│
└── private/                   # PRIVATE — the centre-only stack (never web-reachable)
    ├── zuup-os/               # The bootable, air-gapped exam OS (kernel + rootfs +
    │   │                      #   dm-verity + Secure-Boot UKI + kiosk Firefox)
    │   └── image-build/       #   docker-build.sh → out/zuup-os.img (flash to USB)
    ├── exam-terminal/         # Candidate exam UI that runs inside ZUUP-OS (kiosk)
    ├── edge-server/           # Per-centre LAN server: holds enrolled identities,
    │                          #   approvals, sealed bundles — the offline source of truth
    ├── centre-admin/          # Centre Admin LAN portal (approves invigilators, runs the day)
    └── system-admin/          # HQ (tier-0) console: approves Centre Admins, answer vault
```

### The boundary

`public/` and `private/` never call each other directly. A setter seals
questions in `public/backend`, which commits the questions' Merkle root (and a
content pointer) to the chain via `public/contracts`. A centre terminal in
`private/` reads **only** the chain, fetches the opaque (keyless) sealed bundle
from a public content store, and verifies every question against the on-chain
root before decrypting it at T₀. No shared database, no shared secret, no
private API — the blockchain is the entire trust channel. See
`private/exam-terminal/lib/chain-bridge.ts` and `public/backend/app/api/v1/delivery.py`.

---

## ZUUP-OS — the bootable, air-gapped exam terminal

Exam-centre computers don't run a normal OS. They boot **ZUUP-OS**: a minimal,
hardened Linux image (custom 6.6 kernel, read-only **dm-verity** root,
**Secure-Boot**-signed Unified Kernel Image) that comes up straight into a
**locked kiosk Firefox** — no desktop, no shell, no USB storage, no way out.

### Build the bootable image (works from Windows via Docker Desktop)

```bash
cd private/zuup-os/image-build
./docker-build.sh          # builds kernel + rootfs (incl. firefox-esr) → out/zuup-os.img
```

The artifact is a **disk image** (`out/zuup-os.img`, ~509 MB) — **not** a `.exe`.
Write it to a USB stick and boot the laptop from it:

- **Windows:** flash `zuup-os.img` with [Rufus](https://rufus.ie) or
  [balenaEtcher](https://etcher.balena.io).
- **Linux:** `dd if=out/zuup-os.img of=/dev/sdX bs=4M oflag=direct`
- **Try it in a VM first:** `./40-qemu-smoke.sh` (QEMU + OVMF + swtpm).

> On the laptop, boot from the USB (one-time boot menu). Real terminals enrol
> the Secure-Boot keys in firmware; for a test laptop, disable Secure Boot or
> boot the dev-signed image.

### Offline-first: everything is verified **locally**, with no internet during the exam

The centre LAN is **air-gapped** the entire exam. Here is the data flow:

```
BEFORE EXAM DAY (online, at HQ → centre):
  Public website registration (candidates + centre staff, with face/biometric
  hashes) ──sync──▶ that centre's Edge DB.  The enrolment data is pre-positioned
  on the centre's own server so it is present locally before the doors open.

DURING THE EXAM (fully offline — NO internet for anyone, incl. the Centre Admin):
  Terminal boots ZUUP-OS ▶ Centre Admin / Invigilator log in  ▶ candidate
  face + fingerprint check  — all verified LOCALLY against the centre Edge DB.
  Network egress is blocked at the kernel; the only reachable host is the Edge.

AFTER THE EXAM (Centre Admin re-enables the uplink):
  Centre nodes upload sealed answer-root bundles — Merkle roots + per-student
  hashes, never names/rolls/answers — to the System Admin's Answer Vault, keyed
  by student id. HQ verifies the chain, anchors the root on Polygon, and only
  then HSM-decrypts. A compromised centre yields ciphertext only (INV-6).
```

This is why registration is captured on the public site but **activation and all
exam-time verification happen in person, locally**: a stolen web session is
worthless, and the network being down cannot stop an exam.

---

## Exams We Address

| Exam | Body | Candidates/Year | Our Solution |
|------|------|-----------------|-------------|
| NEET UG | NTA | 2.4M | ZK proof + online CBT |
| JEE Main/Advanced | NTA/IITs | 1.4M | ZK proof + online CBT |
| CUET UG/PG | NTA | 1.4M | ZK proof + online CBT |
| UPSC Civil Services | UPSC | 1.3M | ZK proof + online CBT |
| SSC CGL/CHSL | SSC | 3M+ | ZK proof + online CBT |
| GATE | IITs/NIT | 900K | ZK proof + online CBT |
| State PSC Exams | 28 States | 10M+ | ZK proof + online CBT |
| CBSE Class 10/12 | CBSE | 35M+ | Blockchain audit trail |

**Total addressable:** 40M+ candidates/year across 1,000+ examinations.

---

## What Makes This Different

| We Built | Others Build |
|----------|-------------|
| 4 real portals (candidate · setter · admin · invigilator) wired to a live backend | 1 MVP screen |
| ZK-SNARK (Groth16) + drand beacon + Shamir SSS | "We used blockchain" |
| 6-agent AI pipeline with IRT scoring + Bloom's classification | Basic LLM API call |
| DPDP Act 2023 compliant from schema level | Not mentioned |
| Every claim verifiable on Polygon Amoy from your phone | "Trust us, it works" |

---

---
# Future Scope

## AI Agent Pipeline

6 specialized agents generate IRT-calibrated, Bloom's-verified exam questions:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Generator   │────▶│  IRT Scorer │────▶│   Bloom's    │────▶│  Validator  │
│  Agent       │     │  Agent       │     │   Agent      │     │  Agent       │
│              │     │              │     │              │     │              │
│ Instructor + │     │ 3PL params   │     │ L1-6 keyword │     │ Accept if    │
│ OpenAI/Mock  │     │ b/a/c        │     │ EN + HI      │     │ IRT ∈ range  │
└──────────────┘     └──────────────┘     └──────────────┘     └──────┬───────┘
                                                                      │
                                                              ┌───────▼──────┐
                                                              │   Balancer   │
                                                              │   Agent      │
                                                              │              │
                                                              │ Set A/B/C/D  │
                                                              │ equivalence  │
                                                              └──────────────┘
```

- **50+ mock questions** across NEET/JEE/SSC/UPSC with Hindi translations
- **SSE streaming** for real-time progress in Setter dashboard
- **Set equivalence** prevents "set advantage" fraud vector

---


<div align="center">

**CryptoExam Core · FAR AWAY 2026 · Examinations Track**

*Built for the 40 million students who deserve a system where the math protects them.*

</div>
