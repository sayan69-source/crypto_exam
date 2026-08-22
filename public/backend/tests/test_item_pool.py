"""
Item pool — tests for the three properties the design claims, not for coverage.

Each test below is a claim from the design doc that would otherwise be prose:
a wrong key cannot ship, no setter owns more than 5% of a form, and the paper
is a function of a beacon nobody controlled when the items were written.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.item_pool import (  # noqa: E402
    MAX_AUTHOR_SHARE,
    AssemblyError,
    CandidateItem,
    Distractor,
    TemplateSpec,
    VerificationError,
    build_forms,
    check_blueprint_feasible,
    evaluate,
    expand,
    form_set_root,
    select_form_index,
)


# ── §5.1 — a wrong answer key is structurally impossible ────────────────────

def _circular_motion() -> TemplateSpec:
    return TemplateSpec(
        template_id="PHY-MECH-CIRC-001",
        subject="Physics", topic="Circular Motion", blooms_level=3,
        stem="A particle moves along a circular path of radius {R} m at a constant speed of {v} m/s. Its centripetal acceleration is:",
        params={"R": [2, 4, 5, 8], "v": [6, 10, 12]},
        answer_expr="v**2 / R", unit="m/s^2",
        distractors=[
            Distractor("v / R", "confuses angular velocity with acceleration"),
            Distractor("v**2", "drops the radius"),
            Distractor("2 * v**2 / R", "spurious factor of 2"),
        ],
        irt_a=1.0, irt_b=0.0, irt_c=0.2,
    )


def test_the_key_is_computed_not_asserted():
    """Every accepted item's marked answer equals the expression's value."""
    result = expand(_circular_motion(), max_variants=12)
    assert result.accepted > 0
    for item in result.items:
        R = int(item.stem.split("radius ")[1].split(" m")[0])
        v = int(item.stem.split("speed of ")[1].split(" m/s")[0])
        expected = f"{v**2 / R:.4f}".rstrip("0").rstrip(".") if (v**2 / R) % 1 else str(v**2 // R)
        assert item.options[item.correct_index].startswith(expected), (
            f"marked answer {item.options[item.correct_index]!r} is not v^2/R for R={R} v={v}"
        )


def test_an_expression_that_cannot_be_evaluated_is_refused():
    with pytest.raises(VerificationError):
        evaluate("__import__('os').system('echo pwned')", {})
    with pytest.raises(VerificationError):
        evaluate("open('/etc/passwd')", {})


def test_a_parameter_may_not_shadow_a_builtin():
    with pytest.raises(VerificationError):
        evaluate("abs", {"abs": 3})


# ── §5.1a-B — distinct is not the same as distinguishable ───────────────────

def test_options_closer_than_the_floor_are_rejected():
    """key = n(n+1)/2 against the 'drops the +1' misconception: 1.2% apart at n=80."""
    spec = TemplateSpec(
        template_id="MAT-SEQ-SUM-001",
        subject="Mathematics",
        stem="The sum of the first {n} natural numbers is:",
        params={"n": [80]},
        answer_expr="n*(n+1)/2",
        distractors=[
            Distractor("n*n/2", "drops the +1 term"),
            Distractor("n*n", "squares instead of summing"),
            Distractor("n*(n+2)/2", "off by one the other way"),
        ],
    )
    result = expand(spec, max_variants=5)
    assert result.accepted == 0, "an item with options 1.2% apart must not ship"
    assert any("apart" in reason for _, reason in result.rejections)


def test_a_well_separated_template_still_expands():
    result = expand(_circular_motion(), max_variants=12)
    assert result.accepted >= 4, "the floor must not reject sound items wholesale"


# ── §5.3.3 — the anti-leak cap, which is the whole claim ────────────────────

def _pool(n_per_author: int, authors: int, subject: str = "Physics") -> list[CandidateItem]:
    return [
        CandidateItem(item_id=f"i{a}-{k}", author_id=f"setter-{a}", template_pk=f"t{a}-{k}", subject=subject)
        for a in range(authors)
        for k in range(n_per_author)
    ]


def test_no_setter_exceeds_the_contribution_cap():
    # 5% of 40 is a cap of 2 per setter, so a 40-item paper needs >= 20 setters.
    forms = build_forms(_pool(6, 24), {"Physics": 40}, count=4)
    assert forms
    for f in forms:
        assert f.max_author_share <= MAX_AUTHOR_SHARE + 1e-9, (
            f"form {f.index} gives one setter {f.max_author_share:.1%}, over the "
            f"{MAX_AUTHOR_SHARE:.0%} cap"
        )


def test_a_single_author_pool_is_refused_rather_than_capped_silently():
    """One setter cannot supply a whole paper — that is the property, so it must fail loudly."""
    with pytest.raises(AssemblyError, match="author cap"):
        build_forms(_pool(200, 1), {"Physics": 40}, count=2)


def test_no_two_siblings_share_a_form():
    pool = [
        CandidateItem(item_id=f"i{t}-{v}", author_id=f"setter-{t % 30}", template_pk=f"tpl-{t}", subject="Physics")
        for t in range(60) for v in range(5)
    ]
    for f in build_forms(pool, {"Physics": 30}, count=3):
        templates = [i.split("-")[0] for i in f.item_ids]
        assert len(set(f.item_ids)) == len(f.item_ids)


def test_an_impossible_blueprint_is_caught_before_commitment():
    """The prototype's hard-won lesson: this must fail at commit time, not at T0."""
    with pytest.raises(AssemblyError, match="distinct templates"):
        check_blueprint_feasible(
            [CandidateItem(f"i{k}", "setter-1", "one-template", "Physics") for k in range(50)],
            {"Physics": 20},
        )


# ── §6.1 — the beacon chooses, and the choice is reproducible ───────────────

def test_the_same_beacon_always_selects_the_same_form():
    beacon = "a3" * 32
    picks = {select_form_index(beacon, "exam-1", 256) for _ in range(50)}
    assert len(picks) == 1, "selection must be a pure function of the beacon"


def test_a_different_beacon_selects_differently():
    a = select_form_index("a3" * 32, "exam-1", 256)
    b = select_form_index("7f" * 32, "exam-1", 256)
    assert a != b, "two beacons picking the same form defeats the point"


def test_the_same_beacon_selects_differently_per_exam():
    beacon = "a3" * 32
    assert select_form_index(beacon, "exam-1", 256) != select_form_index(beacon, "exam-2", 256)


def test_the_form_set_root_changes_if_any_form_changes():
    # 5% of 40 is a cap of 2 per setter, so a 40-item paper needs >= 20 setters.
    forms = build_forms(_pool(6, 24), {"Physics": 40}, count=4)
    before = form_set_root(forms)
    forms[0].form_hash = "00" * 32
    assert form_set_root(forms) != before, "the commitment must bind every form"
