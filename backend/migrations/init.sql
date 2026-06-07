-- ═══════════════════════════════════════════════════════════════
-- CryptoExam Core — PostgreSQL 16 Schema
-- § 9 — Database Schema
--
-- DPDP Act 2023 compliant by design:
--   • Biometric data: NEVER stored raw — only hash of facial embedding
--   • Explicit consent tracking: dpdp_consent, dpdp_consent_at, dpdp_consent_ip
--   • Data subject rights: dpdp_audit_log table
--   • Data minimisation: no redundant PII storage
-- ═══════════════════════════════════════════════════════════════

-- ── Custom ENUM Types ──

CREATE TYPE user_role         AS ENUM ('CANDIDATE', 'SETTER', 'ADMIN');
CREATE TYPE exam_type         AS ENUM ('ONLINE_CBT', 'OFFLINE_HARDWARE', 'HYBRID');
CREATE TYPE exam_body         AS ENUM ('NTA', 'UPSC', 'SSC', 'IBPS', 'STATE_PSC', 'CBSE', 'CUSTOM');
CREATE TYPE exam_status       AS ENUM (
    'DRAFT', 'GENERATING', 'PROOF_PENDING', 'LOCKED',
    'DISTRIBUTED', 'LIVE', 'PAUSED', 'COMPLETED', 'AUDITED', 'ABORTED'
);
CREATE TYPE node_status       AS ENUM ('OFFLINE', 'ARMED', 'DECRYPTING', 'COMPLETE', 'ERROR', 'TAMPER_BREACH');
CREATE TYPE question_source   AS ENUM ('AI_GENERATED', 'AI_HYBRID', 'MANUAL_UPLOAD');
CREATE TYPE anomaly_type      AS ENUM (
    'TAB_SWITCH', 'FACE_FAIL', 'NETWORK_DROP', 'NODE_OFFLINE',
    'COPY_ATTEMPT', 'SUSPICIOUS_TIMING', 'FULLSCREEN_EXIT',
    'VM_DETECTED', 'BLUETOOTH_DETECTED', 'SCREEN_RECORD_ATTEMPT'
);
CREATE TYPE enrollment_status AS ENUM ('ENROLLED', 'PRESENT', 'ABSENT', 'DISQUALIFIED');
CREATE TYPE connectivity_tier AS ENUM ('TIER_1_METRO', 'TIER_2_4G', 'TIER_3_BSNL', 'TIER_4_OFFLINE');


-- ═══════════════════════════════════════════════════════════════
-- Table: users
-- DPDP: enrolled_photo_hash stores ONLY hash of facial embedding.
--       Never raw biometric data. dpdp_consent fields track consent.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE users (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                VARCHAR(255) UNIQUE,
    phone                VARCHAR(15),
    role                 user_role NOT NULL,
    full_name            VARCHAR(255) NOT NULL,
    name_hi              VARCHAR(255),               -- Name in Hindi (Devanagari)
    name_regional        VARCHAR(255),               -- Name in regional language
    locale               VARCHAR(10) DEFAULT 'en',
    institution          VARCHAR(255),
    state                VARCHAR(100),               -- Indian state
    district             VARCHAR(100),
    pincode              VARCHAR(10),
    enrolled_photo_hash  BYTEA,                      -- Hash of facial embedding ONLY
    dpdp_consent         BOOLEAN DEFAULT FALSE,      -- DPDP Act 2023 Section 4 consent
    dpdp_consent_at      TIMESTAMPTZ,
    dpdp_consent_ip      INET,
    dpdp_consent_version VARCHAR(20),                -- Consent text version for legal traceability
    aadhaar_linked       BOOLEAN DEFAULT FALSE,
    password_hash        TEXT,
    totp_secret          TEXT,                       -- Admin TOTP (AES-256 encrypted at rest)
    is_active            BOOLEAN DEFAULT TRUE,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- Table: exams
-- Core exam record with full lifecycle state machine.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE exams (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  VARCHAR(500) NOT NULL,
    name_hi               VARCHAR(500),
    name_regional         VARCHAR(500),
    exam_body             exam_body NOT NULL DEFAULT 'CUSTOM',
    subject_taxonomy      JSONB NOT NULL,
    exam_type             exam_type NOT NULL,
    duration_minutes      INTEGER NOT NULL,
    scheduled_at          TIMESTAMPTZ NOT NULL,
    status                exam_status NOT NULL DEFAULT 'DRAFT',
    setter_id             UUID REFERENCES users(id),
    co_setter_ids         UUID[],
    sets_count            INTEGER DEFAULT 4,
    negative_marking      DECIMAL(4,2) DEFAULT 0.25,
    irt_config            JSONB NOT NULL,
    blooms_config         JSONB NOT NULL,
    question_hash         BYTEA,
    zk_proof_hash         BYTEA,
    zk_proof_ipfs         VARCHAR(100),
    constraint_spec_ipfs  VARCHAR(100),
    drand_round           BIGINT,
    timelock_commit       BYTEA,
    polygon_exam_tx       VARCHAR(66),
    polygon_zkproof_tx    VARCHAR(66),
    answer_merkle_root    BYTEA,
    polygon_answer_tx     VARCHAR(66),
    polygon_delivery_tx   VARCHAR(66),
    shamir_shard_count    INTEGER DEFAULT 5,
    shamir_threshold      INTEGER DEFAULT 3,
    paused_at             TIMESTAMPTZ,
    pause_reason          TEXT,
    aborted_at            TIMESTAMPTZ,
    abort_reason          TEXT,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- Table: questions
-- IRT-calibrated questions with Bloom's taxonomy and NCERT alignment.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE questions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id          UUID REFERENCES exams(id) ON DELETE CASCADE,
    set_label        CHAR(1),
    sequence_number  INTEGER,
    text             TEXT NOT NULL,
    text_hi          TEXT,
    text_regional    TEXT,
    options          JSONB NOT NULL,      -- {"A": "...", "B": "...", "C": "...", "D": "..."}
    options_hi       JSONB,
    correct_option   CHAR(1) NOT NULL,
    subject          VARCHAR(255),
    topic            VARCHAR(255),
    ncert_reference  VARCHAR(255),        -- NCERT chapter/page for NEET/JEE alignment
    blooms_level     INTEGER CHECK (blooms_level BETWEEN 1 AND 6),
    irt_b            DECIMAL(6,3),        -- Difficulty
    irt_a            DECIMAL(6,3),        -- Discrimination
    irt_c            DECIMAL(6,3),        -- Guessing
    source           question_source DEFAULT 'AI_GENERATED',
    generation_model VARCHAR(100),
    is_accepted      BOOLEAN DEFAULT FALSE,
    rejection_reason TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- Table: centers
-- Exam centers with geolocation and connectivity classification.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE centers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(255) NOT NULL,
    country           VARCHAR(100) DEFAULT 'India',
    state             VARCHAR(100),
    district          VARCHAR(100),
    city              VARCHAR(100),
    address           TEXT,
    pincode           VARCHAR(10),
    latitude          DECIMAL(9,6),
    longitude         DECIMAL(9,6),
    capacity          INTEGER,
    invigilator_name  VARCHAR(255),
    invigilator_phone VARCHAR(15),
    connectivity      connectivity_tier DEFAULT 'TIER_2_4G',
    isp               VARCHAR(100),
    created_at        TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- Table: hardware_nodes
-- Physical security nodes with TPM 2.0, GPS, and tamper detection.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE hardware_nodes (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id            UUID REFERENCES centers(id) ON DELETE SET NULL,
    serial_number        VARCHAR(100) UNIQUE,
    tpm_ek_cert_hash     BYTEA,
    gps_calibration      JSONB,
    firmware_version     VARCHAR(50),
    last_heartbeat       TIMESTAMPTZ,
    last_heartbeat_sig   BYTEA,            -- TPM 2.0 signed heartbeat
    status               node_status DEFAULT 'OFFLINE',
    timelock_puzzle      JSONB,
    delivery_proof_sig   BYTEA,
    delivery_proof_tx    VARCHAR(66),
    tamper_breach_at     TIMESTAMPTZ,
    battery_percent      INTEGER,
    deployed_at          TIMESTAMPTZ
);


-- ═══════════════════════════════════════════════════════════════
-- Table: enrollments
-- Candidate-exam-center mapping with set assignment.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE enrollments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    exam_id       UUID REFERENCES exams(id) ON DELETE CASCADE,
    center_id     UUID REFERENCES centers(id) ON DELETE SET NULL,
    set_label     CHAR(1),
    roll_number   VARCHAR(50),
    status        enrollment_status DEFAULT 'ENROLLED',
    UNIQUE (candidate_id, exam_id)
);


-- ═══════════════════════════════════════════════════════════════
-- Table: sessions
-- Active exam sessions with encrypted answers and anomaly tracking.
-- DPDP: answers_encrypted stored as AES-GCM blob. No plaintext.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id     UUID REFERENCES enrollments(id) ON DELETE CASCADE,
    started_at        TIMESTAMPTZ,
    ended_at          TIMESTAMPTZ,
    answers_encrypted BYTEA,            -- AES-GCM encrypted blob
    answers_nonce     BYTEA,
    answer_hash       BYTEA,            -- SHA-256 of plaintext (set only on submit)
    merkle_leaf       BYTEA,
    merkle_proof_path JSONB,            -- Inclusion proof for candidate receipt
    face_check_log    JSONB DEFAULT '[]',
    tab_switch_count  INTEGER DEFAULT 0,
    anomaly_flags     JSONB DEFAULT '[]',
    is_submitted      BOOLEAN DEFAULT FALSE,
    is_disqualified   BOOLEAN DEFAULT FALSE,
    receipt_tx        VARCHAR(66)
);


-- ═══════════════════════════════════════════════════════════════
-- Table: anomalies
-- Anti-cheat event log with severity classification.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE anomalies (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID REFERENCES sessions(id) ON DELETE CASCADE,
    exam_id      UUID REFERENCES exams(id) ON DELETE CASCADE,
    center_id    UUID REFERENCES centers(id) ON DELETE SET NULL,
    type         anomaly_type,
    severity     INTEGER CHECK (severity BETWEEN 1 AND 5),
    details      JSONB,
    resolved     BOOLEAN DEFAULT FALSE,
    resolved_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- Table: admin_audit_log
-- Administrative action audit trail with 2-admin co-signature.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE admin_audit_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action       VARCHAR(100),
    target_type  VARCHAR(50),
    target_id    UUID,
    reason       TEXT,
    co_admin_id  UUID REFERENCES users(id) ON DELETE SET NULL,   -- 2-admin co-signature
    ip_address   INET,
    on_chain_tx  VARCHAR(66),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- Table: dpdp_audit_log
-- DPDP Act 2023 compliance audit — data subject rights tracking.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE dpdp_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(100),  -- ACCESS_REQUEST, CORRECTION, ERASURE, CONSENT_WITHDRAW
    requested_at    TIMESTAMPTZ DEFAULT NOW(),
    fulfilled_at    TIMESTAMPTZ,
    fulfilled_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    data_categories TEXT[],        -- What categories of data were accessed
    notes           TEXT
);


-- ═══════════════════════════════════════════════════════════════
-- Table: shamir_shards
-- Secret sharing shard metadata — hash only, never raw shard in DB.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE shamir_shards (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id      UUID REFERENCES exams(id) ON DELETE CASCADE,
    holder_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    shard_index  INTEGER,
    shard_hash   BYTEA,              -- Hash only — NEVER raw shard in DB
    is_submitted BOOLEAN DEFAULT FALSE,
    submitted_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════
-- Performance Indexes
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX idx_sessions_enrollment    ON sessions(enrollment_id);
CREATE INDEX idx_sessions_unsubmitted   ON sessions(is_submitted) WHERE NOT is_submitted;
CREATE INDEX idx_enrollments_exam       ON enrollments(exam_id);
CREATE INDEX idx_enrollments_candidate  ON enrollments(candidate_id);
CREATE INDEX idx_questions_exam         ON questions(exam_id);
CREATE INDEX idx_questions_set          ON questions(exam_id, set_label);
CREATE INDEX idx_anomalies_exam         ON anomalies(exam_id);
CREATE INDEX idx_anomalies_unresolved   ON anomalies(exam_id, resolved) WHERE NOT resolved;
CREATE INDEX idx_anomalies_session      ON anomalies(session_id);
CREATE INDEX idx_nodes_center           ON hardware_nodes(center_id);
CREATE INDEX idx_nodes_status           ON hardware_nodes(status);
CREATE INDEX idx_audit_admin            ON admin_audit_log(admin_id);
CREATE INDEX idx_audit_created          ON admin_audit_log(created_at);
CREATE INDEX idx_exams_status           ON exams(status);
CREATE INDEX idx_exams_scheduled        ON exams(scheduled_at);
CREATE INDEX idx_exams_setter           ON exams(setter_id);
CREATE INDEX idx_centers_state          ON centers(state);
CREATE INDEX idx_centers_location       ON centers(latitude, longitude);
CREATE INDEX idx_dpdp_principal         ON dpdp_audit_log(principal_id);
CREATE INDEX idx_users_role             ON users(role);
CREATE INDEX idx_users_email            ON users(email);
CREATE INDEX idx_shamir_exam            ON shamir_shards(exam_id);


-- ═══════════════════════════════════════════════════════════════
-- Seed Data: Demo exam centers (5 representative Indian cities)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO centers (name, state, district, city, latitude, longitude, capacity, connectivity, isp) VALUES
    ('IIT Delhi Exam Hall',           'Delhi (NCT)',    'South Delhi',     'New Delhi',   28.5450, 77.1926, 500, 'TIER_1_METRO', 'Jio Fiber'),
    ('NIT Patna Convention Centre',   'Bihar',          'Patna',           'Patna',       25.6209, 85.1723, 300, 'TIER_2_4G',    'Airtel'),
    ('Kendriya Vidyalaya Guwahati',   'Assam',          'Kamrup Metro',    'Guwahati',    26.1445, 91.7362, 200, 'TIER_2_4G',    'BSNL'),
    ('Government School Leh',         'Ladakh',         'Leh',             'Leh',         34.1526, 77.5771, 80,  'TIER_4_OFFLINE','BSNL'),
    ('Anna University Exam Centre',   'Tamil Nadu',     'Chennai',         'Chennai',     13.0108, 80.2354, 450, 'TIER_1_METRO', 'ACT Fibernet');
