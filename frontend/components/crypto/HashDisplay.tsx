/**
 * CryptoExam Core — HashDisplay Component
 * Truncated hash with copy button and Polygonscan link
 */
'use client';

import { useState, useCallback } from 'react';
import styles from './HashDisplay.module.css';

interface HashDisplayProps {
  hash: string;
  label?: string;
  polygonscanUrl?: string;
  variant?: 'light' | 'dark';
  full?: boolean;
}

const POLYGONSCAN_BASE = 'https://amoy.polygonscan.com/tx/';

export default function HashDisplay({ hash, label, polygonscanUrl, variant = 'light', full }: HashDisplayProps) {
  const [copied, setCopied] = useState(false);

  const truncated = full ? hash : hash.length > 20
    ? `${hash.slice(0, 10)}...${hash.slice(-8)}`
    : hash;

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [hash]);

  const scanUrl = polygonscanUrl || (hash.startsWith('0x') ? `${POLYGONSCAN_BASE}${hash}` : undefined);

  return (
    <div className={`${styles.wrapper} ${styles[variant]}`}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.hashRow}>
        <code className={styles.hash} title={hash}>{truncated}</code>
        <div className={styles.actions}>
          <button className={styles.btn} onClick={handleCopy} title="Copy full hash" aria-label="Copy hash">
            {copied ? '✓' : '📋'}
          </button>
          {scanUrl && (
            <a className={styles.btn} href={scanUrl} target="_blank" rel="noopener noreferrer" title="View on Polygonscan" aria-label="View on Polygonscan">
              ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
