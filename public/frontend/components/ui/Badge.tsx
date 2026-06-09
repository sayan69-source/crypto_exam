/**
 * CryptoExam Core — Badge Component
 * Variants: on-chain, pending, locked, live, error, zk-verified, default
 */
import styles from './Badge.module.css';

export interface BadgeProps {
  variant?: 'default' | 'onchain' | 'pending' | 'locked' | 'live' | 'error' | 'zk' | 'info' | 'warning' | 'success';
  size?: 'sm' | 'md';
  pulse?: boolean;
  children: React.ReactNode;
}

export default function Badge({ variant = 'default', size = 'md', pulse, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[variant]} ${styles[size]} ${pulse ? styles.pulse : ''}`}>
      {children}
    </span>
  );
}
