/**
 * CryptoExam Core — Mode 2: AI-Edited Upload (Mixed Mode)
 * Dual PDF Upload (Syllabus + Paper) → CV Parsing → AI Black Box Edits
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import styles from '../paper-modes.module.css';
import { paperModesApi } from '@/lib/api/paper-modes';
import FinalizePanel from '@/components/setter/FinalizePanel';

const STEPS = ['Upload PDFs', 'Select Difficulty', 'CV & Black-Box AI', 'Review & Approve'];

type DifficultyLevel = 'EASY' | 'MEDIUM' | 'HARD';

interface EditedQuestion {
  id: number;
  original: string;
  edited: string;
  status: 'modified' | 'new' | 'unchanged';
  approved: boolean | null;
  originalOptions: string[];
  editedOptions: string[];
  aiLogic: string;
}

// Edited questions come from the mode-2 pipeline. There used to be a
// hardcoded SAMPLE_EDITS bank here that a setter reviewed and approved without
// any paper having been uploaded or edited.


export default function AIEditedPage() {
  const [step, setStep] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  
  const [syllabusFile, setSyllabusFile] = useState<{ name: string; size: string } | null>(null);
  const [paperFile, setPaperFile] = useState<{ name: string; size: string } | null>(null);
  
  const [difficulty, setDifficulty] = useState<DifficultyLevel | ''>('');
  const [progress, setProgress] = useState(0);
  const [questions, setQuestions] = useState<EditedQuestion[]>([]);
  const [genError, setGenError] = useState<string | null>(null);

  const syllabusObj = useRef<File | null>(null);
  const paperObj = useRef<File | null>(null);
  const fmtSize = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

  const handleSyllabusUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    syllabusObj.current = f; setSyllabusFile({ name: f.name, size: fmtSize(f.size) });
  };

  const handlePaperUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    paperObj.current = f; setPaperFile({ name: f.name, size: fmtSize(f.size) });
  };

  // Simulate CV + AI processing
  useEffect(() => {
    if (step === 2 && progress < 100) {
      const timer = setInterval(() => setProgress(p => {
        if (p >= 100) { clearInterval(timer); return 100; }
        return p + Math.floor(Math.random() * 5) + 1;
      }), 200);
      return () => clearInterval(timer);
    }
  }, [step, progress]);

  // Auto-advance
  useEffect(() => {
    if (step === 2 && progress >= 100) {
      const timer = setTimeout(() => setStep(3), 800);
      return () => clearTimeout(timer);
    }
  }, [step, progress]);

  const handleApprove = (id: number) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, approved: true } : q));
  };

  const handleReject = (id: number) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, approved: false } : q));
  };

  const editPercentage = difficulty === 'EASY' ? 20 : difficulty === 'MEDIUM' ? 50 : 80;
  const approvedCount = questions.filter(q => q.approved === true).length;
  const totalReviewable = questions.filter(q => q.status !== 'unchanged').length;

  return (
    <div className={styles.page}>
      <input id="ae-syllabus" type="file" accept="application/pdf" hidden onChange={handleSyllabusUpload} />
      <input id="ae-paper" type="file" accept="application/pdf" hidden onChange={handlePaperUpload} />
      <Link href="/setter/paper-modes" className={styles.backBtn}>← Back to Paper Modes</Link>
      <h1 className={styles.title}>AI-Updated Upload (Mixed Mode)</h1>
      <p className={styles.subtitle}>Upload Syllabus & Paper. Computer Vision extracts questions, and a Black-Box AI randomly modifies numbers and phrasing while maintaining original difficulty.</p>

      {/* Stepper */}
      <div className={styles.stepper}>
        {STEPS.map((s, i) => (
          <div key={i} className={`${styles.stepItem} ${i <= step ? styles.stepActive : ''} ${i < step ? styles.stepDone : ''}`}>
            <span className={styles.stepNum}>{i < step ? '✓' : i + 1}</span>
            <span className={styles.stepLabel}>{s}</span>
          </div>
        ))}
      </div>

      {/* Step 0: Upload PDFs */}
      {step === 0 && (
        <div className={styles.form}>
          <div className={styles.infoBanner}>
            <span className={styles.infoBannerIcon}></span>
            <span className={styles.infoBannerText}>
              Upload exactly two PDFs: the official Syllabus and the Question Paper. 
              Computer Vision will map them, and AI will use the syllabus limits to intelligently swap numbers or randomly rephrase questions.
            </span>
          </div>

          <div className={styles.dualUploadGrid}>
            <div className={`${styles.uploadZone} ${syllabusFile ? styles.uploadZoneActive : ''}`} onClick={() => document.getElementById("ae-syllabus")?.click()}>
              <span className={styles.uploadIcon}></span>
              <span className={styles.uploadTitle}>{syllabusFile ? 'Syllabus Uploaded' : 'Upload Syllabus PDF'}</span>
              <span className={styles.uploadDesc}>{syllabusFile ? syllabusFile.name : 'Click to select syllabus file'}</span>
            </div>

            <div className={`${styles.uploadZone} ${paperFile ? styles.uploadZoneActive : ''}`} onClick={() => document.getElementById("ae-paper")?.click()}>
              <span className={styles.uploadIcon}></span>
              <span className={styles.uploadTitle}>{paperFile ? 'Question Paper Uploaded' : 'Upload Question Paper PDF'}</span>
              <span className={styles.uploadDesc}>{paperFile ? paperFile.name : 'Full paper written in exam pattern'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Select Difficulty */}
      {step === 1 && (
        <div className={styles.form}>
          <h3 style={{ fontSize: 16, color: 'var(--color-navy-200)', marginBottom: 8 }}>Select Black-Box AI Intensity</h3>
          <p style={{ fontSize: 13, color: 'var(--color-navy-400)', marginBottom: 24 }}>
            Controls how aggressively the Black-Box AI randomizes your questions. The AI strictly maintains the original difficulty.
          </p>

          <div className={styles.diffGrid}>
            <div
              className={`${styles.diffCard} ${styles.diffCardEasy} ${difficulty === 'EASY' ? styles.diffSelected : ''}`}
              onClick={() => setDifficulty('EASY')}
            >
              <span className={styles.diffIcon}></span>
              <span className={styles.diffName}>Light</span>
              <span className={`${styles.diffPercent} ${styles.diffEasyColor}`}>~20%</span>
              <span className={styles.diffDesc}>Only changes numerical values and swaps option orders. Text remains identical.</span>
            </div>

            <div
              className={`${styles.diffCard} ${styles.diffCardMedium} ${difficulty === 'MEDIUM' ? styles.diffSelected : ''}`}
              onClick={() => setDifficulty('MEDIUM')}
            >
              <span className={styles.diffIcon}></span>
              <span className={styles.diffName}>Moderate</span>
              <span className={`${styles.diffPercent} ${styles.diffMedColor}`}>~50%</span>
              <span className={styles.diffDesc}>Rephrases questions slightly + randomizes numbers. Same core concepts.</span>
            </div>

            <div
              className={`${styles.diffCard} ${styles.diffCardHard} ${difficulty === 'HARD' ? styles.diffSelected : ''}`}
              onClick={() => setDifficulty('HARD')}
            >
              <span className={styles.diffIcon}></span>
              <span className={styles.diffName}>Aggressive</span>
              <span className={`${styles.diffPercent} ${styles.diffHardColor}`}>~80%</span>
              <span className={styles.diffDesc}>Major overhauls. AI may swap entire components (e.g., lens to mirror) within syllabus limits.</span>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: CV + AI Processing */}
      {step === 2 && (
        <div className={styles.form}>
          
          {/* CV Animation shown first half */}
          {progress < 50 ? (
            <div className={styles.cvScanner}>
              <div className={styles.cvIcon}></div>
              <div className={styles.cvText}>Computer Vision Optical Parsing...</div>
            </div>
          ) : (
            <div className={styles.cvScanner} style={{ borderColor: '#605d52' }}>
              <div className={styles.cvIcon}></div>
              <div className={styles.cvText} style={{ color: '#939084' }}>Black-Box AI Randomization Active...</div>
            </div>
          )}

          <div className={styles.progressCard} style={{ marginTop: 16 }}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>Processing Pipeline — {difficulty} Mode ({editPercentage}% edit)</span>
              <span className={styles.progressValue}>{Math.min(progress, 100)}%</span>
            </div>
            <div className={styles.progressBar}>
              <div className={`${styles.progressFill} ${styles.progressFillAI}`} style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          </div>

          <div className={styles.sectionCard}>
            <h3 className={styles.sectionTitle}>Action Log</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { msg: '[CV] Extracting syllabus constraints...', done: progress > 10 },
                { msg: '[CV] Parsing CBT structure from uploaded Question Paper...', done: progress > 25 },
                { msg: '[CV] Mapping questions to Syllabus subtopics...', done: progress > 40 },
                { msg: `[AI] Initializing Black-Box updater...`, done: progress > 50 },
                { msg: `[AI] Randomizing numerical values...`, done: progress > 65 },
                { msg: `[AI] Rephrasing text while matching original difficulty...`, done: progress > 80 },
                { msg: '[AI] Generating diff report...', done: progress >= 100 },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>
                    {item.done ? '✓' : progress > i * 14 ? '…' : ''}
                  </span>
                  <span style={{ fontSize: 13, color: item.done ? 'var(--color-navy-200)' : 'var(--color-navy-500)' }}>{item.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Review & Approve */}
      {step === 3 && (
        <div className={styles.form}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fffefb' }}>Review AI Black-Box Updates ({approvedCount}/{totalReviewable} approved)</h3>
            <span style={{ fontSize: 12, color: 'var(--color-navy-400)' }}>
              {questions.filter(q => q.status === 'modified').length} randomized · {questions.filter(q => q.status === 'unchanged').length} unchanged
            </span>
          </div>

          <div className={styles.diffView}>
            {questions.map(q => (
              <div key={q.id} className={styles.diffItem}>
                <div className={styles.diffHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className={styles.diffQNum}>Q{q.id}</span>
                    <span className={`${styles.diffStatus} ${q.status === 'modified' ? styles.diffModified : styles.diffUnchanged}`}>
                      {q.status === 'modified' ? 'AI Updated' : '— Unchanged'}
                    </span>
                  </div>
                  {q.status === 'modified' && (
                    <span style={{ fontSize: 11, color: 'var(--color-navy-400)', fontFamily: 'var(--font-mono)' }}>
                      Logic: {q.aiLogic}
                    </span>
                  )}
                </div>

                <div className={styles.diffBody}>
                  <div className={styles.diffOriginal}>
                    <span className={`${styles.diffColumnLabel} ${styles.diffOrigLabel}`}>CV Parsed (Original)</span>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>{q.original}</p>
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {q.originalOptions.map((opt, i) => (
                        <span key={i} style={{ fontSize: 12, color: 'var(--color-navy-500)' }}>({String.fromCharCode(65 + i)}) {opt}</span>
                      ))}
                    </div>
                  </div>
                  <div className={styles.diffEdited}>
                    <span className={`${styles.diffColumnLabel} ${styles.diffEditLabel}`}>AI Black-Box Update</span>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>{q.edited}</p>
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {q.editedOptions.map((opt, i) => (
                        <span key={i} style={{ fontSize: 12, color: 'var(--color-navy-300)' }}>({String.fromCharCode(65 + i)}) {opt}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {q.status !== 'unchanged' && (
                  <div className={styles.diffActions}>
                    {q.approved === true && <span style={{ fontSize: 11, color: '#6fa678', fontWeight: 600, marginRight: 8 }}>✓ Approved</span>}
                    {q.approved === false && <span style={{ fontSize: 11, color: '#c25a48', fontWeight: 600, marginRight: 8 }}>✗ Rejected</span>}
                    <button className={styles.approveBtn} onClick={() => handleApprove(q.id)}>✓ Approve</button>
                    <button className={styles.rejectBtn} onClick={() => handleReject(q.id)}>✕ Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {approvedCount >= totalReviewable && (
            <FinalizePanel taskId={taskId} label="Finalize & Lock Paper →" />
          )}
        </div>
      )}

      {/* Navigation */}
      {step !== 2 && (
        <div className={styles.navRow}>
          <button className={styles.prevBtn} onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>← Previous</button>
          <button className={styles.nextBtn} onClick={() => { setStep(Math.min(STEPS.length - 1, step + 1)); if (step === 1) setProgress(0); }} disabled={step === STEPS.length - 1 || (step === 0 && (!syllabusFile || !paperFile)) || (step === 1 && !difficulty)}>Next →</button>
        </div>
      )}
    </div>
  );
}
