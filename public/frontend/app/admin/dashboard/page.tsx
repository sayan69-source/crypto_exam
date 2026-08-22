/**
 * CryptoExam Core — Admin Mission Control Dashboard
 * Wired to the live FastAPI backend (/admin/dashboard, /admin/nodes, /exams).
 * No mock fixtures — shows real system state or an honest loading/error view.
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  adminApi,
  type AdminDashboard,
  type AdminNode,
  type AdminExam,
} from '@/lib/api/admin';
import styles from './dashboard.module.css';

const HEALTH_OK = new Set(['healthy', 'connected', 'up', 'ready']);

export default function AdminDashboard() {
  const [dash, setDash] = useState<AdminDashboard | null>(null);
  const [nodes, setNodes] = useState<AdminNode[]>([]);
  const [exams, setExams] = useState<AdminExam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [d, n, e] = await Promise.all([
          adminApi.dashboard(),
          adminApi.nodes().catch(() => ({ total: 0, nodes: [] as AdminNode[] })),
          adminApi.exams().catch(() => ({ items: [] as AdminExam[], total: 0, page: 1, per_page: 0 })),
        ]);
        if (!alive) return;
        setDash(d);
        setNodes(n.nodes);
        setExams(e.items);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className={styles.page}><div className={styles.header}><h1>Mission Control</h1></div><p style={{ color: 'var(--color-navy-300)' }}>Loading live system state…</p></div>;
  }
  if (error || !dash) {
    return (
      <div className={styles.page}>
        <div className={styles.header}><h1>Mission Control</h1></div>
        <div style={{ padding: 20, border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.15)', borderRadius: 12, color: '#fca5a5' }}>
          Could not reach the backend: {error ?? 'unknown error'}.
          <br />Ensure the API is running at <code>{process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'}</code>.
        </div>
      </div>
    );
  }

  const liveExams = exams.filter((e) => e.status === 'LIVE');
  const onlineNodes = nodes.filter((n) => n.is_online).length;
  const examStatuses = Object.entries(dash.exams).filter(([, v]) => v > 0);

  return (
    <div className={styles.page}>
      {/* Row 0 — Page header */}
      <div className={styles.header}>
        <h1>Mission Control</h1>
        <span className={styles.headerMeta}>
          Live · {new Date(dash.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
        </span>
      </div>

      {/* Row 1 — Live exams strip (real exams in LIVE state) */}
      <div className={styles.liveStrip}>
        {liveExams.length === 0 ? (
          <div className={styles.liveCard} style={{ opacity: 0.7 }}>
            <div className={styles.liveHeader}><span className={styles.liveExamName}>No exams currently live</span></div>
            <div className={styles.liveStats}><span className={styles.liveStatLabel}>Next scheduled exams appear here once they enter the LIVE state.</span></div>
          </div>
        ) : liveExams.map((exam) => (
          <div key={exam.id} className={`${styles.liveCard} ${styles['health-healthy']}`}>
            <div className={styles.liveHeader}>
              <span className={styles.liveIndicator}>● LIVE</span>
              <span className={styles.liveExamName}>{exam.name}</span>
            </div>
            <div className={styles.liveStats}>
              <div className={styles.liveStat}><span className={styles.liveStatValue}>{exam.sets_count}</span><span className={styles.liveStatLabel}>sets</span></div>
              <div className={styles.liveStat}><span className={styles.liveStatValue}>{exam.duration_minutes}m</span><span className={styles.liveStatLabel}>duration</span></div>
              <div className={styles.liveStat}><span className={styles.liveStatValue}>{exam.exam_body}</span><span className={styles.liveStatLabel}>body</span></div>
              <div className={styles.liveStat}><span className={styles.liveStatValue}>−{exam.negative_marking}</span><span className={styles.liveStatLabel}>neg. mark</span></div>
            </div>
          </div>
        ))}
      </div>

      {/* Row 2 — KPI Tiles (real) */}
      <div className={styles.kpiRow}>
        {[
          { label: 'Candidates Enrolled', value: (dash.users.CANDIDATE ?? 0).toLocaleString(), color: '#4ade80' },
          { label: 'Active Sessions', value: dash.active_sessions.toLocaleString(), color: '#60a5fa' },
          { label: 'Nodes Online', value: `${dash.hardware_nodes.online}/${dash.hardware_nodes.total}`, color: dash.hardware_nodes.online < dash.hardware_nodes.total ? '#f59e0b' : '#4ade80' },
          { label: 'Total Enrollments', value: dash.total_enrollments.toLocaleString(), color: '#a78bfa' },
        ].map((kpi) => (
          <div key={kpi.label} className={styles.kpiTile}>
            <span className={styles.kpiValue} style={{ color: kpi.color }}>{kpi.value}</span>
            <span className={styles.kpiLabel}>{kpi.label}</span>
          </div>
        ))}
      </div>

      {/* Row 3 — Node map (real GPS) + System health */}
      <div className={styles.mapRow}>
        <div className={styles.mapPanel}>
          <div className={styles.mapHeader}>
            <h2>Hardware Nodes — India</h2>
            <Link href="/admin/nodes" className={styles.viewAllLink}>View All →</Link>
          </div>
          <div className={styles.mapPlaceholder}>
            <div className={styles.indiaOutline}>
              {nodes.filter((n) => n.latitude != null && n.longitude != null).map((n) => (
                <div
                  key={n.id}
                  className={`${styles.centerDot} ${n.is_online ? styles['dot-healthy'] : styles['dot-inactive']}`}
                  style={{
                    left: `${((n.longitude! - 68) / (98 - 68)) * 100}%`,
                    top: `${((37 - n.latitude!) / (37 - 8)) * 100}%`,
                  }}
                  title={`${n.center_name ?? n.serial_number} — ${n.is_online ? 'online' : 'offline'}`}
                />
              ))}
            </div>
            <div className={styles.mapLegend}>
              <span><span className={`${styles.legendDot} ${styles['dot-healthy']}`} /> Online</span>
              <span><span className={`${styles.legendDot} ${styles['dot-inactive']}`} /> Offline</span>
            </div>
          </div>
        </div>

        {/* System health (real) */}
        <div className={styles.anomalyPanel}>
          <div className={styles.anomalyHeader}>
            <h2>System Health</h2>
            <span className={styles.anomalyBadge}>{Object.values(dash.system_health).filter((s) => HEALTH_OK.has(s)).length}/{Object.keys(dash.system_health).length} OK</span>
          </div>
          <div className={styles.anomalyList}>
            {Object.entries(dash.system_health).map(([component, state]) => (
              <div key={component} className={`${styles.anomalyItem} ${HEALTH_OK.has(state) ? styles['sev-1'] : styles['sev-4']}`}>
                <div className={styles.anomalyMeta}>
                  <span className={styles.anomalyType}>{component}</span>
                  <span className={styles.anomalyTime}>{state}</span>
                </div>
                <span className={`${styles.anomalyStatus} ${HEALTH_OK.has(state) ? styles.resolved : ''}`}>
                  {HEALTH_OK.has(state) ? '✓ Healthy' : 'Degraded'}
                </span>
              </div>
            ))}
            <div className={styles.anomalyItem}>
              <div className={styles.anomalyMeta}><span className={styles.anomalyType}>Users by role</span></div>
              <span className={styles.anomalyCenter}>
                {Object.entries(dash.users).map(([r, c]) => `${r.toLowerCase()} ${c}`).join(' · ')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 4 — Nodes grid (real) + Exam pipeline (real) */}
      <div className={styles.bottomRow}>
        <div className={styles.nodesPanel}>
          <div className={styles.panelHeader}>
            <h2>Hardware Nodes ({onlineNodes}/{nodes.length} online)</h2>
            <Link href="/admin/nodes" className={styles.viewAllLink}>Manage →</Link>
          </div>
          <div className={styles.nodeGrid}>
            {nodes.slice(0, 4).map((node) => (
              <div key={node.id} className={`${styles.nodeCard} ${node.is_online ? styles['nodeStatus-ARMED'] : styles['nodeStatus-ERROR']}`}>
                <div className={styles.nodeHeader}>
                  <code className={styles.nodeSerial}>{node.serial_number}</code>
                  <span className={`${styles.nodeStatusBadge} ${node.is_online ? styles['nodeS-ARMED'] : styles['nodeS-ERROR']}`}>{node.is_online ? 'ONLINE' : 'OFFLINE'}</span>
                </div>
                <span className={styles.nodeCenter}>{node.center_name ?? node.state ?? '—'}</span>
                <div className={styles.nodeChecks}>
                  <span>TPM {node.tpm_verified ? '✓' : '✗'}</span>
                  <span>GPS {node.latitude != null ? '✓' : '✗'}</span>
                  <span>FW {node.firmware_version ?? '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Exam pipeline (real status breakdown) */}
        <div className={styles.blockchainPanel}>
          <div className={styles.panelHeader}>
            <h2>Exam Pipeline</h2>
            <Link href="/admin/exams" className={styles.viewAllLink}>All Exams →</Link>
          </div>
          <div className={styles.txList}>
            {examStatuses.length === 0 ? (
              <div className={styles.txItem}><span className={styles.txType}>No exams</span></div>
            ) : examStatuses.map(([status, count]) => (
              <div key={status} className={styles.txItem}>
                <span className={styles.txType}>{status}</span>
                <code className={styles.txHash}>{count} exam{count === 1 ? '' : 's'}</code>
                <span className={styles.txStatus}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
