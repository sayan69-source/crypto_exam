'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthContext';
import styles from './system-check.module.css';

interface CheckStatus {
  id: string;
  name: string;
  desc: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
}

export default function SystemCheckPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [checks, setChecks] = useState<CheckStatus[]>([
    { id: 'browser', name: 'Browser Compatibility', desc: 'Checking for modern browser features', status: 'pending' },
    { id: 'fullscreen', name: 'Fullscreen API', desc: 'Verifying fullscreen capabilities', status: 'pending' },
    { id: 'resolution', name: 'Screen Resolution', desc: 'Checking minimum 1024x768', status: 'pending' },
    { id: 'crypto', name: 'WebCrypto API', desc: 'Verifying cryptographic features', status: 'pending' },
    { id: 'storage', name: 'Local Storage', desc: 'Checking session data access', status: 'pending' },
    { id: 'multimonitor', name: 'Display Configuration', desc: 'Verifying single monitor setup', status: 'pending' },
    { id: 'devtools', name: 'Developer Tools', desc: 'Checking for closed DevTools', status: 'pending' },
    { id: 'vm', name: 'Virtual Machine Check', desc: 'Detecting hardware anomalies', status: 'pending' },
  ]);
  const [allPassed, setAllPassed] = useState(false);
  const [anyFailed, setAnyFailed] = useState(false);
  const [examId] = useState('e1a2b3c4-5678-90ab-cdef-1234567890ab'); // Mock exam ID

  useEffect(() => {
    runChecks();
  }, []);

  const updateCheck = (id: string, status: 'running' | 'passed' | 'failed') => {
    setChecks(prev => prev.map(c => c.id === id ? { ...c, status } : c));
  };

  const runChecks = async () => {
    setAllPassed(false);
    setAnyFailed(false);
    
    let hasFailure = false;

    // 1. Browser Compatibility
    updateCheck('browser', 'running');
    await new Promise(r => setTimeout(r, 400));
    const browserPassed = typeof window !== 'undefined' && 'fetch' in window && 'Promise' in window;
    updateCheck('browser', browserPassed ? 'passed' : 'failed');
    if (!browserPassed) hasFailure = true;

    // 2. Fullscreen API
    updateCheck('fullscreen', 'running');
    await new Promise(r => setTimeout(r, 400));
    const fullscreenPassed = document.fullscreenEnabled || (document as any).webkitFullscreenEnabled;
    updateCheck('fullscreen', fullscreenPassed ? 'passed' : 'failed');
    if (!fullscreenPassed) hasFailure = true;

    // 3. Screen Resolution
    updateCheck('resolution', 'running');
    await new Promise(r => setTimeout(r, 400));
    const resPassed = window.screen.width >= 1024 && window.screen.height >= 768;
    updateCheck('resolution', resPassed ? 'passed' : 'failed');
    if (!resPassed) hasFailure = true;

    // 4. WebCrypto API
    updateCheck('crypto', 'running');
    await new Promise(r => setTimeout(r, 400));
    const cryptoPassed = window.crypto && window.crypto.subtle;
    updateCheck('crypto', cryptoPassed ? 'passed' : 'failed');
    if (!cryptoPassed) hasFailure = true;

    // 5. Local Storage
    updateCheck('storage', 'running');
    await new Promise(r => setTimeout(r, 400));
    try {
      sessionStorage.setItem('__test', '1');
      sessionStorage.removeItem('__test');
      updateCheck('storage', 'passed');
    } catch {
      updateCheck('storage', 'failed');
      hasFailure = true;
    }

    // 6. Multi-monitor
    updateCheck('multimonitor', 'running');
    await new Promise(r => setTimeout(r, 600));
    // isExtended is an experimental property on screen
    const isExtended = (window.screen as any).isExtended;
    const multimonitorPassed = !isExtended; // Should not be extended
    updateCheck('multimonitor', multimonitorPassed ? 'passed' : 'failed');
    if (!multimonitorPassed) hasFailure = true;

    // 7. DevTools
    updateCheck('devtools', 'running');
    await new Promise(r => setTimeout(r, 500));
    // Simple devtools check (height/width difference)
    const threshold = 160;
    const devtoolsPassed = window.outerWidth - window.innerWidth < threshold && window.outerHeight - window.innerHeight < threshold;
    updateCheck('devtools', devtoolsPassed ? 'passed' : 'failed');
    if (!devtoolsPassed) hasFailure = true;

    // 8. VM Check
    updateCheck('vm', 'running');
    await new Promise(r => setTimeout(r, 800));
    // Hardware concurrency and device memory checks
    const vmPassed = navigator.hardwareConcurrency > 1; // Basic sanity check
    updateCheck('vm', vmPassed ? 'passed' : 'failed');
    if (!vmPassed) hasFailure = true;

    if (hasFailure) {
      setAnyFailed(true);
    } else {
      setAllPassed(true);
    }
  };

  const handleEnterExam = () => {
    // Navigate to exam session
    router.push(`/exam/session/${examId}`);
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>System Compatibility Check</h1>
          <p className={styles.subtitle}>
            Welcome, {session?.name || 'Candidate'}. We are verifying your system to ensure a secure exam environment.
          </p>
        </div>

        <div className={styles.grid}>
          {checks.map(check => (
            <div key={check.id} className={styles.checkItem}>
              <div className={styles.checkIcon}>
                {check.status === 'pending' && <span style={{ color: '#9ca3af' }}>…</span>}
                {check.status === 'running' && <span className={styles.statusSpinner} />}
                {check.status === 'passed' && <span style={{ color: '#16a34a' }}>✓</span>}
                {check.status === 'failed' && <span style={{ color: '#dc2626' }}>✗</span>}
              </div>
              <div className={styles.checkDetails}>
                <div className={styles.checkName}>{check.name}</div>
                <div className={styles.checkDesc}>{check.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.actions}>
          {anyFailed && (
            <div className={styles.warningBox}>
              One or more system checks failed. Please resolve the issues and try again.
              Ensure you have only one monitor, close developer tools, and maximize your window.
            </div>
          )}
          
          <button 
            className={styles.enterBtn} 
            disabled={!allPassed}
            onClick={handleEnterExam}
          >
            {allPassed ? 'Enter Exam Fullscreen' : 'Waiting for checks...'}
          </button>
          
          {anyFailed && (
            <button 
              className={styles.enterBtn} 
              style={{ background: 'transparent', color: 'var(--color-navy-600)', border: '1px solid var(--color-navy-200)', marginTop: '-8px' }}
              onClick={runChecks}
            >
              Run Checks Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
