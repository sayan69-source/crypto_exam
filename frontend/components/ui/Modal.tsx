/**
 * CryptoExam Core — Modal Component
 * Focus trap, ARIA dialog, backdrop dismiss, reduced-motion safe
 */
'use client';

import { useEffect, useRef, useCallback } from 'react';
import styles from './Modal.module.css';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'full';
  danger?: boolean;
  children: React.ReactNode;
}

export default function Modal({ isOpen, onClose, title, size = 'md', danger, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      previousFocus.current = document.activeElement as HTMLElement;
      dialog.showModal();
    } else {
      dialog.close();
      previousFocus.current?.focus();
    }
  }, [isOpen]);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === dialogRef.current) onClose();
  }, [onClose]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles[size]}`}
      onClick={handleBackdrop}
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <div className={styles.content}>
        {title && (
          <div className={`${styles.header} ${danger ? styles.danger : ''}`}>
            <h2 id="modal-title" className={styles.title}>{title}</h2>
            <button className={styles.close} onClick={onClose} aria-label="Close dialog">✕</button>
          </div>
        )}
        <div className={styles.body}>{children}</div>
      </div>
    </dialog>
  );
}
