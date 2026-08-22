/**
 * CryptoExam Core — System Admin · Answer Vault (ZUUP-OS §10.4 / §11.4)
 *
 * The only tier that can decrypt plaintext answers. Centre nodes sync sealed
 * answer-root bundles AFTER an exam; the System Admin then verifies the Merkle
 * chain + node signature, anchors the root on Polygon (roots/counts/hashes only,
 * no PII), and HSM-decrypts into the System Admin store.
 *
 * Real actions: POST /api/v1/sys/ledger/{ingest,anchor,decrypt}. There is no
 * synced bundle in this environment yet (no exam has been sat + uploaded), so
 * this shows an honest empty state rather than fabricated bundles.
 */
'use client';

import { AdminPage, PageHeader, Card, EmptyState } from '@/components/admin/AdminUI';

export default function AnswerVaultPage() {
  return (
    <AdminPage>
      <PageHeader
        eyebrow="Tier 0 · HSM"
        title="Answer Vault"
        subtitle={
          <>
            The only tier that can decrypt. Verify the chain → anchor the root → HSM-decrypt (§11.4).
            The HSM holds the only unwrapping key, so a compromised centre yields ciphertext alone
            (INV-6). Anchors carry roots, counts and hashes — never a roll, name or DOB (§11.5 / DPDP).
          </>
        }
      />

      <Card>
        <EmptyState
          title="No centre answer bundles awaiting processing"
          hint={
            <>
              Sealed answer-root bundles appear here <strong>after an exam</strong>, once centre nodes
              upload them over the sync link. Each then runs the real verify → anchor → HSM-decrypt
              pipeline (<code>POST /sys/ledger/ingest · anchor · decrypt</code>).{' '}
              <strong>No bundles are fabricated</strong> — this stays empty until real answers sync.
            </>
          }
        />
      </Card>
    </AdminPage>
  );
}
