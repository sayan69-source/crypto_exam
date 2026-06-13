/**
 * CryptoExam Core — Invigilator Self-Enrollment (REAL biometrics).
 *
 * Registers a real invigilator using:
 *   • Face    — live webcam → face-api.js 128-float descriptor (stored, not the photo)
 *   • Finger  — WebAuthn platform authenticator (Windows Hello / Touch ID / fingerprint)
 *   • IP/Device — real public IP via echo service + user agent
 *
 * Location is intentionally hard-coded elsewhere (centre perimeter) per spec.
 * Enrollment persists in this browser; the same person can then log in and be
 * verified against this record on /invigilator/login.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { loadFaceApi, detectFace, type FaceDetectResult } from '@/lib/biometric/face-real';
import { registerFingerprint, isPlatformAuthenticatorAvailable, type FingerprintCredential } from '@/lib/biometric/webauthn';
import { getDeviceInfo, type DeviceInfo } from '@/lib/biometric/device';
import { saveEnrollment, getEnrollment } from '@/lib/biometric/enrollment';
import styles from '../invigilator.module.css';

type Step = 'identity' | 'face' | 'fingerprint' | 'device' | 'done';

export default function InvigilatorRegisterPage() {
  const [step, setStep] = useState<Step>('identity');
  const [staffId, setStaffId] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Face
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [face, setFace] = useState<FaceDetectResult | null>(null);

  // Fingerprint
  const [platformAvail, setPlatformAvail] = useState<boolean | null>(null);
  const [fingerprint, setFingerprint] = useState<FingerprintCredential | null>(null);

  // Device
  const [device, setDevice] = useState<DeviceInfo | null>(null);

  // ── camera lifecycle for the face step ──────────────────────────────
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

  async function captureFace() {
    setError(null);
    if (!videoRef.current || !camReady) { setError('Camera not available. Allow camera access and retry.'); return; }
    if (modelStatus !== 'ready') { setError('Face model still loading — wait a moment.'); return; }
    setBusy(true);
    try {
      const result = await detectFace(videoRef.current);
      if (!result) { setError('No face detected. Centre your face in the frame, ensure good lighting, and retry.'); return; }
      if (result.detectionScore < 0.6) { setError(`Low-quality detection (${(result.detectionScore * 100).toFixed(0)}%). Move closer / improve lighting.`); return; }
      setFace(result);
    } catch (e) {
      setError(`Face capture failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // ── identity ────────────────────────────────────────────────────────
  function submitIdentity(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffId)) { setError('Enter a valid staff email.'); return; }
    if (fullName.trim().length < 2) { setError('Enter your full name.'); return; }
    if (getEnrollment(staffId)) {
      setError('This email is already enrolled on this device. You can re-enroll to overwrite — continue to update it.');
    }
    setStep('face');
  }

  function proceedFromFace() {
    if (!face) { setError('Capture your face first.'); return; }
    stopCamera();
    setStep('fingerprint');
  }

  // ── fingerprint step ────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'fingerprint') return;
    isPlatformAuthenticatorAvailable().then(setPlatformAvail);
  }, [step]);

  async function doRegisterFingerprint() {
    setError(null); setBusy(true);
    try {
      const cred = await registerFingerprint(staffId, staffId, fullName);
      setFingerprint(cred);
    } catch (e) {
      setError(`Fingerprint registration failed or was cancelled: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // ── device step ─────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'device') return;
    setBusy(true);
    getDeviceInfo().then((d) => { setDevice(d); setBusy(false); });
  }, [step]);

  function finish() {
    if (!face) { setError('Face not captured.'); setStep('face'); return; }
    setError(null);
    saveEnrollment({
      staffId, fullName,
      faceDescriptor: face.descriptor,
      faceDetectionScore: face.detectionScore,
      fingerprint,
      ip: device?.ip ?? 'unavailable',
      ipSource: device?.source ?? 'none',
      userAgent: device?.userAgent ?? 'unknown',
      registeredAt: new Date().toISOString(),
    });
    setStep('done');
  }

  const STEP_LABELS: Record<string, string> = { face: 'Face', fingerprint: 'Fingerprint', device: 'Device/IP' };
  const ORDER: Step[] = ['face', 'fingerprint', 'device'];

  return (
    <div className={styles.loginPage}>
      <div className={styles.loginCard} style={{ maxWidth: 560 }}>
        <div className={styles.loginHead}>
          <div className={styles.loginIcon}></div>
          <h1 className={styles.loginTitle}>Invigilator Enrollment</h1>
          <p className={styles.loginSub}>निरीक्षक पंजीकरण · Register your real face, fingerprint &amp; device</p>
        </div>

        {step !== 'identity' && step !== 'done' && (
          <div className={styles.stepper}>
            {ORDER.map((s) => {
              const idx = ORDER.indexOf(s);
              const cur = ORDER.indexOf(step as Step);
              const cls = idx < cur ? styles.stepDone : idx === cur ? styles.stepActive : '';
              return <div key={s} className={`${styles.stepDot} ${cls}`}>{STEP_LABELS[s]}</div>;
            })}
          </div>
        )}

        {error && <div className={styles.errorBox}>{error}</div>}

        {/* IDENTITY */}
        {step === 'identity' && (
          <form onSubmit={submitIdentity} className={styles.stepBody}>
            <div className={styles.field}>
              <label className={styles.label}>Full Name · पूरा नाम</label>
              <input className={styles.input} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Smt. Lakshmi Bora" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Staff Email · कर्मचारी ईमेल</label>
              <input className={styles.input} type="email" value={staffId} onChange={(e) => setStaffId(e.target.value)} placeholder="you@centre.gov.in" />
            </div>
            <button type="submit" className={`${styles.btnPrimary} ${styles.fullBtn}`}>Begin Enrollment →</button>
            <p style={{ marginTop: 14, fontSize: 13 }}>
              Already enrolled? <Link href="/invigilator/login" style={{ color: 'var(--color-navy-600)', fontWeight: 600 }}>Go to login</Link>
            </p>
          </form>
        )}

        {/* FACE */}
        {step === 'face' && (
          <div className={styles.stepBody}>
            <h3 className={styles.stepHeading}>Capture Your Face</h3>
            <p className={styles.stepHint}>
              A 128-number face signature is stored — never the photo.<br />
              <span className={styles.stepHintHi}>केवल चेहरे का गणितीय हस्ताक्षर संग्रहीत होता है।</span>
            </p>
            <div className={styles.camera} style={{ maxWidth: 400 }}>
              {camReady
                ? <video ref={videoRef} autoPlay muted playsInline />
                : <div className={styles.cameraPlaceholder}>Waiting for camera… allow access in your browser.</div>}
              <div className={styles.scanRing} />
            </div>
            <p style={{ fontSize: 12, color: modelStatus === 'ready' ? 'var(--color-success)' : modelStatus === 'error' ? 'var(--color-danger)' : 'var(--color-navy-500)', margin: '6px 0' }}>
              {modelStatus === 'loading' && '… Loading face-recognition model…'}
              {modelStatus === 'ready' && '✓ Face model ready'}
              {modelStatus === 'error' && '✗ Face model failed to load (check network)'}
            </p>
            {face && (
              <p className={styles.statusOk}>✓ Face captured — detection quality {(face.detectionScore * 100).toFixed(0)}%</p>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className={`${styles.btnGhost}`} style={{ flex: 1 }} onClick={captureFace} disabled={busy || !camReady || modelStatus !== 'ready'}>
                {busy ? 'Analysing…' : face ? '↻ Recapture' : 'Capture Face'}
              </button>
              <button className={`${styles.btnPrimary}`} style={{ flex: 1 }} onClick={proceedFromFace} disabled={!face}>Next →</button>
            </div>
          </div>
        )}

        {/* FINGERPRINT */}
        {step === 'fingerprint' && (
          <div className={styles.stepBody}>
            <h3 className={styles.stepHeading}>Register Fingerprint</h3>
            <p className={styles.stepHint}>
              Uses your device biometric (Windows Hello / Touch ID / fingerprint reader).<br />
              <span className={styles.stepHintHi}>आपके डिवाइस का बायोमेट्रिक उपयोग होगा।</span>
            </p>
            {platformAvail === false && (
              <div className={styles.errorBox}>No platform authenticator detected on this device. You can still continue with face + IP only.</div>
            )}
            {fingerprint
              ? <p className={styles.statusOk}>✓ Fingerprint credential registered ({fingerprint.credentialId.slice(0, 16)}…)</p>
              : <p style={{ fontSize: 13, color: 'var(--color-navy-500)' }}>{platformAvail === null ? 'Checking device…' : 'Tap below — your OS will ask for your fingerprint.'}</p>}
            <button className={`${styles.btnPrimary} ${styles.fullBtn}`} onClick={doRegisterFingerprint} disabled={busy || !!fingerprint}>
              {busy ? 'Waiting for biometric…' : fingerprint ? '✓ Registered' : 'Register Fingerprint'}
            </button>
            <button className={`${styles.btnGhost} ${styles.fullBtn}`} style={{ marginTop: 10 }} onClick={() => setStep('device')}>
              {fingerprint ? 'Next →' : 'Skip fingerprint →'}
            </button>
          </div>
        )}

        {/* DEVICE / IP */}
        {step === 'device' && (
          <div className={styles.stepBody}>
            <h3 className={styles.stepHeading}>Device &amp; Network</h3>
            <p className={styles.stepHint}>Your real public IP and device are recorded for this enrollment.</p>
            {busy && <p style={{ color: 'var(--color-navy-500)' }}>Detecting public IP…</p>}
            {device && (
              <div style={{ textAlign: 'left', background: 'var(--color-navy-50)', borderRadius: 10, padding: 14, fontSize: 13, lineHeight: 2 }}>
                <div><b>Public IP:</b> <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-navy-800)' }}>{device.ip}</span> <span style={{ color: 'var(--color-navy-400)' }}>(via {device.source})</span></div>
                <div><b>Platform:</b> {device.platform}</div>
                <div><b>Location:</b> CryptoExam Center New Delhi <span style={{ color: 'var(--color-navy-400)' }}>(hard-coded)</span></div>
              </div>
            )}
            <button className={`${styles.btnPrimary} ${styles.fullBtn}`} style={{ marginTop: 14 }} onClick={finish} disabled={busy}>
              ✓ Complete Enrollment
            </button>
          </div>
        )}

        {/* DONE */}
        {step === 'done' && (
          <div className={styles.stepBody}>
            <div className={styles.resultIcon + ' ' + styles.resultVerified}>✓</div>
            <h3 className={styles.stepHeading}>Enrollment complete</h3>
            <p className={styles.stepHint}>
              {fullName}, your face {fingerprint ? ', fingerprint' : ''} and device IP are registered on this browser.
            </p>
            <Link href="/invigilator/login" className={`${styles.btnPrimary} ${styles.fullBtn}`} style={{ display: 'block', textAlign: 'center', textDecoration: 'none', lineHeight: '40px' }}>
              Continue to Login →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
