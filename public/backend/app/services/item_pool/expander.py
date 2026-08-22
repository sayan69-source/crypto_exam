"""
Template expansion and machine verification (design doc §5.1, §5.2 S0/S1).

The point of this module is one property: **a wrong answer key is structurally
impossible**. The key is not something an author or a model asserts — it is the
result of evaluating an expression against the parameters that were substituted
into the stem. To ship a wrong key you would have to write a wrong *formula*,
which is a thing a human reviewing 400 templates can actually catch.

Ported from `prototypes/question-pipeline/pipeline.py`, which is the reference
implementation and stays the executable spec. Two behaviours are load-bearing
and easy to lose in a rewrite:

  * Collision detection compares the RENDERED options, not raw floats. That
    catches two values that differ below display precision (they would look
    identical on the page) and absorbs float noise (0.1+0.2 and 0.3 both render
    "0.3", so no false rejection).
  * A relative separation floor on top of that (§5.1a-B). Distinct strings are
    not distinguishable options: a distractor that differs from the key by a
    lower-order term converges on it as parameters grow — measured at 1.4% for
    a real trigonometry template — and such an item grades transcription care
    rather than the subject.
"""
from __future__ import annotations

import itertools
import math
import re
import secrets
from dataclasses import dataclass, field
from typing import Any, Iterable

# Only arithmetic. No names, no attribute access, no calls beyond this table.
_EXPR_OK = re.compile(r"^[0-9a-zA-Z_+\-*/%.,()\s\*]+$")
_ALLOWED_NAMES: dict[str, Any] = {
    "abs": abs, "round": round, "min": min, "max": max,
    "sqrt": math.sqrt, "pi": math.pi, "e": math.e,
    "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "log": math.log, "log10": math.log10, "exp": math.exp,
    "floor": math.floor, "ceil": math.ceil, "pow": pow,
}

# Two options must be far enough apart that choosing between them is a question
# about the subject rather than about reading care. 5% of the larger magnitude.
MIN_REL_SEPARATION = 0.05


class VerificationError(Exception):
    """An item that cannot be proven correct is never a question."""


@dataclass
class Distractor:
    expr: str
    misconception: str


@dataclass
class TemplateSpec:
    template_id: str
    subject: str
    stem: str
    params: dict[str, list[Any]]
    answer_expr: str
    distractors: list[Distractor]
    topic: str | None = None
    blooms_level: int | None = None
    unit: str = ""
    param_constraint: str | None = None
    irt_a: float | None = None
    irt_b: float | None = None
    irt_c: float | None = None


@dataclass
class ExpandedItem:
    blob_id: str
    stem: str
    options: list[str]
    correct_index: int
    subject: str
    topic: str | None
    blooms_level: int | None
    irt_a: float | None
    irt_b: float | None
    irt_c: float | None


@dataclass
class ExpansionResult:
    items: list[ExpandedItem] = field(default_factory=list)
    rejections: list[tuple[str, str]] = field(default_factory=list)

    @property
    def accepted(self) -> int:
        return len(self.items)


def evaluate(expr: str, params: dict[str, Any]) -> float:
    """
    Evaluate an expression against parameters, or refuse it.

    The namespace is emptied and rebuilt from an allow-list, dunder access is
    blocked, and a parameter may not shadow a builtin — so a template cannot
    reach anything but arithmetic even though this uses `eval`.
    """
    if not _EXPR_OK.match(expr):
        raise VerificationError(f"expression contains disallowed characters: {expr!r}")
    if "__" in expr:
        raise VerificationError("dunder access is not permitted")

    env: dict[str, Any] = {"__builtins__": {}}
    env.update(_ALLOWED_NAMES)
    shadowed = set(params) & set(_ALLOWED_NAMES)
    if shadowed:
        raise VerificationError(f"parameter shadows a builtin: {sorted(shadowed)}")
    env.update(params)

    try:
        value = eval(expr, env)  # noqa: S307 — namespace locked down above
    except Exception as exc:  # noqa: BLE001
        raise VerificationError(f"evaluation failed for {expr!r}: {exc}") from exc

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise VerificationError(f"expression is not numeric: {expr!r} -> {value!r}")
    if math.isnan(value) or math.isinf(value):
        raise VerificationError(f"expression is not finite: {expr!r}")
    return float(value)


def render(value: float, unit: str = "") -> str:
    """Render a number the way a candidate sees it — that is what must be distinct."""
    text = f"{value:.4f}".rstrip("0").rstrip(".") if value % 1 else str(int(value))
    return f"{text} {unit}".strip()


def _combinations(spec: TemplateSpec) -> list[dict[str, Any]]:
    keys = sorted(spec.params)
    combos: list[dict[str, Any]] = []
    for values in itertools.product(*(spec.params[k] for k in keys)):
        combo = dict(zip(keys, values))
        if spec.param_constraint:
            try:
                if not evaluate_bool(spec.param_constraint, combo):
                    continue
            except VerificationError:
                continue
        combos.append(combo)
    return combos


def evaluate_bool(expr: str, params: dict[str, Any]) -> bool:
    """Constraint expressions are comparisons; evaluate them under the same lock-down."""
    if not re.match(r"^[0-9a-zA-Z_+\-*/%.,()\s<>=!&|]+$", expr) or "__" in expr:
        raise VerificationError(f"constraint contains disallowed characters: {expr!r}")
    env: dict[str, Any] = {"__builtins__": {}}
    env.update(_ALLOWED_NAMES)
    env.update(params)
    try:
        return bool(eval(expr, env))  # noqa: S307
    except Exception as exc:  # noqa: BLE001
        raise VerificationError(f"constraint failed for {expr!r}: {exc}") from exc


def expand(
    spec: TemplateSpec,
    *,
    max_variants: int = 25,
    rng: secrets.SystemRandom | None = None,
) -> ExpansionResult:
    """
    Expand one template into verified sibling items.

    S0 (structural): exactly three distractors, four options that are both
                     distinct AND separated, stem fully substituted.
    S1 (symbolic):   the key is re-derived from the expression; an item exists
                     only if its answer is reproducible.
    """
    result = ExpansionResult()
    rand = rng or secrets.SystemRandom()

    combos = _combinations(spec)
    if not combos:
        result.rejections.append((spec.template_id, "no parameter combination satisfies the constraint"))
        return result

    rand.shuffle(combos)
    for idx, combo in enumerate(combos[:max_variants]):
        ident = f"{spec.template_id}#{idx:02d}"
        try:
            if len(spec.distractors) != 3:
                raise VerificationError(f"expected exactly 3 distractors, got {len(spec.distractors)}")

            answer = evaluate(spec.answer_expr, combo)
            wrongs = [evaluate(d.expr, combo) for d in spec.distractors]

            rendered = [render(answer, spec.unit)] + [render(w, spec.unit) for w in wrongs]
            if len(set(rendered)) != 4:
                raise VerificationError(f"an option collides with another (rendered: {rendered})")

            # §5.1a-B: distinct is not the same as distinguishable.
            values = [answer, *wrongs]
            for a in range(len(values)):
                for b in range(a + 1, len(values)):
                    scale = max(abs(values[a]), abs(values[b]), 1e-9)
                    gap = abs(values[a] - values[b]) / scale
                    if gap < MIN_REL_SEPARATION:
                        raise VerificationError(
                            f"options {render(values[a], spec.unit)!r} and "
                            f"{render(values[b], spec.unit)!r} are only {gap:.1%} apart "
                            f"(floor {MIN_REL_SEPARATION:.0%}) — distinct on the page, "
                            "not distinguishable to a candidate"
                        )

            stem = spec.stem
            for key, value in combo.items():
                stem = stem.replace("{" + key + "}", str(value))
            if "{" in stem or "}" in stem:
                raise VerificationError(f"stem has unsubstituted placeholders: {stem!r}")

            # Key position is drawn, not habitual — a fixed position is a tell.
            order = list(range(4))
            rand.shuffle(order)
            options = [rendered[i] for i in order]

            result.items.append(ExpandedItem(
                blob_id=secrets.token_hex(16),   # §6.2 — unrelated to position
                stem=stem,
                options=options,
                correct_index=order.index(0),
                subject=spec.subject,
                topic=spec.topic,
                blooms_level=spec.blooms_level,
                irt_a=spec.irt_a, irt_b=spec.irt_b, irt_c=spec.irt_c,
            ))
        except VerificationError as exc:
            result.rejections.append((ident, str(exc)))

    return result
