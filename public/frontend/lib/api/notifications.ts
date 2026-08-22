/**
 * The cross-feature notification feed.
 *
 * Every call here is scoped server-side to the caller's role — there is no
 * `role` parameter to pass and none to forge. What comes back is whatever the
 * duty behind the current token is supposed to see.
 *
 * `summary()` exists separately from `list()` on purpose: it is what the badge
 * polls on an interval, so it counts rows instead of returning them. Rendering
 * the drawer is the only thing that pays for the list.
 */
import { getAuthToken } from './client';
import { describeApiError } from './errors';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

async function call<T>(method: string, path: string): Promise<T> {
  const token = getAuthToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/notifications${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new Error(`Cannot reach the API at ${API_BASE}. Is the backend running?`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(describeApiError(json, res.status));
  return json as T;
}

/**
 * Mirrors `NotificationKind` in the backend's models. Both consoles share this
 * union even though neither ever receives all of it — the server decides which
 * kinds reach which role, and a client-side split would be a second place for
 * that rule to live and drift out of step with the real one.
 */
export type NotificationKind =
  // the centre uplink and the answer vault → tier-0
  | 'CENTRE_DELIVERY_RECEIVED'
  | 'CENTRE_DELIVERY_REJECTED'
  | 'CENTRE_CREDENTIAL_ISSUED'
  | 'SEALED_RECORDS_OPENED'
  | 'ANSWER_ROOT_ANCHORED'
  // the public site and the approvals queue → whoever holds the approval
  | 'STAFF_REGISTRATION_SUBMITTED'
  | 'STAFF_REGISTRATION_APPROVED'
  | 'CANDIDATE_ENROLLED';

export type NotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  /** Which feature raised it, e.g. `centre-uplink`. */
  sourceFeature: string;
  subjectType: string | null;
  subjectId: string | null;
  /**
   * Counts and hashes describing the event. Never personal data — the server
   * will not put a candidate's name, roll or seat in here.
   */
  payload: Record<string, unknown>;
  read: boolean;
  readAt: string | null;
  createdAt: string | null;
}

export interface NotificationFeed {
  ok: boolean;
  role: string;
  unread: number;
  count: number;
  notifications: AppNotification[];
}

export interface NotificationSummary {
  ok: boolean;
  role: string;
  unread: number;
  latest: AppNotification | null;
}

export const notificationsApi = {
  list: (opts?: { unreadOnly?: boolean; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.unreadOnly) q.set('unread_only', 'true');
    if (opts?.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return call<NotificationFeed>('GET', qs ? `?${qs}` : '');
  },
  /** Cheap enough to poll. Counts rows rather than returning them. */
  summary: () => call<NotificationSummary>('GET', '/summary'),
  markRead: (id: string) =>
    call<{ ok: boolean; notification: AppNotification; unread: number }>('POST', `/${id}/read`),
  markAllRead: () =>
    call<{ ok: boolean; acknowledged: number; unread: number }>('POST', '/read-all'),
};

/** How long ago, in the shorthand an operations console uses. */
export function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}
