"""
§ 28.5 — Mode 3: Completely Human Made.

Inputs : question_paper.pdf (+ options) + answer_key.pdf
Output : parsed paper, structural validation, IRT estimates, ENCRYPTED answer key.
No AI generation — AI is used only for format/consistency validation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.services.pdf_ingestion import pdf_parser, ParsedQuestion
from app.services.question_modes import _irt
from app.services.question_modes.answer_key_crypto import encrypt_answer_key

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    blocking_errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def has_blocking_errors(self) -> bool:
        return len(self.blocking_errors) > 0


class Mode3HumanService:
    async def run(
        self,
        question_paper: bytes | str,
        answer_key_input: bytes | str,
        exam_id: str,
        expected_total: int | None = None,
        reveal_time: str | None = None,
        progress=None,
    ) -> dict:
        def step(pct, msg):
            if progress:
                progress(pct, msg)

        step(10, "Extracting questions from PDF…")
        questions = _parse_questions(question_paper)
        step(35, "Extracting answer key…")
        answer_key = _parse_answer_key(answer_key_input)

        step(55, "Validating structure & answer-key completeness…")
        validation = self._validate(questions, answer_key, expected_total)
        if validation.has_blocking_errors:
            return {
                "status": "VALIDATION_FAILED",
                "mode": "COMPLETELY_HUMAN_MADE",
                "errors": validation.blocking_errors,
                "warnings": validation.warnings,
                "questions": [q.to_dict() for q in questions],
            }

        step(70, "Estimating IRT parameters…")
        irt_params = []
        for q in questions:
            q.correct_answer = answer_key.get(q.question_number)
            p = _irt.estimate(q.question_text, [q.option_A, q.option_B, q.option_C, q.option_D])
            irt_params.append(p)

        step(88, "Encrypting answer key (AES-GCM-256)…")
        encrypted_key = encrypt_answer_key(answer_key, exam_id, reveal_time)

        # Strip answers before returning question objects (security)
        public_questions = []
        for q in questions:
            d = q.to_dict()
            d.pop("correct_answer", None)
            public_questions.append(d)

        step(100, "Mode 3 parsing complete.")
        return {
            "status": "READY_FOR_REVIEW",
            "mode": "COMPLETELY_HUMAN_MADE",
            "question_count": len(questions),
            "questions": public_questions,
            "encrypted_answer_key": encrypted_key,   # never plaintext
            "irt": {
                "per_question": [p.to_dict() for p in irt_params],
                "distribution": _irt.difficulty_distribution(irt_params),
            },
            "validation": {"warnings": validation.warnings},
            "subjects": _subject_breakdown(questions),
            "setter_review_required": True,
        }

    def _validate(self, questions, answer_key, expected_total) -> ValidationResult:
        r = ValidationResult()
        if not questions:
            r.blocking_errors.append("No questions could be extracted from the paper PDF.")
            return r
        if expected_total and len(questions) != expected_total:
            r.warnings.append(f"Expected {expected_total} questions; found {len(questions)}.")

        for q in questions:
            for letter in ("A", "B", "C", "D"):
                if not getattr(q, f"option_{letter}", "").strip():
                    r.blocking_errors.append(f"Q{q.question_number}: option {letter} is empty.")

        missing = [q.question_number for q in questions if q.question_number not in answer_key]
        if missing:
            r.blocking_errors.append(f"Answer key missing for questions: {missing[:20]}")

        nums = [q.question_number for q in questions]
        dupes = sorted({n for n in nums if nums.count(n) > 1})
        if dupes:
            r.blocking_errors.append(f"Duplicate question numbers: {dupes}")
        return r


# ── shared helpers used by all modes ───────────────────────────────────

def _parse_questions(src: bytes | str) -> list[ParsedQuestion]:
    if isinstance(src, str):
        return pdf_parser.parse_question_paper_from_text(src)
    return pdf_parser.parse_question_paper(src)


def _parse_answer_key(src: bytes | str) -> dict[int, str]:
    if isinstance(src, str):
        return pdf_parser.parse_answer_key_from_text(src)
    return pdf_parser.parse_answer_key(src)


def _subject_breakdown(questions: list[ParsedQuestion]) -> dict:
    out: dict[str, int] = {}
    for q in questions:
        out[q.subject_guess or "General"] = out.get(q.subject_guess or "General", 0) + 1
    return out


mode3_service = Mode3HumanService()
