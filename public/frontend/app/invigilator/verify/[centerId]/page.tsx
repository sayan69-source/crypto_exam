/**
 * CryptoExam Core — § 29.3 / § 29.6 Candidate Verification Screen (Interface D)
 * The single most important UI in Interface D: 3-panel dual-biometric verify.
 *   Left (40%): candidate identity   Center (30%): live capture + progress
 *   Right (30%): VERIFIED ✓ / MISMATCH ✗ with confidence scores
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import InvigilatorLayout from '@/components/layout/InvigilatorLayout';
import { invigilatorApi, type RosterEntry, type CandidateVerifyResult } from '@/lib/api/invigilator';
import styles from '../../invigilator.module.css';

type Phase = 'idle' | 'capturing' | 'matching' | 'done';

export default function CandidateVerifyPage() {
  const params = useParams<{ centerId: string }>();
  const centerId = params?.centerId ?? 'ctr-001';

  const [hallTicket, setHallTicket] = useState('');
  const [candidate, setCandidate] = useState<RosterEntry | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<CandidateVerifyResult | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camReady, setCamReady] = useState(false);

  useEffect(() => {
    invigilatorApi.getRoster({ center_id: centerId }).then(setRoster);
  }, [centerId]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  async function startCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } });
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => {}); }
      setCamReady(true);
    } catch { setCamReady(false); }
  }

  function captureFrame(): string {
    const v = videoRef.current;
    if (!v || !camReady) return '';
    const c = document.createElement('canvas');
    c.width = 320; c.height = 240;
    c.getContext('2d')?.drawImage(v, 0, 0, 320, 240);
    return c.toDataURL('image/jpeg', 0.7);
  }

  function lookupCandidate(ticket: string) {
    const found = roster.find((r) => r.hall_ticket === ticket || r.roll_number === ticket) ?? null;
    setCandidate(found);
    return found;
  }

  async function onScan(e: React.FormEvent) {
    e.preventDefault();
    if (!hallTicket.trim()) return;
    setResult(null);
    lookupCandidate(hallTicket.trim());
    await startCamera();
    await runVerification(hallTicket.trim());
  }

  function simulateQR() {
    const pending = roster.find((r) => r.status === 'PENDING') ?? roster[0];
    if (pending?.hall_ticket) { setHallTicket(pending.hall_ticket); lookupCandidate(pending.hall_ticket); startCamera().then(() => runVerification(pending.hall_ticket!)); }
  }

  async function runVerification(ticket: string) {
    setPhase('capturing'); setProgress('Capturing face… · चेहरा कैप्चर हो रहा है');
    await new Promise((r) => setTimeout(r, 900));
    const faceImage = captureFrame();
    setPhase('matching'); setProgress('Matching biometrics… · मिलान हो रहा है');
    const res = await invigilatorApi.verifyCandidate({ hall_ticket: ticket, center_id: centerId, face_image: faceImage });
    setResult(res); setPhase('done');
    streamRef.current?.getTracks().forEach((t) => t.stop()); setCamReady(false);

    // Auto-advance on VERIFIED after 3s (§29.3)
    if (res.overall_result === 'VERIFIED') {
      setTimeout(() => resetForNext(), 3000);
    }
  }

  function resetForNext() {
    setHallTicket(''); setCandidate(null); setResult(null); setPhase('idle'); setProgress('');
    invigilatorApi.getRoster({ center_id: centerId }).then(setRoster);
  }

  const verified = result?.overall_result === 'VERIFIED';

  return (
    <InvigilatorLayout>
      <h1 className={styles.pageTitle}>Candidate Verification</h1>
      <p className={styles.pageSub}>Scan hall ticket QR or enter the number, then verify face + fingerprint.</p>

      <form onSubmit={onScan} style={{ display: 'flex', gap: 12, marginBottom: 22, maxWidth: 620 }}>
        <input className={styles.input} value={hallTicket} onChange={(e) => setHallTicket(e.target.value)}
          placeholder="Hall ticket no. — e.g. HALL-1005" disabled={phase === 'capturing' || phase === 'matching'} />
        <button type="submit" className={styles.btnPrimary} disabled={phase === 'capturing' || phase === 'matching'}>Verify</button>
        <button type="button" className={styles.btnGhost} onClick={simulateQR}>Scan QR</button>
      </form>

      <div className={styles.verifyGrid}>
        {/* LEFT — identity */}
        <div className={styles.panel}>
          <p className={styles.panelLabel}>Candidate Identity</p>
          {candidate ? (
            <>
              <div className={styles.candPhoto}>{(candidate.candidate_name ?? '?').charAt(0)}</div>
              <h2 className={styles.candName}>{candidate.candidate_name}</h2>
              <div className={styles.candMeta}>
                <div>Hall Ticket: <b>{candidate.hall_ticket}</b></div>
                <div>Roll No: <b>{candidate.roll_number}</b></div>
                <div>Session: <b>NEET UG 2026 · Set {(candidate.roll_number ?? 'A').slice(-1)}</b></div>
                <div>Centre: <b>{centerId}</b></div>
              </div>
            </>
          ) : (
            <div className={styles.empty}>Scan a hall ticket to load candidate details.</div>
          )}
        </div>

        {/* CENTER — live capture */}
        <div className={styles.panel}>
          <p className={styles.panelLabel}>Live Capture</p>
          <div className={styles.camera}>
            {camReady ? <video ref={videoRef} muted playsInline /> : <div className={styles.cameraPlaceholder}>Camera idle.<br />Capture begins on verify.</div>}
            <div className={styles.scanRing} />
          </div>
          {progress && <p className={styles.progressLine}>{(phase === 'capturing' || phase === 'matching') && <span className={`${styles.spinner} ${styles.spinnerDark}`} />}{progress}</p>}
        </div>

        {/* RIGHT — result */}
        <div className={styles.panel}>
          <p className={styles.panelLabel}>Result</p>
          {!result ? (
            <div className={styles.empty}>Awaiting verification…</div>
          ) : (
            <>
              <div className={`${styles.resultIcon} ${verified ? styles.resultVerified : styles.resultMismatch}`}>{verified ? '✓' : '✗'}</div>
              <div className={`${styles.resultBig} ${verified ? styles.resultVerified : styles.resultMismatch}`}>{verified ? 'VERIFIED' : 'MISMATCH'}</div>
              <div className={styles.confRow}><span>Face confidence</span><span className={result.face_match ? styles.ok : styles.bad}>{(result.face_confidence * 100).toFixed(1)}%</span></div>
              <div className={styles.confRow}><span>Fingerprint</span><span className={result.fp_match ? styles.ok : styles.bad}>{(result.fp_confidence * 100).toFixed(1)}%</span></div>
              <div className={styles.confRow}><span>Time (IST)</span><span style={{ fontFamily: 'var(--font-mono)' }}>{new Date(result.timestamp).toLocaleTimeString('en-IN')}</span></div>
              <div className={styles.scanBtnRow}>
                {verified
                  ? <button className={styles.btnPrimary} style={{ flex: 1 }} onClick={resetForNext}>Next Candidate →</button>
                  : <button className={styles.btnDanger} style={{ flex: 1 }} onClick={resetForNext}>Call Supervisor</button>}
              </div>
              {!verified && <p className={styles.alertTime} style={{ marginTop: 10 }}>Screen held for supervisor — candidate flagged in system.</p>}
            </>
          )}
        </div>
      </div>
    </InvigilatorLayout>
  );
}
