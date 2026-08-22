"""
The SMTP transport, and the bug that made a correctly configured deployment
deliver nothing.

WHAT HAPPENED
-------------
`app/services/email.py` carried two implementations of one SMTP conversation.
`_send_blocking` — used by `send_otp_email` and `send_setter_invitation` — read
the password through `_smtp_password()` and worked. `_send_smtp` — used by the
generic `send_email`, and therefore by the contact-form and enquiry
verification OTP — carried its own copy, and that copy read:

    smtp_pass: str = getattr(s, "SMTP_PASS", "")

The setting is named `SMTP_PASSWORD`. There is no `SMTP_PASS`, so `getattr`
returned the `""` default and the client logged in with an EMPTY PASSWORD on
every send. Login-by-email delivered; enquiry verification did not; and the
credentials in the environment were correct the whole time.

`test_the_configured_password_actually_reaches_the_server` is the test that was
missing. Every other test in this file exists because the first one, alone,
would still have passed against three other ways of reproducing the same
"Username and Password not accepted".

Nothing here opens a real socket: `smtplib.SMTP` is replaced by a recorder, and
what is asserted is what the transport HANDED to the server.
"""

from __future__ import annotations

import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

import pytest

backend_root = Path(__file__).parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from app.config import get_settings
from app.services import email as email_module

APP_PASSWORD = "abcdefghijklmnop"


class RecordingSMTP:
    """Stands in for smtplib.SMTP / SMTP_SSL and records the conversation."""

    last: "RecordingSMTP | None" = None

    def __init__(self, host, port, timeout=None, context=None):
        self.host = host
        self.port = port
        self.context = context
        self.login_args: tuple[str, str] | None = None
        self.started_tls = False
        self.sent: list[EmailMessage] = []
        RecordingSMTP.last = self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def ehlo(self):
        pass

    def starttls(self, context=None):
        self.started_tls = True

    def login(self, user, password):
        self.login_args = (user, password)

    def send_message(self, msg):
        self.sent.append(msg)


@pytest.fixture(autouse=True)
def smtp_configured(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "SMTP_HOST", "smtp.gmail.com", raising=False)
    monkeypatch.setattr(s, "SMTP_PORT", 587, raising=False)
    monkeypatch.setattr(s, "SMTP_USER", "programme@cryptoexam.test", raising=False)
    monkeypatch.setattr(s, "SMTP_PASSWORD", APP_PASSWORD, raising=False)
    monkeypatch.setattr(s, "SMTP_FROM", "CryptoExam Core <programme@cryptoexam.test>", raising=False)
    monkeypatch.setattr(s, "DEBUG", False, raising=False)
    RecordingSMTP.last = None
    return s


@pytest.fixture
def recorder(monkeypatch):
    monkeypatch.setattr(email_module.smtplib, "SMTP", RecordingSMTP)
    monkeypatch.setattr(email_module.smtplib, "SMTP_SSL", RecordingSMTP)
    return RecordingSMTP


class TestTheRegression:
    @pytest.mark.asyncio
    async def test_the_configured_password_actually_reaches_the_server(self, recorder):
        """THE BUG. `send_email` logged in with "" because it read SMTP_PASS."""
        result = await email_module.send_email(
            to="registrar@university.test",
            subject="Your CryptoExam Core verification code",
            body="123456",
            critical=True,
        )

        assert result.delivery == "smtp"
        server = recorder.last
        assert server is not None, "no SMTP conversation happened at all"
        assert server.login_args is not None, "the transport never logged in"

        user, password = server.login_args
        assert user == "programme@cryptoexam.test"
        # The assertion that fails on the original code, where password == "".
        assert password == APP_PASSWORD
        assert password != "", "logged in with an empty password — the SMTP_PASS bug"

    @pytest.mark.asyncio
    async def test_a_google_app_password_survives_its_display_spaces(
        self, recorder, smtp_configured, monkeypatch
    ):
        """Google shows app passwords as four groups. Pasted verbatim they must
        still authenticate, or the operator gets the same bare rejection from a
        different cause and looks in the same wrong place."""
        monkeypatch.setattr(smtp_configured, "SMTP_PASSWORD", "abcd efgh ijkl mnop")

        await email_module.send_email(
            to="registrar@university.test", subject="s", body="b", critical=True
        )

        _, password = recorder.last.login_args
        assert password == APP_PASSWORD

    @pytest.mark.asyncio
    async def test_the_generic_path_negotiates_tls_like_the_otp_path(self, recorder):
        """An OTP must not cross the wire in the clear. The duplicate that was
        removed did call starttls, but nothing held it to that."""
        await email_module.send_email(
            to="registrar@university.test", subject="s", body="b", critical=True
        )
        assert recorder.last.started_tls is True

    @pytest.mark.asyncio
    async def test_port_465_uses_implicit_tls_rather_than_starttls(
        self, recorder, smtp_configured, monkeypatch
    ):
        """The removed duplicate always called STARTTLS, so a 465 configuration
        hung until timeout. Delegating to the shared transport fixes that too."""
        monkeypatch.setattr(smtp_configured, "SMTP_PORT", 465)

        await email_module.send_email(
            to="registrar@university.test", subject="s", body="b", critical=True
        )

        server = recorder.last
        assert server.port == 465
        assert server.started_tls is False, "465 is implicit TLS; STARTTLS is wrong there"
        assert server.context is not None
        assert server.login_args[1] == APP_PASSWORD


class TestFailingClosed:
    @pytest.mark.asyncio
    async def test_a_critical_send_raises_rather_than_reporting_dev(
        self, monkeypatch, smtp_configured
    ):
        """A verification code that degrades to a dev preview looks like success
        to the caller while the recipient gets nothing. That is the failure mode
        the whole `critical` flag exists to prevent, so it is pinned."""

        class Failing(RecordingSMTP):
            def login(self, user, password):
                raise smtplib.SMTPAuthenticationError(535, b"Username and Password not accepted")

        monkeypatch.setattr(email_module.smtplib, "SMTP", Failing)

        with pytest.raises(RuntimeError):
            await email_module.send_email(
                to="registrar@university.test", subject="s", body="b", critical=True
            )

    @pytest.mark.asyncio
    async def test_a_non_critical_send_may_degrade(self, monkeypatch, smtp_configured):
        """The other half of the same rule: a team notification is not worth
        failing a request the user already completed."""

        class Failing(RecordingSMTP):
            def login(self, user, password):
                raise smtplib.SMTPAuthenticationError(535, b"nope")

        monkeypatch.setattr(email_module.smtplib, "SMTP", Failing)

        result = await email_module.send_email(
            to="registrar@university.test", subject="s", body="b", critical=False
        )
        assert result.delivery == "dev"


class TestTheDiagnostic:
    def test_status_reports_configuration_without_the_password(self, smtp_configured):
        report = email_module.smtp_status()
        assert report["configured"] is True
        assert report["password_present"] is True
        assert report["password_length"] == len(APP_PASSWORD)
        assert APP_PASSWORD not in str(report)

    def test_status_names_the_two_silent_misconfigurations(
        self, smtp_configured, monkeypatch
    ):
        monkeypatch.setattr(smtp_configured, "SMTP_PASSWORD", "abcd efgh ijkl mnop")
        monkeypatch.setattr(smtp_configured, "SMTP_PORT", 465)
        report = email_module.smtp_status()
        assert report["password_had_spaces"] is True
        assert report["mode"] == "implicit-tls"

    def test_an_unconfigured_process_says_so(self, smtp_configured, monkeypatch):
        monkeypatch.setattr(smtp_configured, "SMTP_HOST", "")
        assert email_module.smtp_status()["configured"] is False


class TestDeliverability:
    """The DNS half. Only a definitive answer may refuse an address."""

    def test_a_domain_that_does_not_exist_is_refused(self, monkeypatch):
        from app.api.v1 import email_verify

        import dns.resolver

        def _nxdomain(domain, record):
            raise dns.resolver.NXDOMAIN()

        monkeypatch.setattr(dns.resolver.Resolver, "resolve", lambda self, d, r: _nxdomain(d, r))
        assert email_verify.domain_accepts_mail("arjun@yourorganisaton.invalid") is False

    def test_a_resolver_timeout_does_not_refuse_the_address(self, monkeypatch):
        """Fail open. A restricted-egress container must not lock every
        university out of the contact form."""
        from app.api.v1 import email_verify

        import dns.exception
        import dns.resolver

        def _timeout(self, domain, record):
            raise dns.exception.Timeout()

        monkeypatch.setattr(dns.resolver.Resolver, "resolve", _timeout)
        assert email_verify.domain_accepts_mail("registrar@university.test") is True

    def test_a_domain_with_only_an_address_record_still_accepts_mail(self, monkeypatch):
        """RFC 5321 5.1 — no MX means fall back to A/AAAA, not 'refuse'."""
        from app.api.v1 import email_verify

        import dns.resolver

        def _no_mx_but_an_a(self, domain, record):
            if record == "MX":
                raise dns.resolver.NoAnswer()
            return ["203.0.113.7"]

        monkeypatch.setattr(dns.resolver.Resolver, "resolve", _no_mx_but_an_a)
        assert email_verify.domain_accepts_mail("registrar@university.test") is True

    def test_the_check_can_be_switched_off(self, monkeypatch):
        from app.api.v1 import email_verify

        monkeypatch.setattr(get_settings(), "EMAIL_CHECK_DELIVERABILITY", False, raising=False)
        # No resolver patched: if this reached DNS at all it would be a network
        # call, which the setting exists to prevent.
        assert email_verify.domain_accepts_mail("anything@example.invalid") is True
