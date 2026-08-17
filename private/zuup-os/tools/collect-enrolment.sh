#!/usr/bin/env bash
# ZUUP-OS enrolment collection (spec §7.1) — merge what a terminal measured on
# the bench into the registry record provisioning left incomplete.
#
# Pairs with security/systemd/zuup-enrol.sh, which writes /zuup/enrolment.json
# onto the machine's own ESP during a single supervised enrolment boot. This
# reads that file, checks it belongs to the terminal the record is about, and
# fills the three fields the build host could not know: the TPM attestation key,
# the golden PCR measurements, and the biometric daemon's public half.
#
# Run on the provisioning host with the stick attached (or its ESP mounted).
set -euo pipefail

die() { echo "[collect] FAIL: $*" >&2; exit 1; }

STICK=""; RECORD=""; BUNDLE=""
usage() {
  cat <<'EOF'
usage: collect-enrolment.sh --stick DIR --out registry.json [--bundle bundle.json]

  --stick DIR     the mounted ESP of an enrolled terminal (contains zuup/enrolment.json)
  --out FILE      the registry.json written by provision-terminal.sh, updated in place
  --bundle FILE   optional: also append/replace this terminal in a provisioning
                  bundle's terminals[] array
EOF
  exit 1
}
while (($#)); do
  case "$1" in
    --stick) STICK="${2:?}"; shift 2 ;;
    --out) RECORD="${2:?}"; shift 2 ;;
    --bundle) BUNDLE="${2:?}"; shift 2 ;;
    -h|--help) usage ;;
    *) die "unknown argument $1" ;;
  esac
done
[[ -n "$STICK" && -n "$RECORD" ]] || usage

SRC="$STICK/zuup/enrolment.json"
[[ -r "$SRC" ]] || die "no $SRC — was this stick booted with zuup.enrol=1?"
[[ -r "$RECORD" ]] || die "no $RECORD — run provision-terminal.sh for this seat first"

command -v python3 >/dev/null || die "python3 is required"

python3 - "$SRC" "$RECORD" "${BUNDLE:-}" <<'PY'
import json, sys, pathlib

src, record_path, bundle_path = sys.argv[1], sys.argv[2], sys.argv[3]
enrol = json.loads(pathlib.Path(src).read_text())
record = json.loads(pathlib.Path(record_path).read_text())

# The identity check is the point of this script. An enrolment file carries the
# id of the machine that produced it; pasting one terminal's measurements onto
# another's record would register a golden boot chain against hardware that
# never booted it — and every quote from the real machine would then be denied
# for a reason nobody could work out on exam morning.
if enrol.get("terminal_id") != record.get("id"):
    sys.exit(
        f"refusing to merge: the stick enrolled {enrol.get('terminal_id')} but "
        f"{record_path} is the record for {record.get('id')}"
    )

missing = [k for k in ("ak_pubkey_pem", "golden_pcr") if not enrol.get(k)]
if missing:
    # Not fatal — a machine with no TPM is a real (if degraded) deployment
    # choice, and refusing to record the biometric key too would help nobody.
    # But it must be said out loud, because the consequence is total.
    print(
        f"WARNING: the enrolment carries no {', '.join(missing)}. Every privileged\n"
        f"         login on this terminal will deny (NO_ATTESTATION_KEY_REGISTERED /\n"
        f"         NO_GOLDEN_PCR_REGISTERED). Only proceed if this machine is\n"
        f"         knowingly being deployed without a TPM.",
        file=sys.stderr,
    )

for key in ("ak_pubkey_pem", "bio_pubkey_pem", "golden_pcr"):
    if enrol.get(key):
        record[key] = enrol[key]
if enrol.get("ak_handle"):
    record["ak_handle"] = enrol["ak_handle"]

pathlib.Path(record_path).write_text(json.dumps(record, indent=2) + "\n")
print(f"merged enrolment into {record_path}")

if bundle_path:
    bp = pathlib.Path(bundle_path)
    bundle = json.loads(bp.read_text()) if bp.exists() else {"terminals": []}
    bundle.setdefault("terminals", [])
    # Replace by id rather than append: re-enrolling a repaired terminal must
    # update its row, not leave two rows disagreeing about its golden PCRs.
    bundle["terminals"] = [t for t in bundle["terminals"] if t.get("id") != record["id"]]
    bundle["terminals"].append(record)
    bp.write_text(json.dumps(bundle, indent=2) + "\n")
    print(f"updated {bundle_path} ({len(bundle['terminals'])} terminal(s))")
PY

cat <<EOF

  NEXT: this stick still boots with zuup.enrol=1 and will power off on every
  boot until that is removed. Re-sign it for service:

    tools/provision-terminal.sh --terminal-id <id> --capability <ROLE> \\
        --seat <NO> --centre-config <cfg>

  then POST the bundle to the Edge:  /api/provisioning/ingest
EOF
