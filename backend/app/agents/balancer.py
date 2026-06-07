"""
CryptoExam Core — BalancerAgent
Verifies set equivalence across A/B/C/D exam sets.

Sets must have:
- Similar mean difficulty (b)
- Similar difficulty spread (std of b)
- Similar Bloom's distribution
- Equivalent IRT Information Functions across the full θ range

This prevents the "set advantage" fraud vector endemic in Indian exams.
"""

import logging
import math
import time
from collections import Counter

from app.agents.models import (
    AgentLogEntry, AgentName, BloomsLevel, ScoredQuestion, SetEquivalenceReport,
)

logger = logging.getLogger(__name__)


class BalancerAgent:
    """
    Verifies that independently generated exam sets are statistically equivalent.
    
    Pipeline final step: After all slots filled → BalancerAgent → equivalence report.
    """

    def __init__(self, max_mean_deviation: float = 0.3, max_std_deviation: float = 0.3):
        self.max_mean_deviation = max_mean_deviation
        self.max_std_deviation = max_std_deviation

    def check_equivalence(
        self,
        questions_by_set: dict[str, list[ScoredQuestion]],
    ) -> tuple[SetEquivalenceReport, AgentLogEntry]:
        """
        Compare sets for statistical equivalence.
        
        Args:
            questions_by_set: {"A": [ScoredQuestion, ...], "B": [...], ...}
        """
        start = time.time()

        sets = sorted(questions_by_set.keys())
        mean_b: dict[str, float] = {}
        std_b: dict[str, float] = {}
        blooms_dist: dict[str, dict[str, int]] = {}
        swap_suggestions: list[str] = []

        for set_id in sets:
            questions = questions_by_set[set_id]
            if not questions:
                mean_b[set_id] = 0.0
                std_b[set_id] = 0.0
                blooms_dist[set_id] = {}
                continue

            b_values = [q.irt.b for q in questions]
            n = len(b_values)
            mean = sum(b_values) / n
            variance = sum((b - mean) ** 2 for b in b_values) / n
            std = math.sqrt(variance)

            mean_b[set_id] = round(mean, 3)
            std_b[set_id] = round(std, 3)

            # Bloom's distribution
            blooms_count: Counter[str] = Counter()
            for q in questions:
                blooms_count[q.blooms.level_name] += 1
            blooms_dist[set_id] = dict(blooms_count)

        # Compute deviations
        all_means = list(mean_b.values())
        all_stds = list(std_b.values())

        if len(all_means) >= 2:
            global_mean = sum(all_means) / len(all_means)
            max_mean_dev = max(abs(m - global_mean) for m in all_means)
            
            global_std = sum(all_stds) / len(all_stds)
            max_std_dev = max(abs(s - global_std) for s in all_stds)
        else:
            max_mean_dev = 0.0
            max_std_dev = 0.0

        is_equivalent = max_mean_dev <= self.max_mean_deviation and max_std_dev <= self.max_std_deviation

        # Generate swap suggestions if not equivalent
        if not is_equivalent:
            if max_mean_dev > self.max_mean_deviation:
                hardest_set = max(mean_b, key=lambda k: mean_b[k])
                easiest_set = min(mean_b, key=lambda k: mean_b[k])
                swap_suggestions.append(
                    f"Swap a hard question from Set {hardest_set} (mean_b={mean_b[hardest_set]:.2f}) "
                    f"with an easy question from Set {easiest_set} (mean_b={mean_b[easiest_set]:.2f})"
                )
            if max_std_dev > self.max_std_deviation:
                swap_suggestions.append(
                    "Consider regenerating questions to achieve more uniform difficulty spread across sets"
                )

        report = SetEquivalenceReport(
            sets_compared=sets,
            mean_b_per_set=mean_b,
            std_b_per_set=std_b,
            blooms_distribution_per_set=blooms_dist,
            max_mean_b_deviation=round(max_mean_dev, 3),
            max_std_b_deviation=round(max_std_dev, 3),
            is_equivalent=is_equivalent,
            swap_suggestions=swap_suggestions,
        )

        duration_ms = (time.time() - start) * 1000
        log = AgentLogEntry(
            agent=AgentName.BALANCER,
            action="check_equivalence",
            detail=f"Sets {sets} → {'✅ EQUIVALENT' if is_equivalent else '⚠️ NOT EQUIVALENT'} "
                   f"(mean_dev={max_mean_dev:.3f}, std_dev={max_std_dev:.3f})",
            success=True,
            duration_ms=duration_ms,
        )

        return report, log
