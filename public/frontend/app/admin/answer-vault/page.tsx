/**
 * CryptoExam Core — System Admin · Answer Vault (ZUUP-OS §10.4 / §11.4)
 *
 * The ONLY tier where plaintext answers exist. For each synced centre bundle the
 * System Admin: (1) verifies the centre node signature + re-walks the Merkle
 * hash-chain, (2) anchors the answer-root on Polygon — roots/counts/hashes only,
 * no PII (§11.5), (3) HSM-decrypts into the System Admin store. The HSM holds the
 * only unwrapping key, so even a fully compromised centre yields only ciphertext
 * (INV-6).
 *
 * Wired in production to POST /api/v1/sys/ledger/{ingest,anchor,decrypt} (§13.5).
 * Mock fallback here mirrors the endpoint shapes; the decrypt button is gated on
 * a successful verify, exactly as the backend gates decrypt on chain re-walk.
 */
'use client';

import { useState } from 'react';

type BundleState = 'SYNCED' | 'VERIFIED' | 'ANCHORED' | 'DECRYPTED';

interface CentreBundle {
  centreName: string;
  centreIdHash: string;
  examName: string;
  count: number;
  answerRoot: string;
  nodePubkey: string;
  chainValid: boolean;
  state: BundleState;
  anchorTx?: string;
}

const INITIAL: CentreBundle[] = [
  { centreName: 'DL-IITD', centreIdHash: '9f86d081…b0f00a08', examName: 'NEET 2026 · Slot 1', count: 203, answerRoot: '0x7b34…e1aa', nodePubkey: 'a31c…77', chainValid: true, state: 'SYNCED' },
  { centreName: 'MH-VJTI', centreIdHash: '2c624232…1cf5b09f', examName: 'NEET 2026 · Slot 1', count: 188, answerRoot: '0x55c2…90df', nodePubkey: 'b2e0…41', chainValid: true, state: 'SYNCED' },
];

const ORDER: BundleState[] = ['SYNCED', 'VERIFIED', 'ANCHORED', 'DECRYPTED'];

export default function AnswerVaultPage() {
  const [bundles, setBundles] = useState(INITIAL);
  const [busy, setBusy] = useState<string | null>(null);

  function advance(idx: number, to: BundleState, patch: Partial<CentreBundle> = {}) {
    setBundles((b) => b.map((x, i) => (i === idx ? { ...x, state: to, ...patch } : x)));
  }

  async function verify(idx: number) {
    setBusy(bundles[idx].centreIdHash);
    await new Promise((r) => setTimeout(r, 400)); // POST /sys/ledger/ingest
    advance(idx, 'VERIFIED');
    setBusy(null);
  }
  async function anchor(idx: number) {
    setBusy(bundles[idx].centreIdHash);
    await new Promise((r) => setTimeout(r, 600)); // POST /sys/ledger/anchor
    advance(idx, 'ANCHORED', { anchorTx: '0x' + Math.random().toString(16).slice(2, 10) + '…' });
    setBusy(null);
  }
  async function decrypt(idx: number) {
    setBusy(bundles[idx].centreIdHash);
    await new Promise((r) => setTimeout(r, 700)); // POST /sys/ledger/decrypt (HSM)
    advance(idx, 'DECRYPTED');
    setBusy(null);
  }

  const stateColor = (s: BundleState) =>
    ({ SYNCED: '#fbbf24', VERIFIED: '#38bdf8', ANCHORED: '#a78bfa', DECRYPTED: '#4ade80' }[s]);

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'white', marginBottom: 8 }}>🔐 Answer Vault</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-400)', marginBottom: 6 }}>
        The only tier that can decrypt. Verify the chain → anchor the root → HSM-decrypt (§11.4).
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-navy-500)', marginBottom: 24 }}>
        The HSM holds the only unwrapping key — a compromised centre yields only ciphertext (INV-6).
        Anchors carry roots/counts/hashes only; never a roll, name, or DOB (§11.5 / DPDP).
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {bundles.map((b, idx) => (
          <div
            key={b.centreIdHash}
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-navy-700)', borderRadius: 16, padding: 20 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <span style={{ fontSize: 16, color: 'white', fontWeight: 600 }}>{b.centreName}</span>
              <span style={{ fontSize: 13, color: 'var(--color-navy-300)' }}>{b.examName}</span>
              <span style={{ fontSize: 13, color: 'var(--color-navy-300)' }}>· {b.count} sealed</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: stateColor(b.state), padding: '3px 10px', borderRadius: 999, border: `1px solid ${stateColor(b.state)}` }}>
                {b.state}
              </span>
            </div>

            {/* progress rail */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {ORDER.map((s) => (
                <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: ORDER.indexOf(b.state) >= ORDER.indexOf(s) ? stateColor(b.state) : 'var(--color-navy-700)' }} />
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 14, fontSize: 12 }}>
              <Field k="answer root" v={b.answerRoot} />
              <Field k="node pubkey" v={b.nodePubkey} />
              <Field k="chain re-walk" v={b.chainValid ? '✓ intact (INV-9)' : '✗ BROKEN'} color={b.chainValid ? '#4ade80' : '#f87171'} />
              {b.anchorTx && <Field k="polygon tx" v={b.anchorTx} />}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => verify(idx)} disabled={b.state !== 'SYNCED' || busy !== null} style={step(b.state === 'SYNCED')}>
                1 · Verify chain + node sig
              </button>
              <button onClick={() => anchor(idx)} disabled={b.state !== 'VERIFIED' || busy !== null} style={step(b.state === 'VERIFIED')}>
                2 · Anchor root (Polygon)
              </button>
              <button onClick={() => decrypt(idx)} disabled={b.state !== 'ANCHORED' || busy !== null} style={step(b.state === 'ANCHORED')}>
                3 · HSM decrypt → SA store
              </button>
            </div>

            {b.state === 'DECRYPTED' && (
              <p style={{ marginTop: 12, fontSize: 12, color: '#4ade80' }}>
                ✓ {b.count} answers decrypted into the System Admin store — the only plaintext copy.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div>
      <div style={{ color: 'var(--color-navy-500)', fontSize: 11 }}>{k}</div>
      <code style={{ color: color ?? 'var(--color-navy-200)', background: 'none', padding: 0, fontSize: 12 }}>{v}</code>
    </div>
  );
}

const step = (enabled: boolean): React.CSSProperties => ({
  padding: '9px 14px', borderRadius: 10, border: enabled ? 'none' : '1px solid var(--color-navy-700)',
  background: enabled ? '#4f46e5' : 'transparent', color: enabled ? 'white' : 'var(--color-navy-500)',
  fontSize: 12, fontWeight: 600, cursor: enabled ? 'pointer' : 'not-allowed',
});
