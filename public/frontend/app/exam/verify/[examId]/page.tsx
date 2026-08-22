/**
 * CryptoExam Core — Pre-exam readiness check.
 *
 * Everything on this page used to be invented. The exam came from
 * `mockExams[0]` regardless of the id in the URL, the page announced
 * "✓ Verified" and "Paper difficulty has been verified by ZK proof (Groth16)"
 * for an exam it had never looked up, and the eight system checks were
 * `Math.random() > 0.05` — so a candidate was told their webcam, network and
 * clock were fine without any of them being examined.
 *
 * A readiness check that lies is worse than none: it is relied on precisely
 * when it matters. Each probe below either genuinely tests the thing it names,
 * or reports honestly that a browser cannot test it.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

type Verdict = 'pending' | 'pass' | 'fail' | 'unknown';

interface Check {
  label: string;
  /** `unknown` is a real answer — the browser cannot see an NTP offset. */
  run: () => Promise<Verdict> | Verdict;
  note?: string;
}

interface ExamVerify {
  exam_id: string;
  name?: string;
  status?: string;
  question_hash?: string | null;
  zk_proof_verified?: boolean | null;
  answer_root?: string | null;
}

export default function VerifyPage() {
  const { examId } = useParams<{ examId: string }>();
  const [step, setStep] = useState(0);
  const [exam, setExam] = useState<ExamVerify | null>(null);
  const [examError, setExamError] = useState<string | null>(null);
  const [results, setResults] = useState<Verdict[]>([]);

  // The real public verification record for THIS exam id.
  useEffect(() => {
    if (!examId) return;
    fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}/verify`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'No exam with that id.' : `Verification service returned ${r.status}.`);
        return r.json();
      })
      .then(setExam)
      .catch((e) => setExamError(e instanceof Error ? e.message : 'Could not load the verification record.'));
  }, [examId]);

  const CHECKS: Check[] = [
    {
      label: 'Screen resolution ≥ 1280px',
      run: () => (window.screen.width >= 1280 ? 'pass' : 'fail'),
    },
    {
      label: 'Fullscreen API available',
      run: () => (document.fullscreenEnabled ? 'pass' : 'fail'),
    },
    {
      label: 'Clipboard API present (suppressed during the exam)',
      run: () => ('clipboard' in navigator ? 'pass' : 'fail'),
    },
    {
      label: 'Camera permission',
      // Asks the actual permission layer. Not a camera *test* — that needs a
      // stream the candidate has not consented to yet — but it is real.
      run: async () => {
        if (!navigator.permissions) return 'unknown';
        try {
          const st = await navigator.permissions.query({ name: 'camera' as PermissionName });
          return st.state === 'denied' ? 'fail' : st.state === 'granted' ? 'pass' : 'unknown';
        } catch {
          return 'unknown';
        }
      },
      note: 'Prompted at the centre, not here',
    },
    {
      label: 'Network reaches the examination service',
      run: async () => {
        try {
          const r = await fetch(`${API_BASE.replace(/\/api\/v1$/, '')}/health`, { cache: 'no-store' });
          return r.ok ? 'pass' : 'fail';
        } catch {
          return 'fail';
        }
      },
    },
    {
      label: 'Browser supports the exam runtime',
      run: () => (typeof window.crypto?.subtle?.digest === 'function' ? 'pass' : 'fail'),
      note: 'WebCrypto is required to open sealed questions',
    },
    {
      label: 'Clock accuracy vs the server',
      // The one check a browser genuinely cannot do alone; comparing against
      // the server's Date header is the honest approximation, and a large
      // offset is worth surfacing because T₀ is time-gated.
      run: async () => {
        try {
          const t0 = Date.now();
          const r = await fetch(`${API_BASE.replace(/\/api\/v1$/, '')}/health`, { cache: 'no-store' });
          const serverDate = r.headers.get('date');
          if (!serverDate) return 'unknown';
          const skew = Math.abs(new Date(serverDate).getTime() - (t0 + Date.now()) / 2);
          return skew < 120_000 ? 'pass' : 'fail';
        } catch {
          return 'unknown';
        }
      },
      note: 'Compared with the server clock',
    },
  ];

  const runChecks = useCallback(async () => {
    setResults(new Array(CHECKS.length).fill('pending'));
    for (let i = 0; i < CHECKS.length; i++) {
      const v = await CHECKS[i].run();
      setResults((prev) => { const next = [...prev]; next[i] = v; return next; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (step === 1) runChecks(); }, [step, runChecks]);

  const blocking = results.filter((r) => r === 'fail').length;
  const settled = results.length > 0 && !results.includes('pending');

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', animation: 'fadeIn 300ms ease forwards' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 32 }}>
        {['Exam record', 'Readiness', 'Brief'].map((s, i) => (
          <div key={i} style={{ flex: 1, padding: '10px 16px', borderRadius: 8, background: i <= step ? 'var(--color-navy-600)' : 'var(--color-navy-50)', textAlign: 'center', fontSize: 13, fontWeight: i <= step ? 600 : 400, color: i <= step ? 'white' : 'var(--color-navy-400)' }}>
            {i < step ? '✓' : i + 1}. {s}
          </div>
        ))}
      </div>

      {step === 0 && (
        <section style={card}>
          <h2 style={h2}>Examination record</h2>
          {examError && <p style={bad}>{examError}</p>}
          {!exam && !examError && <p style={muted}>Looking up this examination…</p>}
          {exam && (
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 18px', fontSize: 13.5, margin: 0 }}>
              <dt style={dt}>Examination</dt><dd style={dd}>{exam.name ?? '—'}</dd>
              <dt style={dt}>Status</dt><dd style={dd}>{exam.status ?? '—'}</dd>
              <dt style={dt}>Question commitment</dt>
              <dd style={{ ...dd, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, wordBreak: 'break-all' }}>
                {exam.question_hash ?? 'not yet sealed'}
              </dd>
              <dt style={dt}>Difficulty proof</dt>
              <dd style={dd}>
                {exam.zk_proof_verified === true
                  ? 'Groth16 proof verified'
                  : exam.zk_proof_verified === false
                    ? 'Proof present but NOT verified'
                    : 'No proof recorded for this exam yet'}
              </dd>
            </dl>
          )}
          <button style={btn} onClick={() => setStep(1)} disabled={!exam}>Continue to readiness →</button>
        </section>
      )}

      {step === 1 && (
        <section style={card}>
          <h2 style={h2}>Readiness of this device</h2>
          <p style={muted}>
            Only what this browser can genuinely determine. Anything it cannot test says so
            rather than reporting a pass.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0', display: 'grid', gap: 10 }}>
            {CHECKS.map((c, i) => {
              const v = results[i] ?? 'pending';
              const mark = v === 'pass' ? '✓' : v === 'fail' ? '✗' : v === 'unknown' ? '?' : '…';
              const colour = v === 'pass' ? '#047857' : v === 'fail' ? '#b91c1c' : '#7C8AB8';
              return (
                <li key={c.label} style={{ display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 13.5 }}>
                  <span style={{ color: colour, fontWeight: 700, width: 14 }}>{mark}</span>
                  <span>
                    {c.label}
                    {c.note && <span style={{ color: '#7C8AB8', fontSize: 12 }}> — {c.note}</span>}
                    {v === 'unknown' && <span style={{ color: '#7C8AB8', fontSize: 12 }}> (cannot be determined here)</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {settled && blocking > 0 && (
            <p style={bad}>{blocking} check(s) failed. Raise this with your centre before exam day.</p>
          )}
          <button style={btn} onClick={() => setStep(2)} disabled={!settled}>Continue →</button>
        </section>
      )}

      {step === 2 && (
        <section style={card}>
          <h2 style={h2}>On exam day</h2>
          <p style={muted}>
            You do not sit the examination in this browser. You are verified by face and
            fingerprint at your centre, and the paper opens on a sealed terminal at T₀ —
            which is why the commitment above can be published in advance without
            revealing anything.
          </p>
          <Link href="/center-access" style={{ ...btn, display: 'inline-block', textDecoration: 'none', textAlign: 'center' }}>
            How centre access works
          </Link>
        </section>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border-soft)', borderRadius: 12, padding: 24 };
const h2: React.CSSProperties = { fontSize: 17, color: 'var(--color-navy-900)', margin: '0 0 10px' };
const muted: React.CSSProperties = { fontSize: 13, color: 'var(--color-navy-500)', lineHeight: 1.65, margin: '0 0 12px' };
const dt: React.CSSProperties = { color: 'var(--color-navy-400)' };
const dd: React.CSSProperties = { margin: 0, color: 'var(--color-navy-800)' };
const bad: React.CSSProperties = { padding: '11px 13px', borderRadius: 8, border: '1px solid rgba(200,32,32,0.35)', background: 'rgba(200,32,32,0.06)', color: '#b91c1c', fontSize: 13 };
const btn: React.CSSProperties = { marginTop: 18, padding: '11px 18px', borderRadius: 8, border: 0, background: 'var(--color-navy-900)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
