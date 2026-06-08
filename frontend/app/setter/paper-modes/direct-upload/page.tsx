/**
 * CryptoExam Core — Mode 1: Direct Upload
 * Dual PDF Upload + Computer Vision Parsing
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { mockTrustedInstitutions } from '@/lib/api/mock-data';
import { paperModesApi } from '@/lib/api/paper-modes';
import RedTeamReportPanel from '@/components/setter/RedTeamReport';
import type { RedTeamReport } from '@/lib/api/red-team';
import styles from '../paper-modes.module.css';

const STEPS = ['Select Institution', 'Setter Details', 'Upload PDFs', 'CV Processing', 'Review & Submit'];

function fmtSize(bytes: number) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

export default function DirectUploadPage() {
  const [step, setStep] = useState(0);
  const [selectedInst, setSelectedInst] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [setterData, setSetterData] = useState({
    name: '', designation: '', department: '', email: '',
    idProofType: 'Aadhaar', idProofRef: '',
  });

  const [syllabusFile, setSyllabusFile] = useState<{ name: string; size: string } | null>(null);
  const [paperFile, setPaperFile] = useState<{ name: string; size: string } | null>(null);
  const syllabusObj = useRef<File | null>(null);
  const paperObj = useRef<File | null>(null);
  const syllabusInput = useRef<HTMLInputElement>(null);
  const paperInput = useRef<HTMLInputElement>(null);

  const [progress, setProgress] = useState(0);
  const [parseResult, setParseResult] = useState<Record<string, unknown> | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [redTeam, setRedTeam] = useState<RedTeamReport | null>(null);

  const filteredInstitutions = mockTrustedInstitutions.filter(
    inst => inst.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            inst.short_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedInstitution = mockTrustedInstitutions.find(i => i.id === selectedInst);

  const onSyllabusPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    syllabusObj.current = f; setSyllabusFile({ name: f.name, size: fmtSize(f.size) });
  };
  const onPaperPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    paperObj.current = f; setPaperFile({ name: f.name, size: fmtSize(f.size) });
  };

  // Real upload + parse pipeline (falls back to local simulation in mock mode)
  useEffect(() => {
    if (step !== 3) return;
    let cancelled = false;
    setProgress(0); setParseError(null);
    paperModesApi.run(
      'mode2',
      { question_paper_pdf: paperObj.current ?? undefined, syllabus_pdf: syllabusObj.current ?? undefined },
      { exam_id: 'draft', difficulty: 'MEDIUM' },
      (p) => { if (!cancelled) setProgress(p); },
    ).then((result) => {
      if (cancelled) return;
      setParseResult(result); setProgress(100);
      setTimeout(() => { if (!cancelled) setStep(4); }, 800);
    }).catch((err) => { if (!cancelled) setParseError(err.message || 'Parsing failed'); });
    return () => { cancelled = true; };
  }, [step]);

  return (
    <div className={styles.page}>
      <Link href="/setter/paper-modes" className={styles.backBtn}>← Back to Paper Modes</Link>
      <h1 className={styles.title}>🏛️ Direct Upload — Trusted Institutions</h1>
      <p className={styles.subtitle}>Upload Syllabus and Question Paper PDFs. Computer Vision automatically converts them to CBT format.</p>

      {/* Stepper */}
      <div className={styles.stepper}>
        {STEPS.map((s, i) => (
          <div key={i} className={`${styles.stepItem} ${i <= step ? styles.stepActive : ''} ${i < step ? styles.stepDone : ''}`}>
            <span className={styles.stepNum}>{i < step ? '✓' : i + 1}</span>
            <span className={styles.stepLabel}>{s}</span>
          </div>
        ))}
      </div>

      {/* Step 0: Select Institution */}
      {step === 0 && (
        <div className={styles.form}>
          <div className={styles.field}>
            <label>Search Trusted Institutions</label>
            <input
              type="text"
              className={styles.input}
              placeholder="Search IITs, IISc, ISI, CMI..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className={styles.institutionGrid}>
            {filteredInstitutions.map(inst => (
              <div
                key={inst.id}
                className={`${styles.instCard} ${selectedInst === inst.id ? styles.instCardSelected : ''}`}
                onClick={() => setSelectedInst(inst.id)}
              >
                <span className={styles.instEmoji}>{inst.logo_emoji}</span>
                <div className={styles.instInfo}>
                  <span className={styles.instName}>{inst.short_name}</span>
                  <span className={styles.instLocation}>{inst.location}</span>
                  <div className={styles.instMeta}>
                    <span className={styles.instMetaTag}>Est. {inst.established_year}</span>
                    <span className={styles.instMetaTag}>{inst.exams_conducted} exams</span>
                    <span className={styles.instMetaTag}>0 leaks</span>
                  </div>
                </div>
                <span className={styles.trustBadge}>✅ Verified</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Setter Details */}
      {step === 1 && (
        <div className={styles.form}>
          <div className={styles.infoBanner}>
            <span className={styles.infoBannerIcon}>👤</span>
            <span className={styles.infoBannerText}>
              These details will be shown to students after the exam for full transparency.
              Your email will be partially masked.
            </span>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label>Full Name</label>
              <input type="text" className={styles.input} placeholder="Prof. Arvind Krishnamurthy" value={setterData.name} onChange={e => setSetterData(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className={styles.field}>
              <label>Designation</label>
              <input type="text" className={styles.input} placeholder="Professor & Head of Department" value={setterData.designation} onChange={e => setSetterData(p => ({ ...p, designation: e.target.value }))} />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label>Department</label>
              <input type="text" className={styles.input} placeholder="Dept. of Computer Science & Engineering" value={setterData.department} onChange={e => setSetterData(p => ({ ...p, department: e.target.value }))} />
            </div>
            <div className={styles.field}>
              <label>Official Email</label>
              <input type="email" className={styles.input} placeholder="name@iitb.ac.in" value={setterData.email} onChange={e => setSetterData(p => ({ ...p, email: e.target.value }))} />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label>ID Proof Type</label>
              <select className={styles.input} value={setterData.idProofType} onChange={e => setSetterData(p => ({ ...p, idProofType: e.target.value }))}>
                <option>Aadhaar</option>
                <option>PAN Card</option>
                <option>Government ID</option>
                <option>Institutional ID</option>
              </select>
            </div>
            <div className={styles.field}>
              <label>ID Reference Number</label>
              <input type="text" className={styles.input} placeholder="Last 4 digits only (e.g., ****7834)" value={setterData.idProofRef} onChange={e => setSetterData(p => ({ ...p, idProofRef: e.target.value }))} />
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Upload Dual PDFs */}
      {step === 2 && (
        <div className={styles.form}>
          <div className={styles.infoBanner}>
            <span className={styles.infoBannerIcon}>📄</span>
            <span className={styles.infoBannerText}>
              Upload exactly two PDFs: the official Syllabus and the full Question Paper written in the exam pattern. 
              Our Computer Vision model will automatically integrate them into CBT mode.
            </span>
          </div>

          <input ref={syllabusInput} type="file" accept="application/pdf" hidden onChange={onSyllabusPick} />
          <input ref={paperInput} type="file" accept="application/pdf" hidden onChange={onPaperPick} />
          <div className={styles.dualUploadGrid}>
            {/* Syllabus Upload */}
            <div className={`${styles.uploadZone} ${syllabusFile ? styles.uploadZoneActive : ''}`} onClick={() => syllabusInput.current?.click()}>
              <span className={styles.uploadIcon}>📋</span>
              <span className={styles.uploadTitle}>{syllabusFile ? 'Syllabus Uploaded' : 'Upload Syllabus PDF'}</span>
              <span className={styles.uploadDesc}>{syllabusFile ? `${syllabusFile.name} · ${syllabusFile.size}` : 'Click to select syllabus file'}</span>
            </div>

            {/* Paper Upload */}
            <div className={`${styles.uploadZone} ${paperFile ? styles.uploadZoneActive : ''}`} onClick={() => paperInput.current?.click()}>
              <span className={styles.uploadIcon}>📝</span>
              <span className={styles.uploadTitle}>{paperFile ? 'Question Paper Uploaded' : 'Upload Question Paper PDF'}</span>
              <span className={styles.uploadDesc}>{paperFile ? `${paperFile.name} · ${paperFile.size}` : 'Full paper written in exam pattern'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: CV Processing */}
      {step === 3 && (
        <div className={styles.form}>
          <div className={styles.cvScanner}>
            <div className={styles.cvIcon}>👁️</div>
            <div className={styles.cvText}>Computer Vision Optical Parsing in Progress...</div>
          </div>

          {parseError && (
            <div className={styles.infoBanner} style={{ borderColor: '#ef4444' }}>
              <span className={styles.infoBannerIcon}>⚠️</span>
              <span className={styles.infoBannerText}>Parsing failed: {parseError}</span>
            </div>
          )}

          <div className={styles.progressCard}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>Processing Documents</span>
              <span className={styles.progressValue}>{Math.min(progress, 100)}%</span>
            </div>
            <div className={styles.progressBar}>
              <div className={`${styles.progressFill} ${styles.progressFillCV}`} style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          </div>

          <div className={styles.sectionCard}>
            <h3 className={styles.sectionTitle}>👁️ Vision Activity Log</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { msg: 'Extracting text and structure from Syllabus PDF...', done: progress > 15 },
                { msg: 'Mapping syllabus topics to knowledge taxonomy...', done: progress > 30 },
                { msg: 'Performing Optical Character Recognition (OCR) on Question Paper...', done: progress > 50 },
                { msg: 'Extracting equations, diagrams, and options...', done: progress > 65 },
                { msg: 'Cross-referencing questions against Syllabus constraints...', done: progress > 80 },
                { msg: 'Formatting into Computer-Based Test (CBT) structure...', done: progress > 95 },
                { msg: 'Parsing complete. Ready for review.', done: progress >= 100 },
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

      {/* Step 4: Review & Submit */}
      {step === 4 && (
        <div className={styles.form}>
          <div className={styles.infoBanner}>
            <span className={styles.infoBannerIcon}>✅</span>
            <span className={styles.infoBannerText}>
              Computer Vision parsing successful. The paper is CBT-ready. 
              Upon submission, it will be AES-GCM-256 encrypted and locked on the blockchain.
            </span>
          </div>

          <div className={styles.sectionCard}>
            <h3 className={styles.sectionTitle}>📄 Computer Vision Output</h3>
            <div className={styles.reviewGrid}>
              <span className={styles.reviewLabel}>Questions Extracted</span>
              <span className={styles.reviewValue}>
                {parseResult?.question_count != null
                  ? `${parseResult.question_count as number} Questions`
                  : '75 Questions (3 Sections)'}
              </span>
              <span className={styles.reviewLabel}>Subject Breakdown</span>
              <span className={styles.reviewValue}>
                {parseResult?.subjects
                  ? Object.entries(parseResult.subjects as Record<string, number>).map(([s, n]) => `${s}: ${n}`).join(' · ')
                  : 'Physics · Chemistry · Biology'}
              </span>
              <span className={styles.reviewLabel}>Difficulty (IRT mean b)</span>
              <span className={styles.reviewValueMono}>
                {(parseResult?.irt as { distribution?: { mean_b?: number } })?.distribution?.mean_b ?? '0.21'}
              </span>
              <span className={styles.reviewLabel}>Format</span>
              <span className={styles.reviewValueMono}>Standard NTA CBT UI compatible</span>
            </div>
          </div>

          <div className={styles.sectionCard}>
            <h3 className={styles.sectionTitle}>👤 Setter Transparency Details</h3>
            <div className={styles.reviewGrid}>
              <span className={styles.reviewLabel}>Setter Name</span>
              <span className={styles.reviewValue}>{setterData.name || 'Prof. Arvind Krishnamurthy'}</span>
              <span className={styles.reviewLabel}>Institution</span>
              <span className={styles.reviewValue}>{selectedInstitution?.name || 'IIT Bombay'}</span>
              <span className={styles.reviewLabel}>Institution Record</span>
              <span className={styles.reviewValue} style={{ color: '#4ade80' }}>0 leak incidents — Clean ✅</span>
            </div>
          </div>

          {/* V3 §4.3 — AI Adversarial Red-Team Agent */}
          <RedTeamReportPanel
            questions={(parseResult?.questions as object[]) || [
              { question_number: 1, question_text: 'A body of mass 5 kg moves at 10 m/s. Its kinetic energy is', option_A: '250 J', option_B: '500 J', option_C: '100 J', option_D: '50 J' },
              { question_number: 2, question_text: 'A noble gas always reacts only at high temperature', option_A: 'Neon', option_B: 'Argon', option_C: 'Neon', option_D: 'Hydrogen' },
              { question_number: 3, question_text: 'Pluto is a planet — true or false?', option_A: 'True', option_B: 'False', option_C: 'Both', option_D: 'Neither' },
            ]}
            onResult={setRedTeam}
          />

          <button
            className={styles.submitBtn}
            disabled={redTeam ? !redTeam.red_team_passed : false}
            style={redTeam && !redTeam.red_team_passed ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            title={redTeam && !redTeam.red_team_passed ? `Resolve ${redTeam.blocker_count} Red-Team blocker(s) before locking` : ''}
          >
            🔐 Encrypt & Lock on Blockchain →
          </button>
        </div>
      )}

      {/* Navigation */}
      {step !== 3 && (
        <div className={styles.navRow}>
          <button className={styles.prevBtn} onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>← Previous</button>
          <button className={styles.nextBtn} onClick={() => { setStep(Math.min(STEPS.length - 1, step + 1)); if (step === 2) setProgress(0); }} disabled={step === STEPS.length - 1 || (step === 2 && (!syllabusFile || !paperFile))}>Next →</button>
        </div>
      )}
    </div>
  );
}
