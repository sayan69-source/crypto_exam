/**
 * CryptoExam Core — Input Component
 */
'use client';

import { forwardRef } from 'react';
import styles from './Input.module.css';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  variant?: 'light' | 'dark';
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, variant = 'light', className, id, ...props }, ref) => {
    const inputId = id || `input-${label?.toLowerCase().replace(/\s+/g, '-')}`;
    return (
      <div className={`${styles.wrapper} ${styles[variant]} ${className || ''}`}>
        {label && <label htmlFor={inputId} className={styles.label}>{label}</label>}
        <input
          ref={ref}
          id={inputId}
          className={`${styles.input} ${error ? styles.inputError : ''}`}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          {...props}
        />
        {error && <p id={`${inputId}-error`} className={styles.error}>{error}</p>}
        {hint && !error && <p id={`${inputId}-hint`} className={styles.hint}>{hint}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
