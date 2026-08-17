#!/usr/bin/env bash
# Run the provisioning tools inside the builder container, from a Windows or
# macOS host.
#
# ── Why this wrapper exists ─────────────────────────────────────────────────
#
# `gen-centre-secrets.sh` and `provision-terminal.sh` need `wg`, `ukify`,
# `sbsign`, `openssl` and `systemd-measure`. On the machine most people actually
# have, none of the first four are present — provision-terminal.sh detects that
# and exits 0 with a polite explanation, which means the documented procedure
# quietly did nothing at exactly the step that mints a terminal's identity.
#
# The builder container has all of them, and it already mounts the build volume
# holding `bzImage`, the initramfs and the verity root hash — the three inputs
# provisioning needs and which the build does NOT export to ./out. So running
# there fixes both problems at once and removes the need to copy artifacts
# around.
#
#   provision-in-container.sh secrets --centre-id <uuid>
#   provision-in-container.sh terminal --capability CANDIDATE_SEAT --seat A-01
#   provision-in-container.sh terminal --capability INVIGILATOR_STATION \
#                                      --seat INV-1 --enrol
#   provision-in-container.sh shell        # poke around by hand
#
# Everything lands in the output directory on the host (default out-prod/), so
# the ESP payloads and the registry records are where you can reach them.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
OUT="${ZUUP_OUT:-$REPO/private/zuup-os/image-build/out-prod}"
IMAGE="${ZUUP_BUILDER_IMAGE:-zuup-os-builder}"

die() { echo "[provision-in-container] $*" >&2; exit 1; }

command -v docker >/dev/null || die "docker is required."
docker image inspect "$IMAGE" >/dev/null 2>&1 \
  || die "the builder image '$IMAGE' does not exist — run image-build/docker-build.sh first."
docker volume inspect zuup-os-build >/dev/null 2>&1 \
  || die "the build volume 'zuup-os-build' does not exist — run a build first."
[[ -d "$OUT" ]] || die "output directory $OUT does not exist."

# MSYS rewrites /paths into C:\paths and mangles container-side arguments; the
# -W forms are what the Windows Docker engine can actually resolve.
repo_mnt="$REPO"; out_mnt="$OUT"
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
  repo_mnt="$(cd "$REPO" && pwd -W)"
  out_mnt="$(cd "$OUT" && pwd -W)"
  export MSYS_NO_PATHCONV=1
fi

run() {
  docker run --rm -i \
    -v "$repo_mnt:/zuup:ro" \
    -v zuup-os-build:/build \
    -v "$out_mnt:/dist" \
    -e ZUUP_DB_KEY=/dist/keys/db.key \
    -e ZUUP_DB_CRT=/dist/keys/db.crt \
    "$IMAGE" "$@"
}

MODE="${1:-}"; shift || true
case "$MODE" in
  secrets)
    # `uuidgen` is not on a Windows host either, so let the container mint the
    # id when one was not supplied rather than making the caller find one.
    have_id=0
    for a in "$@"; do [[ "$a" == "--centre-id" ]] && have_id=1; done
    if (( have_id )); then
      run /zuup/private/zuup-os/tools/gen-centre-secrets.sh --out /dist/centre "$@"
    else
      echo "[provision-in-container] no --centre-id given; minting one in the container."
      run -c 'exec /zuup/private/zuup-os/tools/gen-centre-secrets.sh --out /dist/centre \
              --centre-id "$(cat /proc/sys/kernel/random/uuid)" "$@"' _ "$@"
    fi
    echo
    echo "  → $OUT/centre/   (centre.conf, the Edge WireGuard identity, the four secrets)"
    echo "  Fill in CENTRE_NAME, EDGE_LAN_IP and HQ_ENDPOINTS before provisioning."
    ;;

  terminal)
    [[ -r "$OUT/keys/db.key" && -r "$OUT/keys/db.crt" ]] \
      || die "no signing key at $OUT/keys/db.{key,crt}. Provisioning refuses to mint a
        terminal identity under an ephemeral key — see tools/provision-terminal.sh."
    [[ -r "$OUT/centre/centre.conf" ]] \
      || die "no centre config. Run: $0 secrets"
    # --build /build is the whole point: bzImage, the initramfs and the verity
    # root hash live in the volume and are never exported to the host.
    run /zuup/private/zuup-os/tools/provision-terminal.sh \
      --centre-config /dist/centre/centre.conf \
      --build /build --out /dist/provisioned "$@"
    ;;

  collect)
    run /zuup/private/zuup-os/tools/collect-enrolment.sh "$@"
    ;;

  shell)
    docker run --rm -it \
      -v "$repo_mnt:/zuup:ro" -v zuup-os-build:/build -v "$out_mnt:/dist" \
      -e ZUUP_DB_KEY=/dist/keys/db.key -e ZUUP_DB_CRT=/dist/keys/db.crt \
      "$IMAGE"
    ;;

  *)
    sed -n '1,30p' "$0" | sed 's/^# \{0,1\}//'
    exit 1 ;;
esac
