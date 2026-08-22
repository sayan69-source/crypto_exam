/**
 * CryptoExam Core — Admin Blockchain Audit
 * Live Polygon connection status from /blockchain/status. Per-exam on-chain
 * commitments appear once a contract is deployed and exams are anchored — until
 * then this shows the real chain state, not fabricated transactions.
 */
'use client';

import { useEffect, useState } from 'react';
import { adminApi, type BlockchainStatus } from '@/lib/api/admin';

export default function AdminBlockchainPage() {
  const [status, setStatus] = useState<BlockchainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminApi.blockchainStatus()
      .then((s) => { if (alive) setStatus(s); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to reach chain'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const contractDeployed = !!status?.contractAddress;

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'var(--color-navy-900)', marginBottom: 8 }}>Blockchain Audit</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-500)', marginBottom: 24 }}>
        {loading ? 'Querying the chain…' : status?.connected ? 'Live connection to Polygon.' : 'Chain not reachable.'}
      </p>

      {error && (
        <div style={{ padding: 16, border: '1px solid rgba(200,32,32,0.35)', background: 'rgba(200,32,32,0.06)', borderRadius: 12, color: 'var(--color-danger)' }}>{error}</div>
      )}

      {status && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Connection', value: status.connected ? 'CONNECTED' : 'OFFLINE', color: status.connected ? 'var(--color-success)' : 'var(--color-danger)' },
            { label: 'Chain ID', value: status.chainId != null ? `${status.chainId}${status.chainId === 80002 ? ' (Amoy)' : ''}` : '—' },
            { label: 'Latest Block', value: status.latestBlock != null ? `#${status.latestBlock.toLocaleString()}` : '—' },
            { label: 'Contract', value: contractDeployed ? `${status.contractAddress!.slice(0, 10)}…` : 'Not deployed' },
          ].map((s) => (
            <div key={s.label} style={card}>
              <span style={cardLabel}>{s.label}</span>
              <span style={{ ...cardValue, color: s.color ?? 'var(--color-navy-900)' }}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 16, color: 'var(--color-navy-800)', marginBottom: 12 }}>On-chain Exam Commitments</h2>
      <div style={{ ...card }}>
        {contractDeployed ? (
          <p style={{ color: 'var(--color-navy-600)', fontSize: 13 }}>
            Contract <code>{status?.contractAddress}</code> is live. Per-exam Merkle roots and ZK
            proofs are verifiable on Polygonscan as exams are anchored.
          </p>
        ) : (
          <p style={{ color: 'var(--color-navy-600)', fontSize: 13, lineHeight: 1.7 }}>
            The chain is {status?.connected ? 'reachable' : 'unreachable'}, but the CryptoExam contract
            is not deployed in this environment, so there are no exam commitments to show yet. Once a
            contract address + deployer key are configured and an exam is sealed, its{' '}
            <strong>ExamCreated → PaperLocked → AnswerRootCommitted</strong> events appear here, each
            linking to Polygonscan. No transactions are fabricated.
          </p>
        )}
      </div>
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border-soft)', borderRadius: 12, padding: 20 };
const cardLabel: React.CSSProperties = { fontSize: 12, color: 'var(--color-navy-500)', display: 'block' };
const cardValue: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: 'var(--color-navy-900)', fontFamily: 'var(--font-mono)', display: 'block', marginTop: 4 };
