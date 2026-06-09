'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import styles from '@/app/exam/session/[examId]/session.module.css';

interface ExamLockdownProps {
  children: React.ReactNode;
  onViolation: (type: string, details: string) => void;
  isSubmitted: boolean;
}

export function ExamLockdown({ children, onViolation, isSubmitted }: ExamLockdownProps) {
  const router = useRouter();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  
  // Enter fullscreen
  const requestFullscreen = useCallback(async () => {
    try {
      const elem = document.documentElement;
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if ((elem as any).webkitRequestFullscreen) {
        await (elem as any).webkitRequestFullscreen();
      }
      setIsFullscreen(true);
      setHasStarted(true);
    } catch (err) {
      console.error('Error attempting to enable fullscreen:', err);
      alert('Fullscreen is required for the exam. Please click to enter fullscreen.');
    }
  }, []);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = !!document.fullscreenElement || !!(document as any).webkitFullscreenElement;
      setIsFullscreen(isFull);
      if (hasStarted && !isFull && !isSubmitted) {
        onViolation('FULLSCREEN_EXIT', 'User exited fullscreen mode.');
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [hasStarted, isSubmitted, onViolation]);

  // Keyboard shortcut blocking
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow F5/Ctrl+R only if not started
      if (!hasStarted) return;
      
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Block F1-F12
      if (e.key.startsWith('F') && e.key.length <= 3) {
        e.preventDefault();
      }
      
      // Block Ctrl/Cmd combinations
      if (cmdOrCtrl && ['c', 'v', 'x', 'p', 's', 'r', 't', 'w', 'n'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        onViolation('KEYBOARD_SHORTCUT', `Attempted blocked shortcut: ${isMac ? 'Cmd' : 'Ctrl'}+${e.key}`);
      }

      // Block Alt/Option
      if (e.altKey) {
        e.preventDefault();
        onViolation('KEYBOARD_SHORTCUT', 'Attempted Alt key combo');
      }

      // Block PrintScreen / Windows key if possible (browser support varies)
      if (e.key === 'Meta' || e.key === 'OS' || e.key === 'PrintScreen') {
        onViolation('KEYBOARD_SHORTCUT', `Attempted blocked key: ${e.key}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [hasStarted, onViolation]);

  // Navigation / Unload blocking
  useEffect(() => {
    if (!hasStarted || isSubmitted) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // Required for older browsers
      return '';
    };

    // Push state to trap back button
    window.history.pushState(null, '', window.location.href);
    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href);
      onViolation('NAVIGATION_ATTEMPT', 'Attempted to use browser back/forward button');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [hasStarted, isSubmitted, onViolation]);

  // Window Blur (Detects Alt+Tab or clicking other windows)
  useEffect(() => {
    if (!hasStarted || isSubmitted) return;

    const handleBlur = () => {
      onViolation('WINDOW_BLUR', 'Window lost focus');
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [hasStarted, isSubmitted, onViolation]);

  // Block Dragging
  useEffect(() => {
    if (!hasStarted || isSubmitted) return;
    
    const blockDrag = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragstart', blockDrag);
    return () => window.removeEventListener('dragstart', blockDrag);
  }, [hasStarted, isSubmitted]);

  // If exam has started but not in fullscreen (and not submitted), show overlay
  if (hasStarted && !isFullscreen && !isSubmitted) {
    return (
      <div className={styles.antiCheatOverlay} style={{ background: 'var(--color-navy-950)', zIndex: 9999 }}>
        <div className={styles.antiCheatCard}>
          <h2 style={{ fontSize: 24, marginBottom: 16, color: 'var(--color-danger)' }}>⚠️ Exam Paused</h2>
          <p>You have exited fullscreen mode. Your activity has been logged.</p>
          <p style={{ marginTop: 8, marginBottom: 24 }}>You must return to fullscreen to continue the exam.</p>
          <button onClick={requestFullscreen} style={{ padding: '12px 24px', fontSize: 16, background: 'var(--color-navy-600)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            Return to Fullscreen
          </button>
        </div>
      </div>
    );
  }

  // Initial start screen to require user interaction for fullscreen
  if (!hasStarted) {
    return (
      <div className={styles.antiCheatOverlay} style={{ background: 'var(--color-navy-950)', zIndex: 9999 }}>
        <div className={styles.antiCheatCard} style={{ maxWidth: 500 }}>
          <h2 style={{ fontSize: 24, marginBottom: 16, color: 'var(--color-navy-900)' }}>Ready to Begin</h2>
          <p style={{ textAlign: 'left', marginBottom: 12 }}>You are about to enter the secure exam environment.</p>
          <ul style={{ textAlign: 'left', marginBottom: 24, fontSize: 14, color: 'var(--color-navy-600)', paddingLeft: 20 }}>
            <li>The exam will run in fullscreen mode.</li>
            <li>Do not switch tabs, minimize the window, or use other applications.</li>
            <li>Keyboard shortcuts (copy, paste, print) are disabled.</li>
            <li>Right-click is disabled.</li>
            <li>You cannot exit until the exam is submitted.</li>
          </ul>
          <button onClick={requestFullscreen} style={{ padding: '14px 24px', fontSize: 16, fontWeight: 'bold', width: '100%', background: 'var(--color-navy-600)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            Start Exam & Enter Fullscreen
          </button>
        </div>
      </div>
    );
  }

  // Wrapper for user-select none
  return (
    <div style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
      {children}
    </div>
  );
}
