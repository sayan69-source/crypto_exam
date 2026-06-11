#!/usr/bin/env bash
# ZUUP-OS image build — host-side wrapper (the ONLY entry point meant to run on
# a developer workstation). Everything heavy executes inside the pinned
# zuup-os-builder container; the host contributes Docker and a ./out directory.
#
#   ./docker-build.sh                 # full pipeline → out/zuup-os.img
#   ./docker-build.sh 10              # one stage (00|10|20|30|40)
#   ./docker-build.sh -- --dev        # forward args to build-all.sh
#
# Safety: the repository mounts READ-ONLY; the container writes only to ./out.
# Nothing here touches the host's disks, bootloader, or firmware. Booting the
# produced image is a separate, deliberate act (QEMU stage 40, or dd to a
# dedicated terminal's stick — never this machine).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="${ZUUP_OUT:-$HERE/out}"
IMAGE_TAG="zuup-os-builder"

command -v docker >/dev/null 2>&1 || {
  echo "[zuup-os] docker is required. On Windows use Docker Desktop (WSL2 backend)." >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "[zuup-os] docker daemon is not running." >&2
  exit 1
}

mkdir -p "$OUT"

# MSYS/Git-Bash mangles /paths into C:\paths; the -W forms are Docker-safe.
repo_mnt="$REPO_ROOT"; out_mnt="$OUT"
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
  repo_mnt="$(cd "$REPO_ROOT" && pwd -W)"
  out_mnt="$(cd "$OUT" && pwd -W)"
  export MSYS_NO_PATHCONV=1
fi

echo "[zuup-os] building the pinned build-host container…"
docker build -t "$IMAGE_TAG" -f "$HERE/Dockerfile" "$HERE"

echo "[zuup-os] running pipeline (repo ro → /zuup, artifacts → /build)…"
docker run --rm \
  -v "$repo_mnt:/zuup:ro" \
  -v "$out_mnt:/build" \
  -e KVER -e ZUUP_KERNEL_SHA256 -e ZUUP_TRUST_CDN -e ZUUP_DB_KEY -e ZUUP_DB_CRT \
  "$IMAGE_TAG" \
  /zuup/private/zuup-os/image-build/build-all.sh "$@"

echo "[zuup-os] done. Artifacts in: $OUT"
