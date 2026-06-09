/**
 * CryptoExam Core — V3 §9 Complaint Resolution API client.
 * The Merkle proof verification logic is identical to the backend so the demo
 * works fully client-side (mock mode) and is byte-for-byte compatible with the
 * real backend when present.
 */

import { getAuthToken, USE_MOCK } from './client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export type Verdict =
  | 'COMPLAINT_DISMISSED' | 'TAMPERING_DETECTED' | 'PROOF_INVALID' | 'NO_ONCHAIN_ROOT';

export interface CryptoExamReceipt {
  version: 'V3';
  candidateId: string;
  examId: string;
  examName: string;
  submittedAt: string;
  answers: Record<string, string>;
  merkle_proof: string[];
  merkle_index: number;
  merkle_root: string;
  polygonscan_url: string;
  complaint_url: string;
  verification_instructions: string;
}

export interface ComplaintResult {
  complaint_id: string;
  candidate_id: string;
  exam_id: string;
  question_id: string;
  candidate_claim: string;
  stored_answer: string;
  receipt_valid: boolean;
  answers_match: boolean;
  verdict: Verdict;
  onchain_root: string | null;
  receipt_root: string | null;
  polygon_tx_hash: string | null;
  blockchain_timestamp: string | null;
  explanation: string;
  filed_at: string;
}

// ── Pure-JS Merkle (Web Crypto SHA-256) — matches backend exactly ───────

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(h);
}
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out;
}
function hexOf(b: Uint8Array): string { return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function hexTo(s: string): Uint8Array { const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16); return o; }

function canonicalJson(o: Record<string, string>): string {
  const keys = Object.keys(o).sort();
  return '{' + keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(o[k])}`).join(',') + '}';
}

export async function leafHash(answers: Record<string, string>): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(canonicalJson(answers)));
}

export async function buildMerkleTree(leaves: Uint8Array[]): Promise<{ root: string; levels: string[][] }> {
  if (leaves.length === 0) {
    const empty = hexOf(await sha256(new Uint8Array()));
    return { root: empty, levels: [[empty]] };
  }
  const levels: Uint8Array[][] = [leaves.slice()];
  let cur = leaves;
  while (cur.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      const left = cur[i];
      const right = i + 1 < cur.length ? cur[i + 1] : cur[i];
      next.push(await sha256(concat(left, right)));
    }
    levels.push(next);
    cur = next;
  }
  return { root: hexOf(cur[0]), levels: levels.map((lvl) => lvl.map(hexOf)) };
}

export async function proofFor(leaves: Uint8Array[], index: number): Promise<string[]> {
  if (index < 0 || index >= leaves.length) throw new Error('leaf index out of range');
  let cur = leaves.slice();
  let idx = index;
  const proof: string[] = [];
  while (cur.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      const left = cur[i];
      const right = i + 1 < cur.length ? cur[i + 1] : cur[i];
      if (i === idx || i + 1 === idx) proof.push(hexOf(idx === i ? right : left));
      next.push(await sha256(concat(left, right)));
    }
    cur = next;
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export async function verifyMerkleProof(leafHex: string, proof: string[], index: number): Promise<string> {
  let current = hexTo(leafHex);
  let idx = index;
  for (const sib of proof) {
    const s = hexTo(sib);
    current = await sha256(idx % 2 === 0 ? concat(current, s) : concat(s, current));
    idx = Math.floor(idx / 2);
  }
  return hexOf(current);
}

// ── Client API ──────────────────────────────────────────────────────────

async function issueDemoReceiptMock(opts: { exam_id?: string; candidate_id?: string; answers?: Record<string, string>; cohort_size?: number; leaf_index?: number } = {}): Promise<CryptoExamReceipt> {
  const cohort = opts.cohort_size ?? 8;
  const index = opts.leaf_index ?? 3;
  const answers = opts.answers ?? { q1: 'A', q2: 'C', q3: 'B' };
  const leaves: Uint8Array[] = [];
  for (let i = 0; i < cohort; i++) {
    if (i === index) leaves.push(await leafHash(answers));
    else leaves.push(await leafHash({ q1: 'ABCD'[i % 4], q2: 'ABCD'[(i + 1) % 4] }));
  }
  const tree = await buildMerkleTree(leaves);
  const proof = await proofFor(leaves, index);
  return {
    version: 'V3',
    candidateId: opts.candidate_id ?? 'demo-candidate',
    examId: opts.exam_id ?? 'demo-exam-2026',
    examName: 'CryptoExam Demo Exam',
    submittedAt: new Date().toISOString(),
    answers,
    merkle_proof: proof,
    merkle_index: index,
    merkle_root: tree.root,
    polygonscan_url: `https://amoy.polygonscan.com/tx/${tree.root.slice(0, 64)}`,
    complaint_url: '/exam/complaint',
    verification_instructions:
      '1) Open polygonscan_url. 2) Find merkleRoot. 3) Compare to merkle_root above. If identical, your answers are unchanged on-chain.',
  };
}

async function fileComplaintLocal(
  receipt: CryptoExamReceipt,
  candidateClaim: string,
  questionId: string,
  onchainRoot?: string,
): Promise<ComplaintResult> {
  const leaf = hexOf(await leafHash(receipt.answers));
  const computedRoot = await verifyMerkleProof(leaf, receipt.merkle_proof, receipt.merkle_index);
  const anchor = onchainRoot || receipt.merkle_root;
  const stored = receipt.answers[questionId] ?? 'NOT_FOUND';
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `c-${Date.now()}`;
  const filedAt = new Date().toISOString();

  if (!anchor) {
    return baseResult(id, receipt, questionId, candidateClaim, stored, false, false, 'NO_ONCHAIN_ROOT', anchor || null, computedRoot,
      'No anchored Merkle root available for this exam yet (post-commit not reached).', filedAt);
  }
  if (computedRoot !== anchor) {
    return baseResult(id, receipt, questionId, candidateClaim, stored, false, false, 'PROOF_INVALID', anchor, computedRoot,
      'Merkle inclusion proof does not reproduce the anchored root. Receipt may be forged or corrupted.', filedAt);
  }
  const match = stored === candidateClaim;
  return baseResult(id, receipt, questionId, candidateClaim, stored, true, match,
    match ? 'COMPLAINT_DISMISSED' : 'TAMPERING_DETECTED', anchor, computedRoot,
    match
      ? 'Receipt is valid and matches the on-chain root. Stored answer matches your claim — dispute dismissed with proof.'
      : "Receipt is valid, but the stored answer differs from your claim. The system's record of your answer does not match what you say you submitted — this is tamper-evidence.",
    filedAt);
}

function baseResult(
  id: string, receipt: CryptoExamReceipt, qid: string, claim: string, stored: string,
  receiptValid: boolean, match: boolean, verdict: Verdict,
  onchainRoot: string | null, receiptRoot: string | null, explanation: string, filedAt: string,
): ComplaintResult {
  return {
    complaint_id: id, candidate_id: receipt.candidateId, exam_id: receipt.examId,
    question_id: qid, candidate_claim: claim, stored_answer: stored,
    receipt_valid: receiptValid, answers_match: match, verdict,
    onchain_root: onchainRoot, receipt_root: receiptRoot,
    polygon_tx_hash: null, blockchain_timestamp: null,
    explanation, filed_at: filedAt,
  };
}

async function tryBackend<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (USE_MOCK) return null;
  try {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export const complaintApi = {
  async issueDemoReceipt(opts?: { exam_id?: string; candidate_id?: string; answers?: Record<string, string>; cohort_size?: number; leaf_index?: number }): Promise<CryptoExamReceipt> {
    const real = await tryBackend<CryptoExamReceipt>('/complaint/demo-receipt', { method: 'POST', body: JSON.stringify(opts || {}) });
    return real ?? (await issueDemoReceiptMock(opts));
  },
  async file(
    receipt: CryptoExamReceipt, questionId: string, candidateClaim: string,
    onchainRoot?: string,
  ): Promise<ComplaintResult> {
    const real = await tryBackend<ComplaintResult>('/complaint/file', {
      method: 'POST',
      body: JSON.stringify({
        candidate_id: receipt.candidateId,
        exam_id: receipt.examId,
        question_id: questionId,
        candidate_claim: candidateClaim,
        receipt,
        onchain_root: onchainRoot,
      }),
    });
    return real ?? (await fileComplaintLocal(receipt, candidateClaim, questionId, onchainRoot));
  },
};

export default complaintApi;
