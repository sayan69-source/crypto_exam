/**
 * CryptoExam Core — Setter Exam Creation Wizard
 * 4-step wizard: Identity → Config → IRT+Bloom's → Review
 */
'use client';

import { useState } from 'react';
import styles from './create.module.css';

const STEPS = ['Exam Identity', 'Configuration', 'IRT & Bloom\'s Targets', 'Review & Create'];

export default function SetterCreatePage() {
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState({
    name: '', examBody: 'NTA', examType: 'ONLINE_CBT', duration: 180,
    subjects: [{ name: 'Physics', questionCount: 30 }],
    negativeMark: 0.25, setsCount: 4,
    targetMeanB: 0.0, targetStdB: 1.0, minA: 0.5, maxC: 0.25,
  });

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Create New Exam</h1>

      {/* Progress stepper */}
      <div className={styles.stepper}>
        {STEPS.map((s, i) => (
          <div key={i} className={`${styles.stepperItem} ${i <= step ? styles.stepperActive : ''} ${i < step ? styles.stepperDone : ''}`}>
            <span className={styles.stepperNum}>{i < step ? '✓' : i + 1}</span>
            <span className={styles.stepperLabel}>{s}</span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className={styles.stepContent}>
        {step === 0 && (
          <div className={styles.form}>
            <div className={styles.field}>
              <label>Exam Name</label>
              <input type="text" placeholder="e.g., NEET UG 2026 — Phase I" value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} className={styles.input} />
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label>Exam Body</label>
                <select className={styles.input} value={formData.examBody} onChange={e => setFormData(prev => ({ ...prev, examBody: e.target.value }))}>
                  <option>NTA</option><option>UPSC</option><option>SSC</option><option>IBPS</option><option>CBSE</option>
                </select>
              </div>
              <div className={styles.field}>
                <label>Exam Type</label>
                <select className={styles.input} value={formData.examType} onChange={e => setFormData(prev => ({ ...prev, examType: e.target.value }))}>
                  <option value="ONLINE_CBT">Online CBT</option><option value="OFFLINE_HARDWARE">Offline Hardware</option><option value="HYBRID">Hybrid</option>
                </select>
              </div>
            </div>
          </div>
        )}
        {step === 1 && (
          <div className={styles.form}>
            <div className={styles.row}>
              <div className={styles.field}>
                <label>Duration (minutes)</label>
                <input type="number" className={styles.input} value={formData.duration} onChange={e => setFormData(prev => ({ ...prev, duration: +e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>Sets (A/B/C/D)</label>
                <input type="number" className={styles.input} value={formData.setsCount} onChange={e => setFormData(prev => ({ ...prev, setsCount: +e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label>Negative Marking</label>
                <input type="number" step="0.25" className={styles.input} value={formData.negativeMark} onChange={e => setFormData(prev => ({ ...prev, negativeMark: +e.target.value }))} />
              </div>
            </div>
            <div className={styles.field}>
              <label>Subjects</label>
              {formData.subjects.map((s, i) => (
                <div key={i} className={styles.subjectRow}>
                  <input className={styles.input} value={s.name} onChange={e => { const subs = [...formData.subjects]; subs[i].name = e.target.value; setFormData(prev => ({ ...prev, subjects: subs })); }} placeholder="Subject name" />
                  <input className={styles.input} type="number" value={s.questionCount} onChange={e => { const subs = [...formData.subjects]; subs[i].questionCount = +e.target.value; setFormData(prev => ({ ...prev, subjects: subs })); }} placeholder="Questions" style={{ width: 100 }} />
                </div>
              ))}
              <button className={styles.addSubBtn} onClick={() => setFormData(prev => ({ ...prev, subjects: [...prev.subjects, { name: '', questionCount: 30 }] }))}>+ Add Subject</button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className={styles.form}>
            <h3 style={{ color: 'var(--color-navy-200)', marginBottom: 16 }}>IRT Parameters</h3>
            <div className={styles.row}>
              <div className={styles.field}><label>Target Mean b</label><input type="number" step="0.1" className={styles.input} value={formData.targetMeanB} onChange={e => setFormData(prev => ({ ...prev, targetMeanB: +e.target.value }))} /></div>
              <div className={styles.field}><label>Target Std b</label><input type="number" step="0.1" className={styles.input} value={formData.targetStdB} onChange={e => setFormData(prev => ({ ...prev, targetStdB: +e.target.value }))} /></div>
            </div>
            <h3 style={{ color: 'var(--color-navy-200)', marginTop: 24, marginBottom: 16 }}>Bloom&apos;s Taxonomy Targets</h3>
            <div className={styles.bloomsGrid}>
              {['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'].map((level, i) => (
                <div key={level} className={styles.bloomsItem}>
                  <span className={styles.bloomsLabel}>L{i+1}: {level}</span>
                  <input type="number" className={styles.bloomsInput} defaultValue={[10, 25, 30, 20, 10, 5][i]} /> <span className={styles.bloomsPercent}>%</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {step === 3 && (
          <div className={styles.reviewCard}>
            <h3>Review & Create</h3>
            <div className={styles.reviewGrid}>
              <span className={styles.reviewLabel}>Name</span><span className={styles.reviewValue}>{formData.name || 'Untitled Exam'}</span>
              <span className={styles.reviewLabel}>Body</span><span className={styles.reviewValue}>{formData.examBody}</span>
              <span className={styles.reviewLabel}>Type</span><span className={styles.reviewValue}>{formData.examType}</span>
              <span className={styles.reviewLabel}>Duration</span><span className={styles.reviewValue}>{formData.duration} minutes</span>
              <span className={styles.reviewLabel}>Sets</span><span className={styles.reviewValue}>{formData.setsCount}</span>
              <span className={styles.reviewLabel}>Subjects</span><span className={styles.reviewValue}>{formData.subjects.map(s => `${s.name} (${s.questionCount}Q)`).join(', ')}</span>
            </div>
            <button className={styles.createBtn}>Create Exam →</button>
          </div>
        )}
      </div>

      <div className={styles.navRow}>
        <button className={styles.prevBtn} onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>← Previous</button>
        <button className={styles.nextBtn} onClick={() => setStep(Math.min(STEPS.length - 1, step + 1))} disabled={step === STEPS.length - 1}>Next →</button>
      </div>
    </div>
  );
}
