-- ── §10.7 / §11 question delivery + post-exam egress gate ──────────────────
--
-- The centre LAN is internet-free during an exam (INV-3), so the Edge is the
-- centre's pre-staged cache of the SEALED, KEYLESS question bundle — the same
-- role the TCS-iON test-centre server plays. The public website seals the
-- paper, commits {questionsRoot, bundleCid} on-chain, and the bundle is loaded
-- into THIS table before exam day (over the provisioning link, never during the
-- exam). Terminals fetch it over the LAN and verify it against questions_root;
-- the T₀ beacon that unlocks decryption is released only at/after t0_at.
--
-- Nothing here is a decryption key: the bundle is ciphertext + Merkle proofs,
-- and the beacon is the PUBLIC drand value. The per-question AES keys are
-- derived on the terminal at T₀ (question-crypto.ts) and exist only in RAM.
CREATE TABLE exam_question_bundle (
    exam_id        UUID PRIMARY KEY REFERENCES exams(id) ON DELETE CASCADE,
    questions_root BYTEA NOT NULL,            -- 32-byte Merkle root (matches on-chain)
    bundle_cid     VARCHAR(80),              -- ipfs://… content id committed on-chain
    chain_tx       VARCHAR(80),              -- lockExam tx (audit link)
    bundle_json    JSONB NOT NULL,           -- the keyless SealedBundle (ct + proofs)
    drand_round    BIGINT NOT NULL DEFAULT 0,
    hkdf_salt      BYTEA NOT NULL,           -- public HKDF salt for the master seed
    t0_beacon      BYTEA,                    -- drand beacon at T₀; NULL until released
    t0_at          TIMESTAMPTZ NOT NULL,     -- the instant the beacon may be served
    staged_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── post-exam lifecycle on the exam itself (drives the §6 egress gate) ──────
-- A centre's internet stays OFF until its Centre Admin needs to forward sealed
-- bundles to HQ — and that is allowed ONLY once the window has closed AND every
-- present candidate has submitted. These columns are the Edge-side source of
-- truth the export endpoint consults (the kernel firewall is the enforcement;
-- this is the authorisation).
ALTER TABLE exams ADD COLUMN IF NOT EXISTS window_closes_at TIMESTAMPTZ;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS egress_opened_at TIMESTAMPTZ;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS egress_opened_by UUID REFERENCES staff_identities(id);
