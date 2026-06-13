/**
 * CryptoExam Core — Admin Nodes Page
 * Wired to the live backend (/admin/nodes). No mock fixtures.
 */
'use client';

import { useEffect, useState } from 'react';
import { adminApi, type AdminNode } from '@/lib/api/admin';

export default function AdminNodesPage() {
  const [nodes, setNodes] = useState<AdminNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    adminApi.nodes()
      .then((r) => { if (alive) setNodes(r.nodes); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load nodes'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const online = nodes.filter((n) => n.is_online).length;

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'var(--color-navy-900)', marginBottom: 8 }}>Hardware Nodes</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-500)', marginBottom: 24 }}>
        {loading ? 'Loading live node telemetry…' : `${online}/${nodes.length} online · live from the backend`}
      </p>

      {error && (
        <div style={{ padding: 16, border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.15)', borderRadius: 12, color: '#fca5a5' }}>
          Could not reach the backend: {error}
        </div>
      )}

      {!loading && !error && nodes.length === 0 && (
        <p style={{ color: 'var(--color-navy-400)' }}>No hardware nodes registered.</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {nodes.map((node) => (
          <div key={node.id} style={{
            background: '#fff', border: `1px solid ${node.is_online ? 'var(--border-soft)' : 'rgba(200,32,32,0.35)'}`,
            borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <code style={{ fontSize: 13, color: 'var(--color-navy-700)' }}>{node.serial_number}</code>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9999,
                background: node.is_online ? 'rgba(26,122,76,0.12)' : 'rgba(200,32,32,0.12)',
                color: node.is_online ? 'var(--color-success)' : 'var(--color-danger)',
              }}>{node.is_online ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-navy-600)' }}>{node.center_name ?? node.state ?? '—'}</span>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--color-navy-600)' }}>
              <span>TPM {node.tpm_verified ? '✓' : '✗'}</span>
              <span>GPS {node.latitude != null && node.longitude != null ? '✓' : '✗'}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-navy-500)' }}>
              <span>FW: {node.firmware_version ?? '—'}</span>
              {node.last_heartbeat && <span>HB: {new Date(node.last_heartbeat).toLocaleString('en-IN')}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
