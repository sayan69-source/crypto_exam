/**
 * CryptoExam Core — Admin Emergency Panel (V3 §10)
 * Real 2-of-3 admin dual-control over the live backend (/emergency/*).
 * No simulated actions — every request, confirmation and broadcast is real.
 */
'use client';

import DualControlPanel from '@/components/admin/DualControlPanel';
import styles from './emergency.module.css';

export default function EmergencyPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Emergency Control Panel</h1>
        <p className={styles.subtitle}>
          Pause, extend, resume, abort or broadcast under 2-of-3 admin dual-control.
          Every action is a real request against the backend and is logged.
        </p>
      </div>

      {/* V3 §10 — real 2-of-3 admin dual-control (emergencyApi → /emergency/*). */}
      <DualControlPanel />
    </div>
  );
}
