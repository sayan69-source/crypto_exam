#!/usr/bin/env bash
# ZUUP-OS Secure Boot key hierarchy generator (spec §7.1).
#
# Creates the exam authority's UEFI key hierarchy: PK (platform key), KEK
# (key-exchange key), and db (signature database key), each as an X.509 cert +
# the EFI signature lists needed for enrolment. Run ONCE, on the OFFLINE key
# ceremony machine — never on a networked host. The private halves move
# straight into the HSM; only the .crt/.esl/.auth artifacts leave the room.
set -euo pipefail

# ── host guard ──────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]] || ! command -v cert-to-efi-sig-list >/dev/null 2>&1; then
  cat <<'EOF'
[zuup-os] Offline key-ceremony artifact (needs Linux + efitools); not running here.
          On the ceremony machine it would, in order:
            1. generate RSA-4096 keypairs for PK, KEK, db (openssl, no passphrase
               prompts — the ceremony room is the control)
            2. self-sign PK; sign KEK with PK; sign db with KEK
            3. produce .esl signature lists + .auth enrolment blobs (sign-efi-sig-list)
            4. print SHA-256 fingerprints for the ceremony record
            5. remind the operator: private keys → HSM, then shred local copies
          Nothing was changed on this machine.
EOF
  exit 0
fi

OUT="${1:-./keys}"
GUID="${ZUUP_OWNER_GUID:-$(uuidgen)}"
mkdir -p "$OUT"
cd "$OUT"

echo "$GUID" > owner-guid.txt

make_key() { # name, subject, signer-key (optional), signer-crt (optional)
  local name="$1" subj="$2" skey="${3:-}" scrt="${4:-}"
  openssl req -newkey rsa:4096 -nodes -keyout "${name}.key" \
    -new -x509 -sha256 -days 3650 -subj "$subj" -out "${name}.crt"
  cert-to-efi-sig-list -g "$GUID" "${name}.crt" "${name}.esl"
  if [[ -n "$skey" ]]; then
    sign-efi-sig-list -g "$GUID" -k "$skey" -c "$scrt" "$name" "${name}.esl" "${name}.auth"
  else
    sign-efi-sig-list -g "$GUID" -k "${name}.key" -c "${name}.crt" "$name" "${name}.esl" "${name}.auth"
  fi
}

make_key PK  "/CN=ZUUP Exam Authority Platform Key/"
make_key KEK "/CN=ZUUP Exam Authority KEK/" PK.key PK.crt
make_key db  "/CN=ZUUP Exam Authority Image Signing/" KEK.key KEK.crt

echo "── ceremony record ─────────────────────────────────────────"
for f in PK KEK db; do
  printf "%-4s sha256 " "$f"; openssl x509 -in "${f}.crt" -noout -fingerprint -sha256
done
cat <<'EOF'

NEXT (in this order, §7.1):
  1. import PK.key/KEK.key/db.key into the HSM; verify import; SHRED the .key files
  2. db.key (HSM handle) is what sign-image.sh uses on the build host
  3. carry {PK,KEK,db}.auth to centre commissioning → enroll-keys.sh
EOF
