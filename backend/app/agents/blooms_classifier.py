"""
CryptoExam Core — BloomsAgent
Classifies questions by Bloom's Taxonomy cognitive level (1-6).

Uses keyword/verb-pattern matching on question stems.
Supports English and Hindi verb stems.
"""

import logging
import time
from typing import Optional

from app.agents.models import AgentLogEntry, AgentName, BloomsClassification, BloomsLevel, GeneratedQuestion

logger = logging.getLogger(__name__)


# Bloom's Taxonomy verb stems by level
# Each verb maps to its Bloom's level
BLOOMS_VERBS: dict[int, set[str]] = {
    1: {  # Remember
        "define", "list", "name", "identify", "recall", "state", "recognize",
        "label", "select", "match", "memorize", "repeat", "describe",
        "which of the following is", "what is", "who is", "when was", "where is",
        # Hindi
        "परिभाषित", "नाम बताइए", "पहचानिए", "सूची",
    },
    2: {  # Understand
        "explain", "summarize", "interpret", "classify", "compare",
        "distinguish", "paraphrase", "predict", "translate", "discuss",
        "give an example", "in your own words",
        "the correct statement is", "which statement is true",
        # Hindi
        "समझाइए", "व्याख्या", "वर्गीकरण",
    },
    3: {  # Apply
        "calculate", "solve", "compute", "determine", "apply",
        "demonstrate", "use", "find", "show that", "illustrate",
        "if the value", "the speed of", "the force on",
        "what is the value of", "find the",
        # Hindi
        "गणना कीजिए", "हल कीजिए", "ज्ञात कीजिए",
    },
    4: {  # Analyze
        "analyze", "differentiate", "examine", "compare and contrast",
        "break down", "categorize", "deduce", "infer", "distinguish between",
        "what is the relationship", "the ratio of",
        "consider the following statements", "which of the following is/are correct",
        # Hindi
        "विश्लेषण", "अंतर बताइए", "तुलना कीजिए",
    },
    5: {  # Evaluate
        "evaluate", "justify", "assess", "critique", "judge",
        "argue", "defend", "support", "recommend", "prioritize",
        "which is the most", "which is the best", "the most suitable",
        "assertion", "reason", "both assertion and reason",
        # Hindi
        "मूल्यांकन", "उचित ठहराइए",
    },
    6: {  # Create
        "design", "construct", "create", "propose", "formulate",
        "synthesize", "develop", "compose", "plan", "invent",
        "devise a method", "how would you",
        # Hindi
        "रचना कीजिए", "प्रस्ताव दीजिए",
    },
}

# Build reverse lookup: verb → level
VERB_TO_LEVEL: dict[str, int] = {}
for level, verbs in BLOOMS_VERBS.items():
    for verb in verbs:
        VERB_TO_LEVEL[verb] = level


class BloomsAgent:
    """
    Classifies questions by Bloom's Taxonomy cognitive level.
    
    Pipeline step 3: IRTScorerAgent → BloomsAgent → ValidatorAgent
    """

    def classify(self, question: GeneratedQuestion) -> tuple[BloomsClassification, AgentLogEntry]:
        """Classify a question's Bloom's Taxonomy level."""
        start = time.time()

        text_lower = question.text.lower()
        detected_verbs: list[str] = []
        level_scores: dict[int, float] = {i: 0.0 for i in range(1, 7)}

        # 1. Scan for Bloom's verb stems
        for verb, level in VERB_TO_LEVEL.items():
            if verb in text_lower:
                detected_verbs.append(verb)
                level_scores[level] += 1.0

        # 2. Structural analysis bonuses
        # Multi-statement questions → Analyze/Evaluate
        if "consider the following" in text_lower or "which of the following" in text_lower:
            level_scores[4] += 0.5

        # Assertion-Reason → Evaluate
        if "assertion" in text_lower and "reason" in text_lower:
            level_scores[5] += 1.0

        # Numerical calculations → Apply
        if any(c.isdigit() for c in question.text):
            digit_ratio = sum(c.isdigit() for c in question.text) / max(len(question.text), 1)
            if digit_ratio > 0.03:
                level_scores[3] += 0.5

        # "If...then" conditional → Analyze
        if " if " in text_lower and " then " in text_lower:
            level_scores[4] += 0.3

        # 3. Default bias: if no clear signal, lean towards Apply (level 3)
        if all(s == 0 for s in level_scores.values()):
            level_scores[3] = 1.0

        # 4. Find highest-scoring level
        best_level = max(level_scores, key=lambda k: level_scores[k])
        total_score = sum(level_scores.values())
        confidence = level_scores[best_level] / total_score if total_score > 0 else 0.5

        result = BloomsClassification(
            level=BloomsLevel(best_level),
            confidence=round(min(0.95, max(0.4, confidence)), 2),
            detected_verbs=detected_verbs[:5],
        )

        duration_ms = (time.time() - start) * 1000
        log = AgentLogEntry(
            agent=AgentName.BLOOMS,
            action="classify_blooms",
            detail=f"Q:{question.id[:8]} → L{best_level} ({result.level_name}) [conf={result.confidence:.0%}, verbs={detected_verbs[:3]}]",
            success=True,
            duration_ms=duration_ms,
        )

        return result, log
