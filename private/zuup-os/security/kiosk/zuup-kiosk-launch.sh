#!/bin/sh
# ZUUP-OS kiosk launcher (spec §7.4/§7.6) — chooses the ONE surface this
# terminal is allowed to present, by its Edge-reported capability, then hands
# the only display seat to Cage+Firefox locked at that URL.
#
# This is what makes the role tiering physical: a CANDIDATE_SEAT can never open
# the Centre Admin portal and an ADMIN_STATION never opens the candidate seat —
# the capability is provisioned in the signed image + the Edge registry, not
# chosen by whoever sits down. Deny-by-default: anything unexpected loads the
# fail-closed /locked wall, never a shell or a different role.
#
# Tiering (answers "where does each role log in"):
#   ADMIN_STATION        → /admin/  Centre Admin portal  (centre-admin, LAN-only)
#   INVIGILATOR_STATION  → /        exam-terminal Gate → invigilator login
#   CANDIDATE_SEAT       → /        exam-terminal Gate → candidate seat
#   (System Admin is NOT here — it is the HQ public-website tier, off the LAN.)
#
# ── Why this script waits before it launches ────────────────────────────────
# Firefox NEVER retries a failed navigation. A browser started one second before
# the origin binds its port stays parked on "Unable to connect" for the whole
# exam, with no reload control in kiosk mode — which is exactly the "Firefox
# opens but shows an error" failure. So the order here is: probe the origin
# until it answers HTTP, *then* start the browser. If it never answers we still
# put something on the screen — a local diagnostic page that names the reason —
# because a locked terminal with a blank or broken screen cannot be triaged in
# an exam hall.
set -eu

# Boot progress has to be observable on the machine itself: kmsg reaches every
# registered console (dev images list tty0, so it lands on the laptop screen)
# and is discarded on production, where console=null is the point.
#
# Defined FIRST, before any code that might want it. It used to sit below the
# configuration block, so a `log` call added above it would be a "command not
# found" — fatal under `set -eu`, on the one script whose failure leaves the
# terminal showing nothing at all.
log() {
  echo "zuup-kiosk: $*" > /dev/kmsg 2>/dev/null || true
}

# The Edge origin, in order of authority:
#   1. ZUUP_EDGE_URL          an explicit override in a unit drop-in (the
#                             all-in-one sets it to its own loopback Caddy);
#   2. /run/zuup-identity/edge-url  published at boot from the SIGNED cmdline;
#   3. https://edge.local     the historical default, which resolves on no
#                             production terminal — DNS is refused and the image
#                             ships no hosts entry. Kept only so an image built
#                             before (2) existed still behaves as it used to.
EDGE="${ZUUP_EDGE_URL:-}"
if [ -z "$EDGE" ] && [ -r /run/zuup-identity/edge-url ]; then
  EDGE="$(tr -d ' \n' < /run/zuup-identity/edge-url)"
fi
[ -n "$EDGE" ] || EDGE="https://edge.local"
# Identity comes from /run first — published at boot by zuup-identity.service
# out of the signed kernel cmdline (production) or by zuup-commission.sh (the
# all-in-one). /etc/zuup/terminal-id is the image's baked placeholder and is
# only ever the fallback.
ID_FILE="/etc/zuup/terminal-id"
[ -r /run/zuup-identity/terminal-id ] && ID_FILE=/run/zuup-identity/terminal-id
CAP_FILE="/run/zuup-identity/capability"
VARIANT_FILE="/etc/zuup/image-variant"
DIAG_TEMPLATE="/usr/share/zuup/kiosk/no-centre.html"
# Which browser binary to exec.
#
# /etc/zuup/browser-path is written by the image build (20-stage-rootfs.sh) and
# holds the REAL binary under /usr/lib — the same path the zuup-firefox AppArmor
# profile attaches to, verified at build time. Preferring it over /usr/bin
# matters: AppArmor attaches by resolved executable path, so exec'ing a wrapper
# or a symlink is how a confined browser quietly becomes an unconfined one. The
# build already failed if these two could not be made to agree, so by the time
# this runs there is exactly one correct answer and it is in that file.
FIREFOX="${ZUUP_FIREFOX:-}"
if [ -z "$FIREFOX" ] && [ -r /etc/zuup/browser-path ]; then
  FIREFOX="$(tr -d ' \n' < /etc/zuup/browser-path)"
  [ -x "$FIREFOX" ] || FIREFOX=""
fi
if [ -z "$FIREFOX" ]; then
  # Only reached on an image built before browser-path existed. Still prefer the
  # /usr/lib binaries, because those are the ones the profile can attach to.
  for c in /usr/lib/firefox-esr/firefox-esr /usr/lib/firefox/firefox \
           /usr/bin/firefox-esr /usr/bin/firefox; do
    [ -x "$c" ] && { FIREFOX="$c"; break; }
  done
  [ -z "$FIREFOX" ] && FIREFOX=/usr/lib/firefox-esr/firefox-esr
  log "WARNING: /etc/zuup/browser-path missing — fell back to $FIREFOX"
fi

# The all-in-one demo image bundles its own centre stack and overrides this to
# the local role chooser (security/allinone/kiosk-allinone.conf). Empty on every
# production image, where the capability lookup below is the ONLY router.
FORCED_URL="${ZUUP_KIOSK_URL:-}"
# The all-in-one cold-starts PostgreSQL, three Node services and Caddy from a
# tmpfs; a laptop needs ~60-120 s of that before the origin answers.
READY_BUDGET="${ZUUP_KIOSK_READY_BUDGET:-180}"
PROBE_TIMEOUT="${ZUUP_KIOSK_PROBE_TIMEOUT:-4}"
# The Edge answers the capability lookup only after its migrations finish, which
# is later than the proxy starts serving — hence a retry window of its own.
CAP_TRIES="${ZUUP_KIOSK_CAP_TRIES:-10}"
CAP_SLEEP="${ZUUP_KIOSK_CAP_SLEEP:-3}"

VARIANT="unknown"
[ -r "$VARIANT_FILE" ] && VARIANT="$(tr -d ' \n' < "$VARIANT_FILE")"

PROFILE="${HOME:-/tmp/firefox}/profile"
mkdir -p "$PROFILE"

# ── input, reported before anything can paint over it ───────────────────────
#
# A kiosk that renders but accepts no keystroke is indistinguishable, from the
# journal and from the screen, from one that works: every unit is green, the
# page is up, the pointer moves. The first boot on hardware was exactly this —
# no key did anything, including Alt+Home, which is the only navigation
# affordance kiosk mode leaves.
#
# The single fact that splits the diagnosis in two is whether the KERNEL has a
# keyboard at all. If it does, the fault is above the kernel (seat, libinput,
# keymap, compositor); if it does not, it is a driver or a device-authorisation
# problem and nothing in userspace will help. That is one grep, so it runs
# unconditionally — and it runs HERE, before the origin wait, so it lands in the
# middle of the boot log with tens of seconds to spare rather than in the last
# instant before cage takes the display.
report_input() {
  if [ -r /proc/bus/input/devices ]; then
    sed -n 's/^N: Name="\(.*\)"$/\1/p' /proc/bus/input/devices 2>/dev/null \
      | while IFS= read -r n; do log "input device: $n"; done
    if grep -q 'Handlers=.*kbd' /proc/bus/input/devices 2>/dev/null; then
      log "input: the kernel HAS a keyboard — a dead keyboard is above the kernel"
    else
      log "input: NO keyboard device in the kernel (check i8042/atkbd, USB authorisation)"
    fi
  else
    log "input: /proc/bus/input/devices unreadable"
  fi
  # cage reaches devices through libseat; with logind masked, seatd is the only
  # backend that can hand it one. No socket means it silently falls back.
  if [ -S /run/seatd.sock ]; then
    log "input: seatd socket present"
  else
    log "input: NO seatd socket — cage falls back to its builtin backend"
  fi
}
report_input

# ── 1. wait for the origin to answer HTTP ───────────────────────────────────
# ANY status code counts as ready — including 502. The all-in-one's Caddy is up
# long before the Node portals are, and it serves a self-refreshing "starting"
# page for them (security/allinone/www/starting.html), so the kiosk can hand
# over the moment something will answer instead of erroring. What we are ruling
# out here is the connection/DNS/TLS failure Firefox cannot recover from.
origin_up() {
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$PROBE_TIMEOUT" "$EDGE/" 2>/dev/null || true)"
  [ -n "$code" ] && [ "$code" != "000" ]
}

log "variant=$VARIANT edge=$EDGE — waiting for the centre origin (budget ${READY_BUDGET}s)"
ORIGIN_READY=0
waited=0
while [ "$waited" -lt "$READY_BUDGET" ]; do
  if origin_up; then ORIGIN_READY=1; break; fi
  if [ "$((waited % 20))" -eq 0 ] && [ "$waited" -gt 0 ]; then
    log "still waiting for $EDGE … ${waited}s/${READY_BUDGET}s"
  fi
  sleep 2
  waited=$((waited + 2))
done

# ── 2. a RAM-only Firefox profile ───────────────────────────────────────────
# The JS/WASM JITs are turned off (§7.5 hardening posture): the Gate runs on the
# interpreter under the kiosk's seccomp cage, with no first-run, update, or
# telemetry surface. `browser.startup.homepage` matters in kiosk mode — Alt+Home
# is the only navigation affordance left once the chrome is gone, so it points
# at whatever surface this terminal is allowed to return to.
HOMEPAGE="${FORCED_URL:-$EDGE}"
cat > "$PROFILE/user.js" <<EOF
user_pref("javascript.options.baselinejit", false);
user_pref("javascript.options.ion", false);
user_pref("javascript.options.native_regexp", false);
user_pref("javascript.options.wasm", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("app.update.enabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
// No user namespaces in this kernel → Firefox's sandboxes can't start; turn them
// off (single trusted air-gapped origin, nothing untrusted to isolate).
user_pref("security.sandbox.content.level", 0);
user_pref("media.gmp.insecure.allow", true);
// Alt+Home returns here — the one way back to the allowed surface in kiosk mode.
user_pref("browser.startup.homepage", "$HOMEPAGE");
EOF

# ── 3. render the local diagnostic page (only used if the origin never came up) ─
# A blank screen or a raw "Server not found" tells an invigilator nothing. This
# page names the image variant, the origin it tried, and the terminal id, and it
# keeps probing so it replaces itself the moment the centre appears.
diagnostic_url() {
  out="$PROFILE/no-centre.html"
  if [ -r "$DIAG_TEMPLATE" ]; then
    sed -e "s|@@EDGE@@|$EDGE|g" \
        -e "s|@@VARIANT@@|$VARIANT|g" \
        -e "s|@@TERMINAL@@|${TID:-unprovisioned}|g" \
        -e "s|@@RECOVER@@|${FORCED_URL:-$EDGE}|g" \
        "$DIAG_TEMPLATE" > "$out" 2>/dev/null \
      || printf '<h1>ZUUP-OS</h1><p>No centre reachable at %s</p>' "$EDGE" > "$out"
  else
    printf '<h1>ZUUP-OS</h1><p>No centre reachable at %s (variant %s)</p>' \
      "$EDGE" "$VARIANT" > "$out"
  fi
  echo "file://$out"
}

# ── 4. choose the surface ───────────────────────────────────────────────────
TID=""
if [ -r "$ID_FILE" ]; then TID="$(tr -d ' \n' < "$ID_FILE")"; fi

if [ "$ORIGIN_READY" = 0 ]; then
  log "FAIL: $EDGE never answered in ${READY_BUDGET}s — showing the local diagnostic page"
  TARGET="$(diagnostic_url)"
elif [ -n "$FORCED_URL" ]; then
  # Demo/all-in-one override — never present on a production image.
  log "kiosk URL pinned by image drop-in: $FORCED_URL"
  TARGET="$FORCED_URL"
elif [ -z "$TID" ] || [ "$TID" = "REPLACE-AT-PROVISIONING" ]; then
  # No identity baked in → fail closed, never guess a role.
  log "no terminal id — fail-closed wall"
  TARGET="$EDGE/locked"
else
  # What role is this machine allowed to present?
  #
  # First choice is the LOCAL answer, and on a production terminal it is the
  # better one in both directions that matter. It is authenticated — the
  # capability came off the Secure-Boot-signed cmdline, so changing it needs the
  # authority's signing key rather than a reachable Edge — and it is instant,
  # which takes up to CAP_TRIES × CAP_SLEEP (30 s by default) of Edge round
  # trips out of the boot path. On a hall of terminals all cold-starting at once
  # that is the difference between seats coming up together and coming up in a
  # slow ragged wave while the Edge answers 500 capability lookups.
  #
  # The Edge lookup remains for images provisioned before identity moved onto
  # the cmdline, and for the all-in-one, whose roles are self-commissioned at
  # first boot and genuinely are not known until the Edge says so.
  CAP=""
  STATUS=""
  if [ -r "$CAP_FILE" ]; then
    CAP="$(tr -d ' \n' < "$CAP_FILE")"
    STATUS="200"
    log "capability from the signed cmdline: $CAP (no Edge lookup needed)"
  fi
  cap_try=0
  while [ -z "$CAP" ] && [ "$cap_try" -lt "$CAP_TRIES" ]; do
    BODY="$PROFILE/.capability"
    STATUS="$(curl -s -o "$BODY" -w '%{http_code}' --max-time 8 \
              "$EDGE/api/terminal/$TID/capability" 2>/dev/null || true)"
    if [ "$STATUS" = "200" ]; then
      CAP="$(sed -n 's/.*"capability":"\([A-Z_]*\)".*/\1/p' "$BODY")"
      break
    fi
    if [ "$STATUS" = "404" ]; then break; fi
    sleep "$CAP_SLEEP"
    cap_try=$((cap_try + 1))
  done
  rm -f "$PROFILE/.capability"

  # The Gate reads WHICH terminal it is from the machine itself
  # (/local/identity → /etc/zuup/terminal-id), so there is nothing to hand it in
  # the URL. `?role=` is passed only to disambiguate a machine commissioned as
  # several stations (the all-in-one); it names a ROLE that is resolved against
  # that same machine-held list, so it cannot name a station this hardware does
  # not have. It used to be `?terminal=<uuid>` — an id in the address bar, which
  # is a terminal being told which seat it is.
  case "$CAP" in
    ADMIN_STATION)       TARGET="$EDGE/admin/" ;;
    INVIGILATOR_STATION) TARGET="$EDGE/?role=INVIGILATOR_STATION" ;;
    CANDIDATE_SEAT)      TARGET="$EDGE/?role=CANDIDATE_SEAT" ;;
    *)
      if [ "$STATUS" = "404" ]; then
        log "Edge denies terminal $TID (404) — fail-closed wall"
        TARGET="$EDGE/locked"
      else
        log "capability unresolved (status=${STATUS:-none}) — opening the fail-closed Gate"
        TARGET="$EDGE/"
      fi
      ;;
  esac
fi

# ── 5. hand the only display seat to Cage + Firefox ─────────────────────────
# wlroots picks a GLES2/EGL renderer by default, which needs a DRI driver for
# the machine's GPU. On a terminal whose GPU has no in-kernel driver the display
# still exists (simpledrm over the UEFI framebuffer) but EGL has nothing to bind
# to, and cage exits immediately. Retrying once on the pixman software renderer
# turns that from a black screen into a slower but working kiosk.
log "launching kiosk → $TARGET"

# cage's stderr → console so a compositor failure (no seat/DRM) is visible on a
# dev image (console=tty0); harmless on production (console=null discards it).
# If /dev/console cannot be opened the redirect itself would fail the exec, so
# fall back to dropping it rather than losing the kiosk over a log sink.
ERRSINK=/dev/console
: > /dev/console 2>/dev/null || ERRSINK=/dev/null

launch() {
  /usr/bin/cage -d -- "$FIREFOX" --kiosk --profile "$PROFILE" "$TARGET" 2>"$ERRSINK"
}

START="$(date +%s)"
set +e
launch
RC=$?
set -e
if [ "$RC" -eq 0 ]; then exit 0; fi

ELAPSED=$(( $(date +%s) - START ))
if [ "$ELAPSED" -lt 10 ] && [ -z "${WLR_RENDERER:-}" ]; then
  log "cage exited in ${ELAPSED}s (rc=$RC) — retrying on the pixman software renderer"
  export WLR_RENDERER=pixman
  set +e
  launch
  RC=$?
  set -e
fi
exit "$RC"
