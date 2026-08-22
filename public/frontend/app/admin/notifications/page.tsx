/**
 * Tier-1 · the admin console's notification history.
 *
 * The same component the tier-0 console renders, and deliberately so: one feed
 * implementation, one set of behaviours, no second copy to drift. What differs
 * is entirely server-side — every query is scoped to the caller's role, so
 * what arrives here is what an ADMIN is supposed to see: candidate enrolments
 * from the public site, and the Invigilator applications this tier holds.
 *
 * A tier-1 administrator cannot see which centre's sealed papers arrived, and
 * cannot see the Centre Admin approval queue that belongs to tier-0. Those
 * rows are not hidden by this page — they are never sent to it.
 */
'use client';

import NotificationHistory from '@/components/admin/NotificationHistory';

export default function AdminNotificationsPage() {
  return <NotificationHistory />;
}
