/**
 * CryptoExam Core — Pre-Exam Verification Wizard
 * 3-step wizard: Identity → System Check → Exam Brief
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { mockExams } from '@/lib/api/mock-data';

const SYSTEM_CHECKS = [
  { label: 'Browser compatibility', icon: '🌐' },
  { label: 'Screen resolution ≥ 1280px', icon: '🖥️' },
  { label: 'Webcam access', icon: '📷' },
  { label: 'Fullscreen API available', icon: '⛶' },
  { label: 'Network connectivity', icon: '📶' },
  { label: 'Clipboard API (suppressed)', icon: '📋' },
  { label: 'Keyboard detection', icon: '⌨️' },
  { label: 'Time sync (NTP ±2s)', icon: '🕐' },
];

export default function VerifyPage() {
  const exam = mockExams[0];
  const [step, setStep] = useState(0);
  const [checks, setChecks] = useState<(boolean | null)[]>(new Array(SYSTEM_CHECKS.length).fill(null));

  // Simulate system checks
  useEffect(() => {
    if (step !== 1) return;
    SYSTEM_CHECKS.forEach((_, i) => {
      setTimeout(() => {
        setChecks(prev => { const next = [...prev]; next[i] = Math.random() > 0.05; return next; });
      }, 500 + i * 600);
    });
  }, [step]);

  const allChecksPassed = checks.every(c => c === true);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', animation: 'fadeIn 300ms ease forwards' }}>
      {/* Stepper */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 32 }}>
        {['Identity', 'System Check', 'Exam Brief'].map((s, i) => (
          <div key={i} style={{ flex: 1, padding: '10px 16px', borderRadius: 8, background: i <= step ? 'var(--color-navy-600)' : 'var(--color-navy-50)', textAlign: 'center', fontSize: 13, fontWeight: i <= step ? 600 : 400, color: i <= step ? 'white' : 'var(--color-navy-400)', transition: 'all 200ms ease' }}>
            {i < step ? '✓' : i + 1}. {s}
          </div>
        ))}
      </div>

      {/* Step 1 — Identity */}
      {step === 0 && (
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 16, padding: 32, boxShadow: 'var(--shadow-md)' }}>
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>Identity Verification</h2>
          <p style={{ fontSize: 13, color: 'var(--color-navy-400)', marginBottom: 24 }}>Confirm your identity before entering the exam</p>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: 16, background: 'var(--color-navy-50)', borderRadius: 12, marginBottom: 24 }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--color-navy-200)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📷</div>
            <div>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-navy-800)', display: 'block' }}>Priya Sharma</span>
              <span style={{ fontSize: 12, color: 'var(--color-navy-400)', fontFamily: 'var(--font-mono)' }}>NEET-2026-BIH-0847291</span>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 12px', borderRadius: 9999, background: 'var(--color-success-light)', color: 'var(--color-success-text)', fontWeight: 600 }}>✅ Verified</span>
          </div>
          <button onClick={() => setStep(1)} style={{ width: '100%', padding: 13, fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)', background: 'var(--color-navy-600)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Proceed to System Check →</button>
        </div>
      )}

      {/* Step 2 — System Check */}
      {step === 1 && (
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 16, padding: 32, boxShadow: 'var(--shadow-md)' }}>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>System Compatibility Check</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SYSTEM_CHECKS.map((check, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, background: checks[i] === true ? 'var(--color-success-light)' : checks[i] === false ? 'var(--color-danger-light)' : '#f9fafb', transition: 'background 300ms ease' }}>
                <span style={{ fontSize: 16 }}>{check.icon}</span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--color-navy-700)' }}>{check.label}</span>
                <span style={{ fontSize: 14 }}>
                  {checks[i] === true ? '✅' : checks[i] === false ? '❌' : '⏳'}
                </span>
              </div>
            ))}
          </div>
          <button onClick={() => setStep(2)} disabled={!allChecksPassed} style={{ width: '100%', padding: 13, fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)', background: allChecksPassed ? 'var(--color-navy-600)' : '#d1d5db', color: 'white', border: 'none', borderRadius: 8, cursor: allChecksPassed ? 'pointer' : 'not-allowed', marginTop: 16 }}>
            {allChecksPassed ? 'Proceed to Exam Brief →' : 'Running checks...'}
          </button>
        </div>
      )}

      {/* Step 3 — Exam Brief */}
      {step === 2 && (
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 16, padding: 32, boxShadow: 'var(--shadow-md)' }}>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>Exam Brief</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 16px', fontSize: 14, marginBottom: 24 }}>
            <span style={{ color: '#9ca3af' }}>Exam</span><span style={{ fontWeight: 600 }}>{exam.name}</span>
            <span style={{ color: '#9ca3af' }}>Duration</span><span>{exam.duration_minutes} minutes</span>
            <span style={{ color: '#9ca3af' }}>Questions</span><span>{exam.subject_taxonomy.subjects.reduce((a, s) => a + s.question_count, 0)}</span>
            <span style={{ color: '#9ca3af' }}>Negative</span><span>-{exam.negative_marking} per wrong answer</span>
            <span style={{ color: '#9ca3af' }}>Set</span><span>Set B</span>
          </div>
          <div style={{ padding: 14, background: 'var(--color-navy-50)', borderRadius: 12, marginBottom: 24, fontSize: 12, color: 'var(--color-navy-500)' }}>
            <p style={{ margin: '0 0 4px' }}>🔒 Your answers will be encrypted as you answer.</p>
            <p style={{ margin: '0 0 4px' }}>⛓️ On submission, all answers are committed to the Polygon blockchain.</p>
            <p style={{ margin: 0 }}>🔬 Paper difficulty has been verified by ZK proof (Groth16).</p>
          </div>
          <Link href={`/exam/session/${exam.id}`} style={{ display: 'block', width: '100%', padding: 14, fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)', background: 'linear-gradient(135deg, var(--color-india-saffron), var(--color-saffron-500))', color: 'white', border: 'none', borderRadius: 8, textAlign: 'center', textDecoration: 'none' }}>
            Enter Exam →
          </Link>
        </div>
      )}
    </div>
  );
}
