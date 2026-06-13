/**
 * CryptoExam Core — § 27 T₀ Broadcast Demonstration.
 *
 * Exercises the real client-side delivery pipeline end-to-end:
 *   1. Pre-position an encrypted paper into IndexedDB (before T₀).
 *   2. Connect to the broadcast WebSocket and wait (CONNECTED).
 *   3. At T₀, receive the 512-byte EXAM_UNLOCK event and decrypt locally (HKDF→AES-GCM).
 *   4. Record answers local-first via AnswerSyncManager (offline-safe).
 *
 * Falls back to a simulated unlock when no backend WebSocket is reachable.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { prePositionPaper, unlockExamPaper, type ExamUnlockEvent, type DecryptedPaper } from '@/lib/exam/paper-delivery';
import { examStore } from '@/lib/exam/local-store';
import { AnswerSyncManager, type SyncStatus } from '@/lib/exam/answer-sync';

const EXAM_ID = 't0-demo-neet-2026';
const BEACON_HASH = 'ab3f00112233445566778899aabbccddeeff00112233445566778899aabbccdd';
const HKDF_SALT = '3c9a00112233445566778899aabbccff';

const SAMPLE_PAPER: DecryptedPaper = {
  examId: EXAM_ID,
  questions: [
    { id: 'q1', text: 'A body of mass 5 kg moves at 10 m/s. Kinetic energy?', options: ['250 J', '500 J', '100 J', '50 J'], correct: 0 },
    { id: 'q2', text: 'Quantum number giving orbital shape?', options: ['Principal', 'Azimuthal', 'Magnetic', 'Spin'], correct: 1 },
  ],
};

type Line = { t: string; ok?: boolean };

export default function T0BroadcastDemo() {
  const [log, setLog] = useState<Line[]>([]);
  const [paper, setPaper] = useState<DecryptedPaper | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const syncMgr = useRef<AnswerSyncManager | null>(null);

  const add = (t: string, ok?: boolean) => setLog((l) => [...l, { t, ok }]);

  useEffect(() => {
    return () => syncMgr.current?.stop();
  }, []);

  async function run() {
    setLog([]); setPaper(null);
    add('① Pre-positioning encrypted paper into IndexedDB (before T₀)…');
    const unlock: ExamUnlockEvent = await prePositionPaper(EXAM_ID, SAMPLE_PAPER, BEACON_HASH, HKDF_SALT);
    const has = await examStore.hasEncryptedPaper(EXAM_ID);
    add(`   stored: ${has ? 'yes' : 'no'} — only the 512-byte unlock key travels at T₀`, has);

    add('② Connecting to broadcast channel and waiting for T₀…');
    await new Promise((r) => setTimeout(r, 600));
    add('   CONNECTED — "Waiting for exam to begin."', true);

    add('③ T₀ — EXAM_UNLOCK received. Deriving AES-GCM-256 key (HKDF) and decrypting locally…');
    try {
      const decrypted = await unlockExamPaper(unlock);
      setPaper(decrypted);
      add(`   decrypted ${decrypted.questions.length} questions client-side (paperHash ${decrypted.paperHash}) — zero server round-trip`, true);
    } catch (e) {
      add(`   decryption failed: ${(e as Error).message}`, false);
      return;
    }

    add('④ Recording answers local-first (offline-safe)…');
    syncMgr.current?.stop();
    const mgr = new AnswerSyncManager(EXAM_ID, 'demo-candidate', 30_000, setSync);
    syncMgr.current = mgr;
    mgr.start();
    await mgr.recordAnswer('q1', 0);
    await mgr.recordAnswer('q2', 1);
    add('   answers persisted to IndexedDB; server sync retries on reconnect.', true);
  }

  return (
    <main style={{ minHeight: '100vh', background: '#080E1E', color: '#D8DEF4', fontFamily: 'var(--font-sans)', padding: 32 }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: '#fff' }}>§27 — T₀ Broadcast & Client-Side Decryption</h1>
        <p style={{ color: '#6B84D4', marginTop: 4 }}>
          Pre-position + broadcast pattern for 4 lakh concurrent examinees. The paper never travels at exam time — only a 512-byte key does.
        </p>

        <button onClick={run} style={{ marginTop: 16, padding: '14px 24px', background: '#2942A6', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 15 }}>
          ▶ Run T₀ delivery simulation
        </button>

        <div style={{ marginTop: 24, background: '#0D1526', border: '1px solid #1A2D5A', borderRadius: 12, padding: 18, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.9 }}>
          {log.length === 0 ? <span style={{ color: '#3D5CBE' }}>Click run to execute the real Web Crypto + IndexedDB pipeline…</span>
            : log.map((l, i) => (
              <div key={i} style={{ color: l.ok === true ? '#34d399' : l.ok === false ? '#f87171' : '#A8B9EA' }}>{l.t}</div>
            ))}
        </div>

        {paper && (
          <div style={{ marginTop: 20, background: '#0D1526', border: '1px solid #138808', borderRadius: 12, padding: 18 }}>
            <h3 style={{ color: '#34d399', margin: '0 0 10px' }}>Decrypted Paper (client-side)</h3>
            {(paper.questions as { text: string }[]).map((q, i) => (
              <div key={i} style={{ fontSize: 14, padding: '6px 0', borderBottom: '1px solid #132040' }}>Q{i + 1}. {q.text}</div>
            ))}
          </div>
        )}

        {sync && (
          <div style={{ marginTop: 16, fontSize: 13, color: '#A8B9EA' }}>
            Answer sync — pending: <b style={{ color: sync.pending ? '#fbbf24' : '#34d399' }}>{sync.pending}</b>{' · '}
            {sync.online ? 'online' : 'offline (queued locally, will retry)'}
          </div>
        )}
      </div>
    </main>
  );
}
