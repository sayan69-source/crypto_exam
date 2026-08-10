/**
 * CryptoExam Core — Admin Nodes Page
 * Wired to the live backend (/admin/nodes). No mock fixtures.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminNode } from '@/lib/api/admin';
import {
  AdminPage, PageHeader, Card, Badge, Button, Table,
  ErrorState, EmptyState, SkeletonRows, cellMono, cellStrong,
} from '@/components/admin/AdminUI';

export default function AdminNodesPage() {
  const [nodes, setNodes] = useState<AdminNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi.nodes()
      .then((r) => setNodes(r.nodes))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load nodes'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const online = nodes.filter((n) => n.is_online).length;

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Estate telemetry"
        title="Hardware Nodes"
        subtitle={
          loading
            ? 'Loading live node telemetry…'
            : `${online} of ${nodes.length} online. A node is a sealed centre terminal reporting TPM attestation and position.`
        }
        actions={<Button onClick={load} disabled={loading}>Refresh</Button>}
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && (
        <Card flush>
          <Table head={['Serial', 'Centre', 'TPM', 'GPS', 'Firmware', 'Last heartbeat', 'Status']}>
            {loading && <SkeletonRows rows={5} cols={7} />}

            {!loading && nodes.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 0, borderBottom: 0 }}>
                  <EmptyState
                    title="No hardware nodes registered"
                    hint="Nodes appear once a centre terminal boots ZUUP-OS and completes attestation."
                  />
                </td>
              </tr>
            )}

            {!loading && nodes.map((node) => (
              <tr key={node.id}>
                <td className={cellMono}>{node.serial_number}</td>
                <td className={cellStrong}>{node.center_name ?? node.state ?? '—'}</td>
                <td>
                  <Badge tone={node.tpm_verified ? 'ok' : 'danger'}>
                    {node.tpm_verified ? 'Attested' : 'Unverified'}
                  </Badge>
                </td>
                <td>
                  <Badge tone={node.latitude != null && node.longitude != null ? 'ok' : 'neutral'}>
                    {node.latitude != null && node.longitude != null ? 'Fixed' : 'No fix'}
                  </Badge>
                </td>
                <td className={cellMono}>{node.firmware_version ?? '—'}</td>
                <td>{node.last_heartbeat ? new Date(node.last_heartbeat).toLocaleString('en-IN') : '—'}</td>
                <td>
                  <Badge tone={node.is_online ? 'ok' : 'danger'} dot>
                    {node.is_online ? 'Online' : 'Offline'}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </AdminPage>
  );
}
