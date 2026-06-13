/**
 * CryptoExam Core — Admin Blockchain Page
 */
'use client';

import { mockBlockchainEvents, mockIntegrityReport, mockExams } from '@/lib/api/mock-data';
import BlockchainTxCard from '@/components/crypto/BlockchainTxCard';

export default function AdminBlockchainPage() {
  const report = mockIntegrityReport;

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'white', marginBottom: 8 }}>Blockchain Audit</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-400)', marginBottom: 32 }}>Polygon Amoy PoS — All events decoded and verified</p>

      {/* Integrity Check */}
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-navy-700)', borderRadius: 16, padding: 24, marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, color: 'var(--color-navy-200)', marginBottom: 16 }}>Integrity Verification — {mockExams[0].name}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {report.details.map((check, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: `3px solid ${check.passed ? '#4ade80' : '#f87171'}` }}>
              <span style={{ fontSize: 16 }}>{check.passed ? '✓' : '✗'}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, color: 'var(--color-navy-200)', fontWeight: 500, display: 'block' }}>{check.label}</span>
                {check.detail && <span style={{ fontSize: 11, color: 'var(--color-navy-400)' }}>{check.detail}</span>}
              </div>
              {check.tx_hash && (
                <code style={{ fontSize: 11, color: 'var(--color-navy-400)', background: 'none', padding: 0 }}>{check.tx_hash}</code>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 12, background: report.overall_verdict === 'INTEGRITY_VERIFIED' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', textAlign: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: report.overall_verdict === 'INTEGRITY_VERIFIED' ? '#4ade80' : '#f87171' }}>
            {report.overall_verdict === 'INTEGRITY_VERIFIED' ? '✓ INTEGRITY VERIFIED' : '✗ INTEGRITY FAILURE'}
          </span>
        </div>
      </div>

      {/* Transaction Feed */}
      <h2 style={{ fontSize: 16, color: 'var(--color-navy-200)', marginBottom: 16 }}>Transaction Feed</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mockBlockchainEvents.map(event => (
          <BlockchainTxCard key={event.tx_hash} event={event} />
        ))}
      </div>
    </div>
  );
}
