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

@pytest.mark.asyncio
async def test_email_verify_flow():
    # Use ASGITransport for modern httpx testing of ASGI apps
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Request verification
        req_response = await client.post(
            "/api/v1/auth/email/verify/request",
            json={"email": "testinvigilator@nta.gov.in"}
        )
        assert req_response.status_code == 200
        req_data = req_response.json()
        assert "challenge_id" in req_data
        assert "dev_code" in req_data
        
        challenge_id = req_data["challenge_id"]
        dev_code = req_data["dev_code"]
        assert dev_code is not None, "dev_code should be returned in debug mode"
        
        # Test invalid code
        confirm_bad = await client.post(
            "/api/v1/auth/email/verify/confirm",
            json={"challenge_id": challenge_id, "code": "000000"}
        )
        assert confirm_bad.status_code == 400
        assert "Invalid OTP code" in confirm_bad.json()["detail"]
        
        # Confirm verification
        confirm_response = await client.post(
            "/api/v1/auth/email/verify/confirm",
            json={"challenge_id": challenge_id, "code": dev_code}
        )
        assert confirm_response.status_code == 200
        assert confirm_response.json()["ok"] == True
        assert confirm_response.json()["email"] == "testinvigilator@nta.gov.in"
        
        # Ensure challenge cannot be used again
        confirm_again = await client.post(
            "/api/v1/auth/email/verify/confirm",
            json={"challenge_id": challenge_id, "code": dev_code}
        )
        assert confirm_again.status_code == 400
        assert "Challenge already consumed" in confirm_again.json()["detail"]

@pytest.mark.asyncio
async def test_email_verify_disposable():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        req_response = await client.post(
            "/api/v1/auth/email/verify/request",
            json={"email": "hacker@mailinator.com"}
        )
        assert req_response.status_code == 400
        assert "Disposable email addresses are not allowed" in req_response.json()["detail"]
