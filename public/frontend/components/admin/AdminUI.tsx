/**
 * Shared building blocks for the admin console.
 *
 * Each admin page used to hand-roll its own header, card, table and
 * loading/error/empty states with inline style objects. That is why the console
 * looked unfinished next to the public site: not a bad theme, just fourteen
 * slightly different ones. These components are deliberately small and dumb —
 * they encode the layout decisions once so pages can be about their data.
 */
'use client';

import type { ReactNode } from 'react';
import s from './admin.module.css';

/* ── Page scaffold ──────────────────────────────────────────────────────── */

export function AdminPage({ children }: { children: ReactNode }) {
  return <div className={s.page}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  /** One line on what this page is for, or the live state of it. */
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={s.header}>
      <div className={s.headerText}>
        {eyebrow && <span className={s.eyebrow}>{eyebrow}</span>}
        <h1 className={s.title}>{title}</h1>
        {subtitle && <p className={s.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={s.headerActions}>{actions}</div>}
    </header>
  );
}

/* ── Surfaces ───────────────────────────────────────────────────────────── */

export function Card({
  children,
  title,
  actions,
  flush,
  className = '',
}: {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
  /** Use for tables, which bring their own edge padding. */
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`${s.card} ${flush ? s.cardTight : ''} ${className}`}>
      {title && (
        <div className={s.cardHead}>
          <h2 className={s.cardTitle}>{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function CardGrid({ children, minColumn }: { children: ReactNode; minColumn?: number }) {
  return (
    <div
      className={s.grid}
      style={minColumn ? ({ '--admin-min-col': `${minColumn}px` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card>
      <div className={s.stat}>
        <span className={s.statLabel}>{label}</span>
        <span className={s.statValue}>{value}</span>
        {hint && <span className={s.statHint}>{hint}</span>}
      </div>
    </Card>
  );
}

/* ── Table ──────────────────────────────────────────────────────────────── */

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const cellStrong = s.tdStrong;
export const cellMono = s.tdMono;
export const cellNum = s.tdNum;

/* ── Badge ──────────────────────────────────────────────────────────────── */

export type Tone = 'neutral' | 'info' | 'warn' | 'ok' | 'danger';

const TONE_CLASS: Record<Tone, string> = {
  neutral: s.badgeNeutral,
  info: s.badgeInfo,
  warn: s.badgeWarn,
  ok: s.badgeOk,
  danger: s.badgeDanger,
};

export function Badge({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`${s.badge} ${TONE_CLASS[tone]}`}>
      {dot && <span className={s.badgeDot} />}
      {children}
    </span>
  );
}

/**
 * Map a backend status string to a tone.
 *
 * Kept in one place so LOCKED means the same colour everywhere. Anything
 * unrecognised falls through to neutral rather than guessing — a status the UI
 * has not been taught about should look unremarkable, not alarming.
 */
export function toneForStatus(status: string): Tone {
  const v = status.toUpperCase();
  if (['ACTIVE', 'ONLINE', 'OK', 'HEALTHY', 'COMPLETED', 'ANSWERED', 'APPROVED', 'VERIFIED', 'CONFIRMED'].includes(v)) return 'ok';
  if (['LIVE', 'IN_REVIEW', 'GENERATING', 'PROOF_PENDING', 'PENDING', 'PENDING_APPROVAL', 'DISTRIBUTED'].includes(v)) return 'warn';
  if (['NEW', 'DRAFT', 'LOCKED', 'SCHEDULED'].includes(v)) return 'info';
  if (['OFFLINE', 'FAULT', 'REVOKED', 'ABORTED', 'FAILED', 'PAUSED', 'DENIED'].includes(v)) return 'danger';
  return 'neutral';
}

/* ── Toolbar ────────────────────────────────────────────────────────────── */

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className={s.toolbar}>{children}</div>;
}

export function Chip({
  active,
  count,
  onClick,
  children,
}: {
  active?: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className={`${s.chip} ${active ? s.chipActive : ''}`} onClick={onClick} aria-pressed={active}>
      {children}
      {count !== undefined && <span className={s.chipCount}>{count}</span>}
    </button>
  );
}

/* ── Buttons ────────────────────────────────────────────────────────────── */

export function Button({
  variant = 'default',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  const cls = variant === 'primary' ? s.btnPrimary : variant === 'danger' ? s.btnDanger : '';
  return <button {...props} className={`${s.btn} ${cls} ${props.className ?? ''}`} />;
}

export function LinkButton({
  variant = 'default',
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  const cls = variant === 'primary' ? s.btnPrimary : variant === 'danger' ? s.btnDanger : '';
  return <a {...props} className={`${s.btn} ${cls} ${props.className ?? ''}`} />;
}

/* ── The three states every data page needs ─────────────────────────────── */

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={`${s.state} ${s.stateError}`} role="alert">
      <span className={s.stateTitle}>Could not load this page</span>
      <span>{message}</span>
      {onRetry && (
        <Button onClick={onRetry} style={{ marginTop: 8 }}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className={s.state}>
      <span className={s.stateTitle}>{title}</span>
      {hint && <span>{hint}</span>}
    </div>
  );
}

/** Placeholder rows so a table does not collapse and reflow when data lands. */
export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c}>
              <div className={s.skeleton} style={{ width: c === 0 ? '55%' : '78%' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
