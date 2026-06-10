-- ════════════════════════════════════════════════════════════════════════
-- 001_zuup_core.sql — the §12 ZUUP-OS additive schema (v2).
--
-- Field names are the CONTRACT (§0.1): implementations may add columns but must
-- not remove or rename these. On the HQ superset DB the role-enum values are
-- added with `ALTER TYPE user_role ADD VALUE IF NOT EXISTS ...` (§12.1); here
-- they already exist from 000_base_subset.sql.
-- ════════════════════════════════════════════════════════════════════════

-- ── §12.1 Enums ─────────────────────────────────────────────────────────
CREATE TYPE identity_status   AS ENUM ('PENDING_APPROVAL','ACTIVE','SUSPENDED','REVOKED');
CREATE TYPE terminal_cap      AS ENUM ('CANDIDATE_SEAT','INVIGILATOR_STATION','ADMIN_STATION');
CREATE TYPE terminal_state    AS ENUM ('AVAILABLE','ASSIGNED','ATTENDED','IN_EXAM','SUBMITTED','DOWN','LOCKED');
CREATE TYPE approval_kind     AS ENUM ('INVIGILATOR_REGISTRATION','CENTER_ADMIN_REGISTRATION');
CREATE TYPE answer_sync_state AS ENUM ('SEALED','SYNCED','DECRYPTED','ANCHORED');

-- ── §12.2 Privileged identities ─────────────────────────────────────────
CREATE TABLE staff_identities (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role                 user_role NOT NULL CHECK (role IN
                            ('CENTER_INVIGILATOR','CENTER_ADMIN','SYSTEM_ADMIN')),
    center_id            UUID REFERENCES centers(id) ON DELETE CASCADE,   -- NULL for SYSTEM_ADMIN
    full_name            VARCHAR(255) NOT NULL,
    face_embedding_hash  BYTEA NOT NULL,        -- hash only (DPDP); raw never stored
    fingerprint_template BYTEA NOT NULL,        -- minutiae template, not raw image
    bound_ip             INET,                  -- fixed LAN IP for match-all (§8.2)
    bound_terminal_id    UUID,                  -- optional station binding
    status               identity_status NOT NULL DEFAULT 'PENDING_APPROVAL',
    approved_by          UUID REFERENCES staff_identities(id),
    activated_at         TIMESTAMPTZ,
    revoked_at           TIMESTAMPTZ,
    revoke_reason        TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- INV-7: AT MOST ONE active Centre Admin per centre.
CREATE UNIQUE INDEX one_active_center_admin
    ON staff_identities(center_id)
    WHERE role = 'CENTER_ADMIN' AND status = 'ACTIVE';

CREATE INDEX idx_staff_center_role ON staff_identities(center_id, role, status);

-- ── §12.3 Approval requests + one-time codes ────────────────────────────
CREATE TABLE approval_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                    approval_kind NOT NULL,
    applicant_identity_id   UUID NOT NULL REFERENCES staff_identities(id) ON DELETE CASCADE,
    center_id               UUID REFERENCES centers(id) ON DELETE CASCADE,
    approver_identity_id    UUID REFERENCES staff_identities(id),
    code_hash               BYTEA,             -- Argon2id(code); cleartext never stored
    code_ttl                TIMESTAMPTZ,
    code_consumed           BOOLEAN DEFAULT FALSE,
    fingerprint_authorised  BOOLEAN DEFAULT FALSE,
    status                  identity_status DEFAULT 'PENDING_APPROVAL',
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    resolved_at             TIMESTAMPTZ
);
CREATE INDEX idx_approval_pending ON approval_requests(center_id, status)
    WHERE status = 'PENDING_APPROVAL';

-- ── §12.4 Terminal registry + seat bindings ─────────────────────────────
CREATE TABLE terminals (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id     UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
    seat_no       VARCHAR(20) NOT NULL,
    capability    terminal_cap NOT NULL DEFAULT 'CANDIDATE_SEAT',
    wg_pubkey     TEXT NOT NULL,               -- WireGuard identity (in signed image)
    tpm_ek_hash   BYTEA,                        -- expected TPM endorsement key hash
    golden_pcr    JSONB,                        -- known-good PCR set for attestation
    bound_ip      INET,
    state         terminal_state NOT NULL DEFAULT 'AVAILABLE',
    health        VARCHAR(16) DEFAULT 'OK',
    last_seen     TIMESTAMPTZ,
    UNIQUE (center_id, seat_no)
);
CREATE INDEX idx_terminal_pool ON terminals(center_id, capability, state, health);

CREATE TABLE seat_bindings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    terminal_id     UUID NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    center_id       UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
    exam_id         UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    candidate_roll  VARCHAR(50) NOT NULL,
    bound_by        UUID NOT NULL REFERENCES staff_identities(id),   -- the invigilator
    bind_token      BYTEA NOT NULL,            -- one-shot HMAC, consumed at login
    bound_at        TIMESTAMPTZ DEFAULT NOW(),
    consumed_at     TIMESTAMPTZ,
    -- a terminal holds at most one un-consumed binding at a time
    CONSTRAINT seat_bindings_one_per_terminal UNIQUE (terminal_id) DEFERRABLE INITIALLY DEFERRED
);

-- ── §12.5 Candidate credential + biometric enrolment (extends users/enrollments)
ALTER TABLE users ADD COLUMN IF NOT EXISTS dob_hash             BYTEA;  -- Argon2id(DOB)
ALTER TABLE users ADD COLUMN IF NOT EXISTS fingerprint_template BYTEA;  -- candidate finger (template)
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS checked_in_at  TIMESTAMPTZ;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS checked_in_by  UUID REFERENCES staff_identities(id);
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS assigned_terminal_id UUID REFERENCES terminals(id);

-- ── §12.6 Encrypted answer ledger (Centre Admin store — ciphertext ONLY) ─
CREATE TABLE answer_ledger (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id      UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
    exam_id        UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    seat_no        VARCHAR(20),
    leaf_index     BIGINT NOT NULL,            -- position in the centre hash-chain
    leaf_hash      BYTEA NOT NULL,             -- SHA-256(ct||iv||tag||wrapped_DK)
    prev_root      BYTEA NOT NULL,
    chain_root     BYTEA NOT NULL,             -- rolling root after this leaf
    node_root_sig  BYTEA NOT NULL,             -- TPM signature over chain_root
    ciphertext     BYTEA NOT NULL,             -- AES-256-GCM sealed R
    iv             BYTEA NOT NULL,
    auth_tag       BYTEA NOT NULL,
    wrapped_dk     BYTEA NOT NULL,             -- DK wrapped to SYSTEM ADMIN key
    sync_state     answer_sync_state NOT NULL DEFAULT 'SEALED',
    polygon_tx     VARCHAR(66),                -- set by System Admin on anchor
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (center_id, exam_id, leaf_index)
);
CREATE INDEX idx_answer_ledger_sync ON answer_ledger(center_id, sync_state);
-- NOTE: there is intentionally NO decryption-key column here. The centre is blind (INV-6).

-- ── §12.7 Tamper-evident audit (hash-chained) ───────────────────────────
CREATE TABLE secure_audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq         BIGINT GENERATED ALWAYS AS IDENTITY,  -- added field (§0.1): deterministic chain order
    center_id   UUID REFERENCES centers(id) ON DELETE SET NULL,
    actor_id    UUID REFERENCES staff_identities(id) ON DELETE SET NULL,
    action      VARCHAR(64) NOT NULL,          -- CODE_ISSUED, IDENTITY_ACTIVATED, SEAT_ASSIGNED, LOGIN_DENIED…
    target      VARCHAR(64),
    details     JSONB,
    prev_hash   BYTEA NOT NULL,
    entry_hash  BYTEA NOT NULL,                -- SHA-256(prev_hash||row)
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_secure_audit_center ON secure_audit_log(center_id, created_at);
