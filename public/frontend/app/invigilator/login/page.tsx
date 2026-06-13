/**
 * CryptoExam Core — § 29.2 Invigilator Biometric Login (REAL biometrics).
 *
 * Verifies the signed-in invigilator against their on-device enrollment:
 *   Geofence (hard-coded centre) → Face (live face-api match) →
 *   Fingerprint (WebAuthn assertion) → OTP → session.
 *
 * Face and fingerprint are real. IP is captured live and compared to the
 * enrolled IP (shown, not blocking — IPs legitimately change). Location stays
 * hard-coded per current spec.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthContext';
import { invigilatorApi } from '@/lib/api/invigilator';
import { loadFaceApi, detectFace, matchDescriptors, FACE_MATCH_THRESHOLD } from '@/lib/biometric/face-real';
import { verifyFingerprint } from '@/lib/biometric/webauthn';
import { getPublicIP } from '@/lib/biometric/device';
import { getEnrollment, type InvigilatorEnrollment } from '@/lib/biometric/enrollment';
import styles from '../invigilator.module.css';

type Step = 'creds' | 'geofence' | 'face' | 'fingerprint' | 'otp' | 'done';
const STEP_ORDER: Step[] = ['geofence', 'face', 'fingerprint', 'otp'];
const STEP_LABELS: Record<string, string> = { geofence: 'Location', face: 'Face', fingerprint: 'Fingerprint', otp: 'OTP' };

export default function InvigilatorLoginPage() {
  const { login } = useAuth();
  const [step, setStep] = useState<Step>('creds');
  const [staffId, setStaffId] = useState('');
  const [enrollment, setEnrollment] = useState<InvigilatorEnrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<string | null>(null);
  const [liveIp, setLiveIp] = useState<string | null>(null);
  const [faceResult, setFaceResult] = useState<{ distance: number; confidence: number } | null>(null);
  const [fpResult, setFpResult] = useState<string | null>(null);
  const [otp, setOtp] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  // Start/stop webcam + load model on the face step
  useEffect(() => {
    if (step !== 'face') return;
    let cancelled = false;
    setModelStatus('loading');
    loadFaceApi().then(() => { if (!cancelled) setModelStatus('ready'); })
      .catch(() => { if (!cancelled) setModelStatus('error'); });
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360, facingMode: 'user' } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        setCamReady(true);
      } catch {
        setCamReady(false);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [step]);

  // Attach the live stream once the <video> is actually mounted (camReady renders it in).
  // Setting srcObject in the effect above failed because the element isn't in the DOM yet.
  useEffect(() => {
    const v = videoRef.current;
    if (camReady && v && streamRef.current && v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current;
      v.play().catch(() => {});
    }
  }, [camReady]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamReady(false);
  }

  // ── creds ───────────────────────────────────────────────────────────
  function startCreds(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffId)) { setError('Enter a valid staff email.'); return; }
    const enr = getEnrollment(staffId);
    if (!enr) {
      setError('No enrollment found for this email on this device. Please register your biometrics first.');
      return;
    }
    setEnrollment(enr);
    setStep('geofence');
  }

  // ── geofence (hard-coded centre) + live IP capture ──────────────────
  async function runGeofence() {
    setBusy(true); setError(null);
    try {
      // Capture the real public IP and compare to the enrolled IP (display only)
      const { ip } = await getPublicIP();
      setLiveIp(ip);

      const coords = await new Promise<GeolocationCoordinates>((res, rej) => {
        if (!navigator.geolocation) return rej(new Error('no geo'));
        navigator.geolocation.getCurrentPosition((p) => res(p.coords), () => rej(new Error('denied')), { enableHighAccuracy: true, timeout: 8000 });
      }).catch(() => null);

      const result = await invigilatorApi.verifyGeofence({
        latitude: coords?.latitude ?? 28.6139,
        longitude: coords?.longitude ?? 77.2090,
        accuracy: coords?.accuracy,
        center_id: 'ctr-001',
      });
      if (result.within_center_bounds) {
        setGeo(`${result.reason} (${result.distance_m} m from centre)`);
        setStep('face');
      } else {
        setError(`Outside centre perimeter: ${result.reason}`);
      }
    } finally { setBusy(false); }
  }

  // ── REAL face verification ──────────────────────────────────────────
  async function runFace() {
    setBusy(true); setError(null);
    try {
      if (!enrollment) { setError('No enrollment loaded.'); return; }
      if (!videoRef.current || !camReady) { setError('Camera not available. Allow camera access and retry.'); return; }
      if (modelStatus !== 'ready') { setError('Face model still loading — wait a moment and retry.'); return; }
      const live = await detectFace(videoRef.current);
      if (!live) { setError('No face detected. Centre your face and ensure good lighting.'); return; }
      const m = matchDescriptors(live.descriptor, enrollment.faceDescriptor);
      setFaceResult({ distance: m.distance, confidence: m.confidence });
      if (m.matched) {
        stopCamera();
        setStep('fingerprint');
      } else {
        setError(`Face does not match enrollment (distance ${m.distance.toFixed(3)} > ${FACE_MATCH_THRESHOLD}). This is not the enrolled person, or lighting differs greatly.`);
      }
    } catch (e) {
      setError(`Face verification error: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  // ── REAL fingerprint verification (WebAuthn) ────────────────────────
  async function runFingerprint() {
    setBusy(true); setError(null);
    try {
      if (!enrollment) { setError('No enrollment loaded.'); return; }
      if (!enrollment.fingerprint) {
        // No fingerprint was enrolled — allow proceeding (face already matched)
        setFpResult('No fingerprint enrolled — skipped');
        setStep('otp');
        return;
      }
      const r = await verifyFingerprint(enrollment.fingerprint.credentialId);
      if (r.ok) {
        setFpResult('Verified');
        setStep('otp');
      } else {
        setError(`Fingerprint verification failed: ${r.reason ?? 'try again'}`);
      }
    } finally { setBusy(false); }
  }

  // ── OTP (unchanged — backend TOTP, lenient in dev) ──────────────────
  async function runOtp() {
    setBusy(true); setError(null);
    try {
      if (otp.length < 6) { setError('Enter the 6-digit OTP.'); setBusy(false); return; }
      const tok = await invigilatorApi.verifyTOTP(otp, staffId);
      if (!tok) { setError('Invalid OTP code.'); setBusy(false); return; }
      await login('invigilator', staffId, enrollment?.fullName || 'Invigilator');
      setStep('done');
      window.location.href = '/invigilator/dashboard';
    } finally { setBusy(false); }
  }

  const ipMatch = enrollment && liveIp ? (enrollment.ip === liveIp) : null;

  return (
    <div className={styles.loginPage}>
      <div className={styles.loginCard}>
        <div className={styles.loginHead}>
          <div className={styles.loginIcon}></div>
          <h1 className={styles.loginTitle}>Invigilator Gateway</h1>
          <p className={styles.loginSub}>केंद्र निरीक्षक · Biometric multi-factor sign-in</p>
        </div>

        {step !== 'creds' && (
          <div className={styles.stepper}>
            {STEP_ORDER.map((s) => {
              const idx = STEP_ORDER.indexOf(s);
              const cur = STEP_ORDER.indexOf(step as Step);
              const cls = idx < cur ? styles.stepDone : idx === cur ? styles.stepActive : '';
              return <div key={s} className={`${styles.stepDot} ${cls}`}>{STEP_LABELS[s]}</div>;
            })}
          </div>
        )}

        {error && <div className={styles.errorBox}>{error}</div>}

        {step === 'creds' && (
          <form onSubmit={startCreds} className={styles.stepBody}>
            <div className={styles.field}>
              <label className={styles.label}>Staff Email · कर्मचारी ईमेल</label>
              <input className={styles.input} type="email" value={staffId} onChange={(e) => setStaffId(e.target.value)} placeholder="you@centre.gov.in" />
            </div>
            <button type="submit" className={`${styles.btnPrimary} ${styles.fullBtn}`}>Begin Verification · सत्यापन शुरू करें</button>
            <p style={{ marginTop: 14, fontSize: 13 }}>
              Not enrolled yet? <Link href="/invigilator/register" style={{ color: 'var(--color-navy-600)', fontWeight: 600 }}>Register your biometrics</Link>
            </p>
          </form>
        )}

        {step === 'geofence' && (
          <div className={styles.stepBody}>
            <h3 className={styles.stepHeading}>Location &amp; Network</h3>
            <p className={styles.stepHint}>Checking centre perimeter and capturing your device IP.<br /><span className={styles.stepHintHi}>केंद्र परिधि एवं डिवाइस IP की जाँच।</span></p>
            {geo && <p className={styles.statusOk}>✓ {geo}</p>}
            {liveIp && (
              <p style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                IP: {liveIp} {ipMatch === true ? <span className={styles.statusOk}>· matches enrollment</span> : ipMatch === false ? <span style={{ color: 'var(--color-warning)' }}>· differs from enrolled {enrollment?.ip}</span> : null}
              </p>
            )}
            <button className={`${styles.btnPrimary} ${styles.fullBtn}`} onClick={runGeofence} disabled={busy}>
              {busy ? <span className={styles.spinner} /> : 'Verify Location &amp; IP · सत्यापित करें'}
            </button>
          </div>
        )}

        {step === 'face' && (
          <div className={styles.stepBody}>
            <h3 className={styles.stepHeading}>Face Verification</h3>
            <p className={styles.stepHint}>Look at the camera. We compare you to your enrolled face.<br /><span className={styles.stepHintHi}>कैमरे की ओर देखें।</span></p>
            <div className={styles.camera} style={{ maxWidth: 400 }}>
              {camReady ? <video ref={videoRef} autoPlay muted playsInline /> : <div className={styles.cameraPlaceholder}>Waiting for camera… allow access.</div>}
              <div className={styles.scanRing} />
            </div>
            <p style={{ fontSize: 12, color: modelStatus === 'ready' ? 'var(--color-success)' : modelStatus === 'error' ? 'var(--color-danger)' : 'var(--color-navy-500)', margin: '6px 0' }}>
              {modelStatus === 'loading' && '… Loading face-recognition model…'}
              {modelStatus === 'ready' && '✓ Face model ready'}
              {modelStatus === 'error' && '✗ Face model failed (check network)'}
            </p>
            {faceResult && (
              <p style={{ fontSize: 13, color: 'var(--color-navy-500)' }}>distance {faceResult.distance.toFixed(3)} · confidence {(faceResult.confidence * 100).toFixed(0)}%</p>
            )}
            <button className={`${styles.btnPrimary} ${styles.fullBtn}`} onClick={runFace} disabled={busy || !camReady || modelStatus !== 'ready'}>
              {busy ? <span className={styles.spinner} /> : 'Verify Face · चेहरा मिलाएँ'}
            </button>
          </div>
        )}

        {step === 'fingerprint' && (
          <div className={styles.stepBody}>
            <h3 className={styles.stepHeading}>Fingerprint (WebAuthn)</h3>
            <p className={styles.stepHint}>Use your device biometric when prompted.<br /><span className={styles.stepHintHi}>संकेत मिलने पर बायोमेट्रिक दें।</span></p>
            {faceResult && <p className={styles.statusOk}>✓ Face matched (confidence {(faceResult.confidence * 100).toFixed(0)}%)</p>}
            <button className={`${styles.btnPrimary} ${styles.fullBtn}`} onClick={runFingerprint} disabled={busy}>
              {busy ? <span className={styles.spinner} /> : enrollment?.fingerprint ? 'Scan Fingerprint · फिंगरप्रिंट' : 'Continue (no fingerprint enrolled)'}
            </button>
          </div>
        )}

        {step === 'otp' && (
          <div className={styles.stepBody}>
            <h3 className={styles.stepHeading}>One-Time Password</h3>
            <p className={styles.stepHint}>Enter any 6-digit code (dev OTP).<br /><span className={styles.stepHintHi}>6 अंकों का कोड दर्ज करें।</span></p>
            {fpResult && <p className={styles.statusOk}>✓ Fingerprint: {fpResult}</p>}
            <div className={styles.field}>
              <input className={`${styles.input} ${styles.otpInput}`} inputMode="numeric" maxLength={6} value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="● ● ● ● ● ●" autoFocus />
            </div>
            <button className={`${styles.btnPrimary} ${styles.fullBtn}`} onClick={runOtp} disabled={busy}>
              {busy ? <span className={styles.spinner} /> : 'Sign In · प्रवेश करें'}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className={styles.stepBody}>
            <div className={styles.resultIcon + ' ' + styles.resultVerified}>✓</div>
            <p className={styles.resultBig}>Signed in — redirecting…</p>
          </div>
        )}
      </div>
    </div>
  );
}
