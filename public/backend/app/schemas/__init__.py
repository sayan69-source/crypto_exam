"""
CryptoExam Core — Pydantic Request/Response Schemas
Core schemas for auth, exams, and system responses.
"""

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field, EmailStr, field_validator


# ── Enums (mirror DB) ──

class UserRoleEnum(str, Enum):
    CANDIDATE = "CANDIDATE"
    SETTER = "SETTER"
    ADMIN = "ADMIN"
    INVIGILATOR = "INVIGILATOR"


class ExamStatusEnum(str, Enum):
    DRAFT = "DRAFT"
    GENERATING = "GENERATING"
    PROOF_PENDING = "PROOF_PENDING"
    LOCKED = "LOCKED"
    DISTRIBUTED = "DISTRIBUTED"
    LIVE = "LIVE"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    AUDITED = "AUDITED"
    ABORTED = "ABORTED"


class ExamBodyEnum(str, Enum):
    NTA = "NTA"
    UPSC = "UPSC"
    SSC = "SSC"
    IBPS = "IBPS"
    STATE_PSC = "STATE_PSC"
    CBSE = "CBSE"
    CUSTOM = "CUSTOM"


class ExamTypeEnum(str, Enum):
    ONLINE_CBT = "ONLINE_CBT"


# ── Auth Schemas ──

class LoginRequest(BaseModel):
    """Unified login — supports roll number or email."""
    identifier: str = Field(..., description="Email or roll number")
    password: str | None = Field(None, description="Password (setter/admin)")
    dob: str | None = Field(None, description="Date of birth (YYYY-MM-DD, candidate)")
    role: UserRoleEnum | None = Field(None, description="Role hint for routing")


class OTPVerifyRequest(BaseModel):
    """OTP second factor verification."""
    session_token: str
    otp: str = Field(..., min_length=6, max_length=6)


class TokenResponse(BaseModel):
    """JWT token response."""
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    role: UserRoleEnum
    user_id: UUID


class UserProfile(BaseModel):
    """Current user profile."""
    id: UUID
    email: str | None
    phone: str | None
    role: UserRoleEnum
    full_name: str
    name_hi: str | None
    locale: str
    institution: str | None
    state: str | None
    district: str | None
    dpdp_consent: bool
    aadhaar_linked: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Exam Schemas ──

class ExamCreate(BaseModel):
    """Create a new exam."""
    name: str = Field(..., max_length=500)
    name_hi: str | None = None
    exam_body: ExamBodyEnum = ExamBodyEnum.CUSTOM
    exam_type: ExamTypeEnum
    duration_minutes: int = Field(..., gt=0, le=600)
    scheduled_at: datetime
    subject_taxonomy: dict
    irt_config: dict
    blooms_config: dict
    sets_count: int = Field(default=4, ge=1, le=8)
    negative_marking: float = 0.25


class ExamResponse(BaseModel):
    """Exam detail response."""
    id: UUID
    name: str
    name_hi: str | None
    exam_body: ExamBodyEnum
    exam_type: ExamTypeEnum
    duration_minutes: int
    scheduled_at: datetime
    status: ExamStatusEnum
    setter_id: UUID | None
    sets_count: int
    negative_marking: float
    question_hash: str | None = None
    zk_proof_hash: str | None = None
    polygon_exam_tx: str | None = None
    polygon_zkproof_tx: str | None = None
    answer_merkle_root: str | None = None
    polygon_answer_tx: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("question_hash", "zk_proof_hash", "answer_merkle_root", mode="before")
    @classmethod
    def _bytes_to_hex(cls, v):
        # These columns are LargeBinary in the DB; surface them as hex strings
        # so the response model (which types them as str) can serialize them.
        return v.hex() if isinstance(v, (bytes, bytearray)) else v


class ExamListResponse(BaseModel):
    """Paginated exam list."""
    items: list[ExamResponse]
    total: int
    page: int
    per_page: int


# ── § 29 Invigilator Gateway Schemas ──

class GeofenceRequest(BaseModel):
    latitude: float
    longitude: float
    accuracy: float | None = None
    center_id: str | None = None


class GeofenceResponse(BaseModel):
    within_center_bounds: bool
    distance_m: float
    radius_m: float
    reason: str = ""


class FaceVerifyRequest(BaseModel):
    """Invigilator self-auth OR fallback candidate face capture."""
    image: str = Field(..., description="data URL or base64 JPEG")
    staff_id: str | None = None
    candidate_id: str | None = None


class FaceVerifyResponse(BaseModel):
    verified: bool
    confidence: float
    reason: str = ""


class TOTPVerifyRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=8)
    staff_id: str | None = None


class FIDO2ChallengeResponse(BaseModel):
    challenge: str
    rp_id: str = "cryptoexamcore.in"
    credential_id: str | None = None


class FIDO2VerifyRequest(BaseModel):
    assertion: dict
    challenge: str
    staff_id: str | None = None


class CandidateVerifyRequest(BaseModel):
    """§ 29.3 — dual biometric verification of one candidate."""
    hall_ticket: str
    exam_id: str | None = None
    center_id: str | None = None
    face_image: str | None = Field(None, description="live face capture (data URL/base64)")
    fp_template_hash: str | None = None
    fp_match_score: int | None = None
    fido2_assertion: dict | None = None
    fido2_challenge: str | None = None


class CandidateVerifyResponse(BaseModel):
    candidate_id: str | None
    candidate_name: str | None
    hall_ticket: str
    face_match: bool
    face_confidence: float
    fp_match: bool
    fp_confidence: float
    overall_result: str
    timestamp: datetime
    verification_id: str


class RosterEntry(BaseModel):
    candidate_id: str
    candidate_name: str
    roll_number: str | None
    hall_ticket: str | None
    status: str            # PENDING | VERIFIED | MISMATCH | FLAGGED
    photo_thumbnail: str | None = None
    verified_at: datetime | None = None


class InvigilatorAlert(BaseModel):
    id: str
    type: str              # MISMATCH | LATE_ARRIVAL | INCIDENT
    severity: str          # INFO | WARN | CRITICAL
    candidate_name: str | None
    message: str
    created_at: datetime
    resolved: bool = False


# ── Health / System Schemas ──

class HealthResponse(BaseModel):
    """System health check response."""
    status: str
    service: str
    version: str
    timestamp: str
    components: dict[str, str]


class ErrorResponse(BaseModel):
    """Standard error response."""
    error: str
    message: str
    details: dict | None = None
