-- ═══════════════════════════════════════════════════════════════════════════
--  Provenance for a terminal registry row
-- ═══════════════════════════════════════════════════════════════════════════
--
-- There are now two ways a machine gets into `terminals`:
--
--   PROVISIONED  an authority registered it (the HQ provisioning bundle). Its
--                golden PCRs were recorded from a build somebody signed off,
--                on a machine somebody physically commissioned.
--
--   FIRST_BOOT   the machine registered ITSELF. Only the all-in-one image can
--                do this, and only into its own on-board Edge, because there a
--                single laptop is the entire centre — Edge, portals and
--                terminal surface on one box, with no separate authority that
--                could have vouched for it beforehand.
--
-- The difference matters and must never be invisible: a FIRST_BOOT terminal's
-- golden PCRs are whatever it measured of itself, so its attestation proves
-- continuity ("this is the same software that first ran here") but not
-- provenance ("this is the software an authority approved"). Recording which is
-- which lets the portals say so on screen and lets an auditor tell them apart
-- afterwards, rather than the distinction living only in someone's memory of
-- how a particular laptop was set up.
ALTER TABLE terminals
  ADD COLUMN IF NOT EXISTS commissioned_via VARCHAR(16) NOT NULL DEFAULT 'PROVISIONED',
  ADD COLUMN IF NOT EXISTS commissioned_at  TIMESTAMPTZ;

COMMENT ON COLUMN terminals.commissioned_via IS
  'PROVISIONED (an authority registered this machine) or FIRST_BOOT (it '
  'registered itself; all-in-one image only). A FIRST_BOOT terminal attests to '
  'its own continuity, not to an approved provenance.';
COMMENT ON COLUMN terminals.commissioned_at IS
  'When the registry row was created. NULL for rows that predate this column.';
