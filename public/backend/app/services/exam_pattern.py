"""
The exam pattern — one declarative object that an exam IS, so the terminal does
not need to be rewritten per exam.

── The problem this replaces ───────────────────────────────────────────────

Today an exam is implicitly MCQ. `Question` carries `options` and a
`correct_option` that is a single letter; the candidate surface renders
`currentQ.options.map(...)`; and marks live in one exam-wide
`negative_marking = 0.25`. Nothing in the schema can express "20 single-answer
questions at +4/−1, then 10 numeric-entry questions at +4/0", which is JEE Main.
A second exam shape means a second renderer, and a third means a third.

So the pattern becomes data. A section says what its questions ARE and what they
are WORTH, the terminal renders whatever the section declares, and the scorer
applies whatever the section says — neither of them knowing which exam this is.

── What a section fixes ────────────────────────────────────────────────────

    name              "Physics — Section B"
    subject           "Physics"
    question_type     SINGLE_CHOICE | MULTI_CHOICE | NUMERIC
    count             how many questions
    marks_correct     + per correct
    marks_wrong       − per wrong (0 for most numeric sections)
    marks_unattempted almost always 0, but stated rather than assumed
    attempt_limit     "any 10 of these 15" — None means attempt all
    numeric_tolerance absolute tolerance for NUMERIC; a numeric answer compared
                      by exact equality would fail every candidate who wrote
                      0.33 where the key says 1/3

── Two decisions worth defending ───────────────────────────────────────────

**Marks are per SECTION, not per question.** Indian papers are specified that
way — "Section A: 20 questions, +4, −1" — and a per-question override invites
the failure where one question in a section is quietly worth more, which is not
detectable by looking at the paper and is precisely what a challenge alleges.
A question inherits its section's arithmetic and cannot depart from it.

**Nothing here has a default that flatters.** `marks_wrong` must be stated even
when it is zero. A pattern that silently assumed no negative marking would score
an entire exam wrongly and produce a plausible-looking mark sheet, and the
candidate who lost a rank to it has no way to see that a default was applied.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any


class QuestionType(str, enum.Enum):
    """
    What a candidate does to answer, which is also what the terminal must draw.

    Deliberately about the INTERACTION rather than the subject: the terminal
    switches on this and nothing else, so adding a type is adding one renderer
    branch and one scorer branch, not a new exam.
    """

    SINGLE_CHOICE = "SINGLE_CHOICE"   # radio; exactly one of N
    MULTI_CHOICE = "MULTI_CHOICE"     # checkboxes; all-correct-or-nothing
    NUMERIC = "NUMERIC"               # keypad entry, compared within a tolerance


class PatternError(ValueError):
    """A pattern that cannot be scored is not a pattern."""


@dataclass(frozen=True)
class Section:
    name: str
    subject: str
    question_type: QuestionType
    count: int
    marks_correct: Decimal
    marks_wrong: Decimal
    marks_unattempted: Decimal = Decimal("0")
    attempt_limit: int | None = None
    numeric_tolerance: Decimal | None = None

    def __post_init__(self) -> None:
        if self.count <= 0:
            raise PatternError(f"section {self.name!r} has {self.count} questions")
        if self.marks_correct <= 0:
            raise PatternError(
                f"section {self.name!r} awards {self.marks_correct} for a correct answer; "
                "a section where being right is worth nothing is a configuration mistake"
            )
        if self.marks_wrong > 0:
            raise PatternError(
                f"section {self.name!r} has marks_wrong={self.marks_wrong}. Negative marking "
                "is expressed as a NEGATIVE number (or zero); a positive value would award "
                "marks for wrong answers, which is the sign error most likely to survive review"
            )
        if self.attempt_limit is not None and not (0 < self.attempt_limit <= self.count):
            raise PatternError(
                f"section {self.name!r} lets a candidate attempt {self.attempt_limit} "
                f"of {self.count}"
            )
        if self.question_type is QuestionType.NUMERIC:
            if self.numeric_tolerance is None or self.numeric_tolerance < 0:
                raise PatternError(
                    f"numeric section {self.name!r} needs a non-negative numeric_tolerance. "
                    "Comparing a candidate's typed decimal to the key by exact equality "
                    "fails everyone who wrote 0.33 where the key holds 1/3"
                )
        elif self.numeric_tolerance is not None:
            raise PatternError(
                f"section {self.name!r} is {self.question_type.value} but sets a numeric "
                "tolerance, which nothing would ever read"
            )

    @property
    def max_marks(self) -> Decimal:
        """What a perfect candidate scores here — bounded by the attempt limit."""
        return Decimal(self.attempt_limit or self.count) * self.marks_correct


@dataclass(frozen=True)
class ExamPattern:
    """
    The whole shape of one paper. Built from stored JSON, validated on the way in.
    """

    sections: list[Section]
    duration_minutes: int
    calculator: str = "NONE"          # NONE | BASIC | SCIENTIFIC
    sections_are_timed_separately: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.sections:
            raise PatternError("a pattern with no sections describes no exam")
        if self.duration_minutes <= 0:
            raise PatternError(f"duration is {self.duration_minutes} minutes")
        seen: set[str] = set()
        for s in self.sections:
            if s.name in seen:
                # Section names travel into the mark sheet and into any
                # challenge about it; two rows called "Section A" is a document
                # nobody can argue about precisely.
                raise PatternError(f"two sections are both named {s.name!r}")
            seen.add(s.name)

    @property
    def total_questions(self) -> int:
        return sum(s.count for s in self.sections)

    @property
    def max_marks(self) -> Decimal:
        return sum((s.max_marks for s in self.sections), Decimal("0"))

    @property
    def subjects(self) -> list[str]:
        out: list[str] = []
        for s in self.sections:
            if s.subject not in out:
                out.append(s.subject)
        return out

    def blueprint(self) -> dict[str, int]:
        """
        How many items each subject needs — the input `build_forms` takes.

        This is the join between the pattern and the item pool: the pattern says
        what the paper must contain, assembly draws exactly that from items that
        belong to no exam.
        """
        bp: dict[str, int] = {}
        for s in self.sections:
            bp[s.subject] = bp.get(s.subject, 0) + s.count
        return bp

    def section_of(self, index: int) -> Section:
        """Which section question `index` (0-based, paper order) falls in."""
        if index < 0:
            raise PatternError(f"question index {index} is negative")
        cursor = 0
        for s in self.sections:
            if index < cursor + s.count:
                return s
            cursor += s.count
        raise PatternError(
            f"question index {index} is past the end of a {self.total_questions}-question paper"
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "sections": [
                {
                    "name": s.name,
                    "subject": s.subject,
                    "question_type": s.question_type.value,
                    "count": s.count,
                    "marks_correct": str(s.marks_correct),
                    "marks_wrong": str(s.marks_wrong),
                    "marks_unattempted": str(s.marks_unattempted),
                    "attempt_limit": s.attempt_limit,
                    "numeric_tolerance": (
                        str(s.numeric_tolerance) if s.numeric_tolerance is not None else None
                    ),
                }
                for s in self.sections
            ],
            "duration_minutes": self.duration_minutes,
            "calculator": self.calculator,
            "sections_are_timed_separately": self.sections_are_timed_separately,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "ExamPattern":
        """
        Rebuild from stored JSON, refusing anything that would not score.

        Decimal, never float. `0.1 + 0.2` is not `0.3` in binary floating point,
        and a total that is out by 1e-16 is a total that renders as a different
        number than the one on the mark sheet.
        """
        if not isinstance(raw, dict):
            raise PatternError("pattern must be an object")
        try:
            sections = [
                Section(
                    name=str(s["name"]),
                    subject=str(s["subject"]),
                    question_type=QuestionType(s["question_type"]),
                    count=int(s["count"]),
                    marks_correct=Decimal(str(s["marks_correct"])),
                    marks_wrong=Decimal(str(s["marks_wrong"])),
                    marks_unattempted=Decimal(str(s.get("marks_unattempted", "0"))),
                    attempt_limit=(
                        int(s["attempt_limit"]) if s.get("attempt_limit") is not None else None
                    ),
                    numeric_tolerance=(
                        Decimal(str(s["numeric_tolerance"]))
                        if s.get("numeric_tolerance") is not None
                        else None
                    ),
                )
                for s in raw["sections"]
            ]
        except PatternError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            raise PatternError(f"malformed section: {exc}") from exc

        return cls(
            sections=sections,
            duration_minutes=int(raw["duration_minutes"]),
            calculator=str(raw.get("calculator", "NONE")),
            sections_are_timed_separately=bool(raw.get("sections_are_timed_separately", False)),
            metadata=dict(raw.get("metadata") or {}),
        )


# ── the shapes people actually sit ──────────────────────────────────────────
#
# Presets, not special cases: each is an ordinary ExamPattern, and the terminal
# and the scorer cannot tell them apart from a custom one. They exist so an
# administrator setting up JEE Main does not re-derive its marking scheme, and
# so the numbers are in one reviewable place rather than in an operator's head.

def jee_main() -> ExamPattern:
    """75 questions, 300 marks. Numeric sections carry NO negative marking."""
    sections: list[Section] = []
    for subject in ("Physics", "Chemistry", "Mathematics"):
        sections.append(Section(
            name=f"{subject} — Section A",
            subject=subject,
            question_type=QuestionType.SINGLE_CHOICE,
            count=20,
            marks_correct=Decimal("4"),
            marks_wrong=Decimal("-1"),
        ))
        sections.append(Section(
            name=f"{subject} — Section B",
            subject=subject,
            question_type=QuestionType.NUMERIC,
            count=10,
            marks_correct=Decimal("4"),
            marks_wrong=Decimal("0"),
            attempt_limit=5,
            numeric_tolerance=Decimal("0.01"),
        ))
    return ExamPattern(sections=sections, duration_minutes=180, calculator="NONE")


def neet_ug() -> ExamPattern:
    """180 questions, 720 marks, single-choice throughout."""
    sections = [
        Section(
            name=subject, subject=subject,
            question_type=QuestionType.SINGLE_CHOICE, count=count,
            marks_correct=Decimal("4"), marks_wrong=Decimal("-1"),
        )
        for subject, count in (
            ("Physics", 45), ("Chemistry", 45), ("Botany", 45), ("Zoology", 45),
        )
    ]
    return ExamPattern(sections=sections, duration_minutes=200, calculator="NONE")


PRESETS = {"JEE_MAIN": jee_main, "NEET_UG": neet_ug}
