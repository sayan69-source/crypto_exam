/**
 * CryptoExam Core — Admin Centers Page
 * India map (placeholder) + center list
 */
'use client';

import { mockCenters } from '@/lib/api/mock-data';
import styles from './centers.module.css';

export default function AdminCentersPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>🗺️ Exam Centers</h1>
      <p className={styles.subtitle}>{mockCenters.length} centers across India</p>

      <div className={styles.layout}>
        <div className={styles.mapPanel}>
          <div className={styles.mapArea}>
            {mockCenters.map(center => (
              <div
                key={center.id}
                className={`${styles.dot} ${styles[`dot-${center.status}`]}`}
                style={{
                  left: `${((center.longitude - 68) / 30) * 100}%`,
                  top: `${((37 - center.latitude) / 29) * 100}%`,
                }}
                title={center.name}
              />
            ))}
          </div>
        </div>

        <div className={styles.listPanel}>
          {mockCenters.map(center => (
            <div key={center.id} className={`${styles.centerCard} ${styles[`card-${center.status}`]}`}>
              <div className={styles.centerHeader}>
                <span className={styles.centerName}>{center.name}</span>
                <span className={`${styles.statusBadge} ${styles[`badge-${center.status}`]}`}>{center.status}</span>
              </div>
              <div className={styles.centerMeta}>
                <span>📍 {center.city}, {center.state}</span>
                <span>👥 {center.candidates_present}/{center.capacity}</span>
                <span>📶 {center.connectivity.replace('TIER_', 'T').replace('_', ' ')}</span>
              </div>
              <div className={styles.centerContact}>
                <span>👤 {center.invigilator_name}</span>
                <span>📞 {center.invigilator_phone}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
