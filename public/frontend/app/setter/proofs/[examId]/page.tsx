/**
 * CryptoExam Core — ZK Proof + Paper Lock console (REAL).
 * Driven by the exam's live state: generate the Groth16 difficulty proof
 * (/lifecycle/{id}/generate-zk) and perform the irreversible lock
 * (/lifecycle/{id}/lock), then surface the real on-chain commitments.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { setterApi, type SetterExam } from '@/lib/api/setter';
import styles from './proofs.module.css';

type Phase = 'loading' | 'checklist' | 'working' | 'confirmed' | 'locking' | 'locked';

export default function ZKProofPage() {
  const { examId } = useParams<{ examId: string }>();
  const [exam, setExam] = useState<SetterExam | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lockText, setLockText] = useState('');

  const refresh = async (): Promise<SetterExam | null> => {
    const e = await setterApi.exam(examId);
    setExam(e);
    return e;
  };

  const phaseFor = (e: SetterExam): Phase =>
    e.status === 'LOCKED' || e.status === 'DISTRIBUTED' || e.status === 'LIVE' || e.status === 'COMPLETED'
      ? 'locked'
      : e.zk_proof_hash
        ? 'confirmed'
        : 'checklist';

  useEffect(() => {
    if (!examId) return;
    refresh()
      .then((e) => e && setPhase(phaseFor(e)))
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  const handleGenerate = async () => {
    setError(null);
    setPhase('working');
    try {
      await setterApi.generateZk(examId);
      const e = await refresh();
      setPhase(e?.zk_proof_hash ? 'confirmed' : 'checklist');
    } catch (err) {
      setError((err as Error).message);
      setPhase('checklist');
    }
  };

  const handleLock = async () => {
    setError(null);
    setPhase('locking');
    try {
      await setterApi.lockExam(examId);
      const e = await refresh();
      setPhase(e ? phaseFor(e) : 'confirmed');
    } catch (err) {
      setError((err as Error).message);
      setPhase('confirmed');
    }
  };

  if (phase === 'loading') return <div className={styles.page}><p style={{ color: '#9ca3af' }}>Loading exam…</p></div>;
  if (!exam) return <div className={styles.page}><p style={{ color: '#f87171' }}>{error ?? 'Exam not found.'}</p></div>;

  const explorer = (tx?: string | null) => `https://amoy.polygonscan.com/tx/${tx}`;

  return (
    <div className={styles.page}>
      {error && (
        <div style={{ padding: 14, borderRadius: 10, background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {phase === 'checklist' && (
        <div className={styles.phaseCard}>
          <h1 className={styles.phaseTitle}>Pre-Proof Checklist</h1>
          <p className={styles.phaseSubtitle}>{exam.name} · status {exam.status}</p>
          <div className={styles.checklist}>
            {[
              `Exam owned by you (setter-scoped)`,
              `${exam.sets_count ?? 0} set(s) configured`,
              `Negative marking ${exam.negative_marking ?? 0}`,
              `Generate the Groth16 proof of the paper's difficulty distribution`,
            ].map((label, i) => (
              <div key={i} className={styles.checkItem}>
                <span className={styles.checkDone}>✓</span>
                <div><span className={styles.checkLabel}>{label}</span></div>
              </div>
            ))}
          </div>
          <button className={styles.beginBtn} onClick={handleGenerate}>Begin Proof Generation →</button>
        </div>
      )}

      {phase === 'working' && (
        <div className={styles.phaseCard}>
          <h1 className={styles.genTitle}>Generating Zero-Knowledge Proof…</h1>
          <p className={styles.phaseSubtitle}>Encoding the witness, running the Groth16 prover and anchoring on Polygon. This is a real backend operation.</p>
        </div>
      )}

      {(phase === 'confirmed' || phase === 'locked') && (
        <div className={styles.phaseCard}>
          <h1 className={styles.confirmedTitle}>
            {phase === 'locked' ? 'Paper locked — committed on the public ledger.' : 'The proof is on the public ledger.'}
          </h1>
          <p className={styles.confirmedSubtitle}>{exam.name} · status {exam.status}</p>

          <div className={styles.proofCard}>
            <div className={styles.proofRow}>
              <span className={styles.proofLabel}>ZK Proof Hash</span>
              <code className={styles.proofValue}>{exam.zk_proof_hash ?? '— not generated —'}</code>
            </div>
            <div className={styles.proofRow}>
              <span className={styles.proofLabel}>Question Hash H</span>
              <code className={styles.proofValue}>{exam.question_hash ?? '—'}</code>
            </div>
            <div className={styles.proofRow}>
              <span className={styles.proofLabel}>Answer Merkle Root</span>
              <code className={styles.proofValue}>{exam.answer_merkle_root ?? '—'}</code>
            </div>
            <div className={styles.proofDivider} />
            <div className={styles.proofRow}>
              <span className={styles.proofLabel}>Polygon ZK-proof TX</span>
              {exam.polygon_zkproof_tx
                ? <a href={explorer(exam.polygon_zkproof_tx)} target="_blank" rel="noopener noreferrer" className={styles.txLink}>{exam.polygon_zkproof_tx.slice(0, 18)}… ↗</a>
                : <span className={styles.proofMeta}>not anchored yet</span>}
            </div>
            <div className={styles.proofRow}>
              <span className={styles.proofLabel}>Polygon exam TX</span>
              {exam.polygon_exam_tx
                ? <a href={explorer(exam.polygon_exam_tx)} target="_blank" rel="noopener noreferrer" className={styles.txLink}>{exam.polygon_exam_tx.slice(0, 18)}… ↗</a>
                : <span className={styles.proofMeta}>not anchored yet</span>}
            </div>
          </div>

          {phase === 'confirmed' && (
            <button className={styles.proceedBtn} onClick={() => setPhase('locking')}>→ Proceed to Final Lock</button>
          )}
        </div>
      )}

      {phase === 'locking' && (
        <div className={styles.lockOverlay}>
          <div className={styles.lockModal}>
            <div className={styles.lockDanger} />
            <h1 className={styles.lockTitle}>LOCK EXAMINATION PAPER</h1>
            <div className={styles.lockWarning}>
              <p><strong>This action is PERMANENT AND IRREVERSIBLE.</strong></p>
              <p>The paper is encrypted and its commitment is written on-chain — no admin can override it.</p>
              <p>The AES key is bound to the drand T₀ beacon — unknowable until exam time.</p>
            </div>
            <div className={styles.lockConfirm}>
              <label className={styles.lockLabel}>
                Type the exam name exactly to confirm:<strong> {exam.name}</strong>
              </label>
              <input type="text" className={styles.lockInput} value={lockText} onChange={(e) => setLockText(e.target.value)} placeholder={exam.name} />
            </div>
            <button className={styles.lockBtn} disabled={lockText !== exam.name} onClick={handleLock}>LOCK PAPER</button>
          </div>
        </div>
      )}
    </div>
  );
}
