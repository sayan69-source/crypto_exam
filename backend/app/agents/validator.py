"""
CryptoExam Core — ValidatorAgent
Accept/reject decisions based on IRT range, Bloom's match, and quality checks.
"""

import logging
import time

from app.agents.models import (
    AgentLogEntry, AgentName, BloomsClassification, BloomsLevel,
    GeneratedQuestion, IRTScore, ScoredQuestion, ValidationResult,
)

logger = logging.getLogger(__name__)


class ValidatorAgent:
    """
    Validates a scored question against pipeline targets.
    
    Accept criteria:
    1. IRT b within target ± tolerance
    2. Bloom's level matches target ± 1
    3. No duplicate detected
    4. Option quality passes basic checks
    
    Pipeline step 4: BloomsAgent → ValidatorAgent → (accept → pool | reject → retry)
    """

    def __init__(
        self,
        target_b: float = 0.0,
        b_tolerance: float = 1.5,
        min_a: float = 0.5,
        max_c: float = 0.25,
    ):
        self.target_b = target_b
        self.b_tolerance = b_tolerance
        self.min_a = min_a
        self.max_c = max_c
        self._seen_hashes: set[str] = set()
        self._duplicate_window: int = 0  # Track how many to skip for dedup

    def validate(
        self,
        question: GeneratedQuestion,
        irt: IRTScore,
        blooms: BloomsClassification,
        target_blooms: int | None = None,
    ) -> tuple[ValidationResult, AgentLogEntry]:
        """
        Validate a question against all criteria.
        
        Returns:
            (result, log_entry)
        """
        start = time.time()
        reasons: list[str] = []

        # 1. IRT range check
        irt_in_range = True
        if abs(irt.b - self.target_b) > self.b_tolerance:
            irt_in_range = False
            reasons.append(f"IRT b={irt.b:.2f} outside target {self.target_b:.1f}±{self.b_tolerance}")
        if irt.a < self.min_a:
            irt_in_range = False
            reasons.append(f"Discrimination a={irt.a:.2f} below minimum {self.min_a}")
        if irt.c > self.max_c:
            irt_in_range = False
            reasons.append(f"Guessing c={irt.c:.2f} above maximum {self.max_c}")

        # 2. Bloom's level match (±1 tolerance)
        blooms_matches = True
        if target_blooms is not None:
            if abs(blooms.level.value - target_blooms) > 1:
                blooms_matches = False
                reasons.append(
                    f"Bloom's L{blooms.level.value} ({blooms.level_name}) "
                    f"too far from target L{target_blooms}"
                )

        # 3. Duplicate detection (text similarity)
        text_key = question.text.strip().lower()[:80]
        no_duplicate = text_key not in self._seen_hashes
        if not no_duplicate:
            reasons.append("Duplicate question detected")
        else:
            self._seen_hashes.add(text_key)

        # 4. Option quality checks
        option_quality_ok = True
        opts = question.options

        # All options must have content
        if any(len(v.strip()) < 1 for v in opts.values()):
            option_quality_ok = False
            reasons.append("Empty option detected")

        # Correct option must exist in options
        if question.correct_option not in opts:
            option_quality_ok = False
            reasons.append(f"Correct option '{question.correct_option}' not in options")

        # Options shouldn't all be identical
        if len(set(opts.values())) < 3:
            option_quality_ok = False
            reasons.append("Too many identical options")

        # Final decision
        accepted = irt_in_range and blooms_matches and no_duplicate and option_quality_ok

        result = ValidationResult(
            accepted=accepted,
            reasons=reasons,
            irt_in_range=irt_in_range,
            blooms_matches=blooms_matches,
            no_duplicate=no_duplicate,
            option_quality_ok=option_quality_ok,
        )

        duration_ms = (time.time() - start) * 1000
        log = AgentLogEntry(
            agent=AgentName.VALIDATOR,
            action="validate" if accepted else "reject",
            detail=f"Q:{question.id[:8]} → {'✅ ACCEPTED' if accepted else '❌ REJECTED: ' + '; '.join(reasons)}",
            success=True,
            duration_ms=duration_ms,
        )

        return result, log
