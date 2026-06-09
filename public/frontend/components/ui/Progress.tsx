/**
 * CryptoExam Core — Progress Component
 * Linear bar + Circular ring (for exam timer)
 */
import styles from './Progress.module.css';

interface ProgressBarProps {
  value: number; // 0-100
  variant?: 'navy' | 'saffron' | 'success' | 'danger';
  size?: 'sm' | 'md';
  label?: string;
}

export function ProgressBar({ value, variant = 'navy', size = 'md', label }: ProgressBarProps) {
  return (
    <div className={styles.barWrapper}>
      {label && <span className={styles.barLabel}>{label}</span>}
      <div className={`${styles.bar} ${styles[`bar-${size}`]}`}>
        <div
          className={`${styles.barFill} ${styles[`fill-${variant}`]}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

interface ProgressRingProps {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
  color?: string;
  children?: React.ReactNode;
}

export function ProgressRing({ value, size = 120, strokeWidth = 6, color, children }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className={styles.ringWrapper} style={{ width: size, height: size }}>
      <svg className={styles.ring} width={size} height={size}>
        <circle
          className={styles.ringBg}
          cx={size / 2} cy={size / 2} r={radius}
          strokeWidth={strokeWidth}
        />
        <circle
          className={styles.ringFill}
          cx={size / 2} cy={size / 2} r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={color ? { stroke: color } : undefined}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <div className={styles.ringContent}>{children}</div>}
    </div>
  );
}
