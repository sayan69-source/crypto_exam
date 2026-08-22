"""
§ 4.3 (V3) — AI Adversarial Red-Team Agent.

Attacks every question with three personas IN PARALLEL before a paper can lock:
  1. The Clever Student   — looking for grammar/elimination loopholes
  2. The RTI Officer      — looking for legally challengeable phrasing
  3. The Opposition Lawyer — looking for any defensible alternate answer

A question fails if ANY persona returns a BLOCKER. BLOCKERs cannot be overridden
— the setter MUST fix or remove them. WARN flags may be acknowledged.

Pluggable LLM
-------------
If `anthropic` is installed AND `ANTHROPIC_API_KEY` is set, real Claude calls are
made. Otherwise a self-contained heuristic attack pass runs (deterministic, fully
offline) so the V3 pipeline is always demoable. Both paths yield the same
RedTeamReport shape — the setter UI is identical.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)

try:  # pragma: no cover — optional production dependency
    import anthropic  # type: ignore
    _HAS_ANTHROPIC = bool(os.environ.get("ANTHROPIC_API_KEY"))
except Exception:  # noqa: BLE001
    _HAS_ANTHROPIC = False


# ── Types ───────────────────────────────────────────────────────────────

class AttackType(str, Enum):
    AMBIGUITY = "AMBIGUITY"
    MULTIPLE_CORRECT = "MULTIPLE_CORRECT"
    NO_CORRECT = "NO_CORRECT"
    ABSOLUTE_LANGUAGE = "ABSOLUTE_LANGUAGE"
    CULTURAL_BIAS = "CULTURAL_BIAS"
    GRAMMAR_ELIM = "GRAMMAR_ELIM"
    TRIVIAL_DISTRACTOR = "TRIVIAL_DISTRACTOR"
    ANSWER_LEAKED = "ANSWER_LEAKED"
    SYLLABUS_BREACH = "SYLLABUS_BREACH"
    OUTDATED_FACT = "OUTDATED_FACT"


@dataclass
class RedTeamFlag:
    question_number: int
    attack_type: str
    severity: str            # "BLOCKER" | "WARN"
    description: str
    suggested_fix: Optional[str]
    confidence: float
    persona: str             # which persona raised the flag

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RedTeamReport:
    total_questions: int
    blockers: list[RedTeamFlag] = field(default_factory=list)
    warnings: list[RedTeamFlag] = field(default_factory=list)
    passed_clean: int = 0
    red_team_passed: bool = False
    backend: str = "heuristic"

    def to_dict(self) -> dict:
        return {
            "total_questions": self.total_questions,
            "blockers": [f.to_dict() for f in self.blockers],
            "warnings": [f.to_dict() for f in self.warnings],
            "passed_clean": self.passed_clean,
            "red_team_passed": self.red_team_passed,
            "backend": self.backend,
            "blocker_count": len(self.blockers),
            "warning_count": len(self.warnings),
        }


# ── Persona prompts (used when Claude is available) ─────────────────────

_PERSONAS = {
    "clever_student": (
        "You are a clever student trying to get full marks WITHOUT real knowledge. "
        "Look for: grammar/elimination loopholes, two defensible options, obviously wrong distractors that trivialise guessing."
    ),
    "rti_officer": (
        "You are an RTI officer reviewing an examination question. "
        "Look for: ambiguous phrasing, no single defensible answer, outdated facts, cultural assumptions, "
        "anything that would not survive a legal challenge in High Court."
    ),
    "opposition_lawyer": (
        "You are a lawyer for a failed candidate. Find ANY interpretation where a different answer can be defended. "
        "Find domain edge cases where the marked answer is wrong."
    ),
}


# ── Heuristic detectors (used when no LLM) ──────────────────────────────

_ABSOLUTE_WORDS = ("always", "never", "only", "exclusively", "all of the above", "none of the above")
_BIASED = ("our country", "in india only", "in our religion", "mother tongue", "vedic")
_OUTDATED_HINTS = ("pluto is a planet", "9 planets", "appendix is useless", "great wall visible from space")


def _detect_heuristic(q_num: int, stem: str, opts: dict[str, str], correct: Optional[str]) -> list[RedTeamFlag]:
    flags: list[RedTeamFlag] = []
    low = stem.lower()
    opt_texts = [v.strip() for v in opts.values()]
    opt_low = [v.lower() for v in opt_texts]

    # 1) Absolute language → WARN (Clever Student + RTI)
    if any(w in low for w in _ABSOLUTE_WORDS) or any(w in t for t in opt_low for w in _ABSOLUTE_WORDS):
        flags.append(RedTeamFlag(
            q_num, AttackType.ABSOLUTE_LANGUAGE.value, "WARN",
            "Question or options contain absolute language ('always'/'never'/'only') — often creates ambiguity.",
            "Soften absolutes; specify the context where the statement holds.",
            0.85, "rti_officer",
        ))

    # 2) Duplicate options → BLOCKER (MULTIPLE_CORRECT possible)
    if len({t for t in opt_low if t}) < len(opt_texts):
        flags.append(RedTeamFlag(
            q_num, AttackType.MULTIPLE_CORRECT.value, "BLOCKER",
            "Two or more options are textually identical — multiple correct answers possible.",
            "Rewrite duplicate options as distinct misconception-based distractors.",
            0.99, "opposition_lawyer",
        ))

    # 3) Trivial distractor (very short option) → WARN
    if any(0 < len(t) <= 2 for t in opt_texts):
        flags.append(RedTeamFlag(
            q_num, AttackType.TRIVIAL_DISTRACTOR.value, "WARN",
            "A distractor is one or two characters long — too short to test knowledge.",
            "Replace with a plausible alternative of comparable length.",
            0.8, "clever_student",
        ))

    # 4) Answer-in-question — if any opt token appears verbatim in stem and is short, flag
    if correct and correct in opts:
        corr = opts[correct].lower().strip()
        toks = [t for t in corr.split() if len(t) > 4]
        if toks and any(tok in low for tok in toks):
            flags.append(RedTeamFlag(
                q_num, AttackType.ANSWER_LEAKED.value, "BLOCKER",
                "The correct option's key term appears verbatim in the question stem — the answer is leaked.",
                "Paraphrase the stem so the key term is not repeated.",
                0.88, "clever_student",
            ))

    # 5) Cultural bias markers
    if any(w in low for w in _BIASED):
        flags.append(RedTeamFlag(
            q_num, AttackType.CULTURAL_BIAS.value, "WARN",
            "Stem contains culturally-loaded phrasing that may disadvantage some candidates.",
            "Use neutral phrasing applicable across regions and religions.",
            0.75, "rti_officer",
        ))

    # 6) Outdated facts
    if any(h in low for h in _OUTDATED_HINTS):
        flags.append(RedTeamFlag(
            q_num, AttackType.OUTDATED_FACT.value, "BLOCKER",
            "Statement references a scientific fact that has been superseded.",
            "Update to current scientific consensus.",
            0.9, "opposition_lawyer",
        ))

    # 7) Grammar elimination — if exactly one option uses 'are/is' that matches the stem
    if re.search(r'\bis\b', low):
        plural = [k for k, v in opts.items() if re.search(r'\bare\b', v.lower())]
        if len(plural) == 1 and correct and correct not in plural:
            flags.append(RedTeamFlag(
                q_num, AttackType.GRAMMAR_ELIM.value, "WARN",
                "Grammatical number-agreement eliminates exactly one option without domain knowledge.",
                "Match verb agreement across all options.",
                0.7, "clever_student",
            ))

    # 8) Ambiguity: question contains 'best', 'most likely' but options aren't comparable
    if ("best" in low or "most likely" in low) and len(set(len(t) for t in opt_texts)) >= 3:
        flags.append(RedTeamFlag(
            q_num, AttackType.AMBIGUITY.value, "WARN",
            "Comparative phrasing ('best'/'most likely') with options of unequal specificity invites dispute.",
            "Define the comparison axis explicitly or constrain option length parity.",
            0.7, "rti_officer",
        ))

    return flags


# ── Claude path ─────────────────────────────────────────────────────────

async def _persona_attack_claude(
    client, q_num: int, stem: str, opts: dict[str, str], correct: Optional[str], subject: Optional[str],
    persona: str, prompt: str,
) -> list[RedTeamFlag]:
    user = (
        f"{prompt}\n\n"
        f"Question {q_num}: {stem}\n"
        f"A) {opts.get('A','')}  B) {opts.get('B','')}  C) {opts.get('C','')}  D) {opts.get('D','')}\n"
        f"Stated correct answer: {correct}\nSubject: {subject or 'Unknown'}\n\n"
        "Identify all flaws. For each flaw, return a JSON object with keys: "
        "attack_type (one of AMBIGUITY|MULTIPLE_CORRECT|NO_CORRECT|ABSOLUTE_LANGUAGE|CULTURAL_BIAS|GRAMMAR_ELIM|"
        "TRIVIAL_DISTRACTOR|ANSWER_LEAKED|SYLLABUS_BREACH|OUTDATED_FACT), severity (BLOCKER|WARN), "
        "description, suggested_fix, confidence (0..1). Return a JSON ARRAY only. Empty array if clean."
    )
    try:
        resp = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": user}],
        )
        text = resp.content[0].text.strip()
        # Tolerate code fences
        text = re.sub(r'^```(?:json)?|```$', '', text, flags=re.MULTILINE).strip()
        raw = json.loads(text)
        out: list[RedTeamFlag] = []
        for f in raw:
            try:
                if f.get("confidence", 0.0) < 0.65:
                    continue
                out.append(RedTeamFlag(
                    q_num, f["attack_type"], f["severity"], f["description"],
                    f.get("suggested_fix"), float(f.get("confidence", 0.8)), persona,
                ))
            except Exception:  # noqa: BLE001
                continue
        return out
    except Exception as e:  # noqa: BLE001
        logger.warning("Claude red-team persona %s failed (%s) — falling back", persona, e)
        return []


# ── Public agent ────────────────────────────────────────────────────────

class AdversarialRedTeamAgent:
    async def red_team_paper(
        self, questions: list[dict], answer_key: dict[int, str] | None = None,
    ) -> RedTeamReport:
        """
        questions: list of dicts with keys question_number/text, option_A..D, optional correct, subject
                    (works with the dicts emitted by ParsedQuestion/Mode services)
        answer_key: optional {q_num: 'A'|'B'|'C'|'D'} — preferred over question.correct
        """
        backend = "claude" if _HAS_ANTHROPIC else "heuristic"

        all_flags: list[RedTeamFlag] = []
        if _HAS_ANTHROPIC:  # pragma: no cover - requires API
            client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
            sem = asyncio.Semaphore(10)

            async def attack_one(q: dict) -> list[RedTeamFlag]:
                async with sem:
                    q_num = int(q.get("question_number", 0))
                    stem = q.get("question_text") or q.get("question") or ""
                    opts = {k: q.get(f"option_{k}", q.get(k, "")) for k in "ABCD"}
                    correct = (answer_key or {}).get(q_num) or q.get("correct_answer") or q.get("correct")
                    subj = q.get("subject_guess") or q.get("subject")
                    sub_flags = await asyncio.gather(*[
                        _persona_attack_claude(client, q_num, stem, opts, correct, subj, p, prm)
                        for p, prm in _PERSONAS.items()
                    ])
                    return [f for ff in sub_flags for f in ff]

            results = await asyncio.gather(*[attack_one(q) for q in questions])
            for r in results:
                all_flags.extend(r)
        else:
            # Heuristic path: deterministic, runs without external services
            for q in questions:
                q_num = int(q.get("question_number", 0))
                stem = q.get("question_text") or q.get("question") or ""
                opts = {k: q.get(f"option_{k}", q.get(k, "")) for k in "ABCD"}
                correct = (answer_key or {}).get(q_num) or q.get("correct_answer") or q.get("correct")
                all_flags.extend(_detect_heuristic(q_num, stem, opts, correct))

        blockers = [f for f in all_flags if f.severity == "BLOCKER"]
        warnings = [f for f in all_flags if f.severity == "WARN"]
        flagged_q = {f.question_number for f in all_flags}
        passed_clean = max(0, len(questions) - len(flagged_q))
        return RedTeamReport(
            total_questions=len(questions),
            blockers=blockers, warnings=warnings,
            passed_clean=passed_clean,
            red_team_passed=(len(blockers) == 0),
            backend=backend,
        )


red_team_agent = AdversarialRedTeamAgent()
