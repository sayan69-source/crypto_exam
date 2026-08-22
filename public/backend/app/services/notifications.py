"""
Raising a notification — the one way a feature tells another feature something
happened.

WHY A SERVICE AND NOT ``db.add(Notification(...))`` AT EACH CALL SITE
---------------------------------------------------------------------
Because the interesting rules are not in the row, they are in when NOT to write
one. Two of them are load-bearing here:

  * **A retry is not an event.** ``/centre-sync/ledger`` is idempotent by
    design: a courier whose window shut mid-POST re-sends the whole bundle on
    its next tick, and the endpoint answers ``stored=0, duplicate=N``. That is
    the *same* delivery arriving again, not a second delivery. Writing a row
    each time would put the tier-0 console's badge into a permanent climb driven
    by a retry loop nobody can see — the notification equivalent of a stuck
    alarm, which trains an operator to ignore the badge that matters.
  * **A notification must not outlive its own event.** These rows are added to
    the CALLER'S session and committed by the caller's own ``commit()``. So a
    delivery that rolls back takes its notification with it. The alternative —
    committing the notification separately — produces "487 records arrived" on
    a console whose database holds none, and for a platform whose entire claim
    is that its reported state is real, a notification feed that can lie about
    what happened is worse than having no feed.

The corollary of that second rule is the constraint on every caller: `notify`
does NOT commit. It stages a row and returns it. If you call this and never
commit, nothing was raised — which is the correct behaviour when the operation
you were reporting also failed to commit.

DPDP: `payload` is for counts, hashes and record identifiers. Nothing that
names a candidate — no roll number, no seat, no answer content — goes in it.
The events this carries are about sealed ciphertext moving between custodians;
the row describes the movement, never the contents.
"""

import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Notification,
    NotificationKind,
    NotificationSeverity,
    UserRole,
)

logger = logging.getLogger(__name__)


def notify(
    db: AsyncSession,
    *,
    kind: NotificationKind,
    recipient_role: UserRole | str,
    title: str,
    source_feature: str,
    body: str | None = None,
    subject_type: str | None = None,
    subject_id: str | None = None,
    payload: dict[str, Any] | None = None,
    severity: NotificationSeverity = NotificationSeverity.INFO,
) -> Notification:
    """Stage one notification on ``db``. The CALLER commits it.

    Returns the staged row so a caller can assert on it in a test without
    re-querying. Nothing is flushed here — staging must not force a partial
    write of whatever else the caller has pending.
    """
    role = recipient_role.value if isinstance(recipient_role, UserRole) else str(recipient_role)

    row = Notification(
        kind=kind,
        severity=severity,
        recipient_role=role,
        title=title[:200],
        body=body,
        source_feature=source_feature,
        subject_type=subject_type,
        subject_id=str(subject_id) if subject_id is not None else None,
        payload=payload or {},
    )
    db.add(row)
    logger.info(
        "notification staged: kind=%s role=%s subject=%s/%s",
        kind.value, role, subject_type, subject_id,
    )
    return row


async def unread_count(db: AsyncSession, recipient_role: UserRole | str) -> int:
    """How many unread rows this duty is holding.

    Its own query rather than ``len(await feed(...))`` because this is what the
    badge polls: it runs on an interval, for every operator with the console
    open, and must not pay for the rows it is only counting.
    """
    role = recipient_role.value if isinstance(recipient_role, UserRole) else str(recipient_role)
    return (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.recipient_role == role, Notification.read_at.is_(None))
        )
    ).scalar_one()
