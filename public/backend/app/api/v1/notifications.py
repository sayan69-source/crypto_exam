"""
CryptoExam Core — Notifications.

  GET  /api/v1/notifications           — this duty's feed (newest first)
  GET  /api/v1/notifications/summary   — unread count only; what the badge polls
  POST /api/v1/notifications/{id}/read — mark one read
  POST /api/v1/notifications/read-all  — mark the whole feed read

SCOPED BY ROLE, NOT BY USER
---------------------------
Every route here reads ``current_user["role"]`` and can see only rows addressed
to that role. There is no ``?role=`` parameter and no way to ask for another
duty's feed, because the alternative — trusting a query string — would let any
authenticated candidate read tier-0's operational feed by editing a URL.

Role rather than user id is the deliberate choice. The audience for "a centre
just delivered its sealed papers" is whoever is holding tier-0 right now, not
one named administrator who may be off shift; addressing it to a person means
the event is invisible to their relief. The cost of that choice is honest and
worth naming: marking a notification read marks it read for the whole duty, so
this is a shared inbox, not a personal one. That is the correct model for an
operations console and the wrong one for personal mail — no personal mail goes
through here.

READ STATE IS THE POINT
-----------------------
The platform already had ways to show a live number (a WebSocket frame, a
poll). What it had no way to express was "this happened while you were not
looking, and you have not dealt with it yet" — which is the only question that
matters for a courier that syncs unattended at 03:00. ``read_at`` is what makes
that answerable across a page reload, a shift change, or a browser that was
closed at the time.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Notification, UserRole
from app.services.auth import get_current_user
from app.services.notifications import unread_count

logger = logging.getLogger(__name__)
router = APIRouter()

# One page of history. The feed is an operations log, not an archive — a
# console that tries to render every row a busy exam day produced is a console
# that stops rendering.
_MAX_LIMIT = 200


def _role_of(current_user: dict) -> str:
    role = current_user["role"]
    return role.value if isinstance(role, UserRole) else str(role)


def _iso(dt: datetime | None) -> str | None:
    """An ISO timestamp that always carries its offset.

    SQLite has no timezone-aware storage, so a ``DateTime(timezone=True)``
    column hands back a NAIVE datetime there while Postgres hands back an aware
    one — the same row, serialising two different ways depending on which
    database answered. That difference is not cosmetic: ``new Date()`` in the
    browser reads an offset-less ISO string as LOCAL time, so a UTC instant
    written by the server renders five and a half hours out on an operator's
    screen in IST, and "delivered 03:12" becomes "delivered 08:42".

    Everything stored here is written as UTC (see the model's ``created_at``
    default and the ``datetime.now(timezone.utc)`` at each write site), so a
    naive value read back is UTC that lost its label. Reattaching it is correct
    rather than a guess.
    """
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def _serialise(n: Notification) -> dict:
    return {
        "id": str(n.id),
        "kind": n.kind.value if hasattr(n.kind, "value") else str(n.kind),
        "severity": n.severity.value if hasattr(n.severity, "value") else str(n.severity),
        "title": n.title,
        "body": n.body,
        "sourceFeature": n.source_feature,
        "subjectType": n.subject_type,
        "subjectId": n.subject_id,
        "payload": n.payload or {},
        "read": n.read_at is not None,
        "readAt": _iso(n.read_at),
        "createdAt": _iso(n.created_at),
    }


@router.get("", summary="This duty's notification feed")
@router.get("/", include_in_schema=False)
async def list_notifications(
    unread_only: bool = Query(False, description="Only rows nobody has acknowledged yet"),
    limit: int = Query(50, ge=1, le=_MAX_LIMIT),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """The feed, newest first, for whichever role is asking.

    Returns the unread count alongside the rows so a client that renders the
    list can update its badge from the same response instead of issuing a
    second request that could disagree with the first.
    """
    role = _role_of(current_user)

    q = select(Notification).where(Notification.recipient_role == role)
    if unread_only:
        q = q.where(Notification.read_at.is_(None))
    q = q.order_by(Notification.created_at.desc()).limit(limit)

    rows = (await db.execute(q)).scalars().all()
    return {
        "ok": True,
        "role": role,
        "unread": await unread_count(db, role),
        "count": len(rows),
        "notifications": [_serialise(n) for n in rows],
    }


@router.get("/summary", summary="Unread count only (what the badge polls)")
async def summary(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Deliberately tiny.

    This is polled on an interval by every console that is open, so it counts
    rows rather than returning them. The newest row's title comes along because
    it costs one indexed lookup and saves the client a second round trip to
    render a tooltip.
    """
    role = _role_of(current_user)
    latest = (
        await db.execute(
            select(Notification)
            .where(Notification.recipient_role == role)
            .order_by(Notification.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    return {
        "ok": True,
        "role": role,
        "unread": await unread_count(db, role),
        "latest": _serialise(latest) if latest is not None else None,
    }


@router.post("/{notification_id}/read", summary="Acknowledge one notification")
async def mark_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Acknowledge a row, if it is addressed to the caller's duty.

    A row belonging to another role answers 404 rather than 403: the caller has
    no business knowing whether that id exists.
    """
    role = _role_of(current_user)
    row = (
        await db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.recipient_role == role,
            )
        )
    ).scalar_one_or_none()

    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "NO_SUCH_NOTIFICATION")

    # Acknowledging twice keeps the FIRST acknowledgement's time. When it was
    # seen is the audit-relevant fact; a re-click must not overwrite it.
    if row.read_at is None:
        row.read_at = datetime.now(timezone.utc)
        await db.commit()

    return {"ok": True, "notification": _serialise(row), "unread": await unread_count(db, role)}


@router.post("/read-all", summary="Acknowledge this duty's whole feed")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    role = _role_of(current_user)
    now = datetime.now(timezone.utc)

    result = await db.execute(
        update(Notification)
        .where(Notification.recipient_role == role, Notification.read_at.is_(None))
        .values(read_at=now)
    )
    await db.commit()

    return {"ok": True, "acknowledged": result.rowcount or 0, "unread": await unread_count(db, role)}
