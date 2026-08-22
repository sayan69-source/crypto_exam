"""
The authoring endpoint — tested as the claim it replaces, not for coverage.

The thing being replaced is "ask a language model to write or edit the question".
So the tests worth having are the ones that would fail if this endpoint were
merely a differently-shaped way to let a human assert an answer key.
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402

from app.api.v1.item_pool import DistractorIn, TemplateIn, verify_template  # noqa: E402

SETTER = {"user_id": "11111111-1111-1111-1111-111111111111", "role": "SETTER"}


def _template(**over) -> TemplateIn:
    base = dict(
        template_id="PHY-MECH-CIRC-001",
        subject="Physics",
        topic="Circular Motion",
        blooms_level=3,
        stem=(
            "A particle moves along a circular path of radius {R} m at a constant "
            "speed of {v} m/s. Its centripetal acceleration is:"
        ),
        params={"R": [2, 4, 5, 8], "v": [6, 10, 12]},
        answer_expr="v**2 / R",
        unit="m/s^2",
        distractors=[
            DistractorIn(expr="v / R", misconception="confuses angular velocity with acceleration"),
            DistractorIn(expr="v**2", misconception="drops the radius"),
            DistractorIn(expr="2*v**2 / R", misconception="spurious factor of 2"),
        ],
    )
    base.update(over)
    return TemplateIn(**base)


def _run(body: TemplateIn):
    return asyncio.run(verify_template(body, current_user=SETTER))


def test_the_key_is_computed_from_the_formula_not_supplied_by_the_author():
    """
    The load-bearing property. There is no field on this request in which an
    author could put a wrong answer, because there is no answer field at all —
    only an expression. Every item's marked-correct option must therefore equal
    the expression evaluated at that item's parameters.

    An LLM editing a stem can change the numbers and leave the key; this shape
    makes that unrepresentable rather than unlikely.
    """
    out = _run(_template())
    assert out["accepted"] > 0

    for item in out["sample"]:
        # Recover the parameters from the rendered stem and re-derive the answer
        # independently of the expander, so this is a check on the pipeline
        # rather than the pipeline agreeing with itself.
        words = item["stem"].replace(" m/s.", "").replace(" m ", " ").split()
        nums = [float(w) for w in words if w.replace(".", "", 1).isdigit()]
        radius, speed = nums[0], nums[1]
        expected = speed**2 / radius
        assert abs(float(item["correct_option"].split()[0]) - expected) < 1e-6


def test_a_distractor_that_collides_with_the_key_is_refused_with_a_reason():
    """
    `v*v/R` is the same value as `v**2/R`. A human writing four options by hand
    ships this; a reviewer skimming 10,000 generated items misses it. Here every
    parameter combination is rejected, the endpoint refuses, and it says which
    values collided — the author fixes a formula rather than hunting an item.
    """
    with pytest.raises(HTTPException) as e:
        _run(_template(distractors=[
            DistractorIn(expr="v*v / R", misconception="algebraically identical to the key"),
            DistractorIn(expr="v**2", misconception="drops the radius"),
            DistractorIn(expr="2*v**2 / R", misconception="spurious factor of 2"),
        ]))
    assert e.value.status_code == 422
    assert e.value.detail["reason"] == "NO_VARIANT_VERIFIED"
    assert any("collides" in r["why"] for r in e.value.detail["rejections"])


def test_options_that_are_distinct_but_indistinguishable_are_refused():
    """
    §5.1a-B. Two options 1% apart are different strings and the same question to
    a candidate under time pressure — such an item grades transcription care
    rather than physics. Distinctness is not the test; separation is.
    """
    with pytest.raises(HTTPException) as e:
        _run(_template(distractors=[
            DistractorIn(expr="v**2 / R * 1.01", misconception="1% off — visibly distinct, not distinguishable"),
            DistractorIn(expr="v**2", misconception="drops the radius"),
            DistractorIn(expr="2*v**2 / R", misconception="spurious factor of 2"),
        ]))
    assert e.value.status_code == 422
    assert any("apart" in r["why"] for r in e.value.detail["rejections"])


def test_an_expression_cannot_reach_outside_arithmetic():
    """
    `answer_expr` is evaluated. It is evaluated in an emptied namespace with an
    arithmetic allow-list, and this is the test that says so — an author is an
    approved human, but a template travels through review, storage and an
    expansion run, and "the author would never" is not an access control.
    """
    with pytest.raises(HTTPException) as e:
        _run(_template(answer_expr="__import__('os').system('id')"))
    assert e.value.status_code == 422


def test_verification_saves_nothing():
    """
    The authoring loop only works if looking is cheaper than committing. This
    endpoint takes no database session at all, which is the strongest form that
    guarantee can take.
    """
    out = _run(_template())
    assert out["saved"] is False


def test_a_template_yields_many_siblings_from_one_review():
    """
    The economic claim: a human reviews one formula and gets a family of items.
    4 radii x 3 speeds is 12 combinations, and the ones that survive verification
    all descend from a single thing a reviewer read.
    """
    out = _run(_template())
    assert out["accepted"] >= 6, out["rejections"]
    assert out["accepted"] + out["rejected"] <= 12
