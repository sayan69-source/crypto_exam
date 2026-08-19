/**
 * CryptoExam Core — V3 §10 Emergency Dual-Control Panel.
 *
 * Two-person integrity: an admin initiates an emergency action (pause / extend
 * / abort), and a SECOND admin must confirm. The initiator cannot confirm their
 * own request. Requests auto-expire after 5 minutes.
 *
 * The component uses a simple "current admin" toggle so the entire flow is
 * demoable from a single browser session — in production, sessions A and B are
 * on different devices with different JWTs.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { emergencyApi, type EmergencyRequest, type EmergencyActionType } from '@/lib/api/emergency';
import { getAuthToken } from '@/lib/api/client';

const ACTIONS: { value: EmergencyActionType; label: string; severity: 'amber' | 'blue' | 'red' }[] = [
  { value: 'PAUSE_EXAM', label: 'Pause Exam', severity: 'amber' },
  { value: 'EXTEND_EXAM', label: 'Extend Exam', severity: 'blue' },
  { value: 'RESUME_EXAM', label: 'Resume Exam', severity: 'blue' },
  { value: 'ABORT_EXAM', label: 'Abort Exam', severity: 'red' },
  { value: 'ALERT_BROADCAST', label: 'Broadcast Alert', severity: 'blue' },
];

const SEVERITY_COLOR = { amber: '#b07d1a', blue: '#6b5d4f', red: '#b3341c' };

/**
 * Dual control needs two DIFFERENT real administrators to authorise a
 * dangerous action. Three invented names ("Vikram S. Rathore", "Dr. Meera
 * Kapoor", "Adv. Suresh Iyer") made the control look operational while
 * authorising nothing — the co-signer was a fictional person.
 *
 * The roster is loaded from the real admin directory; when it cannot be
 * loaded, the panel says so rather than offering fictional co-signers.
 */
interface AdminOption { id: string; name: string }

export default function DualControlPanel() {
  const [admins, setAdmins] = useState<AdminOption[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState('');

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'}/admin/admins`, {
      headers: { ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}) },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('roster unavailable'))))
      .then((d) => {
        const list: AdminOption[] = (d.admins ?? []).map((a: { id: string; full_name?: string; email: string }) => ({
          id: a.id, name: a.full_name || a.email,
        }));
        setAdmins(list);
        if (list[0]) setCurrentAdmin(list[0].id);
      })
      .catch(() => setRosterError('The administrator roster could not be loaded, so no co-signer can be selected.'));
  }, []);
  const [action, setAction] = useState<EmergencyActionType>('PAUSE_EXAM');
  const [examId, setExamId] = useState('neet-ug-2026-mock');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<EmergencyRequest[]>([]);
  const [history, setHistory] = useState<EmergencyRequest[]>([]);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function refresh() {
    const [p, h] = await Promise.all([emergencyApi.pending(), emergencyApi.history(20)]);
    setPending(p); setHistory(h);
  }

  useEffect(() => { void refresh(); const iv = setInterval(refresh, 5000); return () => clearInterval(iv); }, []);

  async function initiate() {
    if (!reason.trim()) { setFeedback({ kind: 'err', text: 'A written reason is required (logged permanently).' }); return; }
    setBusy(true); setFeedback(null);
    try {
      await emergencyApi.initiate(action, examId, reason.trim(), currentAdmin);
      setFeedback({ kind: 'ok', text: 'Pending — awaiting confirmation from a different admin (5 min window).' });
      setReason('');
      await refresh();
    } catch (e) { setFeedback({ kind: 'err', text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function confirm(request_id: string) {
    setBusy(true); setFeedback(null);
    try {
      const req = await emergencyApi.confirm(request_id, currentAdmin);
      setFeedback({ kind: 'ok', text: `Action executed: ${req.execution_result?.status ?? 'OK'} — committed on-chain.` });
      await refresh();
    } catch (e) { setFeedback({ kind: 'err', text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function reject(request_id: string) {
    const why = prompt('Reason for rejection (logged):'); if (!why) return;
    setBusy(true); setFeedback(null);
    try {
      await emergencyApi.reject(request_id, currentAdmin, why);
      setFeedback({ kind: 'ok', text: 'Request rejected.' });
      await refresh();
    } catch (e) { setFeedback({ kind: 'err', text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  const severity = useMemo(() => ACTIONS.find((a) => a.value === action)!.severity, [action]);

  return (
    <section style={{
      background: 'linear-gradient(180deg, #1a1010 0%, #150e0e 100%)',
      border: '1px solid #2b211c', borderRadius: 16, padding: 24, marginBottom: 28,
      fontFamily: 'var(--font-sans)',
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <span style={{ fontSize: 26 }}></span>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, color: '#fffefb', fontSize: 20 }}>V3 §10 — Emergency Dual-Control</h2>
          <p style={{ margin: '4px 0 0', color: '#939084', fontSize: 13 }}>
            Two-person integrity: initiator cannot confirm their own request. Auto-expires after 5 minutes. Mirrored on Polygon.
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#939084', fontSize: 12 }}>
          You are signed in as
          <select value={currentAdmin} onChange={(e) => setCurrentAdmin(e.target.value)} style={selectMini}>
            {(admins ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* INITIATE */}
        <div style={card}>
          <h3 style={cardTitle}>Initiate action</h3>
          <label style={fieldRow}><span style={lbl}>Action</span>
            <select value={action} onChange={(e) => setAction(e.target.value as EmergencyActionType)} style={input}>
              {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>
          <label style={fieldRow}><span style={lbl}>Exam ID</span>
            <input value={examId} onChange={(e) => setExamId(e.target.value)} style={input} />
          </label>
          <label style={fieldRow}><span style={lbl}>Reason (logged permanently)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ ...input, resize: 'vertical' }} placeholder="e.g. Power outage detected at 14 centres — pause requested" />
          </label>
          <button onClick={initiate} disabled={busy} style={{ ...btn, background: SEVERITY_COLOR[severity] }}>
            {busy ? 'Submitting…' : `Initiate ${ACTIONS.find((a) => a.value === action)?.label}`}
          </button>
        </div>

        {/* PENDING (confirmation queue) */}
        <div style={card}>
          <h3 style={cardTitle}>Awaiting confirmation</h3>
          {pending.length === 0
            ? <div style={empty}>No pending emergency requests.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pending.map((r) => {
                  const initiatorName = (admins ?? []).find((a) => a.id === r.initiator_id)?.name ?? r.initiator_id;
                  const isOwn = currentAdmin === r.initiator_id;
                  const expSec = Math.max(0, Math.floor((Date.parse(r.expires_at) - Date.now()) / 1000));
                  return (
                    <div key={r.request_id} style={{ border: '1px solid #2b211c', borderRadius: 10, padding: 12, background: '#150e0e' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                        <span style={{ color: '#939084' }}>{r.action.replace('_', ' ')} · {r.exam_id}</span>
                        <span style={{ color: expSec < 60 ? '#d99a8e' : '#939084', fontFamily: 'var(--font-mono)' }}>{expSec}s</span>
                      </div>
                      <p style={{ margin: '6px 0', color: '#e8e2d8', fontSize: 13 }}>{r.reason}</p>
                      <p style={{ margin: '0 0 8px', color: '#605d52', fontSize: 11 }}>Initiated by {initiatorName}{isOwn ? ' (you)' : ''}</p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => confirm(r.request_id)} disabled={isOwn || busy}
                          title={isOwn ? 'Initiator cannot confirm their own request' : 'Confirm (requires different admin)'}
                          style={{ ...btn, padding: '8px 14px', fontSize: 12, background: isOwn ? '#36342e' : '#3f6f4a', cursor: isOwn ? 'not-allowed' : 'pointer', opacity: isOwn ? 0.6 : 1 }}>
                          ✓ Confirm
                        </button>
                        <button onClick={() => reject(r.request_id)} disabled={busy}
                          style={{ ...btn, padding: '8px 14px', fontSize: 12, background: '#631518' }}>
                          ✗ Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>}
        </div>
      </div>

      {feedback && (
        <div style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13,
          background: feedback.kind === 'ok' ? 'rgba(63, 111, 74,0.18)' : 'rgba(155, 34, 38,0.18)',
          color: feedback.kind === 'ok' ? '#a8c9a5' : '#d99a8e',
        }}>{feedback.text}</div>
      )}

      {/* HISTORY */}
      <div style={{ ...card, marginTop: 16 }}>
        <h3 style={cardTitle}>Recent emergency actions</h3>
        {history.length === 0 ? <div style={empty}>No recorded actions.</div> :
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ color: '#939084' }}>
              <th style={th}>Action</th><th style={th}>Exam</th><th style={th}>Initiator</th>
              <th style={th}>Confirmer</th><th style={th}>Status</th><th style={th}>Result</th>
            </tr></thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.request_id} style={{ borderTop: '1px solid #2b211c' }}>
                  <td style={td}>{r.action.replace('_', ' ')}</td>
                  <td style={td}>{r.exam_id}</td>
                  <td style={td}>{(admins ?? []).find((a) => a.id === r.initiator_id)?.name ?? r.initiator_id}</td>
                  <td style={td}>{r.confirmer_id ? ((admins ?? []).find((a) => a.id === r.confirmer_id)?.name ?? r.confirmer_id) : '—'}</td>
                  <td style={{ ...td, color: r.status === 'CONFIRMED' ? '#86efac' : r.status === 'REJECTED' ? '#fca5a5' : '#fcd34d' }}>{r.status}</td>
                  <td style={td}>{(r.execution_result as { status?: string })?.status ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>}
      </div>
    </section>
  );
}

const card: React.CSSProperties = { background: '#150e0e', border: '1px solid #2b211c', borderRadius: 12, padding: 16 };
const cardTitle: React.CSSProperties = { margin: '0 0 12px', color: '#c5c0b1', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em' };
const fieldRow: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 };
const lbl: React.CSSProperties = { fontSize: 12, color: '#939084' };
const input: React.CSSProperties = { padding: 10, background: '#150e0e', border: '1px solid #2b211c', borderRadius: 8, color: '#e8e2d8', fontFamily: 'var(--font-sans)', fontSize: 13, outline: 'none' };
const btn: React.CSSProperties = { width: '100%', padding: '10px 14px', border: 'none', borderRadius: 8, color: '#fffefb', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const empty: React.CSSProperties = { color: '#605d52', fontSize: 13, padding: '12px 0' };
const selectMini: React.CSSProperties = { padding: '6px 10px', background: '#150e0e', border: '1px solid #2b211c', color: '#e8e2d8', borderRadius: 6, fontFamily: 'inherit' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 6px', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 };
const td: React.CSSProperties = { padding: '10px 6px', color: '#c5c0b1' };
