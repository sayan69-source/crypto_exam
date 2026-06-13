/**
 * CryptoExam Core — Live Exam Session Page (NTA JEE Main Style)
 * 
 * Layout: Top Header Bar + Left Question Area + Right Navigator Panel
 * Status Palette: Not Visited | Not Answered (Red) | Answered (Green) | 
 *                 Marked for Review (Purple) | Answered & Marked (Purple+Green)
 * Action Buttons: Save & Next | Clear Response | Mark for Review & Next
 */
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import styles from './session.module.css';
import { mockQuestions, mockExams } from '@/lib/api/mock-data';
import { ExamLockdown } from '@/lib/anti-cheat/ExamLockdown';
import PanicButton from '@/components/exam/PanicButton';
import { parseExamConfig } from '@/lib/api/ExamConfigParser';
import { useAuth } from '@/lib/auth/AuthContext';

/**
 * Question states follow the NTA standard:
 * - not_visited:      Grey — never navigated to
 * - not_answered:     Red — visited but no answer saved
 * - answered:         Green — answer saved
 * - marked_review:    Purple — marked for review, no answer
 * - answered_review:  Purple+Green — answer saved AND marked for review
 */
type QStatus = 'not_visited' | 'not_answered' | 'answered' | 'marked_review' | 'answered_review';

interface QuestionState {
  selectedOption: string | null;  // currently selected, not yet saved
  savedAnswer: string | null;     // saved answer
  markedForReview: boolean;
  visited: boolean;
  timeSpent: number;
}

export default function ExamSessionPage() {
  const router = useRouter();
  const { session } = useAuth();
  const exam = mockExams[0];
  const questions = mockQuestions;

  // Dynamic config
  const config = useMemo(() => parseExamConfig(exam, questions), [exam, questions]);
  const sections = config.sections;

  const [currentQ, setCurrentQ] = useState(0);
  const [activeSection, setActiveSection] = useState(sections[0]?.id || '');
  const [states, setStates] = useState<Record<number, QuestionState>>(() => {
    const init: Record<number, QuestionState> = {};
    questions.forEach((_, i) => {
      init[i] = { selectedOption: null, savedAnswer: null, markedForReview: false, visited: false, timeSpent: 0 };
    });
    // Mark first question as visited
    if (init[0]) init[0].visited = true;
    return init;
  });
  const [timeLeft, setTimeLeft] = useState(exam.duration_minutes * 60);
  const [antiCheatWarning, setAntiCheatWarning] = useState<string | null>(null);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [language, setLanguage] = useState<'en' | 'hi'>('en');

  // Timer
  useEffect(() => {
    if (isSubmitted) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timer); handleSubmit(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isSubmitted]);

  // Anti-cheat: Right-click prevention
  useEffect(() => {
    const handler = (e: MouseEvent) => { e.preventDefault(); };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  // Anti-cheat: Copy/paste prevention
  useEffect(() => {
    const handler = (e: ClipboardEvent) => { e.preventDefault(); };
    document.addEventListener('copy', handler);
    document.addEventListener('cut', handler);
    return () => { document.removeEventListener('copy', handler); document.removeEventListener('cut', handler); };
  }, []);

  const handleViolation = useCallback((type: string, details: string) => {
    if (type === 'WINDOW_BLUR' || type === 'FULLSCREEN_EXIT') {
      setTabSwitchCount(prev => {
        const next = prev + 1;
        if (next >= 5) setAntiCheatWarning('CRITICAL: Multiple violations detected. Session flagged.');
        else if (next >= 3) setAntiCheatWarning('WARNING: Repeated focus loss. Stay on the exam page.');
        else setAntiCheatWarning('Focus loss detected. Remain in fullscreen.');
        return next;
      });
    } else {
      setAntiCheatWarning(`${details}`);
      setTimeout(() => setAntiCheatWarning(null), 3000);
    }
  }, []);

  // ── Navigation ──
  const navigateTo = useCallback((idx: number) => {
    if (idx < 0 || idx >= questions.length) return;
    setStates(prev => ({
      ...prev,
      [idx]: { ...prev[idx], visited: true },
    }));
    setCurrentQ(idx);
    // Update active section
    const q = questions[idx];
    const sec = sections.find(s => s.questionIndices.includes(idx));
    if (sec) setActiveSection(sec.id);
  }, [questions, sections]);

  // ── Option Selection (local, not saved yet) ──
  const selectOption = useCallback((option: string) => {
    setStates(prev => ({
      ...prev,
      [currentQ]: { ...prev[currentQ], selectedOption: option },
    }));
  }, [currentQ]);

  // ── Save & Next ──
  const saveAndNext = useCallback(() => {
    setStates(prev => {
      const cur = prev[currentQ];
      return {
        ...prev,
        [currentQ]: { ...cur, savedAnswer: cur.selectedOption, visited: true },
      };
    });
    navigateTo(currentQ + 1);
  }, [currentQ, navigateTo]);

  // ── Clear Response ──
  const clearResponse = useCallback(() => {
    setStates(prev => ({
      ...prev,
      [currentQ]: { ...prev[currentQ], selectedOption: null, savedAnswer: null },
    }));
  }, [currentQ]);

  // ── Mark for Review & Next ──
  const markForReviewAndNext = useCallback(() => {
    setStates(prev => {
      const cur = prev[currentQ];
      return {
        ...prev,
        [currentQ]: { ...cur, markedForReview: true, savedAnswer: cur.selectedOption, visited: true },
      };
    });
    navigateTo(currentQ + 1);
  }, [currentQ, navigateTo]);

  // ── Get question status for palette ──
  const getQStatus = (i: number): QStatus => {
    const s = states[i];
    if (!s.visited) return 'not_visited';
    if (s.markedForReview && s.savedAnswer) return 'answered_review';
    if (s.markedForReview) return 'marked_review';
    if (s.savedAnswer) return 'answered';
    return 'not_answered';
  };

  // ── Submit ──
  const handleSubmit = useCallback(() => {
    setIsSubmitted(true);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    router.replace(`/exam/receipt/${exam.id}`);
  }, [exam.id, router]);

  // ── Computed ──
  const q = questions[currentQ];
  const qState = states[currentQ];
  const answeredCount = Object.values(states).filter(s => s.savedAnswer !== null).length;
  const notVisitedCount = Object.values(states).filter(s => !s.visited).length;
  const reviewCount = Object.values(states).filter(s => s.markedForReview).length;
  const notAnsweredCount = Object.values(states).filter(s => s.visited && !s.savedAnswer && !s.markedForReview).length;

  // Timer
  const hours = Math.floor(timeLeft / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const timerUrgent = timeLeft <= 300;

  // Current section questions
  const currentSectionObj = sections.find(s => s.id === activeSection);
  const sectionQIndices = currentSectionObj?.questionIndices || questions.map((_, i) => i);

  return (
    <>
      {/* V3 §7.3 — Silent distress panic button. Mounted outside lockdown so it is
          reachable before fullscreen entry and persists across re-renders. */}
      <PanicButton examId={config.examName} candidateId="self" seatNumber="A-127" centerId="ctr-001" />
      <ExamLockdown onViolation={handleViolation} isSubmitted={isSubmitted}>
      <div className={styles.examRoot}>
        {/* ═══ TOP HEADER BAR ═══ */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.examLogo}></span>
            <div className={styles.headerExamInfo}>
              <span className={styles.headerExamName}>{config.examName}</span>
              <span className={styles.headerExamBody}>{config.examBody} • Set {config.setLabel}</span>
            </div>
          </div>
          <div className={styles.headerCenter}>
            <div className={styles.markingScheme}>
              <span className={styles.markPlus}>+{config.positiveMarks}</span>
              <span className={styles.markSlash}>/</span>
              <span className={styles.markMinus}>-{config.negativeMarks}</span>
            </div>
            <div className={styles.langToggle}>
              <button className={language === 'en' ? styles.langActive : ''} onClick={() => setLanguage('en')}>English</button>
              <button className={language === 'hi' ? styles.langActive : ''} onClick={() => setLanguage('hi')}>हिंदी</button>
            </div>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.candidateProfile}>
              <div className={styles.profilePic}>
                {(session?.name || 'P')[0]}
              </div>
              <div className={styles.profileInfo}>
                <span className={styles.profileName}>{session?.name || 'Priya Sharma'}</span>
                <span className={styles.profileRoll}>{session?.identifier || 'NEET-2026-BIH-0847291'}</span>
              </div>
            </div>
          </div>
        </header>

        {/* ═══ SECTION TABS ═══ */}
        <div className={styles.sectionBar}>
          {sections.map(sec => (
            <button
              key={sec.id}
              className={`${styles.sectionTab} ${activeSection === sec.id ? styles.sectionActive : ''}`}
              onClick={() => {
                setActiveSection(sec.id);
                navigateTo(sec.questionIndices[0]);
              }}
            >
              {sec.name}
              <span className={styles.sectionQCount}>({sec.questionCount})</span>
            </button>
          ))}
        </div>

        {/* ═══ MAIN BODY ═══ */}
        <div className={styles.body}>
          {/* ── LEFT: Question Area ── */}
          <main className={styles.questionArea}>
            {/* Anti-cheat warning overlay */}
            {antiCheatWarning && (
              <div className={styles.warningOverlay} onClick={() => setAntiCheatWarning(null)}>
                <div className={styles.warningCard}>
                  <p>{antiCheatWarning}</p>
                  <button onClick={() => setAntiCheatWarning(null)}>Understood</button>
                </div>
              </div>
            )}

            {/* Question header */}
            <div className={styles.qHeader}>
              <span className={styles.qNum}>Question No. {currentQ + 1}</span>
              <div className={styles.qMeta}>
                <span className={styles.qSection}>{q.subject}</span>
                <span className={styles.qMarks}>
                  Marks: <span className={styles.markPosTag}>+{config.positiveMarks}</span>{' '}
                  <span className={styles.markNegTag}>-{config.negativeMarks}</span>
                </span>
              </div>
            </div>

            {/* Question text */}
            <div className={styles.qBody}>
              <p className={styles.qText}>{q.text}</p>
              {language === 'hi' && q.text_hi && (
                <p className={styles.qTextHi}>{q.text_hi}</p>
              )}
            </div>

            {/* Options */}
            <div className={styles.optionsGrid}>
              {(['A', 'B', 'C', 'D'] as const).map(opt => (
                <label
                  key={opt}
                  className={`${styles.optionRow} ${qState.selectedOption === opt ? styles.optionSelected : ''}`}
                  onClick={() => selectOption(opt)}
                >
                  <span className={styles.optionRadio}>
                    <span className={`${styles.radioCircle} ${qState.selectedOption === opt ? styles.radioChecked : ''}`} />
                  </span>
                  <span className={styles.optionLetter}>{opt})</span>
                  <span className={styles.optionContent}>{q.options[opt]}</span>
                </label>
              ))}
            </div>

            {/* Action Buttons */}
            <div className={styles.actionBar}>
              <div className={styles.actionLeft}>
                <button className={styles.btnReview} onClick={markForReviewAndNext}>
                  Mark for Review &amp; Next
                </button>
                <button className={styles.btnClear} onClick={clearResponse}>
                  Clear Response
                </button>
              </div>
              <div className={styles.actionRight}>
                <button
                  className={styles.btnPrev}
                  onClick={() => navigateTo(currentQ - 1)}
                  disabled={currentQ === 0}
                >
                  ← Previous
                </button>
                <button className={styles.btnSaveNext} onClick={saveAndNext}>
                  Save &amp; Next →
                </button>
              </div>
            </div>
          </main>

          {/* ── RIGHT: Navigator Panel ── */}
          <aside className={styles.navigator}>
            {/* Timer */}
            <div className={`${styles.timerBox} ${timerUrgent ? styles.timerUrgent : ''}`}>
              <span className={styles.timerLabel}>Time Left</span>
              <span className={styles.timerValue}>{timeStr}</span>
            </div>

            {/* Candidate Card */}
            <div className={styles.navProfile}>
              <div className={styles.navProfilePic}>{(session?.name || 'P')[0]}</div>
              <div className={styles.navProfileDetails}>
                <span>{session?.name || 'Priya Sharma'}</span>
              </div>
            </div>

            {/* Question Palette */}
            <div className={styles.palette}>
              <div className={styles.paletteHeader}>Question Palette</div>
              <div className={styles.paletteGrid}>
                {sectionQIndices.map(i => {
                  const status = getQStatus(i);
                  return (
                    <button
                      key={i}
                      className={`${styles.paletteCell} ${styles[`pal-${status}`]} ${i === currentQ ? styles.palCurrent : ''}`}
                      onClick={() => navigateTo(i)}
                      title={`Q${i + 1} — ${status.replace(/_/g, ' ')}`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Legend */}
            <div className={styles.legend}>
              <div className={styles.legendRow}>
                <span className={`${styles.legendDot} ${styles.legNotVisited}`}>{notVisitedCount}</span>
                <span>Not Visited</span>
              </div>
              <div className={styles.legendRow}>
                <span className={`${styles.legendDot} ${styles.legNotAnswered}`}>{notAnsweredCount}</span>
                <span>Not Answered</span>
              </div>
              <div className={styles.legendRow}>
                <span className={`${styles.legendDot} ${styles.legAnswered}`}>{answeredCount}</span>
                <span>Answered</span>
              </div>
              <div className={styles.legendRow}>
                <span className={`${styles.legendDot} ${styles.legReview}`}>{reviewCount}</span>
                <span>Marked for Review</span>
              </div>
            </div>

            {/* Submit */}
            <button
              className={styles.submitBtn}
              onClick={() => setShowSubmitConfirm(true)}
            >
              Submit Exam
            </button>
          </aside>
        </div>

        {/* ═══ SUBMIT CONFIRMATION MODAL ═══ */}
        {showSubmitConfirm && (
          <div className={styles.modalOverlay}>
            <div className={styles.modalCard}>
              <h3>Submit Examination?</h3>
              <div className={styles.submitSummary}>
                <div className={styles.summaryRow}><span>Answered:</span><strong className={styles.sumGreen}>{answeredCount}</strong></div>
                <div className={styles.summaryRow}><span>Not Answered:</span><strong className={styles.sumRed}>{notAnsweredCount}</strong></div>
                <div className={styles.summaryRow}><span>Not Visited:</span><strong className={styles.sumGrey}>{notVisitedCount}</strong></div>
                <div className={styles.summaryRow}><span>Marked for Review:</span><strong className={styles.sumPurple}>{reviewCount}</strong></div>
              </div>
              <p className={styles.submitWarning}>
                Once submitted, you cannot return to the exam. Are you sure you want to submit?
              </p>
              <div className={styles.modalActions}>
                <button className={styles.btnCancelSubmit} onClick={() => setShowSubmitConfirm(false)}>Go Back</button>
                <button className={styles.btnConfirmSubmit} onClick={handleSubmit}>Yes, Submit</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ExamLockdown>
    </>
  );
}
