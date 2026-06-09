/**
 * CryptoExam Core — Admin Mission Control Dashboard
 * 12-column CSS Grid, dark mode, real-time everything
 * Row 1: Live exams strip | Row 2: KPI tiles | Row 3: Map + Anomalies | Row 4: Nodes + Blockchain
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { mockDashboard, mockCenters, mockAnomalies, mockBlockchainEvents, mockNodes } from '@/lib/api/mock-data';
import styles from './dashboard.module.css';

export default function AdminDashboard() {
  const dash = mockDashboard;
  const [tick, setTick] = useState(0);

  // Simulated live ticker
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className={styles.page}>
      {/* Row 0 — Page header */}
      <div className={styles.header}>
        <h1>Mission Control</h1>
        <span className={styles.headerMeta}>Last update: {new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>
      </div>

      {/* Row 1 — Live exams strip */}
      <div className={styles.liveStrip}>
        {dash.live_exams.map(exam => (
          <div key={exam.id} className={`${styles.liveCard} ${styles[`health-${exam.health}`]}`}>
            <div className={styles.liveHeader}>
              <span className={styles.liveIndicator}>● LIVE</span>
              <span className={styles.liveExamName}>{exam.name}</span>
            </div>
            <div className={styles.liveStats}>
              <div className={styles.liveStat}>
                <span className={styles.liveStatValue}>{exam.candidates_online.toLocaleString()}</span>
                <span className={styles.liveStatLabel}>online</span>
              </div>
              <div className={styles.liveStat}>
                <span className={styles.liveStatValue}>{exam.centers_healthy}/{exam.centers_total}</span>
                <span className={styles.liveStatLabel}>centers ok</span>
              </div>
              <div className={styles.liveStat}>
                <span className={styles.liveStatValue}>{Math.floor(exam.time_remaining_seconds / 60)}m</span>
                <span className={styles.liveStatLabel}>remaining</span>
              </div>
              <div className={styles.liveStat}>
                <span className={`${styles.liveStatValue} ${exam.anomaly_count > 0 ? styles.anomalyCount : ''}`}>
                  {exam.anomaly_count}
                </span>
                <span className={styles.liveStatLabel}>anomalies</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Row 2 — KPI Tiles */}
      <div className={styles.kpiRow}>
        {[
          { label: 'Candidates Online', value: dash.candidates_online.toLocaleString(), icon: '👥', color: '#4ade80' },
          { label: 'Centers Healthy', value: `${dash.centers_healthy}/${dash.centers_total}`, icon: '🏫', color: dash.centers_healthy < dash.centers_total ? '#f59e0b' : '#4ade80' },
          { label: 'Blockchain TPS', value: dash.blockchain_tps.toString(), icon: '⛓️', color: '#a78bfa' },
          { label: 'Active Anomalies', value: dash.active_anomalies.toString(), icon: '⚠️', color: dash.active_anomalies > 5 ? '#f87171' : '#f59e0b' },
        ].map(kpi => (
          <div key={kpi.label} className={styles.kpiTile}>
            <span className={styles.kpiIcon}>{kpi.icon}</span>
            <span className={styles.kpiValue} style={{ color: kpi.color }}>{kpi.value}</span>
            <span className={styles.kpiLabel}>{kpi.label}</span>
          </div>
        ))}
      </div>

      {/* Row 3 — Map placeholder + Anomaly feed */}
      <div className={styles.mapRow}>
        {/* India map placeholder */}
        <div className={styles.mapPanel}>
          <div className={styles.mapHeader}>
            <h2>Center Map — India</h2>
            <Link href="/admin/centers" className={styles.viewAllLink}>View All →</Link>
          </div>
          <div className={styles.mapPlaceholder}>
            <div className={styles.indiaOutline}>
              {/* Simplified center dots */}
              {mockCenters.map(center => (
                <div
                  key={center.id}
                  className={`${styles.centerDot} ${styles[`dot-${center.status}`]}`}
                  style={{
                    left: `${((center.longitude - 68) / (98 - 68)) * 100}%`,
                    top: `${((37 - center.latitude) / (37 - 8)) * 100}%`,
                  }}
                  title={`${center.name} — ${center.status}`}
                />
              ))}
            </div>
            <div className={styles.mapLegend}>
              <span><span className={`${styles.legendDot} ${styles['dot-healthy']}`} /> Healthy</span>
              <span><span className={`${styles.legendDot} ${styles['dot-degraded']}`} /> Degraded</span>
              <span><span className={`${styles.legendDot} ${styles['dot-incident']}`} /> Incident</span>
            </div>
          </div>
        </div>

        {/* Anomaly feed */}
        <div className={styles.anomalyPanel}>
          <div className={styles.anomalyHeader}>
            <h2>⚠️ Anomaly Feed</h2>
            <span className={styles.anomalyBadge}>{mockAnomalies.filter(a => !a.resolved).length} active</span>
          </div>
          <div className={styles.anomalyList}>
            {mockAnomalies.map(anomaly => {
              const timeDiff = Math.floor((Date.now() - new Date(anomaly.created_at).getTime()) / 60000);
              return (
                <div key={anomaly.id} className={`${styles.anomalyItem} ${styles[`sev-${anomaly.severity}`]}`}>
                  <div className={styles.anomalyMeta}>
                    <span className={styles.anomalyType}>{anomaly.type.replace(/_/g, ' ')}</span>
                    <span className={styles.anomalyTime}>{timeDiff}m ago</span>
                  </div>
                  <span className={styles.anomalyCenter}>{anomaly.center_name}</span>
                  {anomaly.candidate_name && (
                    <span className={styles.anomalyCandidate}>{anomaly.candidate_name}</span>
                  )}
                  <span className={`${styles.anomalyStatus} ${anomaly.resolved ? styles.resolved : ''}`}>
                    {anomaly.resolved ? '✅ Resolved' : '🔴 Active'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 4 — Nodes + Blockchain */}
      <div className={styles.bottomRow}>
        {/* Hardware Nodes */}
        <div className={styles.nodesPanel}>
          <div className={styles.panelHeader}>
            <h2>🔧 Hardware Nodes</h2>
            <Link href="/admin/nodes" className={styles.viewAllLink}>Manage →</Link>
          </div>
          <div className={styles.nodeGrid}>
            {mockNodes.slice(0, 4).map(node => (
              <div key={node.id} className={`${styles.nodeCard} ${styles[`nodeStatus-${node.status}`]}`}>
                <div className={styles.nodeHeader}>
                  <code className={styles.nodeSerial}>{node.serial_number}</code>
                  <span className={`${styles.nodeStatusBadge} ${styles[`nodeS-${node.status}`]}`}>{node.status}</span>
                </div>
                <span className={styles.nodeCenter}>{node.center_name}</span>
                <div className={styles.nodeChecks}>
                  <span>TPM {node.tpm_ok ? '✅' : '❌'}</span>
                  <span>GPS {node.gps_ok ? '✅' : '❌'}</span>
                  <span>ATECC {node.atecc_ok ? '✅' : '❌'}</span>
                  <span>Mesh {node.tamper_mesh_ok ? '✅' : '❌'}</span>
                </div>
                {node.battery_percent < 100 && (
                  <span className={styles.nodeBattery}>🔋 {node.battery_percent}%</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Blockchain Feed */}
        <div className={styles.blockchainPanel}>
          <div className={styles.panelHeader}>
            <h2>⛓️ Blockchain Feed</h2>
            <Link href="/admin/blockchain" className={styles.viewAllLink}>Full Log →</Link>
          </div>
          <div className={styles.txList}>
            {mockBlockchainEvents.map(event => (
              <div key={event.tx_hash} className={styles.txItem}>
                <span className={styles.txType}>{event.type}</span>
                <code className={styles.txHash}>{event.tx_hash.slice(0, 10)}...{event.tx_hash.slice(-6)}</code>
                <span className={styles.txStatus}>✅</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
