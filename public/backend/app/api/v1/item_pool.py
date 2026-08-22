"""
Item pool authoring (§5.1, §5.2) — the deterministic path that replaces asking a
language model to write or edit exam questions.

── Why this exists ─────────────────────────────────────────────────────────

`question_modes.py` Mode 1 has no generator. It refuses, and tells the operator
to "configure an LLM (OPENAI_API_KEY or LLM_BASE_URL)". Mode 2 is described as
"AI upgraded" and in fact only analyses. So the one path that could put new
questions into the system was an LLM that was never wired up.

That is the right outcome for the wrong reason, and the design doc says so in
its own words (§5.1, "the anti-hallucination core"):

    The spec's Mode 2 ("AI randomly edits 20-80% of questions based on
    difficulty level") will ship wrong answer keys. Changing a number in a
    physics question changes its answer; an LLM asked to "edit" will frequently
    update the stem and not the key, or update both inconsistently. In a
    national exam that is a Supreme Court case, not a bug report.

The alternative it prescribes is not "a better prompt". It is to stop generating
ITEMS and start generating item TEMPLATES whose answer is an EXPRESSION:

    stem:        "A particle moves along a circular path of radius {R} m at a
                  constant speed of {v} m/s. Its centripetal acceleration is:"
    params:      R: [2,3,4,5,8]   v: [4,6,8,10,12]
    answer_expr: "v**2 / R"
    distractors: "v / R"      (confuses omega with a)
                 "v**2"       (drops the radius)
                 "2*v**2 / R" (spurious factor of 2)

The key is never asserted by anyone — it is the result of evaluating the
expression against the parameters that were substituted into the stem. To ship a
wrong key you would have to write a wrong FORMULA, which is a thing a human
reviewing 400 templates can actually catch, and which one reviewer catches for
all 25 of that template's siblings at once.

What that buys, beyond correctness: 400 templates x 25 variants is a 10,000-item
pool a human reviewed 400 things to produce; siblings have near-identical
difficulty by construction, so swapping them between forms is fairness-neutral;
and leaking one variant reveals the template, not the answer to the sibling that
actually appears.

── What this module does NOT do ────────────────────────────────────────────

It calls no model, sends nothing over a network, and costs nothing per item. The
verification is `services/item_pool/expander.py` — S0 (structural: four options,
distinct AND separated, stem fully substituted) and S1 (symbolic: the key is
re-derived and must reproduce). Both are deterministic, so the same template
yields the same verdict on every machine and in every audit, which is the
property a marks challenge is actually argued over.

Templates cover computational subjects well and conceptual ones not at all
(§5.1 puts Physics/Chemistry/Maths at 80-90% templatable, Biology at 30-50%,
comprehension at ~0%). Human-authored items for the rest go through the same
gauntlet; this module is the templated half, not a claim to cover everything.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

# 422 is spelled numerically: Starlette renamed HTTP_422_UNPROCESSABLE_ENTITY to
# ...UNPROCESSABLE_CONTENT and deprecated the old name, so referencing either by
# constant ties this file to a Starlette version for no benefit.
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ItemStatus, ItemTemplate, PoolItem, UserRole
from app.services.auth import require_role
from app.services.item_pool import (
    MAX_AUTHOR_SHARE,
    Distractor,
    TemplateSpec,
    VerificationError,
    expand,
    minimum_authors,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── request / response shapes ────────────────────────────────────────────

class DistractorIn(BaseModel):
    """
    A wrong answer that is COMPUTED, and a name for why a candidate would pick it.

    `misconception` is not decoration. A distractor derived from a named error —
    "confuses angular velocity with acceleration" — tells you something about the
    candidate who selected it, which is what makes the item diagnostically useful
    rather than merely hard. It is also what a reviewer checks: an expression
    nobody can name a reason for is usually noise.
    """
    expr: str = Field(..., min_length=1, max_length=200)
    misconception: str = Field(..., min_length=3, max_length=200)


class TemplateIn(BaseModel):
    template_id: str = Field(..., min_length=3, max_length=64)
    subject: str = Field(..., min_length=1, max_length=120)
    stem: str = Field(..., min_length=10, max_length=2000)
    params: dict[str, list[Any]] = Field(..., description='{"R": [2,3,4], "v": [4,6]}')
    answer_expr: str = Field(..., min_length=1, max_length=200)
    distractors: list[DistractorIn] = Field(..., min_length=3, max_length=3)
    topic: str | None = Field(None, max_length=200)
    blooms_level: int | None = Field(None, ge=1, le=6)
    unit: str = Field("", max_length=32)
    param_constraint: str | None = Field(None, max_length=200)
    irt_a: float | None = None
    irt_b: float | None = None
    irt_c: float | None = None
    max_variants: int = Field(25, ge=1, le=200)


def _spec(body: TemplateIn) -> TemplateSpec:
    return TemplateSpec(
        template_id=body.template_id,
        subject=body.subject,
        stem=body.stem,
        params=body.params,
        answer_expr=body.answer_expr,
        distractors=[Distractor(expr=d.expr, misconception=d.misconception) for d in body.distractors],
        topic=body.topic,
        blooms_level=body.blooms_level,
        unit=body.unit,
        param_constraint=body.param_constraint,
        irt_a=body.irt_a,
        irt_b=body.irt_b,
        irt_c=body.irt_c,
    )


def _expand_or_422(body: TemplateIn):
    """
    Expand, and turn a total failure into a 422 the author can act on.

    The rejections are the product here, not a diagnostic afterthought. A setter
    who writes `answer_expr: "v/R"` with a distractor of `"v / R"` gets told that
    two options collide, on which parameter combination, with both rendered
    values — instead of discovering it when a candidate does.
    """
    try:
        result = expand(_spec(body), max_variants=body.max_variants)
    except VerificationError as exc:
        raise HTTPException(
            status_code=422,
            detail={"reason": "TEMPLATE_INVALID", "message": str(exc)},
        ) from exc

    if not result.items:
        raise HTTPException(
            status_code=422,
            detail={
                "reason": "NO_VARIANT_VERIFIED",
                "message": (
                    "Every parameter combination was rejected, so this template "
                    "yields no items. Nothing was saved."
                ),
                "rejections": [{"variant": v, "why": why} for v, why in result.rejections],
            },
        )
    return result


@router.post("/templates/verify", summary="Expand and verify a template WITHOUT saving it")
async def verify_template(
    body: TemplateIn,
    current_user: dict = Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
) -> dict[str, Any]:
    """
    The authoring loop: write a template, see exactly what it produces.

    Free, instant, offline and idempotent — there is no model call behind it, so
    a setter can iterate on a formula as many times as they like. This is
    deliberately a separate endpoint from the one that saves: the whole argument
    for templates is that a human reviews the FORMULA, and that only happens if
    looking at the output is cheaper than committing it.
    """
    result = _expand_or_422(body)
    return {
        "ok": True,
        "saved": False,
        "template_id": body.template_id,
        "accepted": result.accepted,
        "rejected": len(result.rejections),
        "rejections": [{"variant": v, "why": why} for v, why in result.rejections],
        # A sample rather than everything: the point of review is the formula.
        "sample": [
            {
                "stem": i.stem,
                "options": i.options,
                "correct_index": i.correct_index,
                "correct_option": i.options[i.correct_index],
            }
            for i in result.items[:3]
        ],
        "note": (
            "Answer keys here were COMPUTED from answer_expr, not asserted. "
            "Nothing was written to the pool."
        ),
    }


@router.post("/templates", status_code=status.HTTP_201_CREATED, summary="Author a template into the pool")
async def create_template(
    body: TemplateIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
) -> dict[str, Any]:
    """
    Verify, then persist the template and every sibling it produced.

    The items land as PROVISIONAL, never CALIBRATED: their IRT parameters are the
    author's prior, and calling an estimate a measurement is how an unfair paper
    gets called fair. Only response data from a real sitting promotes them.

    Items belong to NO exam. That is the entire point of the pool — an item an
    author cannot place in a paper is an item whose author cannot know the paper
    (§5.3). Which items become a form, and which form is used, are decided later
    and elsewhere.
    """
    author_id = current_user["user_id"]

    existing = (
        await db.execute(select(ItemTemplate).where(ItemTemplate.template_id == body.template_id))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "reason": "TEMPLATE_EXISTS",
                "message": (
                    f"{body.template_id} is already in the pool. Templates are immutable once "
                    "authored — edit one and its already-expanded siblings would no longer "
                    "match the formula that produced them. Author a new id."
                ),
            },
        )

    result = _expand_or_422(body)

    template = ItemTemplate(
        id=str(uuid4()),
        template_id=body.template_id,
        author_id=author_id,
        subject=body.subject,
        topic=body.topic,
        blooms_level=body.blooms_level,
        stem=body.stem,
        params=body.params,
        param_constraint=body.param_constraint,
        answer_expr=body.answer_expr,
        distractors=[d.model_dump() for d in body.distractors],
        unit=body.unit or None,
        irt_a=body.irt_a,
        irt_b=body.irt_b,
        irt_c=body.irt_c,
        status=ItemStatus.PROVISIONAL,
    )
    db.add(template)
    await db.flush()

    for item in result.items:
        db.add(
            PoolItem(
                id=str(uuid4()),
                template_pk=template.id,
                author_id=author_id,
                blob_id=item.blob_id,
                stem=item.stem,
                options=item.options,
                correct_index=item.correct_index,
                subject=item.subject,
                topic=item.topic,
                blooms_level=item.blooms_level,
                irt_a=item.irt_a,
                irt_b=item.irt_b,
                irt_c=item.irt_c,
                status=ItemStatus.PROVISIONAL,
            )
        )
    await db.commit()

    logger.info(
        "Item pool: template=%s author=%s accepted=%d rejected=%d",
        body.template_id, str(author_id)[:8], result.accepted, len(result.rejections),
    )
    return {
        "ok": True,
        "saved": True,
        "template_id": body.template_id,
        "accepted": result.accepted,
        "rejected": len(result.rejections),
        "rejections": [{"variant": v, "why": why} for v, why in result.rejections],
        "status": ItemStatus.PROVISIONAL.value,
    }


@router.get("/templates", summary="Templates this setter has authored")
async def list_templates(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
) -> dict[str, Any]:
    """
    A setter sees THEIR OWN templates and nothing else.

    Not a convenience filter — §5.3's compartmentalisation. A setter who can
    enumerate the pool knows a large fraction of what any paper could contain,
    which is the leak the author cap exists to bound. An ADMIN sees the whole
    pool because someone has to be able to audit it.
    """
    q = select(ItemTemplate).order_by(ItemTemplate.created_at.desc())
    if current_user.get("role") == UserRole.SETTER.value:
        q = q.where(ItemTemplate.author_id == current_user["user_id"])
    rows = (await db.execute(q)).scalars().all()

    counts = dict(
        (
            await db.execute(
                select(PoolItem.template_pk, func.count(PoolItem.id)).group_by(PoolItem.template_pk)
            )
        ).all()
    )
    return {
        "templates": [
            {
                "template_id": t.template_id,
                "subject": t.subject,
                "topic": t.topic,
                "blooms_level": t.blooms_level,
                "status": t.status.value if t.status else None,
                "variants": counts.get(t.id, 0),
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in rows
        ]
    }


@router.get("/stats", summary="Pool size, author spread, and what a paper would need")
async def pool_stats(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
) -> dict[str, Any]:
    """
    Whether this pool can actually produce a paper, and who owns it.

    The author cap (§5.3.3) has an arithmetic consequence that is easy to miss
    until assembly fails on exam week: at a 5% share each, a paper of k items
    needs at least 20 distinct authors, and no amount of items from too few
    people will do. Surfacing the author count next to the item count is what
    turns that from a surprise into a staffing decision.
    """
    total = (await db.execute(select(func.count(PoolItem.id)))).scalar_one()
    by_subject = (
        await db.execute(select(PoolItem.subject, func.count(PoolItem.id)).group_by(PoolItem.subject))
    ).all()
    authors = (await db.execute(select(func.count(func.distinct(PoolItem.author_id))))).scalar_one()

    return {
        "items": total,
        "authors": authors,
        "by_subject": {s: n for s, n in by_subject},
        "author_cap": MAX_AUTHOR_SHARE,
        "minimum_authors_for": {
            str(k): minimum_authors(k) for k in (30, 90, 180)
        },
        "note": (
            f"No setter may contribute more than {MAX_AUTHOR_SHARE:.0%} of any form, so a "
            f"90-item paper needs at least {minimum_authors(90)} distinct authors regardless "
            "of how many items the pool holds."
        ),
    }
