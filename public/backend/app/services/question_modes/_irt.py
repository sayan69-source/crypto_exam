"""
Lightweight, dependency-free IRT (3PL) parameter estimation.

Without a calibrated response dataset we derive deterministic, reproducible
estimates from the question text/options so the downstream pipeline (difficulty
histogram, ZK inputs) has stable values. Swap for `app.agents.irt_scorer` when
a real calibration backend is wired.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass


@dataclass
class IRTParams:
    b: float  # difficulty
    a: float  # discrimination
    c: float  # guessing

    def to_dict(self) -> dict:
        return {"b": round(self.b, 3), "a": round(self.a, 3), "c": round(self.c, 3)}


def _unit(seed: str) -> float:
    h = int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16)
    return (h % 10_000) / 10_000.0


def estimate(question_text: str, options: list[str]) -> IRTParams:
    base = question_text + "|" + "|".join(options)
    # difficulty centred ~0.2, spread ~0.8; longer/complex stems skew harder
    length_factor = min(1.0, len(question_text) / 200.0)
    b = (_unit(base + ":b") * 4 - 2) * 0.45 + 0.2 + length_factor * 0.4
    a = 0.8 + _unit(base + ":a") * 1.7      # 0.8 – 2.5
    c = 0.15 + _unit(base + ":c") * 0.10    # 0.15 – 0.25
    return IRTParams(b=b, a=a, c=c)


def difficulty_distribution(params: list[IRTParams]) -> dict:
    if not params:
        return {"easy": 0, "medium": 0, "hard": 0, "mean_b": 0.0}
    easy = sum(1 for p in params if p.b < -0.5)
    hard = sum(1 for p in params if p.b > 1.0)
    medium = len(params) - easy - hard
    return {
        "easy": easy, "medium": medium, "hard": hard,
        "mean_b": round(sum(p.b for p in params) / len(params), 3),
        "mean_a": round(sum(p.a for p in params) / len(params), 3),
    }
