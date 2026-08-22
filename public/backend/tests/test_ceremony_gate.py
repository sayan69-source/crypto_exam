"""
The key ceremony must not serve a simulated enclave on a public deployment.

§54-55 puts this ceremony inside a Nitro enclave so that HQ cannot read a paper
it is merely holding. Without one, `SimulatedNitroEnclave` signs its own
attestation document and derives PCR0 from the source file — which proves
nothing, and was being served unauthenticated: /api/v1/ceremony/health answered
{"enclave":"simulated"} to anyone who asked.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402

CEREMONY = [
    "/api/v1/ceremony/health",
    "/api/v1/ceremony/expected-pcr0",
    "/api/v1/ceremony/attestation",
    "/api/v1/ceremony/audit-log",
]


@pytest.fixture()
def _default_off():
    s = get_settings()
    before = s.ALLOW_SIMULATED_ENCLAVE
    s.ALLOW_SIMULATED_ENCLAVE = False
    yield
    s.ALLOW_SIMULATED_ENCLAVE = before


@pytest.mark.parametrize("path", CEREMONY)
def test_every_ceremony_route_refuses_by_default(_default_off, path):
    """
    Router-wide, not per-route: a ceremony endpoint added later is covered by
    default rather than by someone remembering to add a guard.
    """
    r = TestClient(app).get(path)
    assert r.status_code == 503, f"{path} answered {r.status_code}"
    assert r.json()["detail"]["reason"] == "ENCLAVE_NOT_PROVISIONED"


def test_the_refusal_never_leaks_that_a_simulator_is_present(_default_off):
    """
    "enclave: simulated" on a public endpoint is both the demo surface and an
    invitation to ask what else is simulated. The refusal says what is REQUIRED,
    not what is currently standing in for it.
    """
    body = TestClient(app).get("/api/v1/ceremony/health").text.lower()
    assert "simulated" not in body or "simulated one" in body
    assert "pcr0" not in body
    assert "module_id" not in body


def test_the_opt_in_still_works_off_production():
    """Developing against the simulator stays possible — deliberately, and loudly."""
    s = get_settings()
    before = s.ALLOW_SIMULATED_ENCLAVE
    s.ALLOW_SIMULATED_ENCLAVE = True
    try:
        r = TestClient(app).get("/api/v1/ceremony/health")
        assert r.status_code == 200
        assert r.json()["enclave"] == "simulated"
    finally:
        s.ALLOW_SIMULATED_ENCLAVE = before
