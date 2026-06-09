"""
CryptoExam Core — Public Transparency / About API

This module is the single, public, no-authentication source of truth for
*everything about the platform*: who we are, what we promise, how it works,
the technology underneath, what is public versus private, how anyone can
verify an examination, and how to reach us.

Design principle — radical transparency:
    Nothing here requires a login, an API key, or trust in CryptoExam Core.
    The same document that powers the public "About" page is served as plain
    JSON so journalists, candidates, courts and auditors can read, archive,
    diff and machine-check our claims directly.

Endpoints (all GET, all public):
    GET /api/v1/about               — the complete About document
    GET /api/v1/about/guarantees    — the four cryptographic guarantees
    GET /api/v1/about/tech-stack    — the technology stack, layer by layer
    GET /api/v1/about/transparency  — what is public vs private + how to verify
    GET /api/v1/about/faq           — frequently asked questions
"""

from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import get_settings

settings = get_settings()
router = APIRouter()


# ── Response Schemas ─────────────────────────────────────────────────────────

class Value(BaseModel):
    code: str = Field(..., examples=["VALUE 01"])
    title: str
    description: str


class Guarantee(BaseModel):
    code: str = Field(..., examples=["GUARANTEE 01"])
    icon: str
    title: str
    description: str
    mechanism: str = Field(..., description="The cryptographic primitive that backs the claim.")


class LifecycleStage(BaseModel):
    phase: str = Field(..., examples=["T₀"])
    title: str
    description: str


class TechComponent(BaseModel):
    layer: str
    name: str
    detail: str


class Milestone(BaseModel):
    year: str
    title: str
    description: str


class Stat(BaseModel):
    value: str
    label: str


class Role(BaseModel):
    name: str
    summary: str


class FAQItem(BaseModel):
    question: str
    answer: str


class Compliance(BaseModel):
    framework: str
    status: str
    detail: str


class TransparencyClaim(BaseModel):
    claim: str
    public: bool = Field(..., description="True if this data is publicly inspectable.")
    how_to_verify: str


class Contact(BaseModel):
    purpose: str
    channel: str


class AboutDocument(BaseModel):
    name: str
    tagline: str
    version: str
    summary: str
    mission: str
    values: list[Value]
    guarantees: list[Guarantee]
    lifecycle: list[LifecycleStage]
    tech_stack: list[TechComponent]
    compliance: list[Compliance]
    roles: list[Role]
    milestones: list[Milestone]
    stats: list[Stat]
    languages: list[str]
    public_endpoints: dict[str, str]
    generated_at: str
    note: str


class TransparencyReport(BaseModel):
    principle: str
    public_data: list[TransparencyClaim]
    private_data: list[TransparencyClaim]
    public_endpoints: dict[str, str]
    contracts: dict[str, str]
    note: str


# ── Canonical Content ────────────────────────────────────────────────────────
# Edit this content to update the public About page and every consumer at once.

_VALUES = [
    Value(code="VALUE 01", title="Verifiability before convenience.",
          description="We will not ship a feature that cannot be independently checked. "
                      "Every claim we make about an examination must produce evidence."),
    Value(code="VALUE 02", title="Transparency without exposure.",
          description="Proofs are public. Personal data is not. Biometrics are processed "
                      "on-device. Question content stays sealed until T₀."),
    Value(code="VALUE 03", title="Built for India, not retrofitted.",
          description="Eleven languages, on-device biometric processing, DPDP Act 2023 "
                      "alignment, and centres designed for the operating reality of Indian "
                      "examination halls."),
]

_GUARANTEES = [
    Guarantee(code="GUARANTEE 01", icon="lock",
              title="No human sees the paper before T₀",
              description="The paper is encrypted at creation and can only be decrypted at "
                          "the broadcast moment, using a key derived from a public randomness beacon.",
              mechanism="AES-GCM-256 + HKDF from the drand randomness beacon"),
    Guarantee(code="GUARANTEE 02", icon="git-merge",
              title="Answer records are immutable",
              description="Each candidate's answers are hashed into a Merkle tree whose root is "
                          "committed on-chain, making any later alteration provably detectable.",
              mechanism="SHA-256 Merkle root committed to Polygon PoS"),
    Guarantee(code="GUARANTEE 03", icon="binary",
              title="Difficulty is machine-verifiable",
              description="A zero-knowledge proof attests that the paper meets its declared "
                          "difficulty distribution — without revealing the questions themselves.",
              mechanism="ZK-SNARK (Groth16) proof verified on-chain"),
    Guarantee(code="GUARANTEE 04", icon="satellite-dish",
              title="Delivery is provable",
              description="Hardware-backed attestation signs the time, place and device of "
                          "delivery, producing a proof that the right paper reached the right centre.",
              mechanism="TPM 2.0 + GPS signed ProofOfDelivery"),
]

_LIFECYCLE = [
    LifecycleStage(phase="PRE-EXAM", title="Key ceremony",
                   description="Custodians split the master key with Shamir's Secret Sharing. "
                               "No single party can open the paper."),
    LifecycleStage(phase="AUTHORING", title="Paper sealed",
                   description="Setters compose and encrypt the paper. A ZK proof certifies its "
                               "difficulty profile."),
    LifecycleStage(phase="T₀", title="Broadcast",
                   description="At the exact start time, the decryption key is released from the "
                               "beacon. Not a second sooner."),
    LifecycleStage(phase="LIVE", title="Session",
                   description="Candidates answer under lockdown. Responses are continuously "
                               "hashed and synced."),
    LifecycleStage(phase="POST-EXAM", title="Commit & audit",
                   description="The Merkle root is committed on-chain. Anyone can verify any "
                               "submission, forever."),
]

_TECH_STACK = [
    TechComponent(layer="Encryption", name="AES-GCM-256 + HKDF",
                  detail="Authenticated encryption of every paper, with keys derived from a "
                         "public randomness beacon so no one holds them early."),
    TechComponent(layer="Time-lock", name="drand randomness beacon",
                  detail=f"Decryption keys become available only at T₀. drand chain hash "
                         f"{settings.DRAND_CHAIN_HASH[:16]}…"),
    TechComponent(layer="Key custody", name="Shamir's Secret Sharing",
                  detail="The master key is split across independent custodians; a quorum is "
                         "required to act, and no individual can open a paper alone."),
    TechComponent(layer="Integrity", name="SHA-256 Merkle commitments",
                  detail="Every candidate submission is hashed into a Merkle tree whose root is "
                         "anchored on-chain, making tampering detectable."),
    TechComponent(layer="Fairness", name="ZK-SNARK (Groth16, CIRCOM)",
                  detail="Zero-knowledge proofs attest a paper meets its declared difficulty "
                         "distribution without revealing any question."),
    TechComponent(layer="Blockchain", name="Polygon PoS",
                  detail=f"Public, permanent, tamper-evident anchor for hashes and proofs "
                         f"(chain id {settings.POLYGON_CHAIN_ID})."),
    TechComponent(layer="Hardware", name="TPM 2.0 attestation",
                  detail="Hardware security nodes sign the time, place and device of paper "
                         "delivery to each centre."),
    TechComponent(layer="Privacy", name="On-device biometrics",
                  detail="Facial embeddings are computed on the candidate's hardware; raw "
                         "biometric data never leaves the device."),
]

_COMPLIANCE = [
    Compliance(framework="Digital Personal Data Protection Act, 2023 (India)",
               status="Aligned",
               detail="Biometric data is processed on-device and never stored in raw form. "
                      "Candidates retain rights to access, correct and erase their data."),
    Compliance(framework="Public auditability",
               status="By design",
               detail="On-chain commitments and proofs are open to any candidate, examiner, "
                      "journalist or court — no account required."),
    Compliance(framework="Dual-control governance",
               status="Enforced",
               detail="Sensitive operations require two-party authorisation and produce a "
                      "signed, time-stamped audit entry."),
]

_ROLES = [
    Role(name="Candidate",
         summary="A focused exam environment with biometric check-in, autosave, and a printable "
                 "cryptographic receipt for every submission."),
    Role(name="Setter",
         summary="An authoring workbench for composing papers, generating ZK difficulty proofs, "
                 "red-team review, and sealing question banks under lock."),
    Role(name="Invigilator",
         summary="Biometric verification of candidates at the centre, live roster management, and "
                 "a one-tap channel to raise alerts and incident reports."),
    Role(name="Administrator",
         summary="A real-time command console for centres, candidates, nodes and emergencies — "
                 "with dual-control authorisation for every sensitive action."),
]

_MILESTONES = [
    Milestone(year="2023", title="The question",
              description="A working group of cryptographers, educators and former examination "
                          "administrators convened to imagine a system that required zero trust."),
    Milestone(year="2024", title="The first sealed paper",
              description="The first paper was sealed under AES-GCM-256 and opened only by a "
                          "public randomness beacon at the appointed second."),
    Milestone(year="2025", title="On-chain commitments",
              description="Merkle commitments to candidate submissions were anchored on Polygon "
                          "PoS — making the integrity of an examination publicly checkable."),
    Milestone(year="2026", title="FAR AWAY Examinations Track",
              description="CryptoExam Core enters the FAR AWAY 2026 Examinations Track — with full "
                          "hardware attestation, ZK difficulty proofs, and a public audit portal."),
]

_STATS = [
    Stat(value="4", label="Cryptographic guarantees on every exam"),
    Stat(value="11", label="Indian languages supported end to end"),
    Stat(value="0 trust", label="Required in any single party or device"),
    Stat(value="100%", label="Of submissions publicly verifiable"),
]

_LANGUAGES = [
    "English", "Hindi", "Bengali", "Tamil", "Telugu", "Kannada",
    "Malayalam", "Marathi", "Gujarati", "Odia", "Punjabi",
]

_FAQ = [
    FAQItem(question="Do I have to trust CryptoExam Core?",
            answer="No. That is the point. Every guarantee is backed by a proof anchored to a "
                   "public blockchain. You can verify any examination yourself on a block "
                   "explorer, without an account and without trusting us, the examining body, "
                   "or the centre."),
    FAQItem(question="How can a paper stay sealed until the exam begins?",
            answer="The paper is encrypted at authoring time. Its decryption key is derived from "
                   "a public randomness beacon and is only available at the scheduled start time, "
                   "T₀. Custody of the master key is split across independent parties using "
                   "Shamir's Secret Sharing, so no individual can open it early."),
    FAQItem(question='What does "machine-verifiable difficulty" mean?',
            answer="Setters declare a target difficulty distribution for each paper. A "
                   "zero-knowledge proof demonstrates the paper meets that distribution without "
                   "revealing the questions — so fairness across paper variants can be checked "
                   "publicly, before anyone sits the exam."),
    FAQItem(question="Is the platform compliant with Indian data law?",
            answer="Yes. CryptoExam Core is built to comply with the Digital Personal Data "
                   "Protection Act, 2023. Biometric data is processed on-device and never leaves "
                   "the candidate's hardware in raw form."),
    FAQItem(question="Which languages are supported?",
            answer="The candidate interface supports 11 Indian languages with native script "
                   "rendering, including Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam, "
                   "Gujarati and Odia."),
]

_PUBLIC_ENDPOINTS = {
    "about": "/api/v1/about",
    "transparency": "/api/v1/about/transparency",
    "guarantees": "/api/v1/about/guarantees",
    "tech_stack": "/api/v1/about/tech-stack",
    "faq": "/api/v1/about/faq",
    "public_exam_verification": "/api/v1/blockchain/verify/{exam_id}",
    "api_documentation": "/docs",
}


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=AboutDocument,
    summary="About CryptoExam Core (public)",
    description="The complete, public, machine-readable document describing the platform — "
                "mission, values, guarantees, lifecycle, technology, compliance and contact. "
                "No authentication required.",
)
async def get_about() -> AboutDocument:
    """Return the canonical About document. Public, no authentication."""
    return AboutDocument(
        name="CryptoExam Core",
        tagline="The math cannot be bribed. The blockchain cannot forget. The hardware cannot lie.",
        version=settings.APP_VERSION,
        summary=(
            "CryptoExam Core is zero-trust examination infrastructure for India. It delivers "
            "high-stakes examinations that are verifiable end to end — from the moment a paper "
            "is sealed to the instant a candidate submits. Integrity is not promised; it is "
            "proven, on-chain, for anyone to inspect."
        ),
        mission=(
            "To make the integrity of every examination publicly provable, in a country where "
            "the consequences are too high to leave to faith alone. We replace institutional "
            "promises with cryptographic proofs — anchored on a public blockchain, open to any "
            "candidate, examiner, journalist or court to inspect."
        ),
        values=_VALUES,
        guarantees=_GUARANTEES,
        lifecycle=_LIFECYCLE,
        tech_stack=_TECH_STACK,
        compliance=_COMPLIANCE,
        roles=_ROLES,
        milestones=_MILESTONES,
        stats=_STATS,
        languages=_LANGUAGES,
        public_endpoints=_PUBLIC_ENDPOINTS,
        generated_at=datetime.now(timezone.utc).isoformat(),
        note="This document is served publicly and without authentication so that anyone may "
             "read, archive and machine-check it. No trust in CryptoExam Core is required.",
    )


@router.get(
    "/guarantees",
    response_model=list[Guarantee],
    summary="The four cryptographic guarantees (public)",
)
async def get_guarantees() -> list[Guarantee]:
    """The four properties every examination satisfies, and the primitive behind each."""
    return _GUARANTEES


@router.get(
    "/tech-stack",
    response_model=list[TechComponent],
    summary="Technology stack (public)",
)
async def get_tech_stack() -> list[TechComponent]:
    """The cryptographic and hardware stack, layer by layer."""
    return _TECH_STACK


@router.get(
    "/faq",
    response_model=list[FAQItem],
    summary="Frequently asked questions (public)",
)
async def get_faq() -> list[FAQItem]:
    """Common questions about verifiability, sealing, fairness and data law."""
    return _FAQ


@router.get(
    "/transparency",
    response_model=TransparencyReport,
    summary="Transparency report — public vs private data (public)",
    description="An explicit account of exactly what data is public, what is private, and how "
                "anyone can independently verify our claims. No authentication required.",
)
async def get_transparency() -> TransparencyReport:
    """What is public, what is private, and precisely how to check us."""
    contract = settings.CRYPTOEXAM_CONTRACT_ADDRESS or "not yet configured"
    explorer = "https://amoy.polygonscan.com"
    return TransparencyReport(
        principle=(
            "We default to openness. Everything needed to verify the integrity of an "
            "examination is public. Everything that could harm a candidate's privacy or the "
            "secrecy of an unopened paper is kept private — by cryptography, not by policy."
        ),
        public_data=[
            TransparencyClaim(
                claim="The sealed paper's question hash, committed before T₀.",
                public=True,
                how_to_verify=f"Read the on-chain commitment on Polygonscan ({explorer}) or via "
                              f"GET /api/v1/blockchain/verify/{{exam_id}}.",
            ),
            TransparencyClaim(
                claim="The ZK-SNARK difficulty proof for each paper.",
                public=True,
                how_to_verify="Verify the Groth16 proof against the on-chain verifier contract.",
            ),
            TransparencyClaim(
                claim="The Merkle root of all candidate answers.",
                public=True,
                how_to_verify="Recompute the root from your receipt's Merkle path and compare to "
                              "the on-chain value.",
            ),
            TransparencyClaim(
                claim="The time, place and device of paper delivery (ProofOfDelivery).",
                public=True,
                how_to_verify="Inspect the TPM 2.0 + GPS signed attestation referenced on-chain.",
            ),
            TransparencyClaim(
                claim="This About document and the full API specification.",
                public=True,
                how_to_verify="Fetch GET /api/v1/about and read the OpenAPI docs at /docs.",
            ),
        ],
        private_data=[
            TransparencyClaim(
                claim="Question content before T₀.",
                public=False,
                how_to_verify="Encrypted under AES-GCM-256; the key is unavailable until the "
                              "drand beacon releases it at T₀.",
            ),
            TransparencyClaim(
                claim="Raw candidate biometrics.",
                public=False,
                how_to_verify="Processed on-device; only a mathematical embedding is used for "
                              "verification and then discarded. Raw data never leaves the device.",
            ),
            TransparencyClaim(
                claim="The link between a candidate's identity and their on-chain answer hash.",
                public=False,
                how_to_verify="On-chain data carries no personal identifiers; the mapping is held "
                              "privately under DPDP Act 2023 controls.",
            ),
        ],
        public_endpoints=_PUBLIC_ENDPOINTS,
        contracts={
            "cryptoexam_core": contract,
            "explorer": explorer,
            "chain": f"Polygon PoS (chain id {settings.POLYGON_CHAIN_ID})",
        },
        note="If any public claim above cannot be reproduced from public data, it is a bug — "
             "please report it. Integrity that cannot be checked is not integrity.",
    )
