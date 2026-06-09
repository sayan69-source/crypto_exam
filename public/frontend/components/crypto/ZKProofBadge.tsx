/**
 * CryptoExam Core — ZKProofBadge Component
 * Shows verified/pending/failed state with tooltip explanation
 */
import styles from './ZKProofBadge.module.css';

interface ZKProofBadgeProps {
  status: 'verified' | 'pending' | 'failed' | 'generating';
  txHash?: string;
  size?: 'sm' | 'md' | 'lg';
}

const STATUS_CONFIG = {
  verified: { icon: '✅', label: 'ZK Proof Verified', className: 'verified' },
  pending: { icon: '⏳', label: 'Proof Pending', className: 'pending' },
  failed: { icon: '❌', label: 'Proof Failed', className: 'failed' },
  generating: { icon: '⚙️', label: 'Generating Proof...', className: 'generating' },
};

export default function ZKProofBadge({ status, txHash, size = 'md' }: ZKProofBadgeProps) {
  const config = STATUS_CONFIG[status];
  const polygonscanUrl = txHash ? `https://amoy.polygonscan.com/tx/${txHash}` : undefined;

  return (
    <div className={`${styles.badge} ${styles[config.className]} ${styles[size]}`}>
      <span className={styles.icon}>{config.icon}</span>
      <span className={styles.label}>{config.label}</span>
      {polygonscanUrl && (
        <a href={polygonscanUrl} target="_blank" rel="noopener noreferrer" className={styles.link} aria-label="View on Polygonscan">
          ↗
        </a>
      )}
      <div className={styles.tooltip}>
        <p><strong>Zero-Knowledge Proof (Groth16)</strong></p>
        <p>A mathematical proof that this exam paper has exactly the right difficulty distribution — verified by anyone, without revealing a single question.</p>
        {status === 'verified' && <p>✅ Independently verifiable on Polygon blockchain.</p>}
      </div>
    </div>
  );
}
