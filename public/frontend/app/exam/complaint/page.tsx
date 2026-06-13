/**
 * CryptoExam Core — V3 §9 Public Complaint Portal.
 *
 * Workflow:
 *   1. Candidate gets a CryptoExam receipt (JSON) at exam submission.
 *   2. They paste the receipt here, type the question id + the answer they say they submitted.
 *   3. The engine verifies the Merkle inclusion proof against the anchored root and returns
 *      one of: COMPLAINT_DISMISSED · TAMPERING_DETECTED · PROOF_INVALID · NO_ONCHAIN_ROOT.
 *
 * Public — no login. Court-admissible: the math is the affidavit.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { complaintApi, type CryptoExamReceipt, type ComplaintResult } from '@/lib/api/complaint';

const VERDICT_STYLES: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  COMPLAINT_DISMISSED: { color: '#86efac', bg: 'rgba(22,163,74,0.18)', icon: '✓', label: 'Complaint Dismissed' },
  TAMPERING_DETECTED:  { color: '#fca5a5', bg: 'rgba(220,38,38,0.18)', icon: '', label: 'Tampering Detected' },
  PROOF_INVALID:       { color: '#fcd34d', bg: 'rgba(217,119,6,0.18)', icon: '', label: 'Proof Invalid' },
  NO_ONCHAIN_ROOT:     { color: '#93c5fd', bg: 'rgba(37,99,235,0.18)', icon: 'ℹ', label: 'No On-Chain Root Yet' },
};

export default function ComplaintPortalPage() {
  const [receiptText, setReceiptText] = useState('');
  const [questionId, setQuestionId] = useState('q2');
  const [candidateClaim, setCandidateClaim] = useState('C');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComplaintResult | null>(null);
  const [receipt, setReceipt] = useState<CryptoExamReceipt | null>(null);

  async function generateDemoReceipt() {
    setBusy(true); setError(null);
    try {
      const r = await complaintApi.issueDemoReceipt({ answers: { q1: 'A', q2: 'C', q3: 'B' }, cohort_size: 8, leaf_index: 3 });
      setReceipt(r);
      setReceiptText(JSON.stringify(r, null, 2));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true); setError(null); setResult(null);
    try {
      let parsed: CryptoExamReceipt;
      try { parsed = JSON.parse(receiptText); }
      catch { throw new Error('Receipt is not valid JSON. Paste the full receipt you received after submission.'); }
      const res = await complaintApi.file(parsed, questionId, candidateClaim);
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function tamperReceipt() {
    if (!receipt) return;
    // Forge: change q2 in the receipt JSON without recomputing the Merkle proof → PROOF_INVALID
    const forged = { ...receipt, answers: { ...receipt.answers, q2: 'B' } };
    setReceiptText(JSON.stringify(forged, null, 2));
  }

  const styles = result ? VERDICT_STYLES[result.verdict] : null;

  return (
    <main style={{ minHeight: '100vh', background: '#080E1E', color: '#D8DEF4', padding: 32, fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <span style={{ fontSize: 30 }}></span>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: '#fff', margin: 0 }}>Complaint Resolution Portal</h1>
            <p style={{ color: '#6B84D4', fontSize: 14, margin: '2px 0 0' }}>
              शिकायत निवारण · Court-admissible cryptographic verification — no login required
            </p>
          </div>
        </div>

        <p style={{ color: '#A8B9EA', fontSize: 14, lineHeight: 1.7, marginTop: 20 }}>
          Every candidate receives a <b style={{ color: '#fff' }}>CryptoExam receipt</b> with a Merkle inclusion proof of their answers.
          This portal verifies your receipt against the answer Merkle root <b style={{ color: '#fff' }}>permanently committed to Polygon Amoy</b>.
          If your receipt is valid AND the stored answer matches what you say you submitted, the complaint is dismissed with proof.
          If the stored answer does <i>not</i> match — the math itself becomes the evidence of tampering.
        </p>

        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: '1fr', gap: 18 }}>
          <div style={{ background: '#0D1526', border: '1px solid #1A2D5A', borderRadius: 14, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 15 }}>Step 1 · Your CryptoExam Receipt (JSON)</h3>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={generateDemoReceipt} disabled={busy} style={btnGhost}>Use a demo receipt</button>
                {receipt && <button onClick={tamperReceipt} style={{ ...btnGhost, borderColor: '#7f1d1d', color: '#fca5a5' }} title="Forge the receipt to test the TAMPERING / INVALID_PROOF path">Forge receipt</button>}
              </div>
            </div>
            <textarea
              value={receiptText}
              onChange={(e) => setReceiptText(e.target.value)}
              placeholder='{ "version":"V3", "answers":{"q1":"A","q2":"C"}, "merkle_proof":[...], "merkle_index":3, "merkle_root":"..." }'
              style={textareaStyle}
              spellCheck={false}
            />
          </div>

          <div style={{ background: '#0D1526', border: '1px solid #1A2D5A', borderRadius: 14, padding: 22 }}>
            <h3 style={{ margin: 0, color: '#fff', fontSize: 15 }}>Step 2 · The Question You Are Disputing</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
              <label style={fieldStyle}>
                <span style={labelStyle}>Question ID</span>
                <input value={questionId} onChange={(e) => setQuestionId(e.target.value)} style={inputStyle} placeholder="q2" />
              </label>
              <label style={fieldStyle}>
                <span style={labelStyle}>The answer you say you submitted</span>
                <input value={candidateClaim} onChange={(e) => setCandidateClaim(e.target.value)} style={inputStyle} placeholder="A / B / C / D" />
              </label>
            </div>
            <button onClick={submit} disabled={busy || !receiptText.trim()} style={btnPrimary}>
              {busy ? 'Verifying Merkle proof…' : 'Verify Complaint'}
            </button>
          </div>

          {error && <div style={{ color: '#fca5a5', background: 'rgba(220,38,38,0.12)', padding: 12, borderRadius: 10 }}>{error}</div>}

          {result && styles && (
            <div style={{ background: styles.bg, border: `1px solid ${styles.color}`, borderRadius: 14, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 56 }}>{styles.icon}</span>
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: 0, color: styles.color, fontSize: 26 }}>{styles.label}</h2>
                  <p style={{ margin: '4px 0 0', color: '#e2e8f0', fontSize: 14 }}>{result.explanation}</p>
                </div>
              </div>

              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '180px 1fr', columnGap: 18, rowGap: 8, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                <span style={detailLabel}>Complaint ID</span><span>{result.complaint_id.slice(0, 12)}…</span>
                <span style={detailLabel}>Candidate Claim</span><span style={{ color: '#fff' }}>{result.candidate_claim}</span>
                <span style={detailLabel}>Stored Answer</span><span style={{ color: result.answers_match ? '#86efac' : '#fca5a5' }}>{result.stored_answer}</span>
                <span style={detailLabel}>Receipt Valid</span><span style={{ color: result.receipt_valid ? '#86efac' : '#fca5a5' }}>{result.receipt_valid ? 'yes' : 'no'}</span>
                <span style={detailLabel}>Anchored Root</span><span style={{ wordBreak: 'break-all' }}>{result.onchain_root ?? '—'}</span>
                <span style={detailLabel}>Receipt Root</span><span style={{ wordBreak: 'break-all' }}>{result.receipt_root ?? '—'}</span>
                <span style={detailLabel}>Filed At</span><span>{new Date(result.filed_at).toLocaleString('en-IN')}</span>
              </div>

              <p style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>
                This verdict will be permanently committed to the Polygon Amoy blockchain (event: <code>ComplaintResolved</code>).
                Any High Court may verify the proof from any device — no login required.
              </p>
            </div>
          )}
        </div>

        <p style={{ marginTop: 32, fontSize: 12, color: '#475569' }}>
          <Link href="/" style={{ color: '#6B84D4' }}>← Back to portal</Link>
          {' · '} CryptoExam Core · The math cannot be bribed.
        </p>
      </div>
    </main>
  );
}

const btnPrimary: React.CSSProperties = { marginTop: 18, padding: '14px 24px', background: '#2942A6', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 15 };
const btnGhost: React.CSSProperties = { padding: '8px 14px', background: 'transparent', color: '#A8B9EA', border: '1px solid #1A2D5A', borderRadius: 8, fontSize: 12, cursor: 'pointer' };
const textareaStyle: React.CSSProperties = { width: '100%', minHeight: 160, padding: 14, fontFamily: 'var(--font-mono)', fontSize: 12, color: '#cbd5e1', background: '#08101F', border: '1px solid #1A2D5A', borderRadius: 10, outline: 'none', resize: 'vertical', marginTop: 10 };
const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const labelStyle: React.CSSProperties = { fontSize: 12, color: '#94a3b8', fontWeight: 600 };
const inputStyle: React.CSSProperties = { padding: 12, fontFamily: 'var(--font-mono)', fontSize: 14, color: '#fff', background: '#08101F', border: '1px solid #1A2D5A', borderRadius: 8, outline: 'none' };
const detailLabel: React.CSSProperties = { color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11 };
