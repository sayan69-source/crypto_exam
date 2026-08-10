/**
 * CryptoExam Core — Admin · Enquiries
 *
 * The HQ side of the public contact form. Until this page existed the form had
 * no destination at all: it set a "sent" flag in the browser and discarded the
 * message, so an examining body could request a briefing, be shown a
 * confirmation, and reach nobody. Wired to the live backend
 * (/admin/enquiries) — no mock data.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi, type Enquiry, type EnquiryStatus } from '@/lib/api/admin';

const STATUSES: EnquiryStatus[] = ['NEW', 'IN_REVIEW', 'ANSWERED', 'CLOSED'];

const STATUS_STYLE: Record<EnquiryStatus, { bg: string; fg: string; label: string }> = {
  NEW: { bg: 'rgba(37,99,235,0.10)', fg: '#1d4ed8', label: 'New' },
  IN_REVIEW: { bg: 'rgba(217,119,6,0.12)', fg: '#b45309', label: 'In review' },
  ANSWERED: { bg: 'rgba(5,150,105,0.12)', fg: '#047857', label: 'Answered' },
  CLOSED: { bg: 'rgba(100,116,139,0.14)', fg: '#475569', label: 'Closed' },
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
      .then((r) => {
        setItems(r.items);
        setCounts(r.counts);
      })
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

  return (
    <div style={{ animation: 'fadeIn 300ms ease forwards' }}>
      <h1 style={{ fontSize: 22, color: 'var(--color-navy-900)', marginBottom: 8 }}>Enquiries</h1>
      <p style={{ fontSize: 13, color: 'var(--color-navy-500)', marginBottom: 20 }}>
        {loading
          ? 'Loading enquiries…'
          : unanswered > 0
            ? `${unanswered} enquiry${unanswered === 1 ? '' : 's'} awaiting a reply.`
            : 'Everything here has been answered or closed.'}
      </p>

      {/* Filter — counts come from the backend, so the tabs are honest even
          when the current page is filtered. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {(['ALL', ...STATUSES] as const).map((sKey) => {
          const active = filter === sKey;
          const n = sKey === 'ALL'
            ? Object.values(counts).reduce((a, b) => a + b, 0)
            : counts[sKey] ?? 0;
          return (
            <button
              key={sKey}
              onClick={() => setFilter(sKey)}
              style={{
                padding: '7px 14px',
                borderRadius: 999,
                border: `1px solid ${active ? 'var(--color-navy-900)' : 'var(--border-soft)'}`,
                background: active ? 'var(--color-navy-900)' : '#fff',
                color: active ? '#fff' : 'var(--color-navy-600)',
                fontSize: 12.5,
                fontWeight: 550,
                cursor: 'pointer',
              }}
            >
              {sKey === 'ALL' ? 'All' : STATUS_STYLE[sKey].label}
              <span style={{ opacity: 0.65, marginLeft: 7 }}>{n}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: 16, marginBottom: 16, border: '1px solid rgba(200,32,32,0.35)', background: 'rgba(200,32,32,0.06)', borderRadius: 12, color: 'var(--color-danger)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', background: '#fff', border: '1px dashed var(--border-soft)', borderRadius: 12, color: 'var(--color-navy-400)', fontSize: 13.5 }}>
          No enquiries {filter === 'ALL' ? 'yet' : `with status ${STATUS_STYLE[filter as EnquiryStatus].label.toLowerCase()}`}.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((e) => {
          const open = openId === e.id;
          const style = STATUS_STYLE[e.status];
          return (
            <article
              key={e.id}
              style={{ background: '#fff', border: '1px solid var(--border-soft)', borderRadius: 12, overflow: 'hidden' }}
            >
              <button
                onClick={() => setOpenId(open ? null : e.id)}
                aria-expanded={open}
                style={{
                  width: '100%', display: 'grid',
                  gridTemplateColumns: 'minmax(0,2fr) minmax(0,2fr) auto auto',
                  gap: 16, alignItems: 'center', padding: '16px 18px',
                  background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-navy-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.fullName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-navy-500)' }}>{e.organisation ?? '—'}</div>
                </div>
                <div style={{ minWidth: 0, fontSize: 12.5, color: 'var(--color-navy-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.message}
                </div>
                <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11.5, color: 'var(--color-navy-400)' }}>
                  {e.reference}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--color-navy-400)' }}>{timeAgo(e.receivedAt)}</span>
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: style.bg, color: style.fg, fontSize: 11, fontWeight: 600 }}>
                    {style.label}
                  </span>
                </span>
              </button>

              {open && (
                <div style={{ padding: '0 18px 18px', borderTop: '1px solid var(--border-soft)' }}>
                  <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 18px', margin: '16px 0', fontSize: 13 }}>
                    <dt style={{ color: 'var(--color-navy-400)' }}>Email</dt>
                    <dd style={{ margin: 0 }}><a href={`mailto:${e.email}`} style={{ color: 'var(--color-navy-700)' }}>{e.email}</a></dd>
                    {e.phone && (<><dt style={{ color: 'var(--color-navy-400)' }}>Phone</dt><dd style={{ margin: 0 }}>{e.phone}</dd></>)}
                    {e.roleTitle && (<><dt style={{ color: 'var(--color-navy-400)' }}>Role</dt><dd style={{ margin: 0 }}>{e.roleTitle}</dd></>)}
                    <dt style={{ color: 'var(--color-navy-400)' }}>Topic</dt>
                    <dd style={{ margin: 0 }}>{e.topic}</dd>
                  </dl>

                  <p style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.65, color: 'var(--color-navy-700)', background: 'var(--color-bg-subtle, #f8fafc)', padding: 14, borderRadius: 10, margin: '0 0 16px' }}>
                    {e.message}
                  </p>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {STATUSES.filter((sx) => sx !== e.status).map((sx) => (
                      <button
                        key={sx}
                        disabled={busyId === e.id}
                        onClick={() => move(e, sx)}
                        style={{
                          padding: '7px 13px', borderRadius: 8,
                          border: '1px solid var(--border-soft)', background: '#fff',
                          color: 'var(--color-navy-700)', fontSize: 12.5, fontWeight: 550,
                          cursor: busyId === e.id ? 'wait' : 'pointer',
                        }}
                      >
                        Mark {STATUS_STYLE[sx].label.toLowerCase()}
                      </button>
                    ))}
                    <a
                      href={`mailto:${e.email}?subject=${encodeURIComponent(`Re: your enquiry ${e.reference}`)}`}
                      style={{ padding: '7px 13px', borderRadius: 8, border: '1px solid var(--color-navy-900)', background: 'var(--color-navy-900)', color: '#fff', fontSize: 12.5, fontWeight: 550, textDecoration: 'none' }}
                    >
                      Reply by email
                    </a>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
