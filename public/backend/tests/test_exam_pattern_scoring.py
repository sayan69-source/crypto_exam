"""
Pattern + scoring — tested as the rules a challenge is argued over.

Every case here is a marking rule that, applied wrongly, produces a plausible
mark sheet and a wrong rank. None of them are visible by looking at the output.
"""
import sys
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.exam_pattern import (  # noqa: E402
    ExamPattern, PatternError, QuestionType, Section, jee_main, neet_ug,
)
from app.services.exam_scoring import Key, Response, score  # noqa: E402


def _mcq(count=4, correct="4", wrong="-1", **kw) -> Section:
    return Section(
        name=kw.pop("name", "A"), subject=kw.pop("subject", "Physics"),
        question_type=QuestionType.SINGLE_CHOICE, count=count,
        marks_correct=Decimal(correct), marks_wrong=Decimal(wrong), **kw,
    )


# ── the presets are the shapes people actually sit ──────────────────────────

def test_jee_main_is_75_questions_and_300_marks():
    p = jee_main()
    assert p.total_questions == 90          # 3 x (20 + 10) delivered
    assert p.max_marks == Decimal("300")    # 3 x (20 + 5) x 4 SCORED
    assert p.blueprint() == {"Physics": 30, "Chemistry": 30, "Mathematics": 30}


def test_neet_is_180_questions_and_720_marks():
    p = neet_ug()
    assert p.total_questions == 180
    assert p.max_marks == Decimal("720")


# ── the rules ───────────────────────────────────────────────────────────────

def test_unattempted_is_not_wrong():
    """
    The single most consequential distinction in the module. Scoring a blank as
    wrong subtracts a mark per unanswered question and reorders a merit list,
    while producing a mark sheet that looks entirely normal.
    """
    p = ExamPattern(sections=[_mcq(count=3)], duration_minutes=60)
    sheet = score(
        p,
        [Response(0, 1), Response(1, None)],      # q2 absent entirely
        [Key(0, 1), Key(1, 0), Key(2, 0)],
    )
    assert sheet.total == Decimal("4")            # 4, not 4 - 1 - 1
    assert (sheet.correct, sheet.wrong, sheet.unattempted) == (1, 0, 2)


def test_negative_marking_applies_only_to_a_wrong_answer():
    p = ExamPattern(sections=[_mcq(count=2)], duration_minutes=60)
    sheet = score(p, [Response(0, 1), Response(1, 3)], [Key(0, 1), Key(1, 0)])
    assert sheet.total == Decimal("3")            # +4 then -1


def test_an_attempt_limit_keeps_the_BEST_answers_not_the_first():
    """
    "Any 5 of 10" scored on the first five punishes a candidate for answering in
    the order the paper printed. Here the first two are wrong and the last two
    right; a first-N implementation scores -2, best-N scores +8.
    """
    section = Section(
        name="B", subject="Physics", question_type=QuestionType.NUMERIC,
        count=4, marks_correct=Decimal("4"), marks_wrong=Decimal("0"),
        attempt_limit=2, numeric_tolerance=Decimal("0.01"),
    )
    p = ExamPattern(sections=[section], duration_minutes=60)
    sheet = score(
        p,
        [Response(0, "9"), Response(1, "9"), Response(2, "1"), Response(3, "2")],
        [Key(0, "1"), Key(1, "2"), Key(2, "1"), Key(3, "2")],
    )
    assert sheet.total == Decimal("8")
    capped = [r for r in sheet.per_question if r.state == "CAPPED"]
    assert len(capped) == 2, "the two beyond the cap must be visible as CAPPED, not silently gone"


def test_numeric_answers_compare_within_tolerance():
    """A candidate typing 0.33 for a key of 1/3 has not got it wrong."""
    section = Section(
        name="N", subject="Physics", question_type=QuestionType.NUMERIC,
        count=2, marks_correct=Decimal("4"), marks_wrong=Decimal("0"),
        numeric_tolerance=Decimal("0.01"),
    )
    p = ExamPattern(sections=[section], duration_minutes=60)
    sheet = score(p, [Response(0, "0.333"), Response(1, "5.2")],
                  [Key(0, "0.3333"), Key(1, "5.0")])
    assert sheet.total == Decimal("4")     # first inside tolerance, second outside


@pytest.mark.parametrize("typed", ["", "   ", "-", "1.2.3", "abc", "1e999999"])
def test_junk_in_the_numeric_keypad_is_wrong_and_never_an_exception(typed):
    """
    A keypad can emit anything. None of it may take down the scoring of an exam
    — a crash here fails every candidate in the batch, not just this one.
    """
    section = Section(
        name="N", subject="Physics", question_type=QuestionType.NUMERIC,
        count=1, marks_correct=Decimal("4"), marks_wrong=Decimal("-1"),
        numeric_tolerance=Decimal("0.01"),
    )
    p = ExamPattern(sections=[section], duration_minutes=60)
    sheet = score(p, [Response(0, typed)], [Key(0, "1")])
    assert sheet.total in (Decimal("-1"), Decimal("0"))


def test_multi_choice_is_all_or_nothing_and_order_free():
    section = Section(
        name="M", subject="Physics", question_type=QuestionType.MULTI_CHOICE,
        count=2, marks_correct=Decimal("4"), marks_wrong=Decimal("-2"),
    )
    p = ExamPattern(sections=[section], duration_minutes=60)
    sheet = score(p, [Response(0, [2, 0]), Response(1, [0])],
                  [Key(0, [0, 2]), Key(1, [0, 1])])
    assert sheet.total == Decimal("2")     # +4 (order-free) then -2 (subset ≠ full)


def test_a_dropped_question_pays_everyone_including_the_candidate_who_skipped_it():
    """
    A question withdrawn on challenge was the board's mistake. Scoring the
    skipper as unattempted penalises the one candidate who correctly declined to
    guess at a broken item.
    """
    p = ExamPattern(sections=[_mcq(count=2)], duration_minutes=60)
    sheet = score(p, [Response(0, None), Response(1, 0)],
                  [Key(0, 1), Key(1, 0)], dropped={0})
    assert sheet.total == Decimal("8")


def test_a_missing_answer_key_refuses_rather_than_guessing():
    """
    Scoring an unkeyed question as wrong invents a penalty; as correct invents a
    mark. Both produce a mark sheet nobody can defend.
    """
    p = ExamPattern(sections=[_mcq(count=2)], duration_minutes=60)
    with pytest.raises(ValueError, match="no answer key"):
        score(p, [Response(0, 1)], [Key(0, 1)])


# ── the pattern refuses to be unscorable ────────────────────────────────────

def test_positive_negative_marking_is_refused_as_a_sign_error():
    """`marks_wrong=1` would award marks for wrong answers, and reads fine."""
    with pytest.raises(PatternError, match="NEGATIVE"):
        _mcq(wrong="1")


def test_a_numeric_section_without_a_tolerance_is_refused():
    with pytest.raises(PatternError, match="tolerance"):
        Section(name="N", subject="P", question_type=QuestionType.NUMERIC,
                count=1, marks_correct=Decimal("4"), marks_wrong=Decimal("0"))


def test_two_sections_may_not_share_a_name():
    with pytest.raises(PatternError, match="named"):
        ExamPattern(sections=[_mcq(name="A"), _mcq(name="A")], duration_minutes=60)


def test_a_pattern_survives_a_round_trip_through_stored_json():
    """It is persisted as JSON and rebuilt on every delivery; drift here changes marks."""
    before = jee_main()
    after = ExamPattern.from_dict(before.to_dict())
    assert after.max_marks == before.max_marks
    assert after.blueprint() == before.blueprint()
    assert [s.question_type for s in after.sections] == [s.question_type for s in before.sections]


def test_section_of_maps_paper_position_to_its_rules():
    """The terminal asks this to know what to draw; the scorer to know the marks."""
    p = jee_main()
    assert p.section_of(0).question_type is QuestionType.SINGLE_CHOICE
    assert p.section_of(20).question_type is QuestionType.NUMERIC
    with pytest.raises(PatternError, match="past the end"):
        p.section_of(p.total_questions)
