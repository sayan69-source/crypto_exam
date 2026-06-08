/**
 * CryptoExam Core — Mode 2: AI-Edited Upload (Mixed Mode)
 * Dual PDF Upload (Syllabus + Paper) → CV Parsing → AI Black Box Edits
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import styles from '../paper-modes.module.css';

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

const SAMPLE_EDITS: EditedQuestion[] = [
  {
    id: 1, status: 'modified', approved: null,
    original: 'A body of mass 5 kg is thrown vertically upward with a velocity of 20 m/s. The kinetic energy at the highest point is:',
    edited: 'An object of mass 8 kg is projected vertically upward with an initial velocity of 15 m/s. Calculate the kinetic energy at the maximum height:',
    originalOptions: ['0 J', '500 J', '1000 J', '250 J'],
    editedOptions: ['0 J', '900 J', '450 J', '120 J'],
    aiLogic: 'Numerical update. Difficulty matched.'
  },
  {
    id: 2, status: 'modified', approved: null,
    original: 'Which of the following molecules has the highest dipole moment?',
    edited: 'Among the given molecules, identify the one with the greatest permanent dipole moment:',
    originalOptions: ['CO₂', 'H₂O', 'NF₃', 'NH₃'],
    editedOptions: ['BF₃', 'CHCl₃', 'NF₃', 'NH₃'],
    aiLogic: 'Rephrased + Option swap. Same concept.'
  },
  {
    id: 3, status: 'unchanged', approved: true,
    original: 'The process of formation of mRNA from DNA is called:',
    edited: 'The process of formation of mRNA from DNA is called:',
    originalOptions: ['Translation', 'Transcription', 'Replication', 'Transduction'],
    editedOptions: ['Translation', 'Transcription', 'Replication', 'Transduction'],
    aiLogic: 'Left unmodified by Black Box'
  },
  {
    id: 4, status: 'modified', approved: null,
    original: 'A concave mirror of focal length 15 cm forms an image at a distance of 30 cm. The object distance is:',
    edited: 'A convex lens of focal length 20 cm forms a real image at 60 cm from the lens. What is the object distance from the lens?',
    originalOptions: ['30 cm', '20 cm', '10 cm', '45 cm'],
    editedOptions: ['30 cm', '40 cm', '25 cm', '15 cm'],
    aiLogic: 'Changed component (mirror → lens) within same syllabus subtopic.'
  },
];

export default function AIEditedPage() {
  const [step, setStep] = useState(0);
  
  const [syllabusFile, setSyllabusFile] = useState<{ name: string; size: string } | null>(null);
  const [paperFile, setPaperFile] = useState<{ name: string; size: string } | null>(null);
  
  const [difficulty, setDifficulty] = useState<DifficultyLevel | ''>('');
  const [progress, setProgress] = useState(0);
  const [questions, setQuestions] = useState<EditedQuestion[]>(SAMPLE_EDITS);

  const handleSyllabusUpload = () => {
    setSyllabusFile({ name: `Syllabus_${Date.now()}.pdf`, size: `${(Math.random() * 2 + 0.5).toFixed(1)} MB` });
  };

  const handlePaperUpload = () => {
    setPaperFile({ name: `Question_Paper_${Date.now()}.pdf`, size: `${(Math.random() * 5 + 1).toFixed(1)} MB` });
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
      <Link href="/setter/paper-modes" className={styles.backBtn}>← Back to Paper Modes</Link>
      <h1 className={styles.title}>🔄 AI-Updated Upload (Mixed Mode)</h1>
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
            <span className={styles.infoBannerIcon}>📄</span>
            <span className={styles.infoBannerText}>
              Upload exactly two PDFs: the official Syllabus and the Question Paper. 
              Computer Vision will map them, and AI will use the syllabus limits to intelligently swap numbers or randomly rephrase questions.
            </span>
          </div>

          <div className={styles.dualUploadGrid}>
            <div className={`${styles.uploadZone} ${syllabusFile ? styles.uploadZoneActive : ''}`} onClick={handleSyllabusUpload}>
              <span className={styles.uploadIcon}>📋</span>
              <span className={styles.uploadTitle}>{syllabusFile ? 'Syllabus Uploaded' : 'Upload Syllabus PDF'}</span>
              <span className={styles.uploadDesc}>{syllabusFile ? syllabusFile.name : 'Click to select syllabus file'}</span>
            </div>

            <div className={`${styles.uploadZone} ${paperFile ? styles.uploadZoneActive : ''}`} onClick={handlePaperUpload}>
              <span className={styles.uploadIcon}>📝</span>
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
              <span className={styles.diffIcon}>🟢</span>
              <span className={styles.diffName}>Light</span>
              <span className={`${styles.diffPercent} ${styles.diffEasyColor}`}>~20%</span>
              <span className={styles.diffDesc}>Only changes numerical values and swaps option orders. Text remains identical.</span>
            </div>

            <div
              className={`${styles.diffCard} ${styles.diffCardMedium} ${difficulty === 'MEDIUM' ? styles.diffSelected : ''}`}
              onClick={() => setDifficulty('MEDIUM')}
            >
              <span className={styles.diffIcon}>🟡</span>
              <span className={styles.diffName}>Moderate</span>
              <span className={`${styles.diffPercent} ${styles.diffMedColor}`}>~50%</span>
              <span className={styles.diffDesc}>Rephrases questions slightly + randomizes numbers. Same core concepts.</span>
            </div>

            <div
              className={`${styles.diffCard} ${styles.diffCardHard} ${difficulty === 'HARD' ? styles.diffSelected : ''}`}
              onClick={() => setDifficulty('HARD')}
            >
              <span className={styles.diffIcon}>🔴</span>
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
              <div className={styles.cvIcon}>👁️</div>
              <div className={styles.cvText}>Computer Vision Optical Parsing...</div>
            </div>
          ) : (
            <div className={styles.cvScanner} style={{ borderColor: '#6366f1' }}>
              <div className={styles.cvIcon}>🤖</div>
              <div className={styles.cvText} style={{ color: '#818cf8' }}>Black-Box AI Randomization Active...</div>
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
            <h3 className={styles.sectionTitle}>⚙️ Action Log</h3>
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
                    {item.done ? '✅' : progress > i * 14 ? '⏳' : '⬜'}
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
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>Review AI Black-Box Updates ({approvedCount}/{totalReviewable} approved)</h3>
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
                      {q.status === 'modified' ? '🔄 AI Updated' : '— Unchanged'}
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
                    {q.approved === true && <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, marginRight: 8 }}>✅ Approved</span>}
                    {q.approved === false && <span style={{ fontSize: 11, color: '#f87171', fontWeight: 600, marginRight: 8 }}>❌ Rejected</span>}
                    <button className={styles.approveBtn} onClick={() => handleApprove(q.id)}>✓ Approve</button>
                    <button className={styles.rejectBtn} onClick={() => handleReject(q.id)}>✕ Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {approvedCount >= totalReviewable && (
            <button className={styles.submitBtn} style={{ marginTop: 24 }}>🔐 Finalize & Lock Paper →</button>
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
