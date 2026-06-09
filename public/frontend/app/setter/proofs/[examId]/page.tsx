/**
 * CryptoExam Core — ZK Proof Generation Page
 * CEREMONIAL UI — "This page must feel significant. Like a space launch."
 * 4 phases: Checklist → Generation → Confirmed → Lock
 */
'use client';

import { useState, useEffect } from 'react';
import { mockExams } from '@/lib/api/mock-data';
import styles from './proofs.module.css';

type Phase = 'checklist' | 'generating' | 'confirmed' | 'locking';

const PROOF_STEPS = [
  'Encoding question set as CIRCOM witness',
  'Computing question hash H = Poseidon(Q₁,...,Qₙ)',
  'Loading Groth16 proving key (trusted setup zkey)',
  'Executing Groth16 prover',
  'Verifying proof locally with verification key',
  'Compressing and uploading to IPFS',
  'Submitting to Polygon Amoy...',
  'Awaiting 2 block confirmations...',
];

export default function ZKProofPage() {
  const exam = mockExams[0];
  const [phase, setPhase] = useState<Phase>('checklist');
  const [currentStep, setCurrentStep] = useState(0);
  const [stepProgress, setStepProgress] = useState(0);
  const [showExplainer, setShowExplainer] = useState(false);
  const [lockText, setLockText] = useState('');
  const [lockCountdown, setLockCountdown] = useState<number | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // Simulate proof generation
  useEffect(() => {
    if (phase !== 'generating') return;
    if (currentStep >= PROOF_STEPS.length) {
      setPhase('confirmed');
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 5000);
      return;
    }

    const stepDuration = currentStep === 3 ? 4000 : 1500; // Prover step takes longer
    const progressInterval = setInterval(() => {
      setStepProgress(prev => Math.min(100, prev + 3));
    }, stepDuration / 33);

    const stepTimer = setTimeout(() => {
      setStepProgress(0);
      setCurrentStep(prev => prev + 1);
    }, stepDuration);

    return () => { clearInterval(progressInterval); clearTimeout(stepTimer); };
  }, [phase, currentStep]);

  // Lock countdown
  useEffect(() => {
    if (lockCountdown === null || lockCountdown <= 0) return;
    const timer = setTimeout(() => setLockCountdown(lockCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [lockCountdown]);

  const handleBeginProof = () => {
    setPhase('generating');
    setCurrentStep(0);
    setStepProgress(0);
  };

  const handleLock = () => {
    setLockCountdown(3);
    setTimeout(() => {
      setPhase('locking');
    }, 3500);
  };

  return (
    <div className={styles.page}>
      {/* Confetti */}
      {showConfetti && (
        <div className={styles.confetti}>
          {Array.from({ length: 40 }, (_, i) => (
            <div
              key={i}
              className={styles.confettiPiece}
              style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${2 + Math.random() * 3}s`,
                backgroundColor: ['#FF9933', '#FFFFFF', '#138808'][i % 3],
              }}
            />
          ))}
        </div>
      )}

      {/* PHASE 1 — Checklist */}
      {phase === 'checklist' && (
        <div className={styles.phaseCard}>
          <h1 className={styles.phaseTitle}>Pre-Proof Checklist</h1>
          <p className={styles.phaseSubtitle}>{exam.name}</p>

          <div className={styles.checklist}>
            {[
              { label: 'All questions accepted and IRT-validated', done: true },
              { label: "Bloom's distribution within tolerance", done: true },
              { label: 'Sets A/B/C/D equivalence verified', done: true },
              { label: 'Topic overlap below threshold τ', done: true },
              { label: 'Primary setter digital signature', done: true },
              { label: 'Co-setter signatures', done: false, detail: '✅ Dr. Sharma · ⏳ Awaiting Dr. Gupta...' },
            ].map((item, i) => (
              <div key={i} className={styles.checkItem}>
                <span className={item.done ? styles.checkDone : styles.checkPending}>
                  {item.done ? '✅' : '⏳'}
                </span>
                <div>
                  <span className={styles.checkLabel}>{item.label}</span>
                  {item.detail && <span className={styles.checkDetail}>{item.detail}</span>}
                </div>
              </div>
            ))}
          </div>

          <button className={styles.beginBtn} onClick={handleBeginProof}>
            Begin Proof Generation →
          </button>
        </div>
      )}

      {/* PHASE 2 — Generating */}
      {phase === 'generating' && (
        <div className={styles.phaseCard}>
          <h1 className={styles.genTitle}>Generating Zero-Knowledge Proof</h1>

          <div className={styles.stepList}>
            {PROOF_STEPS.map((step, i) => (
              <div key={i} className={`${styles.step} ${i < currentStep ? styles.stepDone : i === currentStep ? styles.stepActive : styles.stepWaiting}`}>
                <span className={styles.stepIcon}>
                  {i < currentStep ? '✅' : i === currentStep ? '⏳' : '○'}
                </span>
                <span className={styles.stepText}>{step}</span>
                {i === currentStep && i === 3 && (
                  <div className={styles.progressBar}>
                    <div className={styles.progressFill} style={{ width: `${stepProgress}%` }} />
                    <span className={styles.progressText}>{stepProgress}% (~{Math.max(0, Math.round((100 - stepProgress) / 3))}s remaining)</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button className={styles.explainerToggle} onClick={() => setShowExplainer(!showExplainer)}>
            {showExplainer ? '▲' : '▼'} What is happening right now?
          </button>

          {showExplainer && (
            <div className={styles.explainer}>
              <p>We are creating a mathematical proof that your paper&apos;s difficulty is exactly what you specified.</p>
              <p>This proof can be checked by <strong>ANYONE</strong> — students, courts, journalists — without revealing a single question.</p>
              <p>It&apos;s like a seal on an envelope that proves what&apos;s inside meets the standard, without opening it.</p>
            </div>
          )}
        </div>
      )}

      {/* PHASE 3 — Confirmed */}
      {phase === 'confirmed' && (
        <div className={styles.phaseCard}>
          <div className={styles.achievementBadge}>
            <span className={styles.achievementIcon}>🔬</span>
          </div>

          <h1 className={styles.confirmedTitle}>The math is now on the public ledger.</h1>
          <p className={styles.confirmedSubtitle}>No NTA official. No government server. No trust required.</p>

          <div className={styles.proofCard}>
            <div className={styles.proofRow}>
              <span className={styles.proofLabel}>ZK Proof π</span>
              <code className={styles.proofValue}>
                {exam.zk_proof_hash?.slice(0, 16)}...{exam.zk_proof_hash?.slice(-16)}
              </code>
            </div>
            <div className={styles.proofRow}>
              <span className={styles.proofLabel}>Question Hash H</span>
              <code className={styles.proofValue}>{exam.question_hash}</code>
            </div>
            <div className={styles.proofRow}>
              <span className={styles.proofLabel}>Constraint Spec</span>
              <code className={styles.proofValue}>{exam.zk_proof_ipfs}</code>
            </div>
            <div className={styles.proofDivider} />
            <div className={styles.proofRow}>
              <span className={styles.proofLabel}>Polygon TX</span>
              <a
                href={`https://amoy.polygonscan.com/tx/${exam.polygon_zkproof_tx}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.txLink}
              >
                {exam.polygon_zkproof_tx?.slice(0, 14)}...{exam.polygon_zkproof_tx?.slice(-8)} ↗
              </a>
            </div>
            <div className={styles.proofRow}>
              <span className={styles.proofLabel}>Block</span>
              <span className={styles.proofMeta}>#58,234,950 · Status: ✅ Confirmed (2 blocks)</span>
            </div>
          </div>

          <button className={styles.proceedBtn} onClick={() => setPhase('locking')}>
            → Proceed to Final Lock
          </button>
        </div>
      )}

      {/* PHASE 4 — Paper Lock */}
      {phase === 'locking' && (
        <div className={styles.lockOverlay}>
          <div className={styles.lockModal}>
            <div className={styles.lockDanger} />
            <h1 className={styles.lockTitle}>LOCK EXAMINATION PAPER</h1>

            <div className={styles.lockWarning}>
              <p><strong>This action is PERMANENT AND IRREVERSIBLE.</strong></p>
              <p>Once locked: Paper cannot be modified under any circumstance.</p>
              <p>Blockchain commitment is permanent — no admin can override it.</p>
              <p>AES key will be bound to drand T₀ beacon — unknowable until exam time.</p>
              <p>Hardware nodes will receive encrypted shards within 24 hours.</p>
              <p>Do not proceed unless every question has been reviewed and approved.</p>
            </div>

            <div className={styles.lockConfirm}>
              <label className={styles.lockLabel}>
                Type the exam name exactly to confirm:
                <strong> {exam.name}</strong>
              </label>
              <input
                type="text"
                className={styles.lockInput}
                value={lockText}
                onChange={e => setLockText(e.target.value)}
                placeholder={exam.name}
              />
            </div>

            {lockCountdown !== null && lockCountdown > 0 ? (
              <div className={styles.lockCountdownDisplay}>
                Locking in {lockCountdown}...
              </div>
            ) : lockCountdown === 0 ? (
              <div className={styles.lockSuccess}>
                <span>🔒</span> Paper Locked. Exam status → LOCKED.
              </div>
            ) : (
              <button
                className={styles.lockBtn}
                disabled={lockText !== exam.name}
                onClick={handleLock}
              >
                🔒 LOCK PAPER
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
