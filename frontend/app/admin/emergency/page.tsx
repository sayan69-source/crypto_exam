/**
 * CryptoExam Core — Admin Emergency Panel
 * Pause, Extend, Abort, Suspend, Broadcast
 * 2-admin co-signature simulation, ≤3 clicks design
 */
'use client';

import { useState } from 'react';
import { mockExams } from '@/lib/api/mock-data';
import styles from './emergency.module.css';

type EmergencyAction = 'pause' | 'extend' | 'abort' | 'suspend' | 'broadcast';

const ACTIONS: { type: EmergencyAction; icon: string; label: string; color: string; description: string }[] = [
  { type: 'pause', icon: '⏸️', label: 'PAUSE ALL EXAMS', color: '#f59e0b', description: 'Freeze all timers. Candidates see a "Please wait" screen. Requires 1 admin co-sign.' },
  { type: 'extend', icon: '⏰', label: 'EXTEND TIME', color: '#3b82f6', description: 'Add time to one or all exams. Logged on blockchain.' },
  { type: 'abort', icon: '🛑', label: 'ABORT EXAM', color: '#ef4444', description: 'Cancel exam. IRREVERSIBLE. Requires 2 admin co-signs. All data preserved for audit.' },
  { type: 'suspend', icon: '🚫', label: 'SUSPEND CENTER', color: '#f97316', description: 'Disable a specific center. All candidates moved to grace period.' },
  { type: 'broadcast', icon: '📢', label: 'BROADCAST MESSAGE', color: '#8b5cf6', description: 'Send a message to all candidates, invigilators, or both.' },
];

export default function EmergencyPage() {
  const [selectedAction, setSelectedAction] = useState<EmergencyAction | null>(null);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [coSignerApproved, setCoSignerApproved] = useState(false);
  const [actionComplete, setActionComplete] = useState(false);

  const handleExecute = () => {
    setConfirming(true);
    setTimeout(() => {
      setActionComplete(true);
    }, 2000);
  };

  const resetAction = () => {
    setSelectedAction(null);
    setReason('');
    setConfirming(false);
    setCoSignerApproved(false);
    setActionComplete(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>🚨 Emergency Control Panel</h1>
        <p className={styles.subtitle}>All actions are logged on-chain and cannot be reversed.</p>
      </div>

      {!selectedAction ? (
        <div className={styles.actionGrid}>
          {ACTIONS.map(action => (
            <button
              key={action.type}
              className={styles.actionCard}
              onClick={() => setSelectedAction(action.type)}
              style={{ borderTopColor: action.color }}
            >
              <span className={styles.actionIcon}>{action.icon}</span>
              <span className={styles.actionLabel}>{action.label}</span>
              <span className={styles.actionDesc}>{action.description}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.executePanel}>
          <div className={styles.executePanelHeader}>
            <button className={styles.backBtn} onClick={resetAction}>← Back</button>
            <h2>{ACTIONS.find(a => a.type === selectedAction)?.icon} {ACTIONS.find(a => a.type === selectedAction)?.label}</h2>
          </div>

          {actionComplete ? (
            <div className={styles.completeCard}>
              <span className={styles.completeIcon}>✅</span>
              <h3>Action Executed Successfully</h3>
              <p>TX Hash: <code>0x7a8b9c0d...f7a8</code> — Logged on Polygon Amoy.</p>
              <button className={styles.doneBtn} onClick={resetAction}>Done</button>
            </div>
          ) : (
            <>
              <div className={styles.formGroup}>
                <label>Target Exam</label>
                <select className={styles.select}>
                  <option>All Live Exams</option>
                  {mockExams.filter(e => e.status === 'LIVE').map(e => (
                    <option key={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label>Reason (logged permanently)</label>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  placeholder="Provide a detailed reason for this action..."
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
              </div>

              {(selectedAction === 'abort') && (
                <div className={styles.coSignBlock}>
                  <h4>Co-Signer Approval Required</h4>
                  <div className={styles.coSignRow}>
                    <span>Admin 1: Vikram S. Rathore</span>
                    <span className={styles.coSignApproved}>✅ Approved (you)</span>
                  </div>
                  <div className={styles.coSignRow}>
                    <span>Admin 2: Dr. Meera Kapoor</span>
                    <button
                      className={styles.coSignBtn}
                      onClick={() => setCoSignerApproved(true)}
                      disabled={coSignerApproved}
                    >
                      {coSignerApproved ? '✅ Approved' : 'Simulate Co-Sign'}
                    </button>
                  </div>
                </div>
              )}

              <button
                className={`${styles.executeBtn} ${selectedAction === 'abort' ? styles.executeDanger : ''}`}
                onClick={handleExecute}
                disabled={!reason || (selectedAction === 'abort' && !coSignerApproved) || confirming}
              >
                {confirming ? (
                  <span className={styles.spinner} />
                ) : (
                  `Execute: ${ACTIONS.find(a => a.type === selectedAction)?.label}`
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
