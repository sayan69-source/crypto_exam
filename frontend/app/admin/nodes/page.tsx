/**
 * CryptoExam Core — Admin Nodes Page
 */
'use client';

import { mockNodes } from '@/lib/api/mock-data';

export default function AdminNodesPage() {
  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'white', marginBottom: 24 }}>🔧 Hardware Nodes</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {mockNodes.map(node => (
          <div key={node.id} style={{
            background: 'rgba(255,255,255,0.04)', border: `1px solid ${node.status === 'ERROR' ? 'rgba(248,113,113,0.3)' : 'var(--color-navy-700)'}`,
            borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <code style={{ fontSize: 13, color: 'var(--color-navy-200)' }}>{node.serial_number}</code>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9999,
                background: node.status === 'COMPLETE' ? 'rgba(74,222,128,0.15)' : node.status === 'ERROR' ? 'rgba(248,113,113,0.15)' : 'rgba(245,158,11,0.15)',
                color: node.status === 'COMPLETE' ? '#4ade80' : node.status === 'ERROR' ? '#f87171' : '#f59e0b',
              }}>{node.status}</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-navy-300)' }}>{node.center_name}</span>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--color-navy-300)' }}>
              <span>TPM {node.tpm_ok ? '✅' : '❌'}</span>
              <span>GPS {node.gps_ok ? '✅' : '❌'}</span>
              <span>ATECC {node.atecc_ok ? '✅' : '❌'}</span>
              <span>Mesh {node.tamper_mesh_ok ? '✅' : '❌'}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-navy-400)' }}>
              <span>FW: {node.firmware_version}</span>
              {node.battery_percent < 100 && <span>🔋 {node.battery_percent}%</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
