/**
 * CryptoExam Core — CC-SSS §§ 54–55 Key Ceremony Portal (public).
 *
 *   Phase 1 — Attestation verification (PCR0 comparison)
 *   Phase 2 — Each official submits an SSS share (encrypted to enclave's RSA-OAEP key)
 *   Phase 3 — Threshold reached → decrypt one question through the enclave
 *
 * Bypass: in mock/demo mode all 5 shares are returned at once so the portal can
 * simulate the 5 officials submitting one-by-one without 5 separate hardware tokens.
 */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ceremonyApi, encryptShareForEnclave, type AttestationResponse, type CeremonyStatus, type DemoPrepareResponse, type ShareEncoded, type AuditEntry } from '@/lib/api/ceremony';

const EXAM_ID = 'demo-cc-2026';

const OFFICIALS = [
  { id: 'off-1', role: 'NTA Director', icon: '🏛️' },
  { id: 'off-2', role: 'Exam Board Chair', icon: '⚖️' },
  { id: 'off-3', role: 'Independent Observer', icon: '🕵️' },
  { id: 'off-4', role: 'Centre Coordinator', icon: '📋' },
  { id: 'off-5', role: 'Ministry Observer', icon: '🏢' },
];

export default function CeremonyPortal() {
  const [expected, setExpected] = useState<{ expected_pcr0: string } | null>(null);
  const [attestation, setAttestation] = useState<AttestationResponse | null>(null);
  const [prep, setPrep] = useState<DemoPrepareResponse | null>(null);
  const [status, setStatus] = useState<CeremonyStatus | null>(null);
  const [logs, setLogs] = useState<{ ts: string; msg: string; tone?: 'ok' | 'err' | 'info' }[]>([]);
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [busyShare, setBusyShare] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  function log(msg: string, tone: 'ok' | 'err' | 'info' = 'info') {
    setLogs((prev) => [{ ts: new Date().toLocaleTimeString('en-IN'), msg, tone }, ...prev].slice(0, 20));
  }

  async function refreshStatus() {
    const [s, a] = await Promise.all([
      ceremonyApi.getStatus(EXAM_ID),
      ceremonyApi.getAuditLog(EXAM_ID, 20),
    ]);
    setStatus(s); setAudit(a); return s;
  }

  useEffect(() => {
    (async () => {
      try {
        const [ep, at] = await Promise.all([ceremonyApi.getExpectedPcr0(), ceremonyApi.getAttestation()]);
        setExpected({ expected_pcr0: ep.expected_pcr0 });
        setAttestation(at);
        log(`Attestation received · PCR0 ${at.pcr_match ? 'MATCHES' : '!! MISMATCH !!'}`, at.pcr_match ? 'ok' : 'err');
        await refreshStatus();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  async function startCeremony() {
    setError(null); setDecrypted(null); setLogs([]);
    try {
      const p = await ceremonyApi.demoPrepare(EXAM_ID);
      setPrep(p);
      log(`Master key split — 5 shares issued (k=${p.threshold}, n=${p.total_officials}). Master discarded.`, 'ok');
      log('Each share would normally be mailed to one official via hardware token. Mock returns all 5.', 'info');
      await refreshStatus();
    } catch (e) { setError((e as Error).message); }
  }

  async function submitShareAs(official: { id: string; role: string }, share: ShareEncoded) {
    if (!attestation) { setError('no attestation document yet'); return; }
    setBusyShare(official.id); setError(null);
    try {
      // Wrap the share to the enclave's RSA-OAEP key, then submit
      const wrapped = await encryptShareForEnclave(share, attestation.enclave_public_key_pem);
      const r = await ceremonyApi.submitShare(EXAM_ID, official.id, wrapped);
      log(`${official.role} submitted share #${share.x} · count ${r.shares_received}/${r.threshold}${r.threshold_met ? ' · THRESHOLD MET' : ''}`, 'ok');
      await refreshStatus();
    } catch (e) {
      log(`${official.role}: ${(e as Error).message}`, 'err');
      setError((e as Error).message);
    } finally { setBusyShare(null); }
  }

  async function decryptOneQuestion() {
    setError(null);
    try {
      const out = await ceremonyApi.processQuestion(EXAM_ID, 0);
      setDecrypted(out.question_json);
      log('Question #0 decrypted inside the enclave. Plaintext never touched proxy memory.', 'ok');
    } catch (e) { setError((e as Error).message); }
  }

  const submitted = new Set((status?.shares_submitted ?? []).map((s) => s.official_id));
  const thresholdMet = status?.threshold_met ?? false;
  const pcrMatch = attestation?.pcr_match ?? false;

  return (
    <main style={page}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <header style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 30 }}>🔐</span>
            <div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30, color: '#fff', margin: 0 }}>Key Ceremony Portal · CC-SSS</h1>
              <p style={{ margin: '2px 0 0', color: '#6B84D4', fontSize: 13 }}>
                §§ 49–62 · Shamir's Secret Sharing + AWS Nitro Enclave Attestation (simulated locally)
              </p>
            </div>
          </div>
          <p style={{ color: '#A8B9EA', fontSize: 14, lineHeight: 1.7, marginTop: 16 }}>
            The exam encryption key was split into <b style={{ color: '#fff' }}>5 mathematical shares</b>.
            Any <b style={{ color: '#fff' }}>3 of 5</b> reconstruct it; fewer reveal <i>zero bits</i>. Reconstruction happens only
            inside a hardware-isolated enclave whose code identity (PCR0) you verify below.
            <br />Public — no login. Anyone can watch the ceremony.
          </p>
        </header>

        {error && <div style={errBox}>⚠️ {error}</div>}

        {/* PHASE 1 — Attestation */}
        <section style={card}>
          <h2 style={cardH2}>Phase 1 · Enclave Attestation</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <div style={pcrBox}>
              <div style={pcrLabel}>Expected PCR0 (from repo)</div>
              <code style={pcrCode}>{expected?.expected_pcr0 ?? '…'}</code>
              <div style={pcrHint}>SHA-384 hash of the enclave processor source</div>
            </div>
            <div style={pcrBox}>
              <div style={pcrLabel}>Live attestation PCR0</div>
              <code style={{ ...pcrCode, color: pcrMatch ? '#86efac' : '#fca5a5' }}>{attestation?.pcr0 ?? '…'}</code>
              <div style={pcrHint}>{attestation?.module_id} · nonce {attestation?.nonce.slice(0, 12)}…</div>
            </div>
          </div>
          <div style={{
            marginTop: 14, padding: '12px 16px', borderRadius: 8, fontWeight: 700, fontSize: 14,
            background: pcrMatch ? 'rgba(22,163,74,0.18)' : 'rgba(220,38,38,0.18)',
            color: pcrMatch ? '#86efac' : '#fca5a5',
          }}>
            {pcrMatch ? '✅ Enclave verified — safe to submit shares' : '🛑 PCR0 MISMATCH — DO NOT SUBMIT. Alert the exam board.'}
          </div>
        </section>

        {/* PHASE 2 — Share submission */}
        <section style={{ ...card, opacity: pcrMatch ? 1 : 0.5 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ ...cardH2, margin: 0 }}>Phase 2 · Share Submission</h2>
            <button onClick={startCeremony} disabled={!pcrMatch} style={btn} title="Issue a fresh SSS-split master key for this ceremony">
              {prep ? '↻ Restart ceremony' : '▶ Begin ceremony (issue 5 shares)'}
            </button>
          </div>

          <ProgressBar status={status} />

          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {OFFICIALS.map((o, i) => {
              const share = prep?.shares[i];
              const has = submitted.has(o.id);
              return (
                <div key={o.id} style={{ ...miniCard, borderColor: has ? '#16a34a' : '#1A2D5A' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{o.icon}</span>
                    <b style={{ color: '#fff', fontSize: 14 }}>{o.role}</b>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                    {share ? `Share x=${share.x} · checksum ${share.checksum}` : 'no share yet — start ceremony'}
                  </div>
                  <button
                    onClick={() => share && submitShareAs(o, share)}
                    disabled={!pcrMatch || !share || has || busyShare === o.id}
                    style={{ ...btn, marginTop: 10, width: '100%', padding: '8px 12px', fontSize: 12,
                             background: has ? '#374151' : busyShare === o.id ? '#374151' : '#2942A6',
                             cursor: has ? 'default' : 'pointer' }}>
                    {has ? '✅ Submitted' : busyShare === o.id ? 'Wrapping & submitting…' : '🔒 Submit Share'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* PHASE 3 — Decrypt one question */}
        <section style={{ ...card, opacity: thresholdMet ? 1 : 0.55 }}>
          <h2 style={cardH2}>Phase 3 · Decrypt One Question Through the Enclave</h2>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 0 }}>
            With ≥ 3 shares submitted, the enclave can reconstruct the SSS key, derive HKDF(SSS_KEY ‖ drand,
            salt=exam_id, info=qN), and decrypt one question. Plaintext appears only inside enclave memory and
            in the JSON returned over TLS — never on the parent.
          </p>
          <button onClick={decryptOneQuestion} disabled={!thresholdMet} style={btn}>🔓 Decrypt Question #0</button>
          {decrypted && (
            <pre style={decryptedBox}>{decrypted}</pre>
          )}
        </section>

        {/* AUDIT LOG + on-chain audit */}
        <section style={card}>
          <h2 style={cardH2}>Phase 4 · Public Ceremony Log</h2>

          {audit.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                On-chain audit (Polygon Amoy)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {audit.map((e) => (
                  <a key={e.tx_hash} href={e.polygonscan_url} target="_blank" rel="noreferrer" style={auditRow}>
                    <span style={{ color: badgeFor(e.event), fontWeight: 700 }}>
                      {e.event === 'CeremonyShareSubmitted' ? '📝' : e.event === 'CeremonyCompleted' ? '✅' : '🛡️'} {e.event}
                    </span>
                    <code style={{ color: '#6B84D4', fontSize: 11 }}>{e.tx_hash.slice(0, 18)}…</code>
                    <span style={{ color: '#64748b', fontSize: 11, marginLeft: 'auto' }}>
                      {new Date(e.timestamp).toLocaleTimeString('en-IN')} → polygonscan ↗
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {logs.length === 0 ? <div style={{ color: '#64748b', fontSize: 13 }}>No events yet.</div> :
            <>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Portal activity
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {logs.map((l, i) => (
                  <div key={i} style={{ color: l.tone === 'ok' ? '#86efac' : l.tone === 'err' ? '#fca5a5' : '#cbd5e1' }}>
                    <span style={{ color: '#475569' }}>{l.ts}</span>  {l.msg}
                  </div>
                ))}
              </div>
            </>}
        </section>

        <p style={{ marginTop: 32, fontSize: 12, color: '#475569' }}>
          <Link href="/" style={{ color: '#6B84D4' }}>← Back to portal</Link>
          {' · '} CryptoExam Core · The key holder is the math. The vault is the hardware.
        </p>
      </div>
    </main>
  );
}

function ProgressBar({ status }: { status: CeremonyStatus | null }) {
  const count = status?.shares_count ?? 0;
  const threshold = status?.threshold ?? 3;
  const total = status?.total_officials ?? 5;
  return (
    <div>
      <div style={{ height: 10, background: '#1A2D5A', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, (count / threshold) * 100)}%`, height: '100%',
          background: count >= threshold ? 'linear-gradient(90deg, #16a34a, #22c55e)' : 'linear-gradient(90deg, #2942A6, #6B84D4)',
          transition: 'width 200ms' }} />
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
        <span>{count} / {threshold} required shares received {count >= threshold && '· threshold met'}</span>
        <span>{total - count} remaining officials</span>
      </div>
    </div>
  );
}

const page: React.CSSProperties = { minHeight: '100vh', background: '#080E1E', color: '#D8DEF4', padding: 32, fontFamily: 'var(--font-sans)' };
const card: React.CSSProperties = { background: '#0D1526', border: '1px solid #1A2D5A', borderRadius: 14, padding: 22, marginBottom: 18 };
const cardH2: React.CSSProperties = { color: '#fff', fontSize: 16, margin: '0 0 12px' };
const btn: React.CSSProperties = { padding: '10px 18px', background: '#2942A6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 };
const pcrBox: React.CSSProperties = { background: '#08101F', border: '1px solid #1A2D5A', borderRadius: 10, padding: 14 };
const pcrLabel: React.CSSProperties = { color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
const pcrCode: React.CSSProperties = { display: 'block', wordBreak: 'break-all', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#cbd5e1', lineHeight: 1.5 };
const pcrHint: React.CSSProperties = { color: '#64748b', fontSize: 11, marginTop: 6 };
const errBox: React.CSSProperties = { color: '#fca5a5', background: 'rgba(220,38,38,0.12)', padding: 12, borderRadius: 10, marginBottom: 14 };
const miniCard: React.CSSProperties = { background: '#08101F', border: '1px solid #1A2D5A', borderRadius: 10, padding: 12 };
const decryptedBox: React.CSSProperties = { marginTop: 12, padding: 14, background: '#08101F', border: '1px solid #16a34a',
  borderRadius: 10, color: '#86efac', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };

const auditRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
  background: '#08101F', border: '1px solid #1A2D5A', borderRadius: 8, textDecoration: 'none', color: '#cbd5e1', fontSize: 12 };

function badgeFor(event: string): string {
  return event === 'CeremonyShareSubmitted' ? '#6B84D4'
       : event === 'CeremonyCompleted' ? '#86efac'
       : '#fbbf24';
}
