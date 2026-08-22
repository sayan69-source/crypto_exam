/**
 * CryptoExam Core — Admin · Enquiries
 *
 * The HQ side of the public contact form. Until this existed the form had no
 * destination: it set a "sent" flag in the browser and discarded the message,
 * so an examining body could request a briefing, see a confirmation, and reach
 * nobody. Wired to the live backend (/admin/enquiries) — no mock data.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi, type Enquiry, type EnquiryStatus } from '@/lib/api/admin';
import {
  AdminPage, PageHeader, Card, Badge, Toolbar, Chip, Button, LinkButton,
  Table, ErrorState, EmptyState, SkeletonRows, toneForStatus,
  cellMono, cellStrong,
} from '@/components/admin/AdminUI';

const STATUSES: EnquiryStatus[] = ['NEW', 'IN_REVIEW', 'ANSWERED', 'CLOSED'];
const LABEL: Record<EnquiryStatus, string> = {
  NEW: 'New', IN_REVIEW: 'In review', ANSWERED: 'Answered', CLOSED: 'Closed',
};

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export default function AdminEnquiriesPage() {
  const [items, setItems] = useState<Enquiry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<EnquiryStatus | 'ALL'>('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi
      .enquiries(filter === 'ALL' ? undefined : filter)
      .then((r) => { setItems(r.items); setCounts(r.counts); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load enquiries'))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(load, [load]);

  async function move(e: Enquiry, status: EnquiryStatus) {
    setBusyId(e.id);
    try {
      await adminApi.updateEnquiry(e.id, status);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the enquiry');
    } finally {
      setBusyId(null);
    }
  }

  const unanswered = useMemo(() => (counts.NEW ?? 0) + (counts.IN_REVIEW ?? 0), [counts]);
  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);

  return (
    <AdminPage>
      <PageHeader
        eyebrow="Public channel"
        title="Enquiries"
        subtitle={
          loading
            ? 'Loading enquiries…'
            : unanswered > 0
              ? `${unanswered} awaiting a reply. Everything sent through the public contact form arrives here.`
              : 'Everything has been answered or closed.'
        }
        actions={<Button onClick={load} disabled={loading}>Refresh</Button>}
      />

      <Toolbar>
        <Chip active={filter === 'ALL'} count={total} onClick={() => setFilter('ALL')}>All</Chip>
        {STATUSES.map((st) => (
          <Chip key={st} active={filter === st} count={counts[st] ?? 0} onClick={() => setFilter(st)}>
            {LABEL[st]}
          </Chip>
        ))}
      </Toolbar>

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && (
        <Card flush>
          <Table head={['Enquirer', 'Organisation', 'Reference', 'Received', 'Status', '']}>
            {loading && <SkeletonRows rows={4} cols={6} />}

            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 0, borderBottom: 0 }}>
                  <EmptyState
                    title={filter === 'ALL' ? 'No enquiries yet' : `Nothing ${LABEL[filter as EnquiryStatus].toLowerCase()}`}
                    hint="Submissions from the public contact form appear here immediately."
                  />
                </td>
              </tr>
            )}

            {!loading && items.map((e) => (
              <FragmentRow
                key={e.id}
                enquiry={e}
                open={openId === e.id}
                busy={busyId === e.id}
                onToggle={() => setOpenId(openId === e.id ? null : e.id)}
                onMove={move}
              />
            ))}
          </Table>
        </Card>
      )}
    </AdminPage>
  );
}

function FragmentRow({
  enquiry: e, open, busy, onToggle, onMove,
}: {
  enquiry: Enquiry;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onMove: (e: Enquiry, s: EnquiryStatus) => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td className={cellStrong}>{e.fullName}</td>
        <td>{e.organisation ?? '—'}</td>
        <td className={cellMono}>{e.reference}</td>
        <td>{timeAgo(e.receivedAt)}</td>
        <td><Badge tone={toneForStatus(e.status)} dot>{LABEL[e.status]}</Badge></td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <Button onClick={(ev) => { ev.stopPropagation(); onToggle(); }} aria-expanded={open}>
            {open ? 'Hide' : 'Open'}
          </Button>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={6} style={{ background: 'color-mix(in srgb, var(--color-navy-900) 2%, transparent)' }}>
            <div style={{ display: 'grid', gap: 14, maxWidth: 760 }}>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
                <span><strong>Email </strong><a href={`mailto:${e.email}`}>{e.email}</a></span>
                {e.phone && <span><strong>Phone </strong>{e.phone}</span>}
                {e.roleTitle && <span><strong>Role </strong>{e.roleTitle}</span>}
                <span><strong>Topic </strong>{e.topic}</span>
              </div>

              <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, margin: 0 }}>{e.message}</p>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {STATUSES.filter((st) => st !== e.status).map((st) => (
                  <Button key={st} disabled={busy} onClick={() => onMove(e, st)}>
                    Mark {LABEL[st].toLowerCase()}
                  </Button>
                ))}
                <LinkButton
                  variant="primary"
                  href={`mailto:${e.email}?subject=${encodeURIComponent(`Re: your enquiry ${e.reference}`)}`}
                >
                  Reply by email
                </LinkButton>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
