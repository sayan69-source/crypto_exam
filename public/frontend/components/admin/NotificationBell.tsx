/**
 * The tier-0 header's notification bell.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The centre uplink is driven by a courier daemon with no operator and no
 * session — it syncs when the centre's window opens, frequently out of hours.
 * Before this, a delivery landing produced a log line on the server and a row
 * count that changed only if somebody happened to press Refresh afterwards. An
 * operator could arrive to a console that looked identical whether nothing had
 * happened overnight or every centre in the state had delivered.
 *
 * So the bell polls a COUNT, not a list: `/notifications/summary` counts rows
 * server-side, and the drawer below is the only thing that pays to fetch them.
 * At a 15s interval on every open console that difference is the whole cost of
 * the feature.
 *
 * The badge counts UNREAD, which is why the read state lives in the database
 * rather than in this component: an operator who acknowledged a delivery at
 * 02:00 must not be shown it again by their relief's browser at 08:00, and a
 * page reload must not resurrect it either.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '@/components/marketing/LucideIcon';
import {
  notificationsApi, timeAgo,
  type AppNotification, type NotificationSeverity,
} from '@/lib/api/notifications';
import s from './NotificationBell.module.css';

/** Matches the tier-0 approvals poll, so the console updates as one thing. */
const POLL_MS = 15_000;

const SEVERITY_ICON: Record<NotificationSeverity, string> = {
  INFO: 'info',
  SUCCESS: 'check-circle-2',
  WARNING: 'alert-triangle',
  CRITICAL: 'shield-alert',
};

export function severityClass(sev: NotificationSeverity): string {
  return s[`sev${sev.charAt(0)}${sev.slice(1).toLowerCase()}`] ?? '';
}

export function NotificationRow({
  n, onAcknowledge, busy,
}: {
  n: AppNotification;
  onAcknowledge?: (id: string) => void;
  busy?: boolean;
}) {
  return (
    <li className={`${s.row} ${n.read ? s.rowRead : ''}`}>
      <span className={`${s.dot} ${severityClass(n.severity)}`} aria-hidden>
        <Icon name={SEVERITY_ICON[n.severity]} size={14} strokeWidth={1.9} />
      </span>

      <div className={s.rowBody}>
        <div className={s.rowTop}>
          <span className={s.rowTitle}>{n.title}</span>
          <time className={s.rowTime} dateTime={n.createdAt ?? undefined}
                title={n.createdAt ? new Date(n.createdAt).toLocaleString('en-IN') : undefined}>
            {timeAgo(n.createdAt)}
          </time>
        </div>

        {n.body && <p className={s.rowText}>{n.body}</p>}

        <div className={s.rowMeta}>
          <span className={s.source}>{n.sourceFeature}</span>
          {typeof n.payload?.stored === 'number' && (
            <span className={s.chip}>{String(n.payload.stored)} stored</span>
          )}
          {typeof n.payload?.duplicate === 'number' && Number(n.payload.duplicate) > 0 && (
            <span className={s.chip}>{String(n.payload.duplicate)} duplicate</span>
          )}
          {typeof n.payload?.quarantined === 'number' && Number(n.payload.quarantined) > 0 && (
            <span className={`${s.chip} ${s.chipWarn}`}>{String(n.payload.quarantined)} quarantined</span>
          )}
          {typeof n.payload?.reason === 'string' && (
            <span className={`${s.chip} ${s.chipCrit}`}>{String(n.payload.reason)}</span>
          )}
          {n.read && n.readAt && (
            <span className={s.ack} title={new Date(n.readAt).toLocaleString('en-IN')}>
              acknowledged {timeAgo(n.readAt)}
            </span>
          )}
          {!n.read && onAcknowledge && (
            <button className={s.ackBtn} disabled={busy} onClick={() => onAcknowledge(n.id)}>
              {busy ? 'Acknowledging…' : 'Acknowledge'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);

  // Both consoles mount this component, and each has its own history route.
  // Taken from the path rather than the session role because the path is what
  // the reader is actually looking at — a link that navigated tier-0 into the
  // tier-1 console would bounce off that console's own role gate.
  const pathname = usePathname();
  const historyHref = pathname?.startsWith('/sysadmin')
    ? '/sysadmin/notifications'
    : '/admin/notifications';

  const poll = useCallback(async () => {
    try {
      const r = await notificationsApi.summary();
      setUnread(r.unread);
      setLastPoll(new Date());
      setError(null);
    } catch {
      // A failed count must not invent one, and must not blank the last real
      // value either — the operator would read zero as "nothing happened".
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await notificationsApi.list({ limit: 12 });
      setItems(r.notifications);
      setUnread(r.unread);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  // Only fetch rows while the drawer is actually showing them.
  useEffect(() => {
    if (!open) return;
    loadList();
    const t = setInterval(loadList, POLL_MS);
    return () => clearInterval(t);
  }, [open, loadList]);

  // Click-away and Escape, because a drawer pinned open over the console is
  // worse than no drawer.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function acknowledge(id: string) {
    setBusyId(id);
    try {
      const r = await notificationsApi.markRead(id);
      setItems((xs) => xs.map((x) => (x.id === id ? r.notification : x)));
      setUnread(r.unread);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not acknowledge that');
    } finally {
      setBusyId(null);
    }
  }

  async function acknowledgeAll() {
    setBusyId('all');
    try {
      await notificationsApi.markAllRead();
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not acknowledge the feed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={s.wrap} ref={wrap}>
      <button
        className={s.bell}
        aria-label={unread ? `${unread} unread notification(s)` : 'Notifications'}
        aria-expanded={open}
        title={lastPoll ? `Checked ${lastPoll.toLocaleTimeString('en-IN', { hour12: false })}` : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={17} strokeWidth={1.8} />
        {unread > 0 && <span className={s.badge}>{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className={s.drawer} role="dialog" aria-label="Notifications">
          <div className={s.head}>
            <span className={s.headTitle}>
              Notifications
              {unread > 0 && <span className={s.headCount}>{unread} unread</span>}
            </span>
            {unread > 0 && (
              <button className={s.linkBtn} disabled={busyId === 'all'} onClick={acknowledgeAll}>
                {busyId === 'all' ? 'Working…' : 'Mark all read'}
              </button>
            )}
          </div>

          {error && <p className={s.err}>{error}</p>}

          {loading && items.length === 0 && <p className={s.empty}>Loading…</p>}

          {!loading && items.length === 0 && !error && (
            <p className={s.empty}>
              Nothing yet. Deliveries from a centre&rsquo;s Admin Station appear here
              the moment they land, whether or not anyone is watching.
            </p>
          )}

          {items.length > 0 && (
            <ul className={s.list}>
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  busy={busyId === n.id}
                  onAcknowledge={acknowledge}
                />
              ))}
            </ul>
          )}

          <div className={s.foot}>
            <Link href={historyHref} onClick={() => setOpen(false)}>
              Full history →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
