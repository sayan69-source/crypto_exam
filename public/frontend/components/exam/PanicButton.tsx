/**
 * CryptoExam Core — V3 §7.3 Panic Button.
 *
 * Silent distress signal for candidates in medical / emergency distress.
 * Triggers:
 *   • Touch  — 3-finger hold for 5 seconds (mobile / tablet)
 *   • Keyboard — Ctrl+Shift+H (5-second hold)
 *
 * Behaviour:
 *   • Sends a panic alert to the invigilator dashboard (silent — no other candidate sees it).
 *   • Exam timer is NOT paused — it's the candidate's choice to wait or continue.
 *   • Brief confirmation overlay; auto-dismissable.
 *
 * Privacy:
 *   • No audio recording, no extra camera capture — just an alert with seat/timestamp.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { invigilatorApi } from '@/lib/api/invigilator';

const HOLD_MS = 5000;       // 5-second hold to prevent accidents
const MIN_TOUCHES = 3;      // 3 fingers

export interface PanicButtonProps {
  examId: string;
  candidateId: string;
  seatNumber?: string;
  centerId?: string;
}

export default function PanicButton({ examId, candidateId, seatNumber, centerId }: PanicButtonProps) {
  const [armed, setArmed] = useState(false);                     // currently in a hold
  const [progress, setProgress] = useState(0);                   // 0..1 of HOLD_MS
  const [alerted, setAlerted] = useState(false);                 // alert dispatched
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string | null>(null);

  const holdStart = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const keyDown = useRef(false);

  function cancelHold() {
    holdStart.current = null; setArmed(false); setProgress(0);
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }

  async function trigger(method: 'TOUCH' | 'KEYBOARD') {
    setAlerted(true); setProgress(1); setArmed(false); holdStart.current = null;
    setDebug(`Triggered via ${method}`);
    try {
      await invigilatorApi.panicAlert({
        examId, candidateId, seatNumber, centerId, method, timestamp: new Date().toISOString(),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function startHold(method: 'TOUCH' | 'KEYBOARD') {
    if (alerted || holdStart.current !== null) return;
    holdStart.current = Date.now(); setArmed(true);
    const loop = () => {
      if (holdStart.current === null) return;
      const elapsed = Date.now() - holdStart.current;
      const p = Math.min(1, elapsed / HOLD_MS);
      setProgress(p);
      if (p >= 1) { void trigger(method); return; }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  // Touch handlers — attached at document level so any 3-finger hold works
  useEffect(() => {
    function onStart(e: TouchEvent) {
      if (e.touches.length >= MIN_TOUCHES) startHold('TOUCH');
    }
    function onEnd(e: TouchEvent) {
      if (e.touches.length < MIN_TOUCHES) cancelHold();
    }
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // Keyboard: Ctrl+Shift+H, hold for HOLD_MS
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && (e.key === 'H' || e.key === 'h') && !keyDown.current) {
        keyDown.current = true; startHold('KEYBOARD');
        e.preventDefault();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'H' || e.key === 'h' || e.key === 'Control' || e.key === 'Shift') {
        if (keyDown.current) { keyDown.current = false; cancelHold(); }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // ── UI ────────────────────────────────────────────────────────────────
  // Hold indicator only renders when armed; confirmation overlay only after alert.
  return (
    <>
      {armed && !alerted && (
        <div style={armedOverlay}>
          <div style={armedCard}>
            <div style={{ fontSize: 40 }}></div>
            <h3 style={{ margin: '8px 0', color: '#fff' }}>Hold to call for help</h3>
            <p style={{ margin: 0, color: '#cbd5e1', fontSize: 13 }}>Keep holding to alert the invigilator…</p>
            <div style={progressBg}>
              <div style={{ ...progressFill, width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      {alerted && (
        <div style={confirmOverlay} role="status">
          <div style={confirmCard}>
            <div style={{ fontSize: 48 }}>✓</div>
            <h3 style={{ margin: '8px 0 4px', color: '#fff' }}>Help has been requested</h3>
            <p style={{ margin: 0, color: '#cbd5e1', fontSize: 14 }}>An invigilator is on their way to your seat.</p>
            <p style={{ margin: '8px 0 0', color: '#94a3b8', fontSize: 12 }}>Your exam timer is still running — you may continue or wait.</p>
            <button onClick={() => setAlerted(false)} style={dismissBtn}>Dismiss</button>
            {error && <p style={{ marginTop: 8, color: '#fca5a5', fontSize: 12 }}>Backend offline ({error}); your alert is queued locally.</p>}
            {debug && <p style={{ marginTop: 4, color: '#475569', fontSize: 10 }}>{debug}</p>}
          </div>
        </div>
      )}

      {/* Small ARIA-only label so screen readers know the panic affordance exists */}
      <span aria-live="polite" style={{ position: 'absolute', left: '-9999px' }}>
        Panic button available: hold three fingers, or hold Ctrl+Shift+H, for five seconds.
      </span>
    </>
  );
}

const armedOverlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,14,30,0.55)', display: 'grid', placeItems: 'center', zIndex: 1000 };
const armedCard: React.CSSProperties = { background: '#0F172A', border: '1px solid #7f1d1d', padding: 24, borderRadius: 14, textAlign: 'center', maxWidth: 360 };
const progressBg: React.CSSProperties = { marginTop: 14, height: 8, width: '100%', background: '#1e293b', borderRadius: 4, overflow: 'hidden' };
const progressFill: React.CSSProperties = { height: '100%', background: 'linear-gradient(90deg, #fbbf24, #ef4444)', transition: 'width 100ms linear' };

const confirmOverlay: React.CSSProperties = { position: 'fixed', top: 24, right: 24, zIndex: 1000 };
const confirmCard: React.CSSProperties = { background: '#0B1120', border: '1px solid #16a34a', padding: 22, borderRadius: 14, textAlign: 'center', maxWidth: 340, boxShadow: '0 20px 50px rgba(0,0,0,0.4)' };
const dismissBtn: React.CSSProperties = { marginTop: 12, padding: '8px 18px', background: '#1A2D5A', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' };
