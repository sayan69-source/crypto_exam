"""
The exam's paper shape — set it once, then everything downstream reads it.

This is the join that makes one terminal serve every exam. The administrator
declares the pattern here; assembly draws `pattern.blueprint()` from the item
pool; the provisioning bundle carries it to the centre; the terminal renders
whatever each section declares; and the scorer applies whatever each section
declares. Nothing downstream contains the word "JEE".

Immutable once set, and that is the point rather than a convenience. The pattern
IS the marking scheme, so a pattern that can be edited after the forms are
committed is a marking scheme that can be edited after the exam has been sat —
which is indistinguishable, from the outside, from having always been that way.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Exam, ExamFormSet, ExamPatternRow, UserRole
from app.services.auth import require_role
from app.services.exam_pattern import PRESETS, ExamPattern, PatternError

logger = logging.getLogger(__name__)
router = APIRouter()


class PatternIn(BaseModel):
    """Either a preset name, or a full pattern. Not both, not neither."""

    preset: str | None = Field(None, description="JEE_MAIN | NEET_UG")
    pattern: dict[str, Any] | None = None


def _resolve(body: PatternIn) -> tuple[ExamPattern, str | None]:
    if bool(body.preset) == bool(body.pattern):
        raise HTTPException(422, {
            "reason": "AMBIGUOUS_PATTERN",
            "message": "Give exactly one of `preset` or `pattern`.",
        })
    if body.preset:
        factory = PRESETS.get(body.preset.upper())
        if not factory:
            raise HTTPException(422, {
                "reason": "UNKNOWN_PRESET",
                "message": f"Unknown preset {body.preset!r}. Known: {sorted(PRESETS)}",
            })
        return factory(), body.preset.upper()
    try:
        return ExamPattern.from_dict(body.pattern or {}), None
    except PatternError as exc:
        # The validation message names the specific rule — a positive
        # marks_wrong, a numeric section with no tolerance, two sections sharing
        # a name. Passing it through verbatim is the whole value.
        raise HTTPException(422, {"reason": "PATTERN_INVALID", "message": str(exc)}) from exc


@router.put("/{exam_id}", summary="Declare this exam's paper shape")
async def set_pattern(
    exam_id: str,
    body: PatternIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.ADMIN)),
) -> dict[str, Any]:
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(404, {"reason": "UNKNOWN_EXAM", "message": "No such exam."})

    pattern, preset = _resolve(body)

    existing = (
        await db.execute(select(ExamPatternRow).where(ExamPatternRow.exam_id == exam_id))
    ).scalar_one_or_none()
    if existing:
        committed = (
            await db.execute(select(ExamFormSet).where(ExamFormSet.exam_id == exam_id))
        ).scalar_one_or_none()
        if committed:
            raise HTTPException(409, {
                "reason": "PATTERN_LOCKED",
                "message": (
                    "This exam's forms are already committed under root "
                    f"{committed.form_set_root[:16]}…, and those forms were drawn to fit "
                    "this pattern. Changing the marking scheme now would re-score a paper "
                    "that has already been fixed."
                ),
            })
        # Not yet committed: replacing is legitimate, since nothing has been
        # assembled against it and no candidate has seen anything.
        await db.delete(existing)
        await db.flush()

    db.add(ExamPatternRow(
        id=str(uuid4()), exam_id=exam_id, pattern=pattern.to_dict(),
        total_questions=pattern.total_questions, max_marks=pattern.max_marks,
        duration_minutes=pattern.duration_minutes, preset=preset,
    ))
    await db.commit()

    logger.info("Pattern set: exam=%s preset=%s q=%d marks=%s",
                str(exam_id)[:8], preset, pattern.total_questions, pattern.max_marks)
    return {
        "ok": True,
        "exam_id": str(exam_id),
        "preset": preset,
        "total_questions": pattern.total_questions,
        "max_marks": str(pattern.max_marks),
        "duration_minutes": pattern.duration_minutes,
        "subjects": pattern.subjects,
        "blueprint": pattern.blueprint(),
        "sections": [
            {"name": s.name, "type": s.question_type.value, "count": s.count,
             "marks_correct": str(s.marks_correct), "marks_wrong": str(s.marks_wrong),
             "attempt_limit": s.attempt_limit}
            for s in pattern.sections
        ],
    }


@router.get("/{exam_id}", summary="This exam's paper shape (drives the terminal)")
async def get_pattern(exam_id: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """
    Unauthenticated, and it carries no secret.

    A pattern says there are 20 single-answer questions worth +4/−1 — it says
    nothing about what any of them ASK. Candidates are entitled to know the
    marking scheme of the paper they are about to sit, and an exam whose scheme
    is discoverable only after the fact is one nobody can prepare for or
    challenge. This is also what the terminal fetches to know what to draw.
    """
    row = (
        await db.execute(select(ExamPatternRow).where(ExamPatternRow.exam_id == exam_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, {
            "reason": "NO_PATTERN",
            "message": "This exam has no declared paper shape yet.",
        })
    return {
        "exam_id": str(exam_id),
        "preset": row.preset,
        "total_questions": row.total_questions,
        "max_marks": str(row.max_marks),
        "duration_minutes": row.duration_minutes,
        "pattern": row.pattern,
    }


@router.get("/presets/list", summary="Built-in paper shapes")
async def list_presets() -> dict[str, Any]:
    out = []
    for name, factory in PRESETS.items():
        p = factory()
        out.append({
            "preset": name,
            "total_questions": p.total_questions,
            "max_marks": str(p.max_marks),
            "duration_minutes": p.duration_minutes,
            "subjects": p.subjects,
        })
    return {"presets": out}
