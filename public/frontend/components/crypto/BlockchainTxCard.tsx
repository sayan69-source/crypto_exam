/**
 * CryptoExam Core — BlockchainTxCard Component
 * Shows TX hash, status badge, decoded event, and Polygonscan link
 */
import styles from './BlockchainTxCard.module.css';
import type { BlockchainEvent } from '@/lib/api/types';

const STATUS_LABELS: Record<string, string> = {
  confirmed: '✓ Confirmed',
  pending: '… Pending',
  unconfirmed: '○ Unconfirmed',
  failed: '✗ Failed',
};

export default function BlockchainTxCard({ event }: { event: BlockchainEvent }) {
  const truncatedHash = `${event.tx_hash.slice(0, 10)}...${event.tx_hash.slice(-8)}`;
  const formattedTime = new Date(event.timestamp).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });

  return (
    <div className={`${styles.card} ${styles[event.status]}`}>
      <div className={styles.header}>
        <span className={styles.type}>{event.type}</span>
        <span className={`${styles.status} ${styles[`status-${event.status}`]}`}>
          {STATUS_LABELS[event.status]}
        </span>
      </div>
      <div className={styles.details}>
        <div className={styles.row}>
          <span className={styles.label}>TX</span>
          <a
            href={`https://amoy.polygonscan.com/tx/${event.tx_hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.txLink}
          >
            <code>{truncatedHash}</code> ↗
          </a>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Block</span>
          <span className={styles.value}>#{event.block_number.toLocaleString()}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Time</span>
          <span className={styles.value}>{formattedTime} IST</span>
        </div>
      </div>
    </div>
  );
}
