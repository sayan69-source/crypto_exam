/**
 * Candidate inclusion check — the interactive half of the public audit page.
 *
 * Lives in its own file because the audit page is a server component (it
 * exports `metadata`), and this needs state. The button it replaces had no
 * handler at all: an auditor typed a roll number, pressed Verify, and nothing
 * happened — on the page whose entire purpose is "check us, do not trust us".
 */
'use client';

import { useState } from 'react';
import styles from './audit-detail.module.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export default function CandidateInclusion({ examId }: { examId: string }) {
  const [roll, setRoll] = useState('');
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);

  async function verify() {
    setChecking(true);
    setVerdict(null);
    try {
      const res = await fetch(
        `${API_BASE}/lifecycle/${encodeURIComponent(examId)}/verify-candidate/${encodeURIComponent(roll.trim())}`,
        { cache: 'no-store' },
      );
      const body = await res.json().catch(() => ({}));

      if (res.status === 404) {
        setVerdict({
          ok: false,
          text: 'No committed answer record was found for that roll number in this exam. Either the roll is wrong, or nothing was submitted from that seat.',
        });
      } else if (!res.ok) {
        const d = body.detail;
        setVerdict({
          ok: false,
          text: typeof d === 'string' ? d : d?.message || `The audit service could not answer (${res.status}).`,
        });
      } else if (body.included || body.verified) {
        setVerdict({
          ok: true,
          text: `Included. Leaf ${String(body.leaf ?? body.leaf_hash ?? '').slice(0, 20)}… verifies against the committed answer root — this record was in the tree when it was anchored, and has not changed since.`,
        });
      } else {
        setVerdict({
          ok: false,
          text: 'That record does NOT verify against the committed root. Report this — it is exactly the condition this page exists to surface.',
        });
      }
    } catch {
      // An unreachable audit service must not read as "not included".
      setVerdict({ ok: false, text: 'The audit service is unreachable, so nothing could be checked. This is not a verdict about the record.' });
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <div className={styles.candidateForm}>
        <input
          type="text"
          placeholder="Enter Roll Number"
          className={styles.input}
          value={roll}
          onChange={(e) => setRoll(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && roll.trim()) verify(); }}
        />
        <button className={styles.verifyBtn} onClick={verify} disabled={checking || !roll.trim()}>
          {checking ? 'Checking…' : 'Verify Inclusion'}
        </button>
      </div>
      {verdict && (
        <p
          role="status"
          style={{
            marginTop: 14,
            padding: '12px 14px',
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.6,
            border: `1px solid ${verdict.ok ? 'rgba(74,222,128,0.4)' : 'rgba(248,113,113,0.4)'}`,
            background: verdict.ok ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
            color: verdict.ok ? '#4ade80' : '#fca5a5',
          }}
        >
          {verdict.text}
        </p>
      )}
    </>
  );
}
