-- ═══════════════════════════════════════════════════════════════════════════
--  Security hardening — findings C1, H3 (SECURITY-REVIEW.md, 2026-08-09)
-- ═══════════════════════════════════════════════════════════════════════════

-- C1 — the TPM factor must be a server-side FACT, not a client assertion.
--
-- /api/terminal/attest computed a verdict and threw it away: it wrote nothing
-- and no login ever consulted it, while the login handlers stamped
-- tpm:"attested" into the issued token regardless. Recording the outcome makes
-- the attestation something the gate can require and something an auditor can
-- inspect after the fact.
ALTER TABLE terminals
  ADD COLUMN IF NOT EXISTS last_attest_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_attest_ok BOOLEAN;

COMMENT ON COLUMN terminals.last_attest_at IS
  'When this terminal last presented a PCR set to /api/terminal/attest.';
COMMENT ON COLUMN terminals.last_attest_ok IS
  'Whether that PCR set matched golden_pcr. Login requires a fresh TRUE.';

-- H3 — one active holder per station.
--
-- Login resolved a station to the NEWEST staff row regardless of status, and
-- /api/invigilator/register is unauthenticated and takes an arbitrary
-- bound_terminal_id. Anyone on the LAN could therefore register a
-- PENDING_APPROVAL identity against a real invigilator's station and lock that
-- station's genuine holder out permanently. The lookup now filters on ACTIVE;
-- this index makes "two active holders" unrepresentable rather than merely
-- unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_holder_per_station
  ON staff_identities (bound_terminal_id)
  WHERE status = 'ACTIVE' AND revoked_at IS NULL AND bound_terminal_id IS NOT NULL;

-- M7 — one live seat per candidate.
--
-- assignRandomSeat bound whatever roll it was handed, so one roll could hold
-- several seats at once — and, with a session per seat, several live papers.
CREATE UNIQUE INDEX IF NOT EXISTS one_live_seat_per_candidate
  ON seat_bindings (exam_id, candidate_roll)
  WHERE consumed_at IS NULL;
