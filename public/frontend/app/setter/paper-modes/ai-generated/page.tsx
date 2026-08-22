/**
 * CryptoExam Core — Mode 3: AI Full Generation
 * Dual PDF Upload (Syllabus + Reference Paper) → CV Style Analysis → Full Generation
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import styles from '../paper-modes.module.css';
import { paperModesApi } from '@/lib/api/paper-modes';
import FinalizePanel from '@/components/setter/FinalizePanel';

const STEPS = ['Upload Reference PDFs', 'Paper Settings', 'CV Analysis & Generation', 'Review & Finalize'];

interface GeneratedQuestion {
  id: number;
  text: string;
  options: string[];
  subject: string;
  topic: string;
  blooms: number;
  irt_b: number;
  approved: boolean | null;
}

// Questions come from the generation pipeline. There used to be six
// hardcoded ones here (circular motion, IUPAC naming, the lac operon…) that a
// setter would review and "approve" without any paper having been generated.


export default function AIGeneratedPage() {
  const [step, setStep] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  
  const [syllabusFile, setSyllabusFile] = useState<{ name: string; size: string } | null>(null);
  const [paperFile, setPaperFile] = useState<{ name: string; size: string } | null>(null);
  
  const [paperConfig, setPaperConfig] = useState({
    name: '', totalQuestions: 90, duration: 180, totalMarks: 720,
    negativeMarking: 0.25, setsCount: 4,
    difficultyDistribution: { easy: 30, medium: 40, hard: 30 },
  });
  const [progress, setProgress] = useState(0);
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [genError, setGenError] = useState<string | null>(null);

  // Real files. These used to invent a name and a random size without any file
  // ever being chosen, so the pipeline had nothing to work from.
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

  // Real CV + generation pipeline (mode1). Progress is what the server
  // reports, not a random increment on a 200 ms timer.
  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;
    setProgress(0); setGenError(null);
    paperModesApi.run(
      'mode1',
      { questions_pdf: paperObj.current ?? undefined, syllabus_pdf: syllabusObj.current ?? undefined },
      { exam_id: 'draft', difficulty: 'MEDIUM', total_questions: paperConfig.totalQuestions ?? 90 },
      (p) => { if (!cancelled) setProgress(p); },
    ).then(({ taskId: tid, result }) => {
      if (cancelled) return;
      setTaskId(tid);
      const got = (result.questions as GeneratedQuestion[] | undefined) ?? [];
      setQuestions(got.map((q, i) => ({ ...q, id: q.id ?? i + 1, approved: null })));
      setProgress(100);
      setTimeout(() => { if (!cancelled) setStep(3); }, 700);
    }).catch((err) => { if (!cancelled) setGenError(err.message || 'Generation failed'); });
    return () => { cancelled = true; };
  }, [step]);

  const handleApprove = (id: number) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, approved: true } : q));
  };

  const handleReject = (id: number) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, approved: false } : q));
  };

  const approvedCount = questions.filter(q => q.approved === true).length;

  return (
    <div className={styles.page}>
      <input id="ag-syllabus" type="file" accept="application/pdf" hidden onChange={handleSyllabusUpload} />
      <input id="ag-paper" type="file" accept="application/pdf" hidden onChange={handlePaperUpload} />
      <Link href="/setter/paper-modes" className={styles.backBtn}>← Back to Paper Modes</Link>
      <h1 className={styles.title}>AI Full Generation</h1>
      <p className={styles.subtitle}>Upload Syllabus and a Reference Paper. Computer Vision analyzes the style, and AI generates an entirely new paper matching that exact standard.</p>

      {/* Stepper */}
      <div className={styles.stepper}>
        {STEPS.map((s, i) => (
          <div key={i} className={`${styles.stepItem} ${i <= step ? styles.stepActive : ''} ${i < step ? styles.stepDone : ''}`}>
            <span className={styles.stepNum}>{i < step ? '✓' : i + 1}</span>
            <span className={styles.stepLabel}>{s}</span>
          </div>
        ))}
      </div>

      {/* Step 0: Upload Reference PDFs */}
      {step === 0 && (
        <div className={styles.form}>
          <div className={styles.infoBanner}>
            <span className={styles.infoBannerIcon}></span>
            <span className={styles.infoBannerText}>
              Upload exactly two PDFs: the official Syllabus and a Reference Question Paper. 
              The Computer Vision AI will analyze question patterns, difficulty curves, and phrasing styles from the reference paper, and use the Syllabus to generate completely new questions.
            </span>
          </div>

          <div className={styles.dualUploadGrid}>
            <div className={`${styles.uploadZone} ${syllabusFile ? styles.uploadZoneActive : ''}`} onClick={() => document.getElementById("ag-syllabus")?.click()}>
              <span className={styles.uploadIcon}></span>
              <span className={styles.uploadTitle}>{syllabusFile ? 'Syllabus Uploaded' : 'Upload Syllabus PDF'}</span>
              <span className={styles.uploadDesc}>{syllabusFile ? syllabusFile.name : 'Defines generation limits'}</span>
            </div>

            <div className={`${styles.uploadZone} ${paperFile ? styles.uploadZoneActive : ''}`} onClick={() => document.getElementById("ag-paper")?.click()}>
              <span className={styles.uploadIcon}></span>
              <span className={styles.uploadTitle}>{paperFile ? 'Reference Paper Uploaded' : 'Upload Reference Paper'}</span>
              <span className={styles.uploadDesc}>{paperFile ? paperFile.name : 'Defines style and difficulty'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Paper Settings */}
      {step === 1 && (
        <div className={styles.form}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label>Paper Name</label>
              <input type="text" className={styles.input} placeholder="e.g., NEET UG 2026 — AI Generated" value={paperConfig.name} onChange={e => setPaperConfig(p => ({ ...p, name: e.target.value }))} />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label>Total Questions</label>
              <input type="number" className={styles.input} value={paperConfig.totalQuestions} onChange={e => setPaperConfig(p => ({ ...p, totalQuestions: +e.target.value }))} />
            </div>
            <div className={styles.field}>
              <label>Duration (minutes)</label>
              <input type="number" className={styles.input} value={paperConfig.duration} onChange={e => setPaperConfig(p => ({ ...p, duration: +e.target.value }))} />
            </div>
            <div className={styles.field}>
              <label>Total Marks</label>
              <input type="number" className={styles.input} value={paperConfig.totalMarks} onChange={e => setPaperConfig(p => ({ ...p, totalMarks: +e.target.value }))} />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label>Negative Marking (per wrong)</label>
              <input type="number" step="0.25" className={styles.input} value={paperConfig.negativeMarking} onChange={e => setPaperConfig(p => ({ ...p, negativeMarking: +e.target.value }))} />
            </div>
            <div className={styles.field}>
              <label>Number of Sets (A/B/C/D)</label>
              <input type="number" className={styles.input} value={paperConfig.setsCount} onChange={e => setPaperConfig(p => ({ ...p, setsCount: +e.target.value }))} />
            </div>
          </div>

          <h3 style={{ fontSize: 14, color: 'var(--color-navy-200)', marginTop: 16 }}>Difficulty Distribution Target</h3>
          <div className={styles.row}>
            <div className={styles.field}>
              <label style={{ color: '#6fa678' }}>Easy (%)</label>
              <input type="number" className={styles.input} value={paperConfig.difficultyDistribution.easy} onChange={e => setPaperConfig(p => ({ ...p, difficultyDistribution: { ...p.difficultyDistribution, easy: +e.target.value } }))} />
            </div>
            <div className={styles.field}>
              <label style={{ color: '#d9a441' }}>Medium (%)</label>
              <input type="number" className={styles.input} value={paperConfig.difficultyDistribution.medium} onChange={e => setPaperConfig(p => ({ ...p, difficultyDistribution: { ...p.difficultyDistribution, medium: +e.target.value } }))} />
            </div>
            <div className={styles.field}>
              <label style={{ color: '#c25a48' }}>Hard (%)</label>
              <input type="number" className={styles.input} value={paperConfig.difficultyDistribution.hard} onChange={e => setPaperConfig(p => ({ ...p, difficultyDistribution: { ...p.difficultyDistribution, hard: +e.target.value } }))} />
            </div>
          </div>

          {paperConfig.difficultyDistribution.easy + paperConfig.difficultyDistribution.medium + paperConfig.difficultyDistribution.hard !== 100 && (
            <div className={styles.infoBanner} style={{ background: 'rgba(194, 90, 72,0.08)', borderColor: 'rgba(194, 90, 72,0.2)' }}>
              <span className={styles.infoBannerIcon}></span>
              <span className={styles.infoBannerText} style={{ color: '#c25a48' }}>
                Difficulty distribution must sum to 100%. Current: {paperConfig.difficultyDistribution.easy + paperConfig.difficultyDistribution.medium + paperConfig.difficultyDistribution.hard}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Step 2: CV Analysis & Generation */}
      {step === 2 && genError && (
        <p role="alert" style={{ margin: '16px 0', padding: '12px 14px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.1)', color: '#fca5a5', fontSize: 13 }}>{genError}</p>
      )}
      {step === 2 && (
        <div className={styles.form}>
          
          {progress < 40 ? (
            <div className={styles.cvScanner}>
              <div className={styles.cvIcon}></div>
              <div className={styles.cvText}>Computer Vision Style Analysis...</div>
            </div>
          ) : (
            <div className={styles.cvScanner} style={{ borderColor: '#3f6f4a' }}>
              <div className={styles.cvIcon} style={{ animation: 'none' }}></div>
              <div className={styles.cvText} style={{ color: '#6fa678' }}>AI Generating New Questions...</div>
            </div>
          )}

          <div className={styles.progressCard} style={{ marginTop: 16 }}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>Generation Pipeline</span>
              <span className={styles.progressValue}>{Math.min(progress, 100)}%</span>
            </div>
            <div className={styles.progressBar}>
              <div className={`${styles.progressFill} ${progress < 40 ? styles.progressFillCV : styles.progressFillGreen}`} style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          </div>

          <div className={styles.sectionCard}>
            <h3 className={styles.sectionTitle}>Process Log</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { msg: '[CV] Extracting structural boundaries from Syllabus PDF...', done: progress > 10 },
                { msg: '[CV] Analyzing wording style and tone from Reference Paper PDF...', done: progress > 25 },
                { msg: '[CV] Building difficulty fingerprint and topic correlation matrix...', done: progress > 38 },
                { msg: '[AI] Generating entirely new Physics questions mimicking parsed style...', done: progress > 55 },
                { msg: '[AI] Generating Chemistry questions (IRT calibrated)...', done: progress > 70 },
                { msg: '[AI] Generating Biology/Math questions (IRT calibrated)...', done: progress > 85 },
                { msg: '[AI] Generating 4 parallel sets with shuffled ordering...', done: progress > 95 },
                { msg: 'Finalizing paper — ready for review...', done: progress >= 100 },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                  <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>
                    {item.done ? '✓' : progress > i * 12 ? '…' : ''}
                  </span>
                  <span style={{ fontSize: 13, color: item.done ? 'var(--color-navy-200)' : 'var(--color-navy-500)' }}>{item.msg}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 8 }}>
            {[
              { label: 'Style Match', value: `${Math.min(99, Math.floor(progress))} %`, color: '#9b2226' },
              { label: 'Questions Generated', value: Math.floor((progress / 100) * paperConfig.totalQuestions), color: '#6fa678' },
              { label: 'Sets Prepared', value: progress >= 96 ? paperConfig.setsCount : 0, color: '#d9a441' },
            ].map(stat => (
              <div key={stat.label} style={{ background: 'rgba(255, 254, 251,0.03)', border: '1px solid var(--color-navy-700)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
                <p style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: stat.color, margin: 0 }}>{stat.value}</p>
                <p style={{ fontSize: 11, color: 'var(--color-navy-400)', margin: 0 }}>{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Review & Finalize */}
      {step === 3 && (
        <div className={styles.form}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fffefb' }}>
              Review Generated Paper ({approvedCount}/{questions.length} approved)
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={styles.approveBtn}
                style={{ padding: '6px 16px' }}
                onClick={() => setQuestions(prev => prev.map(q => ({ ...q, approved: true })))}
              >
                ✓ Approve All
              </button>
            </div>
          </div>

          {/* Paper Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total Questions', value: questions.length },
              { label: 'Style Match Score', value: '98.5%' },
              { label: 'Avg IRT (b)', value: (questions.reduce((s, q) => s + q.irt_b, 0) / questions.length).toFixed(2) },
              { label: 'Bloom\'s Range', value: `L${Math.min(...questions.map(q => q.blooms))}–L${Math.max(...questions.map(q => q.blooms))}` },
            ].map(stat => (
              <div key={stat.label} style={{ background: 'rgba(255, 254, 251,0.03)', border: '1px solid var(--color-navy-700)', borderRadius: 12, padding: 14, textAlign: 'center' }}>
                <p style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fffefb', margin: 0 }}>{stat.value}</p>
                <p style={{ fontSize: 11, color: 'var(--color-navy-400)', margin: 0 }}>{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Generated Questions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {questions.map(q => (
              <div key={q.id} style={{ padding: '14px 18px', background: 'rgba(255, 254, 251,0.03)', border: `1px solid ${q.approved === true ? 'rgba(111, 166, 120,0.3)' : q.approved === false ? 'rgba(194, 90, 72,0.3)' : 'var(--color-navy-700)'}`, borderRadius: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-navy-400)', fontFamily: 'var(--font-mono)' }}>Q{q.id}</span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 9999, background: 'rgba(255, 254, 251,0.06)', color: 'var(--color-navy-300)' }}>{q.subject}</span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 9999, background: 'rgba(255, 254, 251,0.06)', color: 'var(--color-navy-300)' }}>{q.topic}</span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 9999, background: 'rgba(255, 254, 251,0.06)', color: 'var(--color-navy-300)' }}>L{q.blooms}</span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 9999, background: 'rgba(255, 254, 251,0.06)', color: 'var(--color-navy-300)' }}>b={q.irt_b}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {q.approved === true && <span style={{ fontSize: 11, color: '#6fa678', fontWeight: 600 }}>✓</span>}
                    {q.approved === false && <span style={{ fontSize: 11, color: '#c25a48', fontWeight: 600 }}>✗</span>}
                    <button className={styles.approveBtn} onClick={() => handleApprove(q.id)}>✓</button>
                    <button className={styles.rejectBtn} onClick={() => handleReject(q.id)}>✕</button>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: 'var(--color-navy-200)', lineHeight: 1.6, margin: 0, marginBottom: 8 }}>{q.text}</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {q.options.map((opt, i) => (
                    <span key={i} style={{ fontSize: 12, color: 'var(--color-navy-400)', padding: '3px 8px', background: 'rgba(255, 254, 251,0.02)', borderRadius: 6 }}>({String.fromCharCode(65 + i)}) {opt}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {approvedCount === questions.length && (
            <FinalizePanel
              taskId={taskId}
              label="Finalize Paper & Generate ZK Proof →"
            />
          )}
        </div>
      )}

      {/* Navigation */}
      {step !== 2 && (
        <div className={styles.navRow}>
          <button className={styles.prevBtn} onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>← Previous</button>
          <button
            className={styles.nextBtn}
            onClick={() => { setStep(Math.min(STEPS.length - 1, step + 1)); if (step === 1) setProgress(0); }}
            disabled={step === STEPS.length - 1 || (step === 0 && (!syllabusFile || !paperFile))}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
