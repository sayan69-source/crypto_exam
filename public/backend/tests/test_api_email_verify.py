import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_root = Path(__file__).parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from app.main import app
from app.database import engine, Base

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    # Setup test DB tables before each test
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # Teardown after test
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

from unittest.mock import patch

@pytest.mark.asyncio
async def test_email_verify_flow():
    # Use ASGITransport for modern httpx testing of ASGI apps
    transport = ASGITransport(app=app)
    
    with patch("app.api.v1.email_verify.secrets.randbelow", return_value=123456):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Request verification
            req_response = await client.post(
                "/api/v1/email-verification/request",
                json={"email": "testinvigilator@nta.gov.in", "purpose": "LOGIN", "role": "INVIGILATOR"}
            )
            assert req_response.status_code == 200
            req_data = req_response.json()
            assert "challenge_id" in req_data
            assert "dev_code" not in req_data
            
            challenge_id = req_data["challenge_id"]
            dev_code = "123456"
            
            # Test invalid code
            confirm_bad = await client.post(
                "/api/v1/email-verification/verify",
                json={"challenge_id": challenge_id, "email": "testinvigilator@nta.gov.in", "code": "000000"}
            )
            assert confirm_bad.status_code == 400
            assert "Incorrect verification code" in confirm_bad.json()["detail"]
            
            # Confirm verification
            confirm_response = await client.post(
                "/api/v1/email-verification/verify",
                json={"challenge_id": challenge_id, "email": "testinvigilator@nta.gov.in", "code": dev_code}
            )
            assert confirm_response.status_code == 200
            assert confirm_response.json()["verified"] == True
            assert "verification_token" in confirm_response.json()
            
            # Ensure challenge cannot be used again
            confirm_again = await client.post(
                "/api/v1/email-verification/verify",
                json={"challenge_id": challenge_id, "email": "testinvigilator@nta.gov.in", "code": dev_code}
            )
            assert confirm_again.status_code == 400
            assert "Challenge already consumed" in confirm_again.json()["detail"]

@pytest.mark.asyncio
async def test_email_verify_disposable():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        req_response = await client.post(
            "/api/v1/email-verification/request",
            json={"email": "hacker@mailinator.com", "purpose": "LOGIN"}
        )
        assert req_response.status_code == 400
        assert "Disposable email addresses are not allowed" in req_response.json()["detail"]
