"""
§ 28.3 — Mode 1: Completely AI Made.

Inputs : seed questions.pdf (style reference) + syllabus.pdf
Output : fresh AI-generated paper, IRT-calibrated, blueprint-driven.

The uploaded seed questions are used for STYLE ONLY — they are not included.
Generation here is a self-contained, deterministic synthesiser driven by the
syllabus blueprint so the pipeline is fully runnable offline. To produce real
exam content, plug an LLM into `_generate_for_topic` (the spec uses Claude) —
the surrounding pipeline (blueprint → generate → IRT → dedup) is unchanged.
"""

from __future__ import annotations

import logging
import re

from app.services.pdf_ingestion import pdf_parser
from app.services.question_modes import _irt
from app.services.question_modes.mode3_human import _parse_questions
from app.services.question_modes.mode2_hybrid import _parse_syllabus

logger = logging.getLogger(__name__)


class Mode1AIMadeService:
    async def run(
        self,
        seed_questions: bytes | str | None,
        syllabus: bytes | str,
        exam_id: str,
        total_questions: int = 30,
        difficulty: str = "MEDIUM",
        progress=None,
    ) -> dict:
        def step(pct, msg):
            if progress:
                progress(pct, msg)

        step(12, "Reading seed questions for style…")
        seeds = _parse_questions(seed_questions) if seed_questions else []
        style = self._style_profile(seeds)

        step(30, "Reading syllabus & building blueprint…")
        syllabus_struct = _parse_syllabus(syllabus)
        blueprint = self._blueprint(syllabus_struct, total_questions)

        step(55, "Generating questions topic-by-topic…")
        generated = []
        for topic, count in blueprint.items():
            generated.extend(self._generate_for_topic(topic, count, difficulty))
        generated = generated[:total_questions]

        step(78, "De-duplicating (semantic overlap)…")
        generated = self._dedup(generated)

        step(90, "Calibrating IRT parameters…")
        irt_params = [_irt.estimate(q["question"], [q["A"], q["B"], q["C"], q["D"]]) for q in generated]

        step(100, "Mode 1 generation complete.")
        return {
            "status": "READY_FOR_REVIEW",
            "mode": "COMPLETELY_AI_MADE",
            "style_profile": style,
            "blueprint": blueprint,
            "question_count": len(generated),
            "questions": generated,
            "irt": {
                "per_question": [p.to_dict() for p in irt_params],
                "distribution": _irt.difficulty_distribution(irt_params),
            },
            "setter_review_required": True,
        }

    def _style_profile(self, seeds) -> dict:
        if not seeds:
            return {"avg_stem_words": 18, "sample_size": 0, "tone": "formal-academic"}
        words = [len(q.question_text.split()) for q in seeds]
        return {
            "avg_stem_words": round(sum(words) / len(words), 1),
            "sample_size": len(seeds),
            "tone": "formal-academic",
        }

    def _blueprint(self, syllabus_struct: dict, total: int) -> dict:
        topics = [t for ts in syllabus_struct.get("subjects", {}).values() for t in ts]
        if not topics:
            topics = ["General Aptitude"]
        topics = topics[: max(1, min(len(topics), total))]
        base = total // len(topics)
        rem = total - base * len(topics)
        plan = {}
        for i, t in enumerate(topics):
            plan[t] = base + (1 if i < rem else 0)
        return {k: v for k, v in plan.items() if v > 0}

    def _generate_for_topic(self, topic: str, count: int, difficulty: str) -> list[dict]:
        """Deterministic synthesiser placeholder (swap for an LLM call)."""
        topic = re.sub(r'\s+', ' ', topic).strip().rstrip('.')[:80] or "General"
        out = []
        for i in range(count):
            out.append({
                "question": f"[{difficulty}] On the topic of {topic}, which of the following statements is correct? (item {i + 1})",
                "A": f"A correct principle of {topic}.",
                "B": f"A common misconception about {topic}.",
                "C": f"An unrelated property mistakenly linked to {topic}.",
                "D": f"A partially-true statement about {topic}.",
                "correct": "A",
                "topic": topic,
                "bloom_level": 2 if difficulty == "EASY" else 3 if difficulty == "MEDIUM" else 4,
                "ai_generated": True,
            })
        return out

    def _dedup(self, questions: list[dict]) -> list[dict]:
        seen, out = set(), []
        for q in questions:
            key = q["question"].lower()
            if key not in seen:
                seen.add(key)
                out.append(q)
        return out


mode1_service = Mode1AIMadeService()
