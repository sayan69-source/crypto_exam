/**
 * Tier-0 · the full notification history.
 *
 * The bell's drawer answers "what needs my attention now" and holds a dozen
 * rows. This page answers the other question, the one that gets asked after an
 * exam rather than during it: what actually happened, in order, and when was
 * each thing seen.
 *
 * What lands here is tier-0's alone — centre deliveries, refusals, credential
 * rotations, vault openings and anchors, plus the Centre Admin applications
 * only this tier may approve. The component is shared with the tier-1 console,
 * but the ROWS are not: the server scopes every query to the caller's role, so
 * the two consoles cannot see each other's feeds. See NotificationHistory.
 */
'use client';

import NotificationHistory from '@/components/admin/NotificationHistory';

export default function SysAdminNotificationsPage() {
  return <NotificationHistory />;
}
