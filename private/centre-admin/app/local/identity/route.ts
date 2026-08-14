/**
 * This machine's identity, read from the signed image (§7.1).
 *
 * A terminal IS its identity: `/etc/zuup/terminal-id` is written at
 * commissioning, lives inside the signed, dm-verity-protected image, and is the
 * same value whose WireGuard key, golden PCRs and daemon key were registered
 * with the Edge. The kiosk browser cannot read a file, so this route — served
 * by the terminal's own Next runtime, on the terminal, over loopback — hands it
 * the one fact it needs about itself.
 *
 * What this replaces: `getTerminalId()` read `?terminal=<uuid>` or
 * `localStorage`, and the Login Gate offered a text box to type one in. On a
 * kiosk that is a machine claiming to be whichever seat someone types — the
 * Edge would then hand it that seat's capability, its assignment and its paper.
 *
 * ── Why there is also a LIST ────────────────────────────────────────────────
 * A production terminal holds exactly one identity and `roles` has one entry.
 * The all-in-one image is one laptop standing in for an entire centre, so it is
 * commissioned as several stations at once (zuup-commission.sh) and the
 * operator needs to open each surface in turn.
 *
 * The invariant is preserved by WHERE the list comes from: the machine's own
 * commissioning file, never the request. A browser may ask for a role, and it
 * gets the identity this machine actually holds for that role — or nothing. It
 * can no more invent a station than it could before; it simply cannot see any
 * station that was not registered to this hardware.
 *
 * Fail-closed: no file, unreadable file, or a value that is not a UUID all
 * return 503, and the Gate shows an "uncommissioned terminal" wall.
 *
 * Served at `/local/identity`, deliberately NOT under `/api/*`: next.config.ts
 * proxies that whole prefix to the Centre Edge, and a route that answers "who
 * am I" must be answered by this machine.
 */
import { readFile } from "node:fs/promises";

// Node runtime, not Edge: this route exists precisely to touch the filesystem.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where an identity can live, in order of authority:
 *
 *   /etc/zuup/…            baked into the signed image by whoever commissioned
 *                          this machine. Production.
 *   /run/zuup-identity/…   written by the machine itself at first boot
 *                          (all-in-one only); /etc is on the read-only verity
 *                          root, so there is nowhere else it could go.
 *
 * The baked file WINS only if it holds a real id: the image ships a placeholder
 * there, and preferring that would make a commissioned machine report itself as
 * uncommissioned.
 */
const ID_FILES = [
  process.env.ZUUP_TERMINAL_ID_FILE,
  "/etc/zuup/terminal-id",
  "/run/zuup-identity/terminal-id",
].filter((p): p is string => Boolean(p));
const ROLES_FILE = process.env.ZUUP_ROLES_FILE ?? "/run/zuup-identity/terminal-roles.json";
/**
 * What first-boot commissioning did, in words.
 *
 * The machine has no shell — §7.3 strips su/login/agetty — so "check the
 * journal" is advice nobody standing at it can take. The kiosk browser is the
 * only surface that can carry a diagnosis, so commissioning writes its outcome
 * here and the screens render it.
 */
const STATUS_FILE = process.env.ZUUP_STATUS_FILE ?? "/run/zuup-identity/commission-status.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Capability = "CANDIDATE_SEAT" | "INVIGILATOR_STATION" | "ADMIN_STATION";
const CAPABILITIES: Capability[] = ["CANDIDATE_SEAT", "INVIGILATOR_STATION", "ADMIN_STATION"];

interface RoleEntry {
  role: Capability;
  terminalId: string;
  seatNo?: string;
}

/** The commissioning file, if this machine holds several stations. */
async function readRoles(): Promise<{ roles: RoleEntry[]; commissionedVia: string | null }> {
  try {
    const parsed = JSON.parse(await readFile(ROLES_FILE, "utf8")) as {
      commissionedVia?: string;
      roles?: Array<{ role?: string; terminalId?: string; seatNo?: string }>;
    };
    const roles = (parsed.roles ?? []).flatMap((r): RoleEntry[] => {
      if (!r.role || !r.terminalId) return [];
      if (!CAPABILITIES.includes(r.role as Capability)) return [];
      if (!UUID.test(r.terminalId)) return [];
      return [{ role: r.role as Capability, terminalId: r.terminalId.toLowerCase(), seatNo: r.seatNo }];
    });
    return { roles, commissionedVia: parsed.commissionedVia ?? null };
  } catch {
    return { roles: [], commissionedVia: null };
  }
}

/** The commissioning outcome, if this machine wrote one. */
async function readCommissioning(): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(STATUS_FILE, "utf8")) as Record<string, unknown>;
  } catch {
    return null; // a provisioned terminal never commissions itself
  }
}

export async function GET(): Promise<Response> {
  const { roles, commissionedVia } = await readRoles();
  const commissioning = await readCommissioning();

  let primary: string | null = null;
  for (const file of ID_FILES) {
    try {
      const raw = (await readFile(file, "utf8")).trim();
      if (UUID.test(raw)) {
        primary = raw.toLowerCase();
        break;
      }
    } catch {
      // Missing or unreadable — try the next location.
    }
  }

  // A single-identity terminal reports itself as one role; the capability it is
  // allowed to present is still the Edge's answer, not this file's.
  if (!primary && roles.length > 0) primary = roles[0]!.terminalId;

  if (!primary) {
    return Response.json(
      { ok: false, reason: "NO_TERMINAL_IDENTITY", searched: ID_FILES, commissioning },
      { status: 503 },
    );
  }

  return Response.json({
    ok: true,
    terminalId: primary,
    roles,
    // Displayed by the Gate. A machine that vouched for itself must never be
    // mistaken for one an authority commissioned.
    commissionedVia: commissionedVia ?? "PROVISIONED",
    commissioning,
  });
}
