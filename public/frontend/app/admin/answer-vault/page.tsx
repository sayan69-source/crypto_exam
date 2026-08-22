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

export default function AnswerVaultPage() {
  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'var(--color-navy-900)', marginBottom: 8 }}>Answer Vault</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-600)', marginBottom: 6 }}>
        The only tier that can decrypt. Verify the chain → anchor the root → HSM-decrypt (§11.4).
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-navy-500)', marginBottom: 24, maxWidth: 720, lineHeight: 1.7 }}>
        The HSM holds the only unwrapping key — a compromised centre yields only ciphertext (INV-6).
        Anchors carry roots/counts/hashes only; never a roll, name, or DOB (§11.5 / DPDP).
      </p>

      <div style={{ background: '#fff', border: '1px solid var(--border-soft)', borderRadius: 16, padding: 28, textAlign: 'center' }}>
        <p style={{ fontSize: 15, color: 'var(--color-navy-800)', fontWeight: 600, marginBottom: 8 }}>
          No centre answer bundles awaiting processing
        </p>
        <p style={{ fontSize: 13, color: 'var(--color-navy-500)', maxWidth: 560, margin: '0 auto', lineHeight: 1.7 }}>
          Sealed answer-root bundles appear here <strong>after an exam</strong>, once centre nodes
          upload them over the sync link. Each then runs the real verify → anchor → HSM-decrypt
          pipeline (<code>POST /sys/ledger/ingest · anchor · decrypt</code>). No bundles are
          fabricated — this stays empty until real exam answers are synced.
        </p>
      </div>
    </div>
  );
}
