"""
CryptoExam Core — SQLAlchemy ORM Models
§ 9 — Database Schema mapped to Python ORM.

All models match the PostgreSQL schema exactly.
DPDP Act 2023 compliance annotations preserved.
"""

import enum
from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, ForeignKey, Integer,
    JSON, LargeBinary, Numeric, String, Text, UniqueConstraint,
    Index,
)
from sqlalchemy.orm import relationship
from sqlalchemy.types import TypeDecorator

from app.database import Base

# Use JSON instead of JSONB for SQLite compatibility
# Use String instead of INET for SQLite compatibility


class GUID(TypeDecorator):
    """UUID-friendly id column. Stored as a dashed UUID string (length 36) for
    SQLite compatibility, but binds UUID objects to that same string form — so
    both ``Model.id == UUID(x)`` and ``Model.id == "x"`` match. Without this,
    code that coerces ids to ``UUID(...)`` (path params, token sub) silently
    matched no rows on SQLite, breaking every id-filtered lookup."""

    impl = String(length=36)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return str(value)  # UUID or str → dashed string


# ── Python ENUM Types ──

class UserRole(str, enum.Enum):
    CANDIDATE = "CANDIDATE"
    SETTER = "SETTER"
    ADMIN = "ADMIN"
    INVIGILATOR = "INVIGILATOR"  # § 29 — Centre Invigilator Gateway (Interface D)
    # Tier-0. The only role that can decrypt answers, so it does not sign in
    # with a password alone: enrolment is IP-restricted and login requires a
    # WebAuthn fingerprint assertion (api/v1/sysadmin_auth.py).
    SYSTEM_ADMIN = "SYSTEM_ADMIN"


class VerificationResultEnum(str, enum.Enum):
    """§ 29 — Candidate biometric verification outcome."""
    VERIFIED = "VERIFIED"
    MISMATCH = "MISMATCH"
    MANUAL_OVERRIDE = "MANUAL_OVERRIDE"
    PENDING = "PENDING"


class BiometricMethod(str, enum.Enum):
    FIDO2_WEBAUTHN = "FIDO2_WEBAUTHN"
    MANTRA_MFS100 = "MANTRA_MFS100"
    FACE_EMBEDDING = "FACE_EMBEDDING"


class ExamType(str, enum.Enum):
    ONLINE_CBT = "ONLINE_CBT"


class ExamBody(str, enum.Enum):
    NTA = "NTA"
    UPSC = "UPSC"
    SSC = "SSC"
    IBPS = "IBPS"
    STATE_PSC = "STATE_PSC"
    CBSE = "CBSE"
    CUSTOM = "CUSTOM"


class ExamStatus(str, enum.Enum):
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


class NodeStatus(str, enum.Enum):
    OFFLINE = "OFFLINE"
    ARMED = "ARMED"
    DECRYPTING = "DECRYPTING"
    COMPLETE = "COMPLETE"
    ERROR = "ERROR"
    TAMPER_BREACH = "TAMPER_BREACH"


class QuestionSource(str, enum.Enum):
    AI_GENERATED = "AI_GENERATED"
    AI_HYBRID = "AI_HYBRID"
    MANUAL_UPLOAD = "MANUAL_UPLOAD"


class AnomalyType(str, enum.Enum):
    TAB_SWITCH = "TAB_SWITCH"
    FACE_FAIL = "FACE_FAIL"
    NETWORK_DROP = "NETWORK_DROP"
    NODE_OFFLINE = "NODE_OFFLINE"
    COPY_ATTEMPT = "COPY_ATTEMPT"
    SUSPICIOUS_TIMING = "SUSPICIOUS_TIMING"
    FULLSCREEN_EXIT = "FULLSCREEN_EXIT"
    VM_DETECTED = "VM_DETECTED"
    BLUETOOTH_DETECTED = "BLUETOOTH_DETECTED"
    SCREEN_RECORD_ATTEMPT = "SCREEN_RECORD_ATTEMPT"


class EnrollmentStatus(str, enum.Enum):
    ENROLLED = "ENROLLED"
    PRESENT = "PRESENT"
    ABSENT = "ABSENT"
    DISQUALIFIED = "DISQUALIFIED"


class ConnectivityTier(str, enum.Enum):
    TIER_1_METRO = "TIER_1_METRO"
    TIER_2_4G = "TIER_2_4G"
    TIER_3_BSNL = "TIER_3_BSNL"


# ═══════════════════════════════════════════════════════════════
# ORM Models
# ═══════════════════════════════════════════════════════════════

class User(Base):
    """
    User record — DPDP Act 2023 compliant.
    enrolled_photo_hash: ONLY hash of facial embedding. Never raw biometric.
    """
    __tablename__ = "users"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    email = Column(String(255), unique=True, nullable=True)
    phone = Column(String(15), nullable=True)
    role = Column(Enum(UserRole, name="user_role", create_type=True), nullable=False)
    full_name = Column(String(255), nullable=False)
    name_hi = Column(String(255), nullable=True)
    name_regional = Column(String(255), nullable=True)
    locale = Column(String(10), default="en")
    institution = Column(String(255), nullable=True)
    state = Column(String(100), nullable=True)
    district = Column(String(100), nullable=True)
    pincode = Column(String(10), nullable=True)
    enrolled_photo_hash = Column(LargeBinary, nullable=True)
    date_of_birth = Column(String(10), nullable=True)   # YYYY-MM-DD; candidate login factor + provisioned to the centre Edge
    dpdp_consent = Column(Boolean, default=False)
    dpdp_consent_at = Column(DateTime(timezone=True), nullable=True)
    dpdp_consent_ip = Column(String(45), nullable=True)
    dpdp_consent_version = Column(String(20), nullable=True)
    aadhaar_linked = Column(Boolean, default=False)
    password_hash = Column(Text, nullable=True)
    totp_secret = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    enrollments = relationship("Enrollment", back_populates="candidate")
    exams_set = relationship("Exam", back_populates="setter")


class Exam(Base):
    """Core exam record with full lifecycle state machine."""
    __tablename__ = "exams"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    name = Column(String(500), nullable=False)
    name_hi = Column(String(500), nullable=True)
    name_regional = Column(String(500), nullable=True)
    exam_body = Column(Enum(ExamBody, name="exam_body", create_type=True), nullable=False, default=ExamBody.CUSTOM)
    subject_taxonomy = Column(JSON, nullable=False)
    exam_type = Column(Enum(ExamType, name="exam_type", create_type=True), nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(Enum(ExamStatus, name="exam_status", create_type=True), nullable=False, default=ExamStatus.DRAFT)
    setter_id = Column(GUID, ForeignKey("users.id"), nullable=True)
    co_setter_ids = Column(JSON, nullable=True)
    sets_count = Column(Integer, default=4)
    negative_marking = Column(Numeric(4, 2), default=0.25)
    irt_config = Column(JSON, nullable=False)
    blooms_config = Column(JSON, nullable=False)
    question_hash = Column(LargeBinary, nullable=True)
    zk_proof_hash = Column(LargeBinary, nullable=True)
    zk_proof_ipfs = Column(String(100), nullable=True)
    constraint_spec_ipfs = Column(String(100), nullable=True)
    drand_round = Column(Integer, nullable=True)
    polygon_exam_tx = Column(String(66), nullable=True)
    polygon_zkproof_tx = Column(String(66), nullable=True)
    answer_merkle_root = Column(LargeBinary, nullable=True)
    polygon_answer_tx = Column(String(66), nullable=True)
    polygon_delivery_tx = Column(String(66), nullable=True)
    shamir_shard_count = Column(Integer, default=5)
    shamir_threshold = Column(Integer, default=3)
    paused_at = Column(DateTime(timezone=True), nullable=True)
    pause_reason = Column(Text, nullable=True)
    aborted_at = Column(DateTime(timezone=True), nullable=True)
    abort_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    setter = relationship("User", back_populates="exams_set")
    questions = relationship("Question", back_populates="exam", cascade="all, delete-orphan")
    enrollments = relationship("Enrollment", back_populates="exam", cascade="all, delete-orphan")
    anomalies = relationship("Anomaly", back_populates="exam", cascade="all, delete-orphan")
    shamir_shards = relationship("ShamirShard", back_populates="exam", cascade="all, delete-orphan")


class Question(Base):
    """IRT-calibrated question with Bloom's taxonomy and NCERT alignment."""
    __tablename__ = "questions"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    exam_id = Column(GUID, ForeignKey("exams.id", ondelete="CASCADE"), nullable=True)
    set_label = Column(String(1), nullable=True)
    sequence_number = Column(Integer, nullable=True)
    text = Column(Text, nullable=False)
    text_hi = Column(Text, nullable=True)
    text_regional = Column(Text, nullable=True)
    options = Column(JSON, nullable=False)
    options_hi = Column(JSON, nullable=True)
    correct_option = Column(String(1), nullable=False)
    subject = Column(String(255), nullable=True)
    topic = Column(String(255), nullable=True)
    ncert_reference = Column(String(255), nullable=True)
    blooms_level = Column(Integer, nullable=True)
    irt_b = Column(Numeric(6, 3), nullable=True)
    irt_a = Column(Numeric(6, 3), nullable=True)
    irt_c = Column(Numeric(6, 3), nullable=True)
    source = Column(Enum(QuestionSource, name="question_source", create_type=True), default=QuestionSource.AI_GENERATED)
    generation_model = Column(String(100), nullable=True)
    is_accepted = Column(Boolean, default=False)
    rejection_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    exam = relationship("Exam", back_populates="questions")


class Center(Base):
    """Exam center with geolocation and connectivity classification."""
    __tablename__ = "centers"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    name = Column(String(255), nullable=False)
    country = Column(String(100), default="India")
    state = Column(String(100), nullable=True)
    district = Column(String(100), nullable=True)
    city = Column(String(100), nullable=True)
    address = Column(Text, nullable=True)
    pincode = Column(String(10), nullable=True)
    latitude = Column(Numeric(9, 6), nullable=True)
    longitude = Column(Numeric(9, 6), nullable=True)
    capacity = Column(Integer, nullable=True)
    invigilator_name = Column(String(255), nullable=True)
    invigilator_phone = Column(String(15), nullable=True)
    connectivity = Column(Enum(ConnectivityTier, name="connectivity_tier", create_type=True), default=ConnectivityTier.TIER_2_4G)
    isp = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    hardware_nodes = relationship("HardwareNode", back_populates="center")
    enrollments = relationship("Enrollment", back_populates="center")


class HardwareNode(Base):
    """Physical security node: TPM 2.0 + GPS + tamper detection."""
    __tablename__ = "hardware_nodes"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    center_id = Column(GUID, ForeignKey("centers.id", ondelete="SET NULL"), nullable=True)
    serial_number = Column(String(100), unique=True, nullable=True)
    tpm_ek_cert_hash = Column(LargeBinary, nullable=True)
    gps_calibration = Column(JSON, nullable=True)
    firmware_version = Column(String(50), nullable=True)
    last_heartbeat = Column(DateTime(timezone=True), nullable=True)
    last_heartbeat_sig = Column(LargeBinary, nullable=True)
    status = Column(Enum(NodeStatus, name="node_status", create_type=True), default=NodeStatus.OFFLINE)
    delivery_proof_sig = Column(LargeBinary, nullable=True)
    delivery_proof_tx = Column(String(66), nullable=True)
    tamper_breach_at = Column(DateTime(timezone=True), nullable=True)
    battery_percent = Column(Integer, nullable=True)
    deployed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    center = relationship("Center", back_populates="hardware_nodes")

    # Virtual properties for API
    @property
    def is_online(self) -> bool:
        """Node is online if it has a recent heartbeat and status is not OFFLINE."""
        return self.status != NodeStatus.OFFLINE

    @property
    def center_name(self) -> str | None:
        return self.center.name if self.center else None

    @property
    def state(self) -> str | None:
        return self.center.state if self.center else None

    @property
    def latitude(self):
        if self.gps_calibration and "latitude" in self.gps_calibration:
            return self.gps_calibration["latitude"]
        return self.center.latitude if self.center else None

    @property
    def longitude(self):
        if self.gps_calibration and "longitude" in self.gps_calibration:
            return self.gps_calibration["longitude"]
        return self.center.longitude if self.center else None

    @property
    def tpm_verified(self) -> bool:
        return self.tpm_ek_cert_hash is not None


class Enrollment(Base):
    """Candidate-exam-center mapping with set assignment."""
    __tablename__ = "enrollments"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    candidate_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    exam_id = Column(GUID, ForeignKey("exams.id", ondelete="CASCADE"), nullable=True)
    center_id = Column(GUID, ForeignKey("centers.id", ondelete="SET NULL"), nullable=True)
    set_label = Column(String(1), nullable=True)
    roll_number = Column(String(50), nullable=True)
    status = Column(Enum(EnrollmentStatus, name="enrollment_status", create_type=True), default=EnrollmentStatus.ENROLLED)

    __table_args__ = (
        UniqueConstraint("candidate_id", "exam_id", name="uq_enrollment_candidate_exam"),
    )

    # Relationships
    candidate = relationship("User", back_populates="enrollments")
    exam = relationship("Exam", back_populates="enrollments")
    center = relationship("Center", back_populates="enrollments")
    session = relationship("Session", back_populates="enrollment", uselist=False)


class Session(Base):
    """
    Active exam session with encrypted answers.
    DPDP: answers_encrypted is AES-GCM blob. No plaintext ever persisted.
    """
    __tablename__ = "sessions"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    enrollment_id = Column(GUID, ForeignKey("enrollments.id", ondelete="CASCADE"), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    answers_encrypted = Column(JSON, nullable=True)  # In-session JSON, encrypted at final commit
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    answers_nonce = Column(LargeBinary, nullable=True)
    answer_hash = Column(LargeBinary, nullable=True)
    merkle_leaf = Column(LargeBinary, nullable=True)
    merkle_proof_path = Column(JSON, nullable=True)
    face_check_log = Column(JSON, default=list)
    tab_switch_count = Column(Integer, default=0)
    anomaly_flags = Column(JSON, default=list)
    is_submitted = Column(Boolean, default=False)
    is_disqualified = Column(Boolean, default=False)
    receipt_tx = Column(String(66), nullable=True)

    # Relationships
    enrollment = relationship("Enrollment", back_populates="session")
    anomalies = relationship("Anomaly", back_populates="session")


class Anomaly(Base):
    """Anti-cheat event log with severity classification."""
    __tablename__ = "anomalies"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    session_id = Column(GUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    exam_id = Column(GUID, ForeignKey("exams.id", ondelete="CASCADE"), nullable=True)
    center_id = Column(GUID, ForeignKey("centers.id", ondelete="SET NULL"), nullable=True)
    type = Column(Enum(AnomalyType, name="anomaly_type", create_type=True), nullable=True)
    severity = Column(Integer, nullable=True)
    details = Column(JSON, nullable=True)
    resolved = Column(Boolean, default=False)
    resolved_by = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    session = relationship("Session", back_populates="anomalies")
    exam = relationship("Exam", back_populates="anomalies")


class AdminAuditLog(Base):
    """Administrative action audit trail with 2-admin co-signature."""
    __tablename__ = "admin_audit_log"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    admin_id = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(100), nullable=True)
    target_type = Column(String(50), nullable=True)
    target_id = Column(GUID, nullable=True)
    reason = Column(Text, nullable=True)
    co_admin_id = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    ip_address = Column(String(45), nullable=True)
    on_chain_tx = Column(String(66), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class DPDPAuditLog(Base):
    """DPDP Act 2023 compliance — data subject rights + admin action tracking."""
    __tablename__ = "dpdp_audit_log"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    principal_id = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(100), nullable=True)
    resource_type = Column(String(50), nullable=True)
    resource_id = Column(String(100), nullable=True)
    details = Column(JSON, nullable=True)
    ip_address = Column(String(45), nullable=True)
    requested_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    fulfilled_at = Column(DateTime(timezone=True), nullable=True)
    fulfilled_by = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    data_categories = Column(JSON, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class BiometricEnrollment(Base):
    """
    § 29 — Biometric enrollment for invigilators (self-auth) and candidates (verification).

    DPDP Act 2023 data minimisation:
      - face_embedding stores ONLY a derived feature vector, never the raw photo.
      - fp_template_hash stores ONLY a hash/template, never a raw fingerprint image.
      - photo_thumbnail (optional 48×48) is for invigilator UI display only.
      - Rows expire (expires_at) and are purged after the exam window.
    """
    __tablename__ = "biometric_enrollments"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    exam_id = Column(GUID, ForeignKey("exams.id", ondelete="CASCADE"), nullable=True)
    center_id = Column(GUID, ForeignKey("centers.id", ondelete="SET NULL"), nullable=True)
    # Derived biometrics (never raw)
    face_embedding = Column(JSON, nullable=True)          # list[float] feature vector
    fp_template_hash = Column(String(128), nullable=True) # hex digest of FP template
    photo_thumbnail = Column(LargeBinary, nullable=True)  # 48×48 px, UI display only
    # WebAuthn / FIDO2
    webauthn_credential_id = Column(String(512), nullable=True)
    webauthn_public_key = Column(LargeBinary, nullable=True)
    webauthn_sign_count = Column(Integer, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    __table_args__ = (
        Index("ix_biometric_user_exam", "user_id", "exam_id"),
    )


class CandidateVerification(Base):
    """
    § 29.3 — Audit log of every candidate biometric verification at a centre.
    All verifications logged with invigilator_id, timestamp, match score, action.
    """
    __tablename__ = "candidate_verifications"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    candidate_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    invigilator_id = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    exam_id = Column(GUID, ForeignKey("exams.id", ondelete="SET NULL"), nullable=True)
    center_id = Column(GUID, ForeignKey("centers.id", ondelete="SET NULL"), nullable=True)
    hall_ticket = Column(String(100), nullable=True)
    face_match = Column(Boolean, default=False)
    face_confidence = Column(Numeric(5, 4), nullable=True)
    fp_match = Column(Boolean, default=False)
    fp_confidence = Column(Numeric(5, 4), nullable=True)
    overall_result = Column(
        Enum(VerificationResultEnum, name="verification_result", create_type=True),
        default=VerificationResultEnum.PENDING,
    )
    action_taken = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    synced = Column(Boolean, default=True)  # false if logged offline, pending server sync
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    __table_args__ = (
        Index("ix_verification_center_exam", "center_id", "exam_id"),
    )


class ShamirShard(Base):
    """Secret sharing shard metadata — hash only, never raw shard."""
    __tablename__ = "shamir_shards"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    exam_id = Column(GUID, ForeignKey("exams.id", ondelete="CASCADE"), nullable=True)
    holder_id = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    shard_index = Column(Integer, nullable=True)
    shard_hash = Column(LargeBinary, nullable=True)
    is_submitted = Column(Boolean, default=False)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    exam = relationship("Exam", back_populates="shamir_shards")


class SealedQuestionBundle(Base):
    """
    The keyless, per-question sealed bundle that is pre-positioned on the
    candidate terminal (§ 10.7 — TCS-iON-style lazy decryption).

    Stores ONLY ciphertext, IVs, tags and Merkle proofs — never a key and
    never plaintext. The `questions_root` is the value committed on-chain
    (mirrored on Exam.question_hash); `chain_tx` is the lockExam transaction.

    A terminal downloads `bundle` before T₀, then decrypts each question on
    demand once the T₀ master seed is released.
    """
    __tablename__ = "sealed_question_bundles"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    exam_id = Column(GUID, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True)
    questions_root = Column(String(66), nullable=False)   # 0x-prefixed hex — committed on-chain
    bundle_cid = Column(String(100), nullable=True)       # content-addressed pointer (IPFS) anchored on-chain
    question_count = Column(Integer, nullable=False, default=0)
    bundle = Column(JSON, nullable=False)                 # {examId, questionsRoot, count, items[]}
    chain_tx = Column(String(66), nullable=True)          # lockExam tx hash
    drand_round = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    exam = relationship("Exam")


class StaffApprovalStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class StaffRegistrationRequest(Base):
    """A real centre-staff registration captured on the public website (§9.2).

    Centre Admin applicants are approved by the System Admin; invigilator
    applicants by their centre's Centre Admin. Approval issues a one-time,
    time-boxed activation code (shown only to the approver). Activation itself
    still happens in person at the centre — this row only tracks the request
    and its approval, never an ACTIVE identity.
    """
    __tablename__ = "staff_registration_requests"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    role = Column(String(32), nullable=False)              # CENTER_ADMIN | CENTER_INVIGILATOR
    center_id = Column(GUID, ForeignKey("centers.id", ondelete="SET NULL"), nullable=True)
    center_name = Column(String(255), nullable=True)       # denormalised for display
    full_name = Column(String(255), nullable=False)
    face_embedding_hash = Column(String(64), nullable=False)
    status = Column(Enum(StaffApprovalStatus, name="staff_approval_status", create_type=True), default=StaffApprovalStatus.PENDING)
    fingerprint_authorised = Column(Boolean, default=False)
    activation_code_hash = Column(String(64), nullable=True)   # SHA-256 of the issued code (cleartext never stored)
    activation_code_expires_at = Column(DateTime(timezone=True), nullable=True)
    approver_role = Column(String(32), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    approved_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    center = relationship("Center")


class OtpChallenge(Base):
    """A real, single-use, time-boxed OTP issued after password auth and sent to
    the user's registered phone. The cleartext code is never stored — only its
    SHA-256 hash — and a challenge is consumed on first successful verify."""
    __tablename__ = "otp_challenges"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code_hash = Column(String(64), nullable=False)
    phone = Column(String(20), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed = Column(Boolean, default=False)
    attempts = Column(Integer, default=0)
    delivery = Column(String(20), default="sms")   # sms | dev
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class SystemAdminCredential(Base):
    """
    The tier-0 System Admin's hardware-bound login credential.

    Password + OTP is not enough for the account that can decrypt answers, so
    this tier authenticates with a WebAuthn platform authenticator — the
    fingerprint sensor on the machine itself (Windows Hello, Touch ID). The
    private key never leaves the device's secure element; we store only the
    public key, so a stolen database cannot produce an assertion.

    `sign_count` is the authenticator's monotonic counter. A replayed assertion
    carries a counter that does not advance, which is how cloned authenticators
    are detected — see verify_assertion().

    `face_embedding_hash` is the SHA-256 of the enrolment face descriptor. The
    descriptor itself is never stored (DPDP: biometric data is not retained,
    only a hash that can confirm a later match).

    `registered_ip` records where enrolment happened, because enrolment is
    restricted to an operator-controlled address (SYSTEM_ADMIN_ALLOWED_IPS).
    """
    __tablename__ = "system_admin_credentials"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # WebAuthn credential — base64url id, SPKI DER public key.
    credential_id = Column(String(512), unique=True, nullable=False, index=True)
    public_key_spki = Column(LargeBinary, nullable=False)
    sign_count = Column(Integer, nullable=False, default=0)
    aaguid = Column(String(64), nullable=True)

    # Second enrolment factor. Hash only — never the descriptor itself.
    face_embedding_hash = Column(String(64), nullable=True)

    registered_ip = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)


class EnquiryStatus(str, enum.Enum):
    NEW = "NEW"
    IN_REVIEW = "IN_REVIEW"
    ANSWERED = "ANSWERED"
    CLOSED = "CLOSED"


class Enquiry(Base):
    """
    An enquiry from the public site — "request a briefing", exam questions,
    press, procurement.

    This table exists because the contact form previously had no destination at
    all: `handleSubmit` set a "sent" flag in React state and discarded the
    message. An examination board would have filled in the form, been told it
    was sent, and waited for a reply nobody could have known to write. For a
    system whose whole argument is "don't take our word for it", silently
    dropping the one channel the public has is the worst possible defect.

    DPDP note: this holds contact details the enquirer chose to give us, so it
    is personal data with a purpose (answering them) and a retention duty. It is
    deliberately NOT joined to any exam, candidate or centre record.
    """
    __tablename__ = "enquiries"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    reference = Column(String(20), unique=True, nullable=False, index=True)
    full_name = Column(String(200), nullable=False)
    email = Column(String(255), nullable=False)
    phone = Column(String(32), nullable=True)
    organisation = Column(String(255), nullable=True)
    role_title = Column(String(255), nullable=True)
    topic = Column(String(64), nullable=False, default="GENERAL")
    message = Column(Text, nullable=False)

    status = Column(
        Enum(EnquiryStatus, name="enquiry_status", create_type=True),
        nullable=False,
        default=EnquiryStatus.NEW,
        index=True,
    )
    handled_by = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    handled_at = Column(DateTime(timezone=True), nullable=True)
    internal_note = Column(Text, nullable=True)

    # Kept for abuse handling only, never shown alongside the message body.
    source_ip = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, index=True)


# ═══════════════════════════════════════════════════════════════════════════
# ITEM POOL (design doc §5.1, §5.3, §6.1)
# ═══════════════════════════════════════════════════════════════════════════
#
# Questions used to belong to an exam from birth (`questions.exam_id`), so
# there was nothing to assemble *from*: one setter authored one paper and knew
# all of it. These two tables are the change that makes "the setter cannot leak
# the paper" a statement about arithmetic rather than about trust.
#
# A template is authored once and expands into many sibling items. A pool item
# belongs to NO exam until a form selects it, and the selection happens from a
# beacon that did not exist when the item was written.


class ItemStatus(str, enum.Enum):
    DRAFT = "DRAFT"                 # authored, not yet expanded
    PROVISIONAL = "PROVISIONAL"     # verified, difficulty is an estimate not a measurement
    CALIBRATED = "CALIBRATED"       # IRT estimated from real response data
    RETIRED = "RETIRED"             # over-exposed or withdrawn
    REJECTED = "REJECTED"           # failed the gauntlet


class ItemTemplate(Base):
    """
    A parametric item model. The answer is an EXPRESSION, never an asserted
    value — which is what makes a hallucinated key structurally impossible
    (§5.1). One template yields many siblings that differ only in parameters.
    """
    __tablename__ = "item_templates"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    template_id = Column(String(64), unique=True, nullable=False, index=True)
    author_id = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    subject = Column(String(120), nullable=False, index=True)
    topic = Column(String(200), nullable=True)
    blooms_level = Column(Integer, nullable=True)

    stem = Column(Text, nullable=False)                  # with {param} placeholders
    params = Column(JSON, nullable=False)                # {"R": [2,3,4], "v": [4,6]}
    param_constraint = Column(Text, nullable=True)       # optional filter expression
    answer_expr = Column(Text, nullable=False)           # evaluated, never trusted
    distractors = Column(JSON, nullable=False)           # [{expr, misconception}, ...]
    unit = Column(String(32), nullable=True)

    # Family-level IRT prior. Siblings inherit it — they differ only in numbers,
    # so §5.1's claim that swapping them is fairness-neutral holds.
    irt_a = Column(Numeric(6, 3), nullable=True)
    irt_b = Column(Numeric(6, 3), nullable=True)
    irt_c = Column(Numeric(6, 3), nullable=True)

    status = Column(
        Enum(ItemStatus, name="item_status", create_type=True),
        nullable=False, default=ItemStatus.DRAFT, index=True,
    )
    # Exposure is tracked per FAMILY, not per variant: retiring one variant
    # leaves its siblings answerable by anyone who has the template (§5.1a-A).
    exposure_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    items = relationship("PoolItem", back_populates="template", cascade="all, delete-orphan")


class PoolItem(Base):
    """
    One expanded, machine-verified sibling. Belongs to no exam until a form
    selects it — that decoupling is the whole point of the pool.
    """
    __tablename__ = "pool_items"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    template_pk = Column(GUID, ForeignKey("item_templates.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    # Random, unrelated to position — §6.2's defence against pool enumeration.
    blob_id = Column(String(32), unique=True, nullable=False, index=True)

    stem = Column(Text, nullable=False)
    options = Column(JSON, nullable=False)               # ["8 m/s²", "2 m/s²", ...]
    correct_index = Column(Integer, nullable=False)      # position after shuffle
    subject = Column(String(120), nullable=False, index=True)
    topic = Column(String(200), nullable=True)
    blooms_level = Column(Integer, nullable=True)

    irt_a = Column(Numeric(6, 3), nullable=True)
    irt_b = Column(Numeric(6, 3), nullable=True)
    irt_c = Column(Numeric(6, 3), nullable=True)

    status = Column(
        Enum(ItemStatus, name="pool_item_status", create_type=True),
        nullable=False, default=ItemStatus.PROVISIONAL, index=True,
    )
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    template = relationship("ItemTemplate", back_populates="items")


class ExamForm(Base):
    """
    One candidate form: an ordered list of pool item ids, produced at T−14d.

    N of these are committed together as `formSetRoot`; at T₀ the beacon picks
    an index (§6.1). Storing the selection rather than re-deriving it is what
    makes 3,000 centres agree — an index cannot drift, a solver can.
    """
    __tablename__ = "exam_forms"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    exam_id = Column(GUID, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True)
    form_index = Column(Integer, nullable=False)         # 0..N-1
    item_ids = Column(JSON, nullable=False)              # ordered pool_items.id
    form_hash = Column(String(64), nullable=False)       # sha256 over the id list
    # Worst single-author share, recorded so the cap is auditable after the fact.
    max_author_share = Column(Numeric(5, 4), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


# ═══════════════════════════════════════════════════════════════════════════
# EXAM REQUESTS → ACTIVE EXAMS → CANDIDATE CHOICES
# ═══════════════════════════════════════════════════════════════════════════
#
# Where an exam comes from, and what a candidate is allowed to choose about it.
#
# Before this, `Exam` rows appeared from nowhere in particular and the public
# enrolment form listed every one whose status happened to be enrollable. There
# was no record of WHO asked for the exam, no organisation against which a
# candidate could recognise it, and no approval anyone had to give. A candidate
# picked an exam name out of one list and a centre out of a separate list, and
# nothing connected the two.
#
# The chain is now: an organisation submits an ExamRequest -> the System Admin
# (tier-0) and the administration BOTH approve it -> an Exam and its
# ExamOffering are materialised -> and only then can a candidate register.
#
# Everything here is a NEW table on purpose. The app creates its schema with
# `Base.metadata.create_all`, which adds missing tables but never adds a column
# to a table that already exists -- so extending `exams` or `enrollments` in
# place would work on a fresh SQLite file and silently do nothing to a
# long-lived Postgres. Additive tables migrate themselves on both.


class ExamRequestStatus(str, enum.Enum):
    """
    Dual approval, tracked as one state rather than two booleans.

    Both authorities must approve, in either order, and either may reject. The
    states name which approval is still outstanding, so a queue can show an
    approver only what is actually theirs to act on.
    """
    SUBMITTED = "SUBMITTED"                    # awaiting both
    SYSADMIN_APPROVED = "SYSADMIN_APPROVED"    # tier-0 done, administration outstanding
    ADMIN_APPROVED = "ADMIN_APPROVED"          # administration done, tier-0 outstanding
    ACTIVE = "ACTIVE"                          # both approved; the exam is registerable
    REJECTED = "REJECTED"
    WITHDRAWN = "WITHDRAWN"


class ExamRequest(Base):
    """
    An organisation asking us to conduct an examination.

    This is the only way an exam becomes registerable. It carries the proposal
    exactly as the organisation stated it -- the exam name, who is conducting
    it, where it will be sat, and which subjects a candidate may choose --
    because those are the things a candidate is later asked to match against,
    and they must come from the requesting body rather than from us.
    """
    __tablename__ = "exam_requests"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    reference = Column(String(20), unique=True, nullable=False, index=True)

    # What a candidate selects at registration. Stored as given AND normalised
    # (case- and punctuation-insensitive), because "N.T.A." and "nta" are the
    # same body to a candidate and a lookup that disagrees is a lookup that
    # tells a real applicant their exam does not exist.
    exam_name = Column(String(500), nullable=False)
    exam_name_norm = Column(String(500), nullable=False, index=True)
    organisation = Column(String(255), nullable=False)
    organisation_norm = Column(String(255), nullable=False, index=True)

    contact_name = Column(String(200), nullable=False)
    contact_email = Column(String(255), nullable=False)
    contact_phone = Column(String(32), nullable=True)

    proposed_date = Column(DateTime(timezone=True), nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)

    # How many optional subjects a candidate must choose. Null means the subject
    # list is not a choice at all and every subject applies.
    subject_choice_min = Column(Integer, nullable=True)
    subject_choice_max = Column(Integer, nullable=True)

    status = Column(
        Enum(ExamRequestStatus, name="exam_request_status", create_type=True),
        nullable=False, default=ExamRequestStatus.SUBMITTED, index=True,
    )
    # Recorded separately so an audit can answer "who let this exam exist", and
    # so neither authority can be mistaken for the other.
    sysadmin_approved_by = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    sysadmin_approved_at = Column(DateTime(timezone=True), nullable=True)
    admin_approved_by = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    admin_approved_at = Column(DateTime(timezone=True), nullable=True)
    rejected_by = Column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(Text, nullable=True)

    # Set when both approvals land and the Exam is materialised.
    exam_id = Column(GUID, ForeignKey("exams.id", ondelete="SET NULL"), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, index=True)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    locations = relationship(
        "ExamRequestLocation", back_populates="request",
        cascade="all, delete-orphan", order_by="ExamRequestLocation.display_order",
    )
    subjects = relationship(
        "ExamRequestSubject", back_populates="request",
        cascade="all, delete-orphan", order_by="ExamRequestSubject.display_order",
    )


class ExamRequestLocation(Base):
    """
    One named place the requesting organisation intends to run the exam.

    Named, because a candidate chooses between these by name -- "Kolkata - Salt
    Lake" means something to them and a centre UUID does not.
    """
    __tablename__ = "exam_request_locations"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    request_id = Column(GUID, ForeignKey("exam_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    city = Column(String(120), nullable=True)
    state = Column(String(120), nullable=True)
    address = Column(Text, nullable=True)
    # Null means "no stated limit"; allotment then never refuses this location.
    capacity = Column(Integer, nullable=True)
    display_order = Column(Integer, nullable=False, default=0)

    request = relationship("ExamRequest", back_populates="locations")


class ExamRequestSubject(Base):
    """A subject on the proposed paper, and whether a candidate may decline it."""
    __tablename__ = "exam_request_subjects"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    request_id = Column(GUID, ForeignKey("exam_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    code = Column(String(40), nullable=True)
    # Compulsory subjects are not offered as a choice; they simply apply.
    is_compulsory = Column(Boolean, nullable=False, default=True)
    display_order = Column(Integer, nullable=False, default=0)

    request = relationship("ExamRequest", back_populates="subjects")


class ExamOffering(Base):
    """
    The public, registerable face of an exam: who is conducting it and what a
    candidate may choose. One per Exam, created when both approvals land.

    `Exam` itself is the sealed-content lifecycle record (questions, ZK proof,
    Merkle roots). Registration needs none of that and would otherwise have to
    reach into it, so the two are kept apart: this table is what the public API
    reads, and it holds nothing sealed.
    """
    __tablename__ = "exam_offerings"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    exam_id = Column(GUID, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    request_id = Column(GUID, ForeignKey("exam_requests.id", ondelete="SET NULL"), nullable=True)

    organisation = Column(String(255), nullable=False, index=True)
    organisation_norm = Column(String(255), nullable=False, index=True)
    exam_name_norm = Column(String(500), nullable=False, index=True)

    # Registration is open only while this is true AND the Exam's own status
    # still permits it. Two gates because they answer different questions:
    # "should the public see it" and "has the paper already been sat".
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    registration_opens_at = Column(DateTime(timezone=True), nullable=True)
    registration_closes_at = Column(DateTime(timezone=True), nullable=True)

    subject_choice_min = Column(Integer, nullable=True)
    subject_choice_max = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    locations = relationship(
        "ExamLocation", back_populates="offering",
        cascade="all, delete-orphan", order_by="ExamLocation.display_order",
    )
    subjects = relationship(
        "ExamSubject", back_populates="offering",
        cascade="all, delete-orphan", order_by="ExamSubject.display_order",
    )


class ExamLocation(Base):
    """A location a candidate may be allotted for a specific exam."""
    __tablename__ = "exam_locations"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    offering_id = Column(GUID, ForeignKey("exam_offerings.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    city = Column(String(120), nullable=True)
    state = Column(String(120), nullable=True)
    address = Column(Text, nullable=True)
    capacity = Column(Integer, nullable=True)
    display_order = Column(Integer, nullable=False, default=0)
    # Bound to a real centre once one exists for this location. Until then the
    # location is a stated place, not yet a provisioned centre -- and saying so
    # is better than inventing a Center row nobody has commissioned.
    center_id = Column(GUID, ForeignKey("centers.id", ondelete="SET NULL"), nullable=True)

    offering = relationship("ExamOffering", back_populates="locations")


class ExamSubject(Base):
    """A subject on a live exam, and whether choosing it is optional."""
    __tablename__ = "exam_subjects"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    offering_id = Column(GUID, ForeignKey("exam_offerings.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    code = Column(String(40), nullable=True)
    is_compulsory = Column(Boolean, nullable=False, default=True)
    display_order = Column(Integer, nullable=False, default=0)

    offering = relationship("ExamOffering", back_populates="subjects")


class CandidateChoice(Base):
    """
    What one candidate chose at registration, and what they were allotted.

    Kept beside `Enrollment` rather than inside it because `enrollments` is an
    existing table and this schema is created with `create_all`, which would
    never have added these columns to a database that already had it.

    `location_preferences` is an ORDERED list of exam_locations.id. The order is
    the whole point: allotment walks it and takes the first location with room,
    so a candidate who cannot have their first choice lands on their second
    rather than somewhere nobody asked for.
    """
    __tablename__ = "candidate_choices"

    id = Column(GUID, primary_key=True, default=lambda: str(uuid4()))
    enrollment_id = Column(GUID, ForeignKey("enrollments.id", ondelete="CASCADE"),
                           nullable=False, unique=True, index=True)
    location_preferences = Column(JSON, nullable=False, default=list)   # ordered [exam_locations.id]
    allotted_location_id = Column(GUID, ForeignKey("exam_locations.id", ondelete="SET NULL"),
                                  nullable=True, index=True)
    # Which preference index was satisfied (0 = first choice). Null until allotted.
    allotted_preference_rank = Column(Integer, nullable=True)
    allotted_at = Column(DateTime(timezone=True), nullable=True)
    # The compulsory subjects plus whichever optional ones were chosen, as
    # exam_subjects.id.
    subject_ids = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
