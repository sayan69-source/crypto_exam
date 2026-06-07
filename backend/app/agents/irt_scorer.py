"""
CryptoExam Core — IRTScorerAgent
Assigns IRT 3PL parameters (b, a, c) to generated questions using heuristics.

Production: sentence-BERT embedding → kNN(k=7) against calibrated corpus → interpolate.
Demo: deterministic heuristic scoring based on question features.
"""

import hashlib
import logging
import math
import time

from app.agents.models import AgentLogEntry, AgentName, GeneratedQuestion, IRTScore

logger = logging.getLogger(__name__)


# Difficulty keywords by cognitive demand
EASY_KEYWORDS = {
    "define", "name", "list", "identify", "state", "recall",
    "which of the following is", "the correct answer is",
    "what is", "who is", "when was",
}

HARD_KEYWORDS = {
    "derive", "prove", "analyze", "evaluate", "compare and contrast",
    "calculate the ratio", "if and only if", "which combination",
    "consider the following statements", "assertion", "reason",
    "maximum", "minimum", "optimize",
}

VERY_HARD_KEYWORDS = {
    "deduce", "synthesize", "design", "critique", "formulate",
    "which of the following is/are correct",
    "multiple correct", "more than one",
}


class IRTScorerAgent:
    """
    Assigns IRT parameters to a generated question.
    
    3PL Model:
    - b (difficulty): [-3, +3], 0 = medium
    - a (discrimination): [0.5, 3.0], higher = better question
    - c (guessing): [0, 0.25], 4-option MCQ baseline = 0.25
    
    Pipeline step 2: GeneratorAgent → IRTScorerAgent → BloomsAgent
    """

    def __init__(self, target_b: float = 0.0, target_std: float = 1.0):
        self.target_b = target_b
        self.target_std = target_std

    def score(self, question: GeneratedQuestion) -> tuple[IRTScore, AgentLogEntry]:
        """Score a question's IRT parameters using heuristic analysis."""
        start = time.time()

        b = self._estimate_difficulty(question)
        a = self._estimate_discrimination(question)
        c = self._estimate_guessing(question)
        confidence = self._estimate_confidence(question)

        irt = IRTScore(b=b, a=a, c=c, confidence=confidence)
        duration_ms = (time.time() - start) * 1000

        log = AgentLogEntry(
            agent=AgentName.IRT_SCORER,
            action="score_irt",
            detail=f"Q:{question.id[:8]} → b={b:.2f} ({irt.difficulty_label}), a={a:.2f}, c={c:.2f}",
            success=True,
            duration_ms=duration_ms,
        )

        return irt, log

    def _estimate_difficulty(self, q: GeneratedQuestion) -> float:
        """
        Heuristic difficulty estimation.
        Factors: question length, keyword analysis, option complexity, subject.
        """
        text_lower = q.text.lower()
        score = 0.0

        # 1. Question length (longer = harder, generally)
        words = len(q.text.split())
        if words < 15:
            score -= 0.5
        elif words > 40:
            score += 0.5
        elif words > 60:
            score += 1.0

        # 2. Easy keyword detection
        for kw in EASY_KEYWORDS:
            if kw in text_lower:
                score -= 0.4
                break

        # 3. Hard keyword detection
        for kw in HARD_KEYWORDS:
            if kw in text_lower:
                score += 0.5
                break

        # 4. Very hard keyword detection
        for kw in VERY_HARD_KEYWORDS:
            if kw in text_lower:
                score += 0.8
                break

        # 5. Numerical content (calculations = harder)
        digit_ratio = sum(c.isdigit() for c in q.text) / max(len(q.text), 1)
        if digit_ratio > 0.05:
            score += 0.3

        # 6. Option complexity
        avg_opt_len = sum(len(v) for v in q.options.values()) / 4
        if avg_opt_len > 40:
            score += 0.3

        # 7. Subject adjustment
        subject_bias = {
            "Physics": 0.2, "Math": 0.3, "Chemistry": 0.0,
            "Biology": -0.2, "Reasoning": -0.1, "General Studies": 0.1,
        }
        score += subject_bias.get(q.subject, 0.0)

        # 8. Deterministic hash-based jitter for consistency
        h = int(hashlib.md5(q.text.encode()).hexdigest()[:8], 16)
        jitter = ((h % 100) - 50) / 100  # ±0.5
        score += jitter * 0.3

        # Clamp to valid range
        return max(-3.0, min(3.0, round(score, 2)))

    def _estimate_discrimination(self, q: GeneratedQuestion) -> float:
        """Higher for well-constructed questions with clear distractors."""
        # Good questions have options of similar length (distractors are plausible)
        opt_lengths = [len(v) for v in q.options.values()]
        length_variance = sum((l - sum(opt_lengths) / 4) ** 2 for l in opt_lengths) / 4
        
        # Low variance = similar options = good question
        if length_variance < 50:
            a = 1.5
        elif length_variance < 200:
            a = 1.2
        else:
            a = 0.8

        # Explanation quality
        if len(q.explanation) > 100:
            a += 0.3

        return max(0.5, min(3.0, round(a, 2)))

    def _estimate_guessing(self, q: GeneratedQuestion) -> float:
        """Guessing parameter — 0.25 for pure guess, lower for good distractors."""
        # 4-option MCQ baseline
        base_c = 0.25

        # If options are very similar (good distractors), reduce guessing effect
        opt_lengths = [len(v) for v in q.options.values()]
        if max(opt_lengths) - min(opt_lengths) < 10:
            base_c -= 0.05  # Good distractors

        return max(0.0, min(0.25, round(base_c, 2)))

    def _estimate_confidence(self, q: GeneratedQuestion) -> float:
        """How confident the scorer is in its IRT estimate."""
        # Higher confidence for questions that clearly match keyword patterns
        text_lower = q.text.lower()
        matches = 0
        for kw in EASY_KEYWORDS | HARD_KEYWORDS | VERY_HARD_KEYWORDS:
            if kw in text_lower:
                matches += 1
        
        base = 0.7
        base += min(0.25, matches * 0.08)
        return round(min(0.95, base), 2)
