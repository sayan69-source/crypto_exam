-- ═══════════════════════════════════════════════════════════════════════════
--  Real attestation keys — the commissioning half of §7.1 / §8.2
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 003 recorded the OUTCOME of an attestation. It could never be a TRUE one,
-- because nothing in the estate ever wrote `terminals.golden_pcr`: the column
-- was documented as a commissioning input (DEPLOYMENT_GUIDE §"Commissioning")
-- but no API, no provisioning ingest and no seed populated it. `attestTerminal`
-- therefore compared against NULL, returned false for every terminal, and every
-- privileged login died on TPM_ATTESTATION_INVALID — while the boot script
-- treated the same `false` as "this image is not the golden image" and powered
-- the terminal off. The whole estate was unbootable and unloggable-into.
--
-- The other half of the same hole: the old check was `JSON.stringify(golden) ===
-- JSON.stringify(provided)`. Even with a golden set present, that is not
-- attestation — anyone on the LAN who could read one terminal's PCR values could
-- POST them for any other terminal. A PCR set is public; only a TPM SIGNATURE
-- over a fresh nonce proves the machine measured itself.
--
-- So a terminal is now commissioned with two public keys, and the Edge verifies
-- signatures rather than comparing transcripts:
--
--   ak_pubkey_pem   TPM 2.0 Attestation Key (restricted signing key, created by
--                   `tpm2_createak`). The TPM will only sign a TPMS_ATTEST
--                   structure it produced itself with this key, so a valid
--                   signature over our nonce is proof the quote came from THAT
--                   TPM on THIS boot. Never leaves the terminal; only the public
--                   half is registered here.
--
--   bio_pubkey_pem  The on-device biometric daemon's attestation key
--                   (zuup-biometricd, §8.4). The daemon owns the camera and the
--                   reader; it signs the scores it measured. Before this, the
--                   browser posted the scores as plain numbers in a request
--                   body, which meant the face/fingerprint factors of the §8.2
--                   match-all rule were whatever the client typed.
--
-- Both are PUBLIC keys. The Edge holds no private key for either (INV-6).

ALTER TABLE terminals
  ADD COLUMN IF NOT EXISTS ak_pubkey_pem  TEXT,
  ADD COLUMN IF NOT EXISTS bio_pubkey_pem TEXT;

COMMENT ON COLUMN terminals.ak_pubkey_pem IS
  'Public half of this terminal''s TPM 2.0 Attestation Key (SPKI PEM). Registered '
  'at commissioning via the HQ provisioning bundle. A quote signature that verifies '
  'under this key is what makes tpm_attestation_valid a fact.';

COMMENT ON COLUMN terminals.bio_pubkey_pem IS
  'Public half of this terminal''s zuup-biometricd attestation key (SPKI PEM). '
  'Face/fingerprint scores are accepted ONLY inside an envelope signed by it.';

COMMENT ON COLUMN terminals.golden_pcr IS
  'Golden PCR set for this terminal, as {"<index>": "<lowercase sha256 hex>"} for '
  'the sha256 bank. Written by the HQ provisioning ingest at commissioning. A '
  'terminal with a NULL golden set can never attest and therefore can never boot '
  'into the Gate — that is the intended fail-closed state for an unknown machine.';

-- The attestation nonce is one-shot and short-lived, so it lives in Edge memory
-- rather than here; a restart simply forces every terminal to re-attest, which
-- is the safe direction.
