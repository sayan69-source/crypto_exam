-- ════════════════════════════════════════════════════════════════════════
-- 000_base_subset.sql — centre-scoped base tables for the Centre Edge DB.
--
-- The Edge runs its OWN local PostgreSQL holding only the centre-scoped subset
-- (§12 preamble). The authoritative superset lives at HQ. This file creates the
-- minimal base tables the Edge references, using the SAME column names as the
-- public init.sql so the two stay contract-compatible. It is deliberately
-- self-contained so the Edge DB boots without importing anything from public/.
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- Role enum already carries the privileged tiers here (HQ adds them via
-- ALTER TYPE ... ADD VALUE on its pre-existing enum; §12.1).
CREATE TYPE user_role         AS ENUM (
  'CANDIDATE', 'SETTER', 'ADMIN',
  'CENTER_INVIGILATOR', 'CENTER_ADMIN', 'SYSTEM_ADMIN'
);
CREATE TYPE enrollment_status AS ENUM ('ENROLLED', 'PRESENT', 'ABSENT', 'DISQUALIFIED');

CREATE TABLE centers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    state       VARCHAR(100),
    district    VARCHAR(100),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE exams (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             VARCHAR(500) NOT NULL,
    scheduled_at     TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 180,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role                user_role NOT NULL,
    full_name           VARCHAR(255) NOT NULL,
    locale              VARCHAR(10) DEFAULT 'en',
    enrolled_photo_hash BYTEA,                    -- face embedding hash (DPDP)
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

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
