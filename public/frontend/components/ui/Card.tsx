/**
 * CryptoExam Core — Card Component
 */
import styles from './Card.module.css';

export interface CardProps {
  variant?: 'default' | 'dark' | 'crypto' | 'glass';
  padding?: 'sm' | 'md' | 'lg';
  hover?: boolean;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}

export default function Card({ variant = 'default', padding = 'md', hover, className, children, onClick }: CardProps) {
  return (
    <div
      className={`${styles.card} ${styles[variant]} ${styles[`pad-${padding}`]} ${hover ? styles.hover : ''} ${className || ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}
