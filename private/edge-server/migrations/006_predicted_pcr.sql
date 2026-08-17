-- 006 — the authority's PREDICTED measurement, alongside the observed one (§7.1)
--
-- `terminals.golden_pcr` holds what a machine measured about itself at
-- enrolment. That is trust-on-first-use, and the weakness is specific: if the
-- terminal was already carrying a modified image at the moment it enrolled,
-- those measurements ARE its golden set, and every later boot of the compromise
-- verifies perfectly and permanently. The check proves a terminal boots what it
-- booted at enrolment; it cannot prove it boots the image the authority signed.
--
-- `predicted_pcr` is the other half. tools/provision-terminal.sh runs
-- `systemd-measure calculate` over the exact UKI it has just signed for this
-- terminal and records the PCR values that artifact must produce. Nothing the
-- machine says contributes to it.
--
-- Split by what determines the value, not by where it is stored:
--
--   predicted (authority-computed)   PCR 11 — systemd-stub's measurement of the
--                                    kernel, initrd and cmdline inside the UKI.
--                                    Per TERMINAL, because provisioning puts
--                                    this machine's id, capability and seat on
--                                    that cmdline and the stub measures it.
--
--   observed (enrolment-recorded)    PCR 0 firmware, PCR 7 Secure Boot state.
--                                    Vary by hardware model and firmware
--                                    revision; no central party can predict
--                                    them, so they are captured per machine
--                                    under supervision.
--
-- verifyQuote() lets a predicted value OUTRANK the observed one for any index
-- present in both — see `fleetPcr` in src/lib/tpm-quote.ts. A terminal with no
-- predicted values behaves exactly as before, which is what keeps the
-- all-in-one (one self-commissioned laptop, no authority, no fleet) working.

ALTER TABLE terminals
  ADD COLUMN IF NOT EXISTS predicted_pcr JSONB;

COMMENT ON COLUMN terminals.predicted_pcr IS
  'Image-determined PCR values COMPUTED BY THE AUTHORITY from the signed UKI at '
  'provisioning ({"11":"<sha256 hex>"}). Outranks golden_pcr for any index it '
  'names, so a terminal enrolled while already compromised cannot vouch for its '
  'own image. NULL means fall back to enrolment-observed values only.';
