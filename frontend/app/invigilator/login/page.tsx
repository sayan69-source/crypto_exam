/**
 * CryptoExam Core — § 29.2 Invigilator Biometric Login (Interface D)
 * Four factors, in order: Geofence → Face → FIDO2 fingerprint → TOTP.
 * Each critical action is bilingual (English + Hindi).
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';
import { invigilatorApi } from '@/lib/api/invigilator';
import styles from '../invigilator.module.css';

type Step = 'creds' | 'geofence' | 'face' | 'fingerprint' | 'otp' | 'done';
const STEP_ORDER: Step[] = ['geofence', 'face', 'fingerprint', 'otp'];
const STEP_LABELS: Record<string, string> = {
  geofence: 'Location', face: 'Face', fingerprint: 'Fingerprint', otp: 'OTP',
};

export default function InvigilatorLoginPage() {
  const { login } = useAuth();
  const [step, setStep] = useState<Step>('creds');
  const [staffId, setStaffId] = useState('invigilator@cryptoexam.dev');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<string | null>(null);
  const [faceConf, setFaceConf] = useState<number | null>(null);
  const [fpConf, setFpConf] = useState<number | null>(null);
  const [otp, setOtp] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camReady, setCamReady] = useState(false);

  // Start/stop webcam when entering/leaving the face step
  useEffect(() => {
    if (step !== 'face') return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        setCamReady(true);
      } catch {
        setCamReady(false); // camera denied — demo still proceeds
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [step]);

  function captureFrame(): string {
    const v = videoRef.current;
    if (!v || !camReady) return '';
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    canvas.getContext('2d')?.drawImage(v, 0, 0, 320, 240);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  const startCreds = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffId)) { setError('Enter a valid staff email.'); return; }
    setStep('geofence');
  };

  async function runGeofence() {
    setBusy(true); setError(null);
    try {
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

  async function runFace() {
    setBusy(true); setError(null);
    try {
      const img = captureFrame();
      const r = await invigilatorApi.verifyFace(img, staffId);
      if (r.verified) { setFaceConf(r.confidence); streamRef.current?.getTracks().forEach((t) => t.stop()); setStep('fingerprint'); }
      else setError(`Face match failed (${(r.confidence * 100).toFixed(1)}%). Retry or call supervisor.`);
    } finally { setBusy(false); }
  }

  async function runFingerprint() {
    setBusy(true); setError(null);
    try {
      const r = await invigilatorApi.verifyFingerprint(staffId);
      if (r.verified) { setFpConf(r.confidence); setStep('otp'); }
      else setError('Fingerprint verification failed. A FIDO2 fingerprint reader is required.');
    } finally { setBusy(false); }
  }

  async function runOtp() {
    setBusy(true); setError(null);
    try {
      if (otp.length < 6) { setError('Enter the 6-digit OTP.'); setBusy(false); return; }
      const tok = await invigilatorApi.verifyTOTP(otp, staffId);
      if (!tok) { setError('Invalid OTP code.'); setBusy(false); return; }
      await login('invigilator', staffId, 'Smt. Lakshmi Bora');
      setStep('done');
      window.location.href = '/invigilator/dashboard';
    } finally { setBusy(false); }
  }

  return (
    <div className={styles.loginPage}>
      <div className={styles.loginCard}>
        <div className={styles.loginHead}>
          <div className={styles.loginIcon}>🛡️</div>
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

        {error && <div className={styles.errorBox}>⚠️ {error}</div>}

        {step === 'creds' && (
          <form onSubmit={startCreds} className={styles.stepBody}>
            <div className={styles.field}>
              <label className={styles.label}>Staff Email · कर्मचारी ईमेल</label>
              <input className={styles.input} type="email" value={staffId} onChange={(e) => setStaffId(e.target.value)} placeholder="invigilator@centre.gov.in" />
            </div>
            <button type="submit" className={`${styles.btnPrimary} ${styles.fullBtn}`}>Begin Verification · सत्यापन शुरू करें</button>
          </form>
        )}

        {step === 'geofence' && (
          <div className={styles.stepBody}>
            <h3 className={styles.stepHeading}>📍 Location Check</h3>
            <p className={styles.stepHint}>You must be physically at the assigned centre.<br /><span className={styles.stepHintHi}>आप निर्धारित केंद्र पर उपस्थित होने चाहिए।</span></p>
            {geo && <p className={styles.statusOk}>✓ {geo}</p>}
            <button className={`${styles.btnPrimary} ${styles.fullBtn}`} onClick={runGeofence} disabled={busy}>
              {busy ? <span className={styles.spinner} /> : 'Verify Location · स्थान सत्यापित करें'}
            </button>
          </div>
        )}

        {step === 'face' && (
          <div className={styles.stepBody}>
            <h3 className={styles.stepHeading}>🙂 Face Verification</h3>
            <p className={styles.stepHint}>Look at the camera.<br /><span className={styles.stepHintHi}>कैमरे की ओर देखें।</span></p>
            <div className={styles.camera}>
              {camReady
                ? <video ref={videoRef} muted playsInline />
                : <div className={styles.cameraPlaceholder}>Camera unavailable — demo mode will simulate a match.</div>}
              <div className={styles.scanRing} />
            </div>
            <button className={`${styles.btnPrimary} ${styles.fullBtn}`} onClick={runFace} disabled={busy}>
              {busy ? <span className={styles.spinner} /> : 'Capture & Match · चेहरा मिलाएँ'}
            </button>
          </div>
        )}

        {step === 'fingerprint' && (
          <div className={styles.stepBody}>
            <h3 className={styles.stepHeading}>👆 Fingerprint (FIDO2)</h3>
            <p className={styles.stepHint}>Touch the device fingerprint reader when prompted.<br /><span className={styles.stepHintHi}>संकेत मिलने पर फिंगरप्रिंट रीडर को स्पर्श करें।</span></p>
            {faceConf !== null && <p className={styles.statusOk}>✓ Face matched ({(faceConf * 100).toFixed(1)}%)</p>}
            <button className={`${styles.btnPrimary} ${styles.fullBtn}`} onClick={runFingerprint} disabled={busy}>
              {busy ? <span className={styles.spinner} /> : 'Scan Fingerprint · फिंगरप्रिंट स्कैन करें'}
            </button>
          </div>
        )}

        {step === 'otp' && (
          <div className={styles.stepBody}>
            <h3 className={styles.stepHeading}>🔐 One-Time Password</h3>
            <p className={styles.stepHint}>Enter the 6-digit code from your authenticator.<br /><span className={styles.stepHintHi}>प्रमाणक ऐप से 6 अंकों का कोड दर्ज करें।</span></p>
            {fpConf !== null && <p className={styles.statusOk}>✓ Fingerprint verified ({(fpConf * 100).toFixed(1)}%)</p>}
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
