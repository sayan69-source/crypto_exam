/**
 * Tier-0 · the full notification history.
 *
 * The bell's drawer answers "what needs my attention now" and holds a dozen
 * rows. This page answers the other question, the one that gets asked after an
 * exam rather than during it: what actually happened, in order, and when was
 * each thing seen.
 *
 * That is why acknowledged rows stay here rather than disappearing. A feed that
 * deletes what it has shown you cannot answer "when did centre 7's papers
 * arrive, and how long did it take anyone to notice" — which is precisely the
 * question an audit asks. Acknowledgement changes how a row LOOKS; it never
 * removes it.
 *
 * The counters at the top are derived from the same rows the list renders, so
 * the summary and the evidence for it can never disagree.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdminPage, PageHeader, Card, CardGrid, Stat, Button, ErrorState, EmptyState,
} from '@/components/admin/AdminUI';
import { NotificationRow } from '@/components/admin/NotificationBell';
import {
  notificationsApi,
  type AppNotification, type NotificationKind,
} from '@/lib/api/notifications';
import s from './NotificationHistory.module.css';

const POLL_MS = 15_000;

/**
 * Every kind either feed can carry, in the order its journey happens.
 *
 * Both consoles render this same component, and each only ever sees the kinds
 * addressed to its own role — the filter chips below are built from the rows
 * that actually came back, so a console never offers a filter that would
 * return nothing.
 */
const KIND_LABEL: Record<NotificationKind, string> = {
  // the public site → whoever holds the approval
  STAFF_REGISTRATION_SUBMITTED: 'Application received',
  STAFF_REGISTRATION_APPROVED: 'Application approved',
  CANDIDATE_ENROLLED: 'Candidate enrolled',
  // the centre uplink → tier-0
  CENTRE_CREDENTIAL_ISSUED: 'Credential issued',
  CENTRE_DELIVERY_RECEIVED: 'Delivery received',
  CENTRE_DELIVERY_REJECTED: 'Delivery refused',
  SEALED_RECORDS_OPENED: 'Records opened',
  ANSWER_ROOT_ANCHORED: 'Root anchored',
};

type Filter = 'all' | 'unread' | NotificationKind;

export default function NotificationHistory() {
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const first = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Always fetch the whole feed and filter in the browser: the counters
      // must describe the same set the list is drawn from, and a server-side
      // filter would make them describe different ones.
      const r = await notificationsApi.list({ limit: 200 });
      setRows(r.notifications);
      setUnread(r.unread);
      setLastSync(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the notification history');
    } finally {
      setLoading(false);
      first.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function acknowledge(id: string) {
    setBusyId(id);
    try {
      const r = await notificationsApi.markRead(id);
      setRows((xs) => xs.map((x) => (x.id === id ? r.notification : x)));
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
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not acknowledge the feed');
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => {
    const byKind = {} as Record<NotificationKind, number>;
    for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    return byKind;
  }, [rows]);

  const shown = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'unread') return rows.filter((r) => !r.read);
    return rows.filter((r) => r.kind === filter);
  }, [rows, filter]);

  // The third stat is whichever number this console's feed actually has one
  // for, rather than a fixed column that reads zero on the console it does not
  // apply to. Tier-0's feed is about sealed records moving; tier-1's is about
  // people arriving. Both are counted from the EVENTS, not recomputed from the
  // vault or the roster, so the summary and the rows below it are the same
  // data and cannot disagree.
  const delivered = rows
    .filter((r) => r.kind === 'CENTRE_DELIVERY_RECEIVED')
    .reduce((n, r) => n + (Number(r.payload?.stored) || 0), 0);
  const refused = counts.CENTRE_DELIVERY_REJECTED ?? 0;
  const isUplinkFeed = delivered > 0 || refused > 0 || Boolean(counts.CENTRE_CREDENTIAL_ISSUED);

  const people = (counts.STAFF_REGISTRATION_SUBMITTED ?? 0) + (counts.CANDIDATE_ENROLLED ?? 0);
  const approved = counts.STAFF_REGISTRATION_APPROVED ?? 0;

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Cross-feature event log"
        title="Notifications"
        subtitle={
          loading && first.current
            ? 'Loading…'
            : `${rows.length} event(s) · ${unread} unacknowledged — everything raised for this console, in order`
        }
        actions={
          <>
            {lastSync && (
              <span style={{ fontSize: 11.5, color: 'var(--color-navy-400)' }}>
                updated {lastSync.toLocaleTimeString('en-IN', { hour12: false })}
              </span>
            )}
            {unread > 0 && (
              <Button onClick={acknowledgeAll} disabled={busyId === 'all'}>
                {busyId === 'all' ? 'Working…' : 'Mark all read'}
              </Button>
            )}
            <Button onClick={() => load()} disabled={loading}>Refresh</Button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={() => load()} />}

      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <CardGrid minColumn={200}>
          <Stat label="Unacknowledged" value={unread} />
          {isUplinkFeed ? (
            <>
              <Stat label="Sealed records delivered" value={delivered} hint="counted from the events themselves" />
              <Stat
                label="Deliveries refused"
                value={refused}
                hint={refused ? 'a refused bundle stored nothing' : undefined}
              />
            </>
          ) : (
            <>
              <Stat label="People arrived" value={people} hint="applications and enrolments" />
              <Stat
                label="Applications approved"
                value={approved}
                hint={approved ? 'code issued, redeemed in person' : undefined}
              />
            </>
          )}
          <Stat label="Events recorded" value={rows.length} />
        </CardGrid>
      </div>

      <Card flush>
        <div className={s.filters} role="tablist" aria-label="Filter the feed">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            All ({rows.length})
          </FilterChip>
          <FilterChip active={filter === 'unread'} onClick={() => setFilter('unread')}>
            Unacknowledged ({unread})
          </FilterChip>
          {(Object.keys(KIND_LABEL) as NotificationKind[])
            .filter((k) => counts[k])
            .map((k) => (
              <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)}>
                {KIND_LABEL[k]} ({counts[k]})
              </FilterChip>
            ))}
        </div>

        {!loading && shown.length === 0 && (
          <EmptyState
            title={rows.length === 0 ? 'No events yet' : 'Nothing matches that filter'}
            hint={
              rows.length === 0
                ? 'A centre’s Admin Station syncs unattended. When one delivers its sealed answers, refuses a bundle, or has its credential rotated, it is recorded here — whether or not anyone is watching at the time.'
                : 'Clear the filter to see the whole feed.'
            }
          />
        )}

        {shown.length > 0 && (
          <ul className={s.list}>
            {shown.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                busy={busyId === n.id}
                onAcknowledge={acknowledge}
              />
            ))}
          </ul>
        )}
      </Card>

      <p className={s.note}>
        Acknowledged events are kept, not deleted — &ldquo;when did this arrive, and how long
        before anyone saw it&rdquo; is a question an audit asks after the exam, not during it.
        This feed is scoped to your role by the server: there is no setting here that widens
        it, and another console&rsquo;s events are not merely hidden from this page, they are
        never sent to it. Nothing here carries biometric material, an activation code, or
        any answer content.
      </p>
    </AdminPage>
  );
}

function FilterChip({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      className={`${s.chip} ${active ? s.chipOn : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
