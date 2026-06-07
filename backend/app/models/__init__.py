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
    Index, ARRAY,
)
from sqlalchemy.dialects.postgresql import UUID, INET, JSONB
from sqlalchemy.orm import relationship

from app.database import Base


# ── Python ENUM Types ──

class UserRole(str, enum.Enum):
    CANDIDATE = "CANDIDATE"
    SETTER = "SETTER"
    ADMIN = "ADMIN"


class ExamType(str, enum.Enum):
    ONLINE_CBT = "ONLINE_CBT"
    OFFLINE_HARDWARE = "OFFLINE_HARDWARE"
    HYBRID = "HYBRID"


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
    TIER_4_OFFLINE = "TIER_4_OFFLINE"


# ═══════════════════════════════════════════════════════════════
# ORM Models
# ═══════════════════════════════════════════════════════════════

class User(Base):
    """
    User record — DPDP Act 2023 compliant.
    enrolled_photo_hash: ONLY hash of facial embedding. Never raw biometric.
    """
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    email = Column(String(255), unique=True, nullable=True)
    phone = Column(String(15), nullable=True)
    role = Column(Enum(UserRole, name="user_role", create_type=False), nullable=False)
    full_name = Column(String(255), nullable=False)
    name_hi = Column(String(255), nullable=True)
    name_regional = Column(String(255), nullable=True)
    locale = Column(String(10), default="en")
    institution = Column(String(255), nullable=True)
    state = Column(String(100), nullable=True)
    district = Column(String(100), nullable=True)
    pincode = Column(String(10), nullable=True)
    enrolled_photo_hash = Column(LargeBinary, nullable=True)
    dpdp_consent = Column(Boolean, default=False)
    dpdp_consent_at = Column(DateTime(timezone=True), nullable=True)
    dpdp_consent_ip = Column(INET, nullable=True)
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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name = Column(String(500), nullable=False)
    name_hi = Column(String(500), nullable=True)
    name_regional = Column(String(500), nullable=True)
    exam_body = Column(Enum(ExamBody, name="exam_body", create_type=False), nullable=False, default=ExamBody.CUSTOM)
    subject_taxonomy = Column(JSONB, nullable=False)
    exam_type = Column(Enum(ExamType, name="exam_type", create_type=False), nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(Enum(ExamStatus, name="exam_status", create_type=False), nullable=False, default=ExamStatus.DRAFT)
    setter_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    co_setter_ids = Column(ARRAY(UUID(as_uuid=True)), nullable=True)
    sets_count = Column(Integer, default=4)
    negative_marking = Column(Numeric(4, 2), default=0.25)
    irt_config = Column(JSONB, nullable=False)
    blooms_config = Column(JSONB, nullable=False)
    question_hash = Column(LargeBinary, nullable=True)
    zk_proof_hash = Column(LargeBinary, nullable=True)
    zk_proof_ipfs = Column(String(100), nullable=True)
    constraint_spec_ipfs = Column(String(100), nullable=True)
    drand_round = Column(Integer, nullable=True)
    timelock_commit = Column(LargeBinary, nullable=True)
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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    exam_id = Column(UUID(as_uuid=True), ForeignKey("exams.id", ondelete="CASCADE"), nullable=True)
    set_label = Column(String(1), nullable=True)
    sequence_number = Column(Integer, nullable=True)
    text = Column(Text, nullable=False)
    text_hi = Column(Text, nullable=True)
    text_regional = Column(Text, nullable=True)
    options = Column(JSONB, nullable=False)
    options_hi = Column(JSONB, nullable=True)
    correct_option = Column(String(1), nullable=False)
    subject = Column(String(255), nullable=True)
    topic = Column(String(255), nullable=True)
    ncert_reference = Column(String(255), nullable=True)
    blooms_level = Column(Integer, nullable=True)
    irt_b = Column(Numeric(6, 3), nullable=True)
    irt_a = Column(Numeric(6, 3), nullable=True)
    irt_c = Column(Numeric(6, 3), nullable=True)
    source = Column(Enum(QuestionSource, name="question_source", create_type=False), default=QuestionSource.AI_GENERATED)
    generation_model = Column(String(100), nullable=True)
    is_accepted = Column(Boolean, default=False)
    rejection_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    exam = relationship("Exam", back_populates="questions")


class Center(Base):
    """Exam center with geolocation and connectivity classification."""
    __tablename__ = "centers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
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
    connectivity = Column(Enum(ConnectivityTier, name="connectivity_tier", create_type=False), default=ConnectivityTier.TIER_2_4G)
    isp = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    hardware_nodes = relationship("HardwareNode", back_populates="center")
    enrollments = relationship("Enrollment", back_populates="center")


class HardwareNode(Base):
    """Physical security node: TPM 2.0 + GPS + tamper detection."""
    __tablename__ = "hardware_nodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    center_id = Column(UUID(as_uuid=True), ForeignKey("centers.id", ondelete="SET NULL"), nullable=True)
    serial_number = Column(String(100), unique=True, nullable=True)
    tpm_ek_cert_hash = Column(LargeBinary, nullable=True)
    gps_calibration = Column(JSONB, nullable=True)
    firmware_version = Column(String(50), nullable=True)
    last_heartbeat = Column(DateTime(timezone=True), nullable=True)
    last_heartbeat_sig = Column(LargeBinary, nullable=True)
    status = Column(Enum(NodeStatus, name="node_status", create_type=False), default=NodeStatus.OFFLINE)
    timelock_puzzle = Column(JSONB, nullable=True)
    delivery_proof_sig = Column(LargeBinary, nullable=True)
    delivery_proof_tx = Column(String(66), nullable=True)
    tamper_breach_at = Column(DateTime(timezone=True), nullable=True)
    battery_percent = Column(Integer, nullable=True)
    deployed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    center = relationship("Center", back_populates="hardware_nodes")


class Enrollment(Base):
    """Candidate-exam-center mapping with set assignment."""
    __tablename__ = "enrollments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    exam_id = Column(UUID(as_uuid=True), ForeignKey("exams.id", ondelete="CASCADE"), nullable=True)
    center_id = Column(UUID(as_uuid=True), ForeignKey("centers.id", ondelete="SET NULL"), nullable=True)
    set_label = Column(String(1), nullable=True)
    roll_number = Column(String(50), nullable=True)
    status = Column(Enum(EnrollmentStatus, name="enrollment_status", create_type=False), default=EnrollmentStatus.ENROLLED)

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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    enrollment_id = Column(UUID(as_uuid=True), ForeignKey("enrollments.id", ondelete="CASCADE"), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    answers_encrypted = Column(LargeBinary, nullable=True)
    answers_nonce = Column(LargeBinary, nullable=True)
    answer_hash = Column(LargeBinary, nullable=True)
    merkle_leaf = Column(LargeBinary, nullable=True)
    merkle_proof_path = Column(JSONB, nullable=True)
    face_check_log = Column(JSONB, default=list)
    tab_switch_count = Column(Integer, default=0)
    anomaly_flags = Column(JSONB, default=list)
    is_submitted = Column(Boolean, default=False)
    is_disqualified = Column(Boolean, default=False)
    receipt_tx = Column(String(66), nullable=True)

    # Relationships
    enrollment = relationship("Enrollment", back_populates="session")
    anomalies = relationship("Anomaly", back_populates="session")


class Anomaly(Base):
    """Anti-cheat event log with severity classification."""
    __tablename__ = "anomalies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    exam_id = Column(UUID(as_uuid=True), ForeignKey("exams.id", ondelete="CASCADE"), nullable=True)
    center_id = Column(UUID(as_uuid=True), ForeignKey("centers.id", ondelete="SET NULL"), nullable=True)
    type = Column(Enum(AnomalyType, name="anomaly_type", create_type=False), nullable=True)
    severity = Column(Integer, nullable=True)
    details = Column(JSONB, nullable=True)
    resolved = Column(Boolean, default=False)
    resolved_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    session = relationship("Session", back_populates="anomalies")
    exam = relationship("Exam", back_populates="anomalies")


class AdminAuditLog(Base):
    """Administrative action audit trail with 2-admin co-signature."""
    __tablename__ = "admin_audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    admin_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(100), nullable=True)
    target_type = Column(String(50), nullable=True)
    target_id = Column(UUID(as_uuid=True), nullable=True)
    reason = Column(Text, nullable=True)
    co_admin_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    ip_address = Column(INET, nullable=True)
    on_chain_tx = Column(String(66), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class DPDPAuditLog(Base):
    """DPDP Act 2023 compliance — data subject rights tracking."""
    __tablename__ = "dpdp_audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    principal_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(100), nullable=True)
    requested_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    fulfilled_at = Column(DateTime(timezone=True), nullable=True)
    fulfilled_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    data_categories = Column(ARRAY(Text), nullable=True)
    notes = Column(Text, nullable=True)


class ShamirShard(Base):
    """Secret sharing shard metadata — hash only, never raw shard."""
    __tablename__ = "shamir_shards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    exam_id = Column(UUID(as_uuid=True), ForeignKey("exams.id", ondelete="CASCADE"), nullable=True)
    holder_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    shard_index = Column(Integer, nullable=True)
    shard_hash = Column(LargeBinary, nullable=True)
    is_submitted = Column(Boolean, default=False)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    exam = relationship("Exam", back_populates="shamir_shards")
