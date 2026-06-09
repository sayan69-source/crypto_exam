/**
 * CryptoExam Core — Public Transparency / About client
 *
 * Mirrors the public backend at GET /api/v1/about*. These endpoints require
 * no authentication: the platform documents itself in the open. When the
 * backend is reachable the live document is used; otherwise we fall back to a
 * bundled snapshot so the public About page always renders.
 */

import { USE_MOCK } from './client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

// ── Types (mirror app/api/v1/about.py) ──

export interface Value { code: string; title: string; description: string; }
export interface Guarantee { code: string; icon: string; title: string; description: string; mechanism: string; }
export interface LifecycleStage { phase: string; title: string; description: string; }
export interface TechComponent { layer: string; name: string; detail: string; }
export interface Compliance { framework: string; status: string; detail: string; }
export interface Role { name: string; summary: string; }
export interface Milestone { year: string; title: string; description: string; }
export interface Stat { value: string; label: string; }
export interface FAQItem { question: string; answer: string; }
export interface TransparencyClaim { claim: string; public: boolean; how_to_verify: string; }

export interface AboutDocument {
  name: string;
  tagline: string;
  version: string;
  summary: string;
  mission: string;
  values: Value[];
  guarantees: Guarantee[];
  lifecycle: LifecycleStage[];
  tech_stack: TechComponent[];
  compliance: Compliance[];
  roles: Role[];
  milestones: Milestone[];
  stats: Stat[];
  languages: string[];
  public_endpoints: Record<string, string>;
  generated_at: string;
  note: string;
}

export interface TransparencyReport {
  principle: string;
  public_data: TransparencyClaim[];
  private_data: TransparencyClaim[];
  public_endpoints: Record<string, string>;
  contracts: Record<string, string>;
  note: string;
}

// ── Bundled fallback snapshot (kept in sync with the backend) ──

const FALLBACK_GUARANTEES: Guarantee[] = [
  { code: 'GUARANTEE 01', icon: 'lock', title: 'No human sees the paper before T₀', description: 'The paper is encrypted at creation and can only be decrypted at the broadcast moment, using a key derived from a public randomness beacon.', mechanism: 'AES-GCM-256 + HKDF from the drand randomness beacon' },
  { code: 'GUARANTEE 02', icon: 'git-merge', title: 'Answer records are immutable', description: "Each candidate's answers are hashed into a Merkle tree whose root is committed on-chain, making any later alteration provably detectable.", mechanism: 'SHA-256 Merkle root committed to Polygon PoS' },
  { code: 'GUARANTEE 03', icon: 'binary', title: 'Difficulty is machine-verifiable', description: 'A zero-knowledge proof attests that the paper meets its declared difficulty distribution — without revealing the questions themselves.', mechanism: 'ZK-SNARK (Groth16) proof verified on-chain' },
  { code: 'GUARANTEE 04', icon: 'satellite-dish', title: 'Delivery is provable', description: 'Hardware-backed attestation signs the time, place and device of delivery, producing a proof that the right paper reached the right centre.', mechanism: 'TPM 2.0 + GPS signed ProofOfDelivery' },
];

const FALLBACK_TECH: TechComponent[] = [
  { layer: 'Encryption', name: 'AES-GCM-256 + HKDF', detail: 'Authenticated encryption of every paper, with keys derived from a public randomness beacon so no one holds them early.' },
  { layer: 'Time-lock', name: 'drand randomness beacon', detail: 'Decryption keys become available only at T₀ — not a second sooner.' },
  { layer: 'Key custody', name: "Shamir's Secret Sharing", detail: 'The master key is split across independent custodians; a quorum is required to act, and no individual can open a paper alone.' },
  { layer: 'Integrity', name: 'SHA-256 Merkle commitments', detail: 'Every candidate submission is hashed into a Merkle tree whose root is anchored on-chain, making tampering detectable.' },
  { layer: 'Fairness', name: 'ZK-SNARK (Groth16, CIRCOM)', detail: 'Zero-knowledge proofs attest a paper meets its declared difficulty distribution without revealing any question.' },
  { layer: 'Blockchain', name: 'Polygon PoS', detail: 'Public, permanent, tamper-evident anchor for hashes and proofs.' },
  { layer: 'Hardware', name: 'TPM 2.0 attestation', detail: 'Hardware security nodes sign the time, place and device of paper delivery to each centre.' },
  { layer: 'Privacy', name: 'On-device biometrics', detail: "Facial embeddings are computed on the candidate's hardware; raw biometric data never leaves the device." },
];

const FALLBACK_PUBLIC_ENDPOINTS: Record<string, string> = {
  about: '/api/v1/about',
  transparency: '/api/v1/about/transparency',
  guarantees: '/api/v1/about/guarantees',
  tech_stack: '/api/v1/about/tech-stack',
  faq: '/api/v1/about/faq',
  public_exam_verification: '/api/v1/blockchain/verify/{exam_id}',
  api_documentation: '/docs',
};

const FALLBACK_ABOUT: AboutDocument = {
  name: 'CryptoExam Core',
  tagline: 'The math cannot be bribed. The blockchain cannot forget. The hardware cannot lie.',
  version: '0.1.0',
  summary: 'CryptoExam Core is zero-trust examination infrastructure for India. It delivers high-stakes examinations that are verifiable end to end — from the moment a paper is sealed to the instant a candidate submits. Integrity is not promised; it is proven, on-chain, for anyone to inspect.',
  mission: 'To make the integrity of every examination publicly provable, in a country where the consequences are too high to leave to faith alone. We replace institutional promises with cryptographic proofs — anchored on a public blockchain, open to any candidate, examiner, journalist or court to inspect.',
  values: [
    { code: 'VALUE 01', title: 'Verifiability before convenience.', description: 'We will not ship a feature that cannot be independently checked. Every claim we make about an examination must produce evidence.' },
    { code: 'VALUE 02', title: 'Transparency without exposure.', description: 'Proofs are public. Personal data is not. Biometrics are processed on-device. Question content stays sealed until T₀.' },
    { code: 'VALUE 03', title: 'Built for India, not retrofitted.', description: 'Eleven languages, on-device biometric processing, DPDP Act 2023 alignment, and centres designed for the operating reality of Indian examination halls.' },
  ],
  guarantees: FALLBACK_GUARANTEES,
  lifecycle: [
    { phase: 'PRE-EXAM', title: 'Key ceremony', description: "Custodians split the master key with Shamir's Secret Sharing. No single party can open the paper." },
    { phase: 'AUTHORING', title: 'Paper sealed', description: 'Setters compose and encrypt the paper. A ZK proof certifies its difficulty profile.' },
    { phase: 'T₀', title: 'Broadcast', description: 'At the exact start time, the decryption key is released from the beacon. Not a second sooner.' },
    { phase: 'LIVE', title: 'Session', description: 'Candidates answer under lockdown. Responses are continuously hashed and synced.' },
    { phase: 'POST-EXAM', title: 'Commit & audit', description: 'The Merkle root is committed on-chain. Anyone can verify any submission, forever.' },
  ],
  tech_stack: FALLBACK_TECH,
  compliance: [
    { framework: 'Digital Personal Data Protection Act, 2023 (India)', status: 'Aligned', detail: 'Biometric data is processed on-device and never stored in raw form. Candidates retain rights to access, correct and erase their data.' },
    { framework: 'Public auditability', status: 'By design', detail: 'On-chain commitments and proofs are open to any candidate, examiner, journalist or court — no account required.' },
    { framework: 'Dual-control governance', status: 'Enforced', detail: 'Sensitive operations require two-party authorisation and produce a signed, time-stamped audit entry.' },
  ],
  roles: [
    { name: 'Candidate', summary: 'A focused exam environment with biometric check-in, autosave, and a printable cryptographic receipt for every submission.' },
    { name: 'Setter', summary: 'An authoring workbench for composing papers, generating ZK difficulty proofs, red-team review, and sealing question banks under lock.' },
    { name: 'Invigilator', summary: 'Biometric verification of candidates at the centre, live roster management, and a one-tap channel to raise alerts and incident reports.' },
    { name: 'Administrator', summary: 'A real-time command console for centres, candidates, nodes and emergencies — with dual-control authorisation for every sensitive action.' },
  ],
  milestones: [
    { year: '2023', title: 'The question', description: 'A working group of cryptographers, educators and former examination administrators convened to imagine a system that required zero trust.' },
    { year: '2024', title: 'The first sealed paper', description: 'The first paper was sealed under AES-GCM-256 and opened only by a public randomness beacon at the appointed second.' },
    { year: '2025', title: 'On-chain commitments', description: 'Merkle commitments to candidate submissions were anchored on Polygon PoS — making the integrity of an examination publicly checkable.' },
    { year: '2026', title: 'FAR AWAY Examinations Track', description: 'CryptoExam Core enters the FAR AWAY 2026 Examinations Track — with full hardware attestation, ZK difficulty proofs, and a public audit portal.' },
  ],
  stats: [
    { value: '4', label: 'Cryptographic guarantees on every exam' },
    { value: '11', label: 'Indian languages supported end to end' },
    { value: '0 trust', label: 'Required in any single party or device' },
    { value: '100%', label: 'Of submissions publicly verifiable' },
  ],
  languages: ['English', 'Hindi', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Gujarati', 'Odia', 'Punjabi'],
  public_endpoints: FALLBACK_PUBLIC_ENDPOINTS,
  generated_at: new Date().toISOString(),
  note: 'This document is served publicly and without authentication so that anyone may read, archive and machine-check it. No trust in CryptoExam Core is required.',
};

const FALLBACK_TRANSPARENCY: TransparencyReport = {
  principle: 'We default to openness. Everything needed to verify the integrity of an examination is public. Everything that could harm a candidate’s privacy or the secrecy of an unopened paper is kept private — by cryptography, not by policy.',
  public_data: [
    { claim: 'The sealed paper’s question hash, committed before T₀.', public: true, how_to_verify: 'Read the on-chain commitment on Polygonscan or via GET /api/v1/blockchain/verify/{exam_id}.' },
    { claim: 'The ZK-SNARK difficulty proof for each paper.', public: true, how_to_verify: 'Verify the Groth16 proof against the on-chain verifier contract.' },
    { claim: 'The Merkle root of all candidate answers.', public: true, how_to_verify: 'Recompute the root from your receipt’s Merkle path and compare to the on-chain value.' },
    { claim: 'The time, place and device of paper delivery (ProofOfDelivery).', public: true, how_to_verify: 'Inspect the TPM 2.0 + GPS signed attestation referenced on-chain.' },
    { claim: 'This About document and the full API specification.', public: true, how_to_verify: 'Fetch GET /api/v1/about and read the OpenAPI docs at /docs.' },
  ],
  private_data: [
    { claim: 'Question content before T₀.', public: false, how_to_verify: 'Encrypted under AES-GCM-256; the key is unavailable until the drand beacon releases it at T₀.' },
    { claim: 'Raw candidate biometrics.', public: false, how_to_verify: 'Processed on-device; only a mathematical embedding is used for verification and then discarded. Raw data never leaves the device.' },
    { claim: 'The link between a candidate’s identity and their on-chain answer hash.', public: false, how_to_verify: 'On-chain data carries no personal identifiers; the mapping is held privately under DPDP Act 2023 controls.' },
  ],
  public_endpoints: FALLBACK_PUBLIC_ENDPOINTS,
  contracts: {
    cryptoexam_core: 'not yet configured',
    explorer: 'https://amoy.polygonscan.com',
    chain: 'Polygon PoS (chain id 80002)',
  },
  note: 'If any public claim above cannot be reproduced from public data, it is a bug — please report it. Integrity that cannot be checked is not integrity.',
};

// ── Public URLs (so the UI can link people straight to the raw, no-login data) ──

/** Absolute URL of the public About JSON document. */
export const ABOUT_API_URL = `${API_BASE}/about`;
/** Absolute URL of the public transparency report. */
export const TRANSPARENCY_API_URL = `${API_BASE}/about/transparency`;
/** Absolute URL of the interactive OpenAPI docs. */
export const API_DOCS_URL = API_BASE.replace(/\/api\/v1\/?$/, '') + '/docs';

// ── Fetch helpers (public — no auth) ──

async function fetchJson<T>(path: string): Promise<T | null> {
  if (USE_MOCK) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const aboutApi = {
  /** The complete public About document. Live when the backend is up, bundled snapshot otherwise. */
  async get(): Promise<AboutDocument> {
    return (await fetchJson<AboutDocument>('/about')) ?? FALLBACK_ABOUT;
  },
  /** The transparency report — what is public, what is private, and how to verify it. */
  async transparency(): Promise<TransparencyReport> {
    return (await fetchJson<TransparencyReport>('/about/transparency')) ?? FALLBACK_TRANSPARENCY;
  },
  /** Fetch both documents at once and report whether the live public backend answered. */
  async load(): Promise<{ about: AboutDocument; transparency: TransparencyReport; live: boolean }> {
    const [a, t] = await Promise.all([
      fetchJson<AboutDocument>('/about'),
      fetchJson<TransparencyReport>('/about/transparency'),
    ]);
    return {
      about: a ?? FALLBACK_ABOUT,
      transparency: t ?? FALLBACK_TRANSPARENCY,
      live: a !== null,
    };
  },
};

export { FALLBACK_ABOUT, FALLBACK_TRANSPARENCY };
export default aboutApi;
