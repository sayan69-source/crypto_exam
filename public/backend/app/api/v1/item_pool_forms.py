"""
Assembly (§6.1) — commit N forms at T−7d, DRAW one at T₀.

This is the half that makes the item pool worth having. Authoring items nobody
owns is only half the claim; the other half is that which items become a paper,
and which paper actually runs, are decided by something no participant controls.

Until now `build_forms`, `form_set_root` and `select_form_index` had no caller
anywhere outside the unit tests, and `ExamForm` was a table nothing wrote. The
mechanism the whole design rests on was implemented, tested, and connected to
nothing — while the live path sealed whatever questions happened to be attached
to an exam, which is one fixed paper authored by whoever authored it.

── The ordering IS the security property ───────────────────────────────────

  T−7d  ASSEMBLE   N complete forms are built under the blueprint and the 5%
                   author cap, and committed together as ONE root. The paper now
                   exists. Nobody — setter or administrator — knows which of the
                   N will run, because nothing has chosen yet.

  T₀    DRAW       a public random beacon that did not exist at T−7d picks an
                   index. Anyone can recompute it afterwards from the beacon,
                   the exam id and N, so the draw is checkable rather than
                   trusted.

Between those two moments the paper is simultaneously fixed and unknown. That is
the state the entire architecture is arranged to produce, and every refusal in
this module exists to keep it: the commitment cannot be rebuilt, the draw cannot
be repeated with a different beacon, and the drawn items cannot be read before
the draw.

── Why assembly is ADMIN-only and not a setter action ──────────────────────

A setter who could choose which items enter a form would know a paper. §5.3
separates authoring from assembly precisely so that no single person is on both
sides, and that separation is worth more than the convenience of letting the
person who wrote the items arrange them.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Exam, ExamForm, ExamFormSet, ItemStatus, PoolItem, UserRole
from app.services.auth import require_role
from app.services.item_pool import (
    AssemblyError,
    CandidateItem,
    build_forms,
    check_blueprint_feasible,
    form_set_root,
    select_form_index,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class AssembleIn(BaseModel):
    blueprint: dict[str, int] = Field(..., description='{"Physics": 30, "Chemistry": 30}')
    count: int = Field(8, ge=2, le=64, description="N — how many candidate forms to commit together")
    seed_hex: str | None = Field(
        None,
        description=(
            "Assembly seed, hex. Recorded so an auditor can rebuild the identical form "
            "set from the pool rather than take the stored rows on trust. Random if omitted."
        ),
    )


class SelectIn(BaseModel):
    beacon_hex: str = Field(..., min_length=32, max_length=160)
    drand_round: int | None = None


@router.post("/{exam_id}/assemble", status_code=201, summary="T−7d: build and commit N forms")
async def assemble_forms(
    exam_id: str,
    body: AssembleIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
) -> dict[str, Any]:
    """
    Draw N complete forms from the pool and publish one root that binds them all.

    Refuses to run twice, and that refusal is not a convenience guard. A
    commitment that can be replaced is not a commitment: if the set could be
    rebuilt after publication then "the paper was fixed a week ago" means
    nothing, and whoever holds the token can re-roll until a favourable set
    appears. Publishing `form_set_root` is what converts a promise into
    something a stranger can check.
    """
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(404, {"reason": "UNKNOWN_EXAM", "message": "No such exam."})

    existing = (
        await db.execute(select(ExamFormSet).where(ExamFormSet.exam_id == exam_id))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            409,
            {
                "reason": "ALREADY_COMMITTED",
                "message": (
                    "This exam's form set is already committed under root "
                    f"{existing.form_set_root[:16]}…. Rebuilding it would let the set be "
                    "re-rolled until someone liked the result, which is the power this "
                    "commitment exists to remove."
                ),
                "form_set_root": existing.form_set_root,
            },
        )

    # Only items this blueprint could actually draw on.
    #
    # Filtering by subject is not an optimisation. `check_blueprint_feasible`
    # counts DISTINCT AUTHORS across whatever pool it is handed, and the author
    # cap is the constraint most likely to make a blueprint impossible — so
    # passing the whole pool lets setters who have only ever written Biology
    # items make a Chemistry paper look staffable. The feasibility check would
    # pass and assembly would then fail, or worse, succeed with a concentration
    # the cap was supposed to forbid.
    rows = (
        await db.execute(
            select(PoolItem).where(
                PoolItem.status.in_([ItemStatus.PROVISIONAL, ItemStatus.CALIBRATED]),
                PoolItem.subject.in_(list(body.blueprint.keys())),
            )
        )
    ).scalars().all()
    pool = [
        CandidateItem(
            item_id=str(r.id),
            author_id=str(r.author_id) if r.author_id else None,
            template_pk=str(r.template_pk),
            subject=r.subject,
        )
        for r in rows
    ]
    paper_length = sum(body.blueprint.values())

    # Feasibility BEFORE building, so an impossible blueprint is explained rather
    # than discovered as an empty result on exam week. The usual cause is not too
    # few items but too few AUTHORS — a 5% cap needs at least 20 of them, and no
    # quantity of items from the same handful of people will substitute.
    try:
        # Derives paper_length from the blueprint itself — passing it separately
        # would let the two disagree.
        check_blueprint_feasible(pool, body.blueprint)
    except AssemblyError as exc:
        raise HTTPException(422, {"reason": "BLUEPRINT_INFEASIBLE", "message": str(exc)}) from exc

    seed_hex = (body.seed_hex or secrets.token_hex(32)).strip().lower()
    try:
        seed = bytes.fromhex(seed_hex)
    except ValueError as exc:
        raise HTTPException(422, {"reason": "BAD_SEED", "message": "seed_hex is not hex."}) from exc

    try:
        forms = build_forms(pool, body.blueprint, count=body.count, seed=seed)
    except AssemblyError as exc:
        raise HTTPException(422, {"reason": "ASSEMBLY_FAILED", "message": str(exc)}) from exc

    root = form_set_root(forms)
    for f in forms:
        db.add(
            ExamForm(
                id=str(uuid4()), exam_id=exam_id, form_index=f.index,
                item_ids=f.item_ids, form_hash=f.form_hash,
                max_author_share=f.max_author_share,
            )
        )
    db.add(
        ExamFormSet(
            id=str(uuid4()), exam_id=exam_id, form_count=len(forms),
            paper_length=paper_length, blueprint=body.blueprint,
            form_set_root=root, seed_hex=seed_hex,
        )
    )
    await db.commit()

    logger.info("Forms committed: exam=%s N=%d root=%s", str(exam_id)[:8], len(forms), root[:16])
    return {
        "ok": True,
        "exam_id": str(exam_id),
        "form_count": len(forms),
        "paper_length": paper_length,
        "form_set_root": root,
        "seed_hex": seed_hex,
        # Per-form author concentration, so the cap is auditable now rather than
        # after a challenge. Never the item ids — see /commitment for why.
        "max_author_share": [f.max_author_share for f in forms],
        "note": (
            "Which form runs is not decided yet, and cannot be by anyone. Publish "
            "form_set_root now; at T₀ a public beacon picks the index and the draw "
            "becomes checkable against what was published."
        ),
    }


@router.get("/{exam_id}/commitment", summary="The published commitment (public)")
async def form_commitment(exam_id: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """
    What anyone may know before T₀ — and deliberately nothing more.

    The root, how many forms it binds, how long the paper is. NOT which items are
    in which form: that is the secret the commitment exists to protect, and an
    endpoint that returned it would hand the whole pool-to-paper mapping to
    anyone who asked.

    Unauthenticated on purpose. A commitment only outsiders cannot read is not a
    commitment — its entire function is that a stranger can check, afterwards,
    that the paper which ran was one of the papers fixed a week earlier.
    """
    fs = (
        await db.execute(select(ExamFormSet).where(ExamFormSet.exam_id == exam_id))
    ).scalar_one_or_none()
    if not fs:
        raise HTTPException(404, {"reason": "NOT_COMMITTED", "message": "No form set committed for this exam."})
    return {
        "exam_id": str(exam_id),
        "form_set_root": fs.form_set_root,
        "form_count": fs.form_count,
        "paper_length": fs.paper_length,
        "committed_at": fs.committed_at.isoformat() if fs.committed_at else None,
        "selected_index": fs.selected_index,
        "beacon_hex": fs.beacon_hex,
        "drand_round": fs.drand_round,
        "selected_at": fs.selected_at.isoformat() if fs.selected_at else None,
        "how_to_verify": (
            "After T₀, recompute for yourself: selected_index == int.from_bytes("
            "HMAC-SHA256(key=bytes.fromhex(beacon_hex), "
            "msg=b'cryptoexam:form:<exam_id>'), 'big') % form_count"
        ),
    }


@router.post("/{exam_id}/select", summary="T₀: draw the form from the public beacon")
async def select_form(
    exam_id: str,
    body: SelectIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
) -> dict[str, Any]:
    """
    The draw. Two lines of arithmetic, and that is the point.

    Idempotent for the SAME beacon — a retried call after a network blip must not
    re-draw. A DIFFERENT beacon after the fact is refused outright: a draw that
    can be repeated until the caller likes the answer is a choice wearing a
    beacon's clothes, and it is the one way to defeat this scheme from the inside
    while every published artifact still looks correct.
    """
    fs = (
        await db.execute(select(ExamFormSet).where(ExamFormSet.exam_id == exam_id))
    ).scalar_one_or_none()
    if not fs:
        raise HTTPException(409, {"reason": "NOT_COMMITTED", "message": "Commit a form set before drawing from it."})

    beacon = body.beacon_hex.strip().lower()
    if beacon.startswith("0x"):
        beacon = beacon[2:]
    try:
        bytes.fromhex(beacon)
    except ValueError as exc:
        raise HTTPException(422, {"reason": "BAD_BEACON", "message": "beacon_hex is not hex."}) from exc

    if fs.selected_index is not None:
        if fs.beacon_hex != beacon:
            raise HTTPException(
                409,
                {
                    "reason": "ALREADY_DRAWN",
                    "message": (
                        "This exam was already drawn, from a different beacon. Re-drawing "
                        "is how a random selection quietly becomes a chosen one."
                    ),
                    "selected_index": fs.selected_index,
                },
            )
        return {
            "ok": True, "exam_id": str(exam_id),
            "selected_index": fs.selected_index, "repeat": True,
        }

    index = select_form_index(beacon, str(exam_id), fs.form_count)
    fs.selected_index = index
    fs.beacon_hex = beacon
    fs.drand_round = body.drand_round
    fs.selected_at = datetime.now(timezone.utc)
    await db.commit()

    logger.info(
        "T0 draw: exam=%s index=%d/%d beacon=%s",
        str(exam_id)[:8], index, fs.form_count, beacon[:16],
    )
    return {
        "ok": True,
        "exam_id": str(exam_id),
        "selected_index": index,
        "form_count": fs.form_count,
        "form_set_root": fs.form_set_root,
        "repeat": False,
    }


@router.get("/{exam_id}/paper", summary="The drawn paper's items (after T₀ only)")
async def drawn_paper(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
) -> dict[str, Any]:
    """
    The items of the form that was actually drawn, for sealing and delivery.

    Refuses before the draw, and that refusal is the whole mechanism rather than
    a policy detail. If this answered at T−1d it would hand a paper over a week
    early to whoever holds an admin token — while the commitment, the beacon and
    the author cap all remained perfectly intact and the exam leaked anyway.
    """
    fs = (
        await db.execute(select(ExamFormSet).where(ExamFormSet.exam_id == exam_id))
    ).scalar_one_or_none()
    if not fs:
        raise HTTPException(404, {"reason": "NOT_COMMITTED", "message": "No form set for this exam."})
    if fs.selected_index is None:
        raise HTTPException(
            425,  # Too Early
            {
                "reason": "BEFORE_T0",
                "message": (
                    "No form has been drawn yet. The paper is committed but undecided — "
                    "that is the point, and it is why this endpoint cannot answer."
                ),
            },
        )

    form = (
        await db.execute(
            select(ExamForm).where(
                ExamForm.exam_id == exam_id, ExamForm.form_index == fs.selected_index
            )
        )
    ).scalar_one_or_none()
    if not form:
        raise HTTPException(500, {"reason": "FORM_MISSING", "message": "The drawn index has no stored form."})

    items = (
        await db.execute(select(PoolItem).where(PoolItem.id.in_(form.item_ids)))
    ).scalars().all()
    by_id = {str(i.id): i for i in items}
    # Preserve the form's own order — it is part of what form_hash committed to.
    ordered = [by_id[i] for i in form.item_ids if i in by_id]

    return {
        "exam_id": str(exam_id),
        "form_index": fs.selected_index,
        "form_hash": form.form_hash,
        "form_set_root": fs.form_set_root,
        "max_author_share": float(form.max_author_share) if form.max_author_share is not None else None,
        "items": [
            {
                "blob_id": i.blob_id,
                "stem": i.stem,
                "options": i.options,
                "correct_index": i.correct_index,
                "subject": i.subject,
                "topic": i.topic,
            }
            for i in ordered
        ],
    }
