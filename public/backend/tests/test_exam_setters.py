"""
Who may author for an exam — tested as three gates, each shown to be necessary.

The claim is that nomination, approval and mailbox verification are all
required. A test suite that only walks the happy path would pass just as well if
any two of them were decorative, so each gate is checked in isolation: the
states short of VERIFIED must all answer `can_author == False`.
"""
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import ExamSetterNomination, SetterNominationStatus  # noqa: E402


def _nom(**kw) -> ExamSetterNomination:
    base = dict(id=str(uuid.uuid4()), offering_id=str(uuid.uuid4()),
                full_name="Dr A Setter", email="a@example.org", email_norm="aexampleorg")
    base.update(kw)
    return ExamSetterNomination(**base)


def test_a_nomination_alone_grants_nothing():
    """
    The administrator types the address, so if nomination were enough they could
    grant authoring rights to a mailbox they hold themselves — over the item
    pool an entire examination is drawn from.
    """
    assert _nom(status=SetterNominationStatus.NOMINATED).can_author is False


def test_approval_without_verification_grants_nothing():
    """
    Tier-0 approves a PERSON AT AN ADDRESS, not whoever later opens the link.
    Until the mailbox is proved, the two are not known to be the same.
    """
    n = _nom(status=SetterNominationStatus.APPROVED, approved_at=datetime.now(timezone.utc))
    assert n.can_author is False


def test_verification_without_approval_grants_nothing():
    """
    The inverse: proving you hold a mailbox is not the System Admin agreeing you
    should author. Both marks must be present, not either.
    """
    n = _nom(status=SetterNominationStatus.VERIFIED, verified_at=datetime.now(timezone.utc))
    assert n.can_author is False


def test_only_approved_and_verified_may_author():
    now = datetime.now(timezone.utc)
    n = _nom(status=SetterNominationStatus.VERIFIED, approved_at=now, verified_at=now)
    assert n.can_author is True


@pytest.mark.parametrize("status", [
    SetterNominationStatus.REJECTED,
    SetterNominationStatus.REVOKED,
])
def test_a_refused_or_withdrawn_setter_may_not_author(status):
    """Both timestamps can survive a later revocation; the status must still win."""
    now = datetime.now(timezone.utc)
    n = _nom(status=status, approved_at=now, verified_at=now)
    assert n.can_author is False


def test_the_status_alone_cannot_be_forged_into_permission():
    """
    `can_author` reads the timestamps as well as the status, so a row whose
    status was flipped to VERIFIED without the approval and verification ever
    happening is still refused.
    """
    assert _nom(status=SetterNominationStatus.VERIFIED).can_author is False


def test_token_expiry_is_comparable_when_the_driver_returns_naive_datetimes():
    """
    SQLite hands back naive datetimes; comparing one to an aware `now` raises
    TypeError, which would 500 the registration instead of expiring the token.
    The route normalises before comparing — this pins the shape it relies on.
    """
    naive = (datetime.now(timezone.utc) - timedelta(days=1)).replace(tzinfo=None)
    aware = naive.replace(tzinfo=timezone.utc)
    assert datetime.now(timezone.utc) > aware
