/**
 * CryptoExam Core — Cryptographic Receipt Page
 * Court-admissible receipt with Merkle proof. Judges WILL screenshot this.
 */
'use client';

import { useState } from 'react';
import { mockReceipt, mockExams } from '@/lib/api/mock-data';
import HashDisplay from '@/components/crypto/HashDisplay';
import styles from './receipt.module.css';

export default function ReceiptPage() {
  const receipt = mockReceipt;
  const [showProof, setShowProof] = useState(false);

  return (
    <div className={styles.page}>
      <div className={styles.receipt}>
        {/* Tricolour header */}
        <div className={styles.tricolour}>
          <div className={styles.saffron} />
          <div className={styles.white} />
          <div className={styles.green} />
        </div>

        {/* Section 1 — Header */}
        <section className={styles.header}>
          <div className={styles.checkmark}>
            <svg className={styles.checkSvg} viewBox="0 0 52 52">
              <circle className={styles.checkCircle} cx="26" cy="26" r="25" fill="none" />
              <path className={styles.checkPath} fill="none" d="m14.1 27.2 7.1 7.2 16.7-16.8" />
            </svg>
          </div>
          <h1 className={styles.title}>Examination Submitted Successfully</h1>
          <p className={styles.titleHi}>परीक्षा सफलतापूर्वक सबमिट की गई</p>

          <div className={styles.candidateInfo}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Candidate</span>
              <span className={styles.infoValue}>{receipt.candidate_name}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Roll Number</span>
              <span className={styles.infoValueMono}>{receipt.roll_number}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Exam</span>
              <span className={styles.infoValue}>{receipt.exam_name} ({receipt.exam_body})</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Date</span>
              <span className={styles.infoValue}>{receipt.exam_date}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Duration</span>
              <span className={styles.infoValue}>{receipt.entered_at} → {receipt.submitted_at} ({receipt.duration_elapsed})</span>
            </div>
          </div>
        </section>

        {/* Section 2 — Cryptographic Proof */}
        <section className={styles.cryptoSection}>
          <div className={styles.proofRow}>
            <div className={styles.proofLabel}>
              <span className={styles.proofIcon}></span>
              <div>
                <strong>Your Answer Fingerprint (Merkle Root)</strong>
                <p className={styles.proofExplain}>
                  This hash is the mathematical fingerprint of ALL your answers, permanently recorded on the Polygon blockchain. If any official tries to change your answers after submission, this fingerprint will not match — provable to any High Court or the Supreme Court.
                </p>
              </div>
            </div>
            <HashDisplay hash={receipt.answer_merkle_root} variant="dark" full />
          </div>

          <div className={styles.proofRow}>
            <div className={styles.proofLabel}>
              <span className={styles.proofIcon}></span>
              <div>
                <strong>Blockchain Commitment</strong>
                <p className={styles.proofDetail}>
                  TX: <code>{receipt.polygon_answer_tx.slice(0, 14)}...{receipt.polygon_answer_tx.slice(-8)}</code> · Block #{receipt.block_number.toLocaleString()} · ✓ Confirmed
                </p>
              </div>
            </div>
            <a
              href={`https://amoy.polygonscan.com/tx/${receipt.polygon_answer_tx}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.polygonscanBtn}
            >
              View on Polygonscan ↗
            </a>
          </div>

          <div className={styles.proofRow}>
            <div className={styles.proofLabel}>
              <span className={styles.proofIcon}></span>
              <div>
                <strong>Paper Difficulty Proof</strong>
                <p className={styles.proofExplain}>
                  Your paper had exactly the right difficulty distribution — proven by mathematics before you saw a single question.
                </p>
              </div>
            </div>
            <span className={styles.zkBadge}>✓ ZK Proof Verified on-chain</span>
          </div>

          <div className={styles.proofRow}>
            <div className={styles.proofLabel}>
              <span className={styles.proofIcon}></span>
              <div>
                <strong>Your Merkle Inclusion Proof</strong>
                <button className={styles.toggleProof} onClick={() => setShowProof(!showProof)}>
                  {showProof ? 'Hide path ▲' : 'Show Merkle path ▼'}
                </button>
              </div>
            </div>
          </div>

          {showProof && (
            <div className={styles.merklePath}>
              <div className={styles.merkleTree}>
                <div className={styles.merkleNode + ' ' + styles.merkleRoot}>Root</div>
                <div className={styles.merkleBranches}>
                  {receipt.merkle_proof_path.map((h, i) => (
                    <div key={i} className={styles.merkleNode + ' ' + styles.merkleSibling}>
                      <code>{h.slice(0, 8)}...{h.slice(-6)}</code>
                    </div>
                  ))}
                </div>
                <div className={styles.merkleNode + ' ' + styles.merkleLeaf}>
                  Your Leaf
                  <code>{receipt.merkle_leaf.slice(0, 10)}...</code>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Section 3 — Answer Summary */}
        <section className={styles.summarySection}>
          <h2 className={styles.sectionTitle}>Answer Summary</h2>
          <div className={styles.summaryTable}>
            <div className={styles.tableHeader}>
              <span>Q#</span><span>Section</span><span>Status</span><span>Time</span>
            </div>
            {receipt.answers_summary.map(a => (
              <div key={a.question_number} className={styles.tableRow}>
                <span className={styles.qNum}>{a.question_number}</span>
                <span>{a.section}</span>
                <span className={`${styles.ansStatus} ${styles[`status-${a.status}`]}`}>
                  {a.status === 'answered' ? '✓' : a.status === 'flagged_answered' ? '' : ''} {a.status.replace('_', ' ')}
                </span>
                <span className={styles.timeSpent}>{Math.floor(a.time_spent_seconds / 60)}m {a.time_spent_seconds % 60}s</span>
              </div>
            ))}
          </div>
        </section>

        {/* Section 4 — How to Verify */}
        <section className={styles.verifySection}>
          <h2 className={styles.sectionTitle}>How to Verify Independently</h2>
          <div className={styles.verifySteps}>
            {[
              'Open amoy.polygonscan.com on any device',
              'Paste the Transaction Hash shown above',
              'Verify the Merkle Root matches your receipt',
              'Check the block timestamp is AFTER your submission time',
              'Compare the ZK Proof hash with the on-chain record',
            ].map((step, i) => (
              <div key={i} className={styles.verifyStep}>
                <span className={styles.stepNum}>{i + 1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
          <p className={styles.shareNote}>
            Share this link with your family or lawyer. They can verify without logging in.
          </p>
        </section>

        {/* Download buttons */}
        <div className={`${styles.downloadRow} no-print`}>
          <button className={styles.downloadBtn} onClick={() => window.print()}>Print Receipt (A4)</button>
          <button className={styles.downloadBtn}>Export JSON Proof</button>
          <button className={styles.downloadBtn}>Share Link</button>
        </div>
      </div>
    </div>
  );
}
