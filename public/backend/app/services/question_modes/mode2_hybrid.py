"""
§ 28.4 — Mode 2: Human Made + AI Upgraded.

Preserves human questions exactly; AI analyses option quality, flags issues,
checks syllabus alignment and estimates IRT. The setter reviews each suggestion.

The analyses below are self-contained heuristics (runnable without an LLM). A
real LLM (Claude) can be plugged into `_improve_distractors` / `_flag_quality`
without changing the public shape.
"""

from __future__ import annotations

import logging

from app.services.pdf_ingestion import pdf_parser
from app.services.question_modes import _irt
from app.services.question_modes.mode3_human import _parse_questions, _subject_breakdown

logger = logging.getLogger(__name__)

_ABSOLUTE = ("always", "never", "all of the above", "none of the above", "only")


class Mode2HybridService:
    async def run(
        self,
        question_paper: bytes | str,
        syllabus: bytes | str | None,
        exam_id: str,
        difficulty: str = "MEDIUM",
        progress=None,
    ) -> dict:
        def step(pct, msg):
            if progress:
                progress(pct, msg)

        step(15, "Parsing uploaded paper…")
        questions = _parse_questions(question_paper)
        step(35, "Reading syllabus…")
        syllabus_struct = _parse_syllabus(syllabus) if syllabus else {"subjects": {}}

        step(55, "Analysing distractor quality…")
        suggestions = [self._analyse_options(q) for q in questions]

        step(72, "Flagging quality issues…")
        flags = [f for q in questions for f in self._flag_quality(q)]

        step(85, "Checking syllabus alignment…")
        alignment = self._alignment(questions, syllabus_struct)

        step(95, "Estimating IRT parameters…")
        irt_params = [_irt.estimate(q.question_text, [q.option_A, q.option_B, q.option_C, q.option_D]) for q in questions]

        step(100, "Mode 2 analysis complete.")
        return {
            "status": "READY_FOR_REVIEW",
            "mode": "HUMAN_MADE_AI_UPGRADED",
            "difficulty_target": difficulty,
            "question_count": len(questions),
            "original_questions": [q.to_dict() for q in questions],
            "distractor_suggestions": suggestions,
            "quality_flags": flags,
            "alignment_report": alignment,
            "irt": {
                "per_question": [p.to_dict() for p in irt_params],
                "distribution": _irt.difficulty_distribution(irt_params),
            },
            "subjects": _subject_breakdown(questions),
            "setter_review_required": True,
        }

    def _analyse_options(self, q) -> dict:
        analysis = {}
        opts = {"A": q.option_A, "B": q.option_B, "C": q.option_C, "D": q.option_D}
        for letter, text in opts.items():
            t = text.strip()
            if len(t) < 3:
                status, reason = "WEAK", "Option is very short — may be trivially eliminated."
            elif t.lower() in _ABSOLUTE:
                status, reason = "TRIVIAL", "Absolute/option-of-options wording is easy to rule out."
            else:
                status, reason = "GOOD", "Plausible distractor."
            analysis[letter] = {
                "status": status, "reason": reason,
                "suggestion": "" if status == "GOOD" else "Replace with a misconception-based distractor.",
            }
        return {"question_number": q.question_number, "analysis": analysis}

    def _flag_quality(self, q) -> list[dict]:
        flags = []
        low = q.question_text.lower()
        if any(w in low for w in _ABSOLUTE):
            flags.append({
                "question_number": q.question_number, "severity": "WARN",
                "code": "ABSOLUTE_LANGUAGE",
                "message": "Absolute language ('always'/'never') often creates ambiguity in MCQs.",
            })
        opts = [q.option_A.strip().lower(), q.option_B.strip().lower(), q.option_C.strip().lower(), q.option_D.strip().lower()]
        if len(set(opts)) < 4:
            flags.append({
                "question_number": q.question_number, "severity": "ERROR",
                "code": "DUPLICATE_OPTIONS", "message": "Two or more options are identical.",
            })
        return flags

    def _alignment(self, questions, syllabus_struct) -> dict:
        topics = [t.lower() for ts in syllabus_struct.get("subjects", {}).values() for t in ts]
        covered, gaps = 0, 0
        per_subject: dict[str, int] = {}
        for q in questions:
            subj = q.subject_guess or "General"
            per_subject[subj] = per_subject.get(subj, 0) + 1
            text = q.question_text.lower()
            if topics and any(tok in text for t in topics for tok in t.split()[:3]):
                covered += 1
            else:
                gaps += 1
        return {
            "covered": covered, "off_syllabus_or_unmatched": gaps,
            "coverage_pct": round(100 * covered / max(1, len(questions)), 1),
            "per_subject": per_subject,
        }


def _parse_syllabus(src: bytes | str) -> dict:
    if isinstance(src, str):
        return pdf_parser.parse_syllabus_from_text(src)
    return pdf_parser.parse_syllabus(src)


mode2_service = Mode2HybridService()
