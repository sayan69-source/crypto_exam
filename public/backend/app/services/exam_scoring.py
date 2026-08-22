"""
Scoring — apply a pattern's arithmetic to one candidate's responses.

Pure: responses and a key go in, a mark sheet comes out. No database, no clock,
no network. That is deliberate, because this is the module a re-evaluation
petition is actually about, and the answer to "how was this mark reached" has to
be reproducible by someone who was not there.

── Rules that are easy to get wrong and expensive to get wrong ─────────────

**Unattempted is not wrong.** Negative marking applies to a WRONG answer. A
question the candidate never touched scores `marks_unattempted`, which is zero
in every Indian scheme — but scoring it as wrong instead would subtract a mark
per blank and reorder an entire merit list. The two are different states and are
kept different all the way through.

**An attempt limit is a CAP, not a truncation.** "Attempt any 5 of 10" means a
candidate who answered 7 is scored on their best 5, not their first 5. Taking
the first five punishes someone for answering in the order the paper printed.

**Multi-choice is all-or-nothing.** Partial credit for a subset is a policy some
boards adopt and most do not; awarding it silently would inflate every such
paper. If it is ever wanted it becomes an explicit section field, not a default.

**Decimal throughout.** A total accumulated in binary floating point is a total
that can render as 179.99999999999997 on a mark sheet.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.services.exam_pattern import ExamPattern, QuestionType, Section


@dataclass(frozen=True)
class Response:
    """
    One candidate answer, as the terminal sealed it.

    `value` is None for unattempted. Otherwise:
      SINGLE_CHOICE  int   — the chosen option index
      MULTI_CHOICE   list  — chosen option indices, order irrelevant
      NUMERIC        str   — what they typed, kept as text so "2.50" and the
                             tolerance comparison are both possible
    """

    index: int
    value: Any | None


@dataclass(frozen=True)
class Key:
    """The correct answer for one question, in the same shapes."""

    index: int
    value: Any


@dataclass(frozen=True)
class QuestionResult:
    index: int
    section: str
    state: str            # CORRECT | WRONG | UNATTEMPTED | DROPPED | CAPPED
    marks: Decimal


@dataclass(frozen=True)
class MarkSheet:
    total: Decimal
    max_marks: Decimal
    per_section: dict[str, Decimal]
    per_question: list[QuestionResult]
    attempted: int
    correct: int
    wrong: int
    unattempted: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "total": str(self.total),
            "max_marks": str(self.max_marks),
            "per_section": {k: str(v) for k, v in self.per_section.items()},
            "attempted": self.attempted,
            "correct": self.correct,
            "wrong": self.wrong,
            "unattempted": self.unattempted,
            "per_question": [
                {"index": q.index, "section": q.section, "state": q.state, "marks": str(q.marks)}
                for q in self.per_question
            ],
        }


def _numeric_matches(given: Any, expected: Any, tolerance: Decimal) -> bool:
    """
    Within tolerance, and never raising on what a candidate typed.

    A keypad can emit "", "-", "1.2.3" or a 400-digit paste. All of those are
    simply wrong answers; none of them may take down the scoring of an exam.
    """
    try:
        g = Decimal(str(given).strip())
        e = Decimal(str(expected).strip())
    except (ArithmeticError, ValueError, TypeError):
        return False
    if not g.is_finite() or not e.is_finite():
        return False
    return abs(g - e) <= tolerance


def _grade_one(section: Section, response: Response, key: Key) -> tuple[str, Decimal]:
    if response.value is None or (isinstance(response.value, str) and not response.value.strip()):
        return "UNATTEMPTED", section.marks_unattempted

    if section.question_type is QuestionType.SINGLE_CHOICE:
        ok = response.value == key.value

    elif section.question_type is QuestionType.MULTI_CHOICE:
        # Sets, so order and duplicates cannot change the verdict.
        try:
            ok = set(response.value) == set(key.value)
        except TypeError:
            ok = False

    elif section.question_type is QuestionType.NUMERIC:
        tol = section.numeric_tolerance or Decimal("0")
        ok = _numeric_matches(response.value, key.value, tol)

    else:  # pragma: no cover — QuestionType is exhaustive above
        raise ValueError(f"unscorable question type {section.question_type}")

    return ("CORRECT", section.marks_correct) if ok else ("WRONG", section.marks_wrong)


def score(
    pattern: ExamPattern,
    responses: list[Response],
    keys: list[Key],
    *,
    dropped: set[int] | None = None,
) -> MarkSheet:
    """
    Score one candidate.

    `dropped` is the set of question indices withdrawn after publication — a
    question found ambiguous on challenge. Every candidate receives full marks
    for a dropped question INCLUDING those who never attempted it, which is the
    convention Indian boards follow: the question was the board's mistake, and
    scoring it as unattempted would penalise the candidate who correctly
    declined to guess at a broken item.
    """
    dropped = dropped or set()
    by_index = {k.index: k for k in keys}
    responses_by_index = {r.index: r for r in responses}

    # Grade everything first, then apply attempt caps per section — a cap is
    # "your best N", which cannot be known until all of them are graded.
    graded: dict[int, tuple[str, Decimal, Section]] = {}
    for i in range(pattern.total_questions):
        section = pattern.section_of(i)
        if i in dropped:
            graded[i] = ("DROPPED", section.marks_correct, section)
            continue
        key = by_index.get(i)
        if key is None:
            # No key for a question that was delivered. Refuse rather than guess:
            # scoring it as wrong invents a penalty, scoring it as correct
            # invents a mark, and both produce a mark sheet nobody can defend.
            raise ValueError(f"no answer key for question {i}")
        state, marks = _grade_one(section, responses_by_index.get(i, Response(i, None)), key)
        graded[i] = (state, marks, section)

    results: list[QuestionResult] = []
    per_section: dict[str, Decimal] = {}
    cursor = 0
    for section in pattern.sections:
        indices = list(range(cursor, cursor + section.count))
        cursor += section.count
        per_section.setdefault(section.name, Decimal("0"))

        keep = set(indices)
        if section.attempt_limit is not None:
            # Best N by marks. Ties break on the earlier question so the outcome
            # is deterministic and reproducible in a re-evaluation.
            scored = [i for i in indices if graded[i][0] in ("CORRECT", "WRONG", "DROPPED")]
            scored.sort(key=lambda i: (-graded[i][1], i))
            keep = set(scored[: section.attempt_limit]) | {
                i for i in indices if graded[i][0] == "UNATTEMPTED"
            }

        for i in indices:
            state, marks, _ = graded[i]
            if i not in keep:
                # Answered, but beyond the cap. Explicitly CAPPED rather than
                # silently dropped, so a candidate can see why an answer they
                # gave earned nothing.
                results.append(QuestionResult(i, section.name, "CAPPED", Decimal("0")))
                continue
            results.append(QuestionResult(i, section.name, state, marks))
            per_section[section.name] += marks

    counted = [r for r in results if r.state != "CAPPED"]
    return MarkSheet(
        total=sum((r.marks for r in results), Decimal("0")),
        max_marks=pattern.max_marks,
        per_section=per_section,
        per_question=results,
        attempted=sum(1 for r in results if r.state in ("CORRECT", "WRONG", "CAPPED")),
        correct=sum(1 for r in counted if r.state == "CORRECT"),
        wrong=sum(1 for r in counted if r.state == "WRONG"),
        unattempted=sum(1 for r in counted if r.state == "UNATTEMPTED"),
    )
