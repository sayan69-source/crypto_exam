/**
 * CryptoExam Core — Admin Centers Page
 * Wired to the live backend (/admin/centers). India map plots real centre
 * coordinates; status is derived from live node health. No mock data.
 */
'use client';

import { useEffect, useState } from 'react';
import { adminApi, type AdminCenter } from '@/lib/api/admin';
import styles from './centers.module.css';

// Map backend health -> existing CSS status variants.
const CSS_STATUS: Record<string, string> = { healthy: 'healthy', degraded: 'degraded', offline: 'incident', unknown: 'degraded' };

export default function AdminCentersPage() {
  const [centers, setCenters] = useState<AdminCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminApi.centers()
      .then((r) => { if (alive) setCenters(r.centers); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load centers'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Exam Centers</h1>
      <p className={styles.subtitle}>
        {loading ? 'Loading centres…' : `${centers.length} centers across India · live node health`}
      </p>

      {error && (
        <div style={{ padding: 16, border: '1px solid rgba(200,32,32,0.35)', background: 'rgba(200,32,32,0.06)', borderRadius: 12, color: 'var(--color-danger)' }}>{error}</div>
      )}

      <div className={styles.layout}>
        <div className={styles.mapPanel}>
          <div className={styles.mapArea}>
            {centers.filter((c) => c.latitude != null && c.longitude != null).map((center) => (
              <div
                key={center.id}
                className={`${styles.dot} ${styles[`dot-${CSS_STATUS[center.status]}`]}`}
                style={{
                  left: `${((center.longitude! - 68) / 30) * 100}%`,
                  top: `${((37 - center.latitude!) / 29) * 100}%`,
                }}
                title={`${center.name} — ${center.status}`}
              />
            ))}
          </div>
        </div>

        <div className={styles.listPanel}>
          {centers.map((center) => (
            <div key={center.id} className={`${styles.centerCard} ${styles[`card-${CSS_STATUS[center.status]}`]}`}>
              <div className={styles.centerHeader}>
                <span className={styles.centerName}>{center.name}</span>
                <span className={`${styles.statusBadge} ${styles[`badge-${CSS_STATUS[center.status]}`]}`}>{center.status}</span>
              </div>
              <div className={styles.centerMeta}>
                <span>{center.city ? `${center.city}, ` : ''}{center.state ?? ''}</span>
                <span>{center.nodesOnline}/{center.nodesTotal} nodes · cap {center.capacity ?? '—'}</span>
                <span>{(center.connectivity ?? '').replace('TIER_', 'T').replace('_', ' ')}</span>
              </div>
              <div className={styles.centerContact}>
                <span>{center.invigilatorName ?? '—'}</span>
                <span>{center.invigilatorPhone ?? ''}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
