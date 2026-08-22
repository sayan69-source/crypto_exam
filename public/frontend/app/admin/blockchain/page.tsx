/**
 * CryptoExam Core — Admin Blockchain Audit
 * Live chain state from /blockchain/status. Nothing here is fabricated: an
 * undeployed contract says so rather than showing a plausible address.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type BlockchainStatus } from '@/lib/api/admin';
import {
  AdminPage, PageHeader, Card, CardGrid, Stat, Badge, Button,
  ErrorState,
} from '@/components/admin/AdminUI';

export default function AdminBlockchainPage() {
  const [status, setStatus] = useState<BlockchainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi.blockchainStatus()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to reach chain'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const contractDeployed = !!status?.contractAddress;

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Public verifiability"
        title="Blockchain Audit"
        subtitle={
          loading
            ? 'Querying the chain…'
            : status?.connected
              ? 'Live connection. Every anchored exam is verifiable by anyone, without an account.'
              : 'Chain not reachable from this host.'
        }
        actions={
          <>
            <Badge tone={status?.connected ? 'ok' : 'danger'} dot>
              {loading ? 'Checking' : status?.connected ? 'Connected' : 'Offline'}
            </Badge>
            <Button onClick={load} disabled={loading}>Refresh</Button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {status && (
        <>
          <CardGrid minColumn={210}>
            <Stat
              label="Chain ID"
              value={status.chainId ?? '—'}
              hint={status.chainId === 80002 ? 'Polygon Amoy' : status.chainId === 31337 ? 'Local Hardhat' : undefined}
            />
            <Stat
              label="Latest block"
              value={status.latestBlock != null ? `#${status.latestBlock.toLocaleString()}` : '—'}
            />
            <Stat
              label="Contract"
              value={contractDeployed ? `${status.contractAddress!.slice(0, 10)}…` : 'Not deployed'}
              hint={contractDeployed ? status.contractAddress! : 'No address configured'}
            />
            <Stat
              label="Deployer balance"
              value={status.deployerBalance ?? '—'}
              hint={status.deployerAddress ? `${status.deployerAddress.slice(0, 12)}…` : 'No deployer key'}
            />
          </CardGrid>

          <div style={{ marginTop: 'var(--space-xl)' }}>
            <Card title="On-chain exam commitments">
              <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--color-navy-600)', margin: 0 }}>
                {contractDeployed ? (
                  <>
                    Contract <code>{status.contractAddress}</code> is live. Per-exam Merkle roots and
                    Groth16 proofs become verifiable as exams are anchored — the{' '}
                    <strong>ExamCreated → PaperLocked → AnswerRootCommitted</strong> sequence is
                    readable by anyone with an RPC endpoint.
                  </>
                ) : (
                  <>
                    The chain is {status.connected ? 'reachable' : 'unreachable'}, but the CryptoExam
                    contract is not deployed in this environment, so there are no commitments to show.
                    Configure a contract address and a funded deployer key, seal an exam, and its{' '}
                    <strong>ExamCreated → PaperLocked → AnswerRootCommitted</strong> events appear
                    here, each linking to the explorer.{' '}
                    <strong>No transactions are fabricated to fill this space.</strong>
                  </>
                )}
              </p>
            </Card>
          </div>
        </>
      )}
    </AdminPage>
  );
}
