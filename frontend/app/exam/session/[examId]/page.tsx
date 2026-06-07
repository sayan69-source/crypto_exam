/**
 * CryptoExam Core — Live Exam Session Page
 * THE MOST IMPORTANT PAGE — 3-column CSS Grid
 * Left: Navigator | Center: Question | Right: Timer + Crypto Status
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './session.module.css';
import { mockQuestions, mockExams } from '@/lib/api/mock-data';

type AnswerState = 'unanswered' | 'answered' | 'flagged' | 'flagged_answered';

interface QuestionState {
  answer: string | null;
  flagged: boolean;
  timeSpent: number;
}

export default function ExamSessionPage() {
  const exam = mockExams[0];
  const questions = mockQuestions;
  const sections = [...new Set(questions.map(q => q.subject))];

  const [currentQ, setCurrentQ] = useState(0);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [states, setStates] = useState<Record<number, QuestionState>>(
    Object.fromEntries(questions.map((_, i) => [i, { answer: null, flagged: false, timeSpent: 0 }]))
  );
  const [timeLeft, setTimeLeft] = useState(exam.duration_minutes * 60);
  const [antiCheatWarning, setAntiCheatWarning] = useState<string | null>(null);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Anti-cheat: Page visibility
  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        setTabSwitchCount(prev => {
          const next = prev + 1;
          if (next >= 5) {
            setAntiCheatWarning('⚠️ Multiple tab switches detected. Your activity has been flagged.');
          } else if (next >= 3) {
            setAntiCheatWarning('⚠️ Tab switch detected. Please stay on the exam page.');
          }
          return next;
        });
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Anti-cheat: Right-click prevention
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      setAntiCheatWarning('Right-click is disabled during the exam.');
      setTimeout(() => setAntiCheatWarning(null), 3000);
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  // Anti-cheat: Copy/paste prevention
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      e.preventDefault();
      setAntiCheatWarning('Copy/paste is disabled during the exam.');
      setTimeout(() => setAntiCheatWarning(null), 3000);
    };
    document.addEventListener('copy', handler);
    document.addEventListener('cut', handler);
    return () => {
      document.removeEventListener('copy', handler);
      document.removeEventListener('cut', handler);
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') navigateQ(-1);
      else if (e.key === 'ArrowRight') navigateQ(1);
      else if (['1', '2', '3', '4'].includes(e.key)) {
        selectAnswer(['A', 'B', 'C', 'D'][parseInt(e.key) - 1]);
      } else if (['a', 'b', 'c', 'd'].includes(e.key.toLowerCase())) {
        selectAnswer(e.key.toUpperCase());
      } else if (e.key.toLowerCase() === 'f') toggleFlag();
      else if (e.key === '?') setShowHelp(prev => !prev);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [currentQ, states]);

  const navigateQ = useCallback((delta: number) => {
    setCurrentQ(prev => {
      const next = prev + delta;
      if (next < 0 || next >= questions.length) return prev;
      return next;
    });
  }, [questions.length]);

  const selectAnswer = useCallback((option: string) => {
    setStates(prev => ({
      ...prev,
      [currentQ]: { ...prev[currentQ], answer: option },
    }));
  }, [currentQ]);

  const clearAnswer = useCallback(() => {
    setStates(prev => ({
      ...prev,
      [currentQ]: { ...prev[currentQ], answer: null },
    }));
  }, [currentQ]);

  const toggleFlag = useCallback(() => {
    setStates(prev => ({
      ...prev,
      [currentQ]: { ...prev[currentQ], flagged: !prev[currentQ].flagged },
    }));
  }, [currentQ]);

  const getQState = (i: number): AnswerState => {
    const s = states[i];
    if (s.flagged && s.answer) return 'flagged_answered';
    if (s.flagged) return 'flagged';
    if (s.answer) return 'answered';
    return 'unanswered';
  };

  const answeredCount = Object.values(states).filter(s => s.answer !== null).length;
  const q = questions[currentQ];
  const qState = states[currentQ];

  // Timer formatting
  const hours = Math.floor(timeLeft / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  // Timer color
  const timerColor = timeLeft > 1800 ? 'var(--color-navy-500)' : timeLeft > 600 ? '#d97706' : timeLeft > 300 ? '#ea580c' : 'var(--color-danger)';
  const timerProgress = (timeLeft / (exam.duration_minutes * 60)) * 100;

  // SVG ring for timer
  const ringSize = 140;
  const ringStroke = 6;
  const ringRadius = (ringSize - ringStroke) / 2;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (timerProgress / 100) * ringCircumference;

  // Filter questions by section
  const filteredIndices = activeSection
    ? questions.map((q, i) => ({ q, i })).filter(x => x.q.subject === activeSection).map(x => x.i)
    : questions.map((_, i) => i);

  return (
    <div className={styles.session} style={{ userSelect: 'none' }}>
      {/* Anti-cheat warning overlay */}
      {antiCheatWarning && (
        <div className={styles.antiCheatOverlay} onClick={() => setAntiCheatWarning(null)}>
          <div className={styles.antiCheatCard}>
            <p>{antiCheatWarning}</p>
            <button onClick={() => setAntiCheatWarning(null)}>Understood</button>
          </div>
        </div>
      )}

      {/* Keyboard help modal */}
      {showHelp && (
        <div className={styles.helpOverlay} onClick={() => setShowHelp(false)}>
          <div className={styles.helpCard} onClick={e => e.stopPropagation()}>
            <h3>⌨️ Keyboard Shortcuts</h3>
            <div className={styles.helpGrid}>
              <kbd>←</kbd><span>Previous question</span>
              <kbd>→</kbd><span>Next question</span>
              <kbd>1-4</kbd><span>Select option A-D</span>
              <kbd>A-D</kbd><span>Select option A-D</span>
              <kbd>F</kbd><span>Toggle flag</span>
              <kbd>?</kbd><span>Toggle this help</span>
            </div>
            <button className={styles.helpClose} onClick={() => setShowHelp(false)}>Close</button>
          </div>
        </div>
      )}

      {/* LEFT COLUMN — Navigator */}
      <aside className={styles.left}>
        <div className={styles.candidateInfo}>
          <span className={styles.candidateName}>Priya Sharma</span>
          <span className={styles.rollNumber}>NEET-2026-BIH-0847291</span>
        </div>

        <div className={styles.examInfo}>
          <span className={styles.examName}>{exam.name}</span>
          <span className={styles.setLabel}>Set B</span>
        </div>

        {/* Section tabs */}
        <div className={styles.sectionTabs}>
          <button
            className={`${styles.sectionTab} ${!activeSection ? styles.sectionActive : ''}`}
            onClick={() => setActiveSection(null)}
          >
            All
          </button>
          {sections.map(s => (
            <button
              key={s}
              className={`${styles.sectionTab} ${activeSection === s ? styles.sectionActive : ''}`}
              onClick={() => setActiveSection(s)}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Question grid */}
        <div className={styles.qGrid}>
          {filteredIndices.map(i => (
            <button
              key={i}
              className={`${styles.qCell} ${styles[`q-${getQState(i)}`]} ${i === currentQ ? styles.qCurrent : ''}`}
              onClick={() => setCurrentQ(i)}
              aria-label={`Question ${i + 1}, ${getQState(i)}`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        <div className={styles.answerCount}>
          {answeredCount} / {questions.length} answered
        </div>

        <button className={styles.submitExamBtn} disabled={answeredCount < questions.length}>
          Submit Exam
        </button>
      </aside>

      {/* CENTER COLUMN — Question */}
      <main className={styles.center}>
        <div className={styles.qHeader}>
          <span className={styles.qNumber}>Question {currentQ + 1} of {questions.length}</span>
          <span className={styles.qSubjectBadge}>{q.subject}</span>
          <span className={styles.qBloomsBadge}>Bloom&apos;s L{q.blooms_level}</span>
          <button
            className={`${styles.flagBtn} ${qState.flagged ? styles.flagActive : ''}`}
            onClick={toggleFlag}
            aria-label={qState.flagged ? 'Remove flag' : 'Flag for review'}
          >
            {qState.flagged ? '🚩 Flagged' : '⚑ Flag for review'}
          </button>
        </div>

        <div className={styles.qText}>
          <p>{q.text}</p>
          {q.text_hi && <p className={styles.qTextHi}>{q.text_hi}</p>}
        </div>

        <div className={styles.options} role="radiogroup" aria-label="Answer options">
          {(['A', 'B', 'C', 'D'] as const).map(opt => (
            <button
              key={opt}
              className={`${styles.option} ${qState.answer === opt ? styles.optionSelected : ''}`}
              onClick={() => selectAnswer(opt)}
              role="radio"
              aria-checked={qState.answer === opt}
            >
              <span className={styles.optionLabel}>{opt}</span>
              <span className={styles.optionText}>{q.options[opt]}</span>
            </button>
          ))}
        </div>

        {qState.answer && (
          <button className={styles.clearBtn} onClick={clearAnswer}>
            ✕ Clear answer
          </button>
        )}

        <div className={styles.navButtons}>
          <button
            className={styles.navBtn}
            onClick={() => navigateQ(-1)}
            disabled={currentQ === 0}
          >
            ← Previous
          </button>
          <button className={styles.helpToggle} onClick={() => setShowHelp(true)}>
            ⌨️ Shortcuts (?)
          </button>
          <button
            className={styles.navBtn}
            onClick={() => navigateQ(1)}
            disabled={currentQ === questions.length - 1}
          >
            Next →
          </button>
        </div>
      </main>

      {/* RIGHT COLUMN — Timer + Crypto */}
      <aside className={styles.right}>
        {/* Timer */}
        <div className={styles.timerSection}>
          <div className={styles.timerRing} style={{ width: ringSize, height: ringSize }}>
            <svg width={ringSize} height={ringSize}>
              <circle
                cx={ringSize / 2} cy={ringSize / 2} r={ringRadius}
                fill="none" stroke="#e5e7eb" strokeWidth={ringStroke}
              />
              <circle
                cx={ringSize / 2} cy={ringSize / 2} r={ringRadius}
                fill="none" stroke={timerColor} strokeWidth={ringStroke}
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                style={{ transition: 'stroke-dashoffset 1s linear, stroke 300ms ease' }}
              />
            </svg>
            <div className={styles.timerText}>
              <span className={styles.timerValue} style={{ color: timerColor }}>{timeStr}</span>
              <span className={styles.timerLabel}>remaining</span>
            </div>
          </div>
        </div>

        {/* Crypto status */}
        <div className={styles.cryptoStatus}>
          <div className={styles.cryptoBadge}>
            <span>🔒</span> Answers encrypted as you answer
          </div>
          <div className={styles.cryptoBadge}>
            <span>⛓️</span> Will commit to blockchain on submit
          </div>
          <div className={styles.cryptoHash}>
            <span className={styles.cryptoLabel}>Question Hash</span>
            <code>{exam.question_hash?.slice(0, 12)}...</code>
          </div>
        </div>

        {/* Section time advisor */}
        <div className={styles.sectionAdvisor}>
          <h4>Section Progress</h4>
          {sections.map(s => {
            const sectionQs = questions.filter(q => q.subject === s);
            const sectionAnswered = sectionQs.filter((_, i) => {
              const idx = questions.findIndex(q2 => q2.id === sectionQs[i]?.id);
              return states[idx]?.answer !== null;
            }).length;
            return (
              <div key={s} className={styles.sectionProgress}>
                <span className={styles.sectionName}>{s}</span>
                <div className={styles.sectionBar}>
                  <div
                    className={styles.sectionFill}
                    style={{ width: `${(sectionAnswered / sectionQs.length) * 100}%` }}
                  />
                </div>
                <span className={styles.sectionCount}>{sectionAnswered}/{sectionQs.length}</span>
              </div>
            );
          })}
        </div>

        {/* Invigilator contact */}
        <div className={styles.invigilator}>
          <span className={styles.invLabel}>Invigilator</span>
          <span className={styles.invName}>Dr. Anita Desai</span>
          <span className={styles.invPhone}>📞 +91 12345 67890</span>
        </div>
      </aside>
    </div>
  );
}
