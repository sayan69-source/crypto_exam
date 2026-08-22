import asyncio
import httpx
import sqlite3
import os
import time

LOG_PATH = "/Users/riturajbarman/Downloads/crypto_exam-main/backend.log"

def get_latest_otp(email):
    # tail the log file and find the OTP for the email
    # [DEV-MODE] To: test2@test.com
    # Subject: Your CryptoExam Core verification code
    # 
    # Your CryptoExam Core verification code is:
    # 
    # 123456
    with open(LOG_PATH, "r") as f:
        lines = f.readlines()
    
    # search backwards
    for i in range(len(lines)-1, -1, -1):
        if email in lines[i] and "[DEV-MODE]" in lines[i]:
            # The code is a few lines down
            for j in range(i+1, min(i+15, len(lines))):
                line = lines[j].strip()
                if line.isdigit() and len(line) == 6:
                    return line
    return None

async def run_test():
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        db_path = "/Users/riturajbarman/Downloads/crypto_exam-main/public/backend/cryptoexam.db"
        
        email1 = f"test_{int(time.time())}@test.com"
        email2 = f"admin_{int(time.time())}@test.com"
            
        print(f"1. Requesting Email Verification for Organisation ({email1})...")
        resp = await client.post("/api/v1/email-verification/request", json={"email": email1, "purpose": "EXAM_REQUEST"})
        assert resp.status_code == 200, f"Failed to request org OTP: {resp.text}"
        org_challenge_id = resp.json()["challenge_id"]
        
        # wait a bit for log to write
        await asyncio.sleep(1)
        otp = get_latest_otp(email1)
        print(f"OTP found in logs: {otp}")
        
        # Verify OTP to get token
        resp = await client.post("/api/v1/email-verification/verify", json={"email": email1, "code": otp, "challenge_id": org_challenge_id})
        assert resp.status_code == 200, f"Failed to verify org OTP: {resp.text}"
        org_token = resp.json()["verification_token"]
        print(f"Verification token: {org_token[:10]}...")
        
        print("2. Submitting Exam Request...")
        payload = {
            "examName": "Python E2E Test Exam",
            "organisation": "Test Org",
            "contactName": "Test User",
            "contactEmail": email1,
            "administrator": {
                "fullName": "Admin User",
                "email": email2
            },
            "locations": [{"name": "Center A", "city": "City A"}],
            "subjects": [{"name": "Math", "code": "MATH101", "compulsory": True}],
            "emailVerificationToken": org_token
        }
        resp = await client.post("/api/v1/exam-requests", json=payload)
        assert resp.status_code == 201, f"Failed to request exam: {resp.text}"
        data = resp.json()
        request_id = data["reference"]
        print(f"✅ Exam Request Created! Reference: {request_id}")
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM exam_requests WHERE reference = ?", (request_id,))
        real_req_id = cursor.fetchone()[0]

        print("3. Approving Exam Request (Simulating Sysadmin)...")
        import uuid
        from datetime import datetime, timezone
        from app.models import ExamRequest
        from app.services.exam_registration import materialise
        
        # Load the request via SQLAlchemy to use materialise
        from sqlalchemy.ext.asyncio import AsyncSession
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload
        from app.database import async_session
        
        async with async_session() as session:
            stmt = select(ExamRequest).options(selectinload(ExamRequest.locations), selectinload(ExamRequest.subjects)).where(ExamRequest.id == real_req_id)
            req = (await session.execute(stmt)).scalar_one_or_none()
            
            # Approve it
            req.sysadmin_approved_at = datetime.now(timezone.utc)
            req.sysadmin_approved_by = "test-sysadmin"
            
            # Materialise it
            await materialise(session, req)
            await session.commit()
            
        print("✅ Exam Request Approved via materialise()!")

        print(f"4. Testing Admin Registration Onboarding Workflow ({email2})...")
        resp = await client.post("/api/v1/email-verification/request", json={"email": email2, "purpose": "REGISTER"})
        assert resp.status_code == 200, f"Failed to request admin OTP: {resp.text}"
        admin_challenge_id = resp.json()["challenge_id"]
        
        await asyncio.sleep(1)
        admin_otp = get_latest_otp(email2)
        print(f"Admin OTP found in logs: {admin_otp}")
        
        resp = await client.post("/api/v1/email-verification/verify", json={"email": email2, "code": admin_otp, "challenge_id": admin_challenge_id})
        assert resp.status_code == 200, f"Admin OTP verification failed: {resp.text}"
        admin_token = resp.json()["verification_token"]
        
        # Register Admin
        admin_payload = {
            "email": email2,
            "password": "Password123!",
            "full_name": "Admin User",
            "email_verification_token": admin_token
        }
        resp = await client.post("/api/v1/auth/register-exam-admin", json=admin_payload)
        assert resp.status_code == 201, f"Failed to register admin: {resp.text}"
        print("✅ Admin Registered Successfully via API!")
        
        cursor.execute("SELECT user_id FROM exam_administrators WHERE email = ?", (email2,))
        linked_user_id = cursor.fetchone()[0]
        assert linked_user_id is not None, "user_id was not linked!"
        print(f"✅ Administrator linked to User ID: {linked_user_id}")
        
        conn.close()
        print("🎉 END TO END WORKFLOW TEST PASSED!")

if __name__ == "__main__":
    asyncio.run(run_test())
