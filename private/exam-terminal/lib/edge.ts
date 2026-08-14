"use client";
/**
 * Typed client for the Centre Edge API as seen FROM A TERMINAL (§13.1–§13.3).
 * Same-origin `/api/*` (proxied to the Edge in dev; the Edge over the
 * WireGuard tunnel in production). The terminal never holds credentials —
 * probes go to the Edge, only the Edge's verdict comes back (§7.6).
 */

const TOKEN_KEY = "zuup_terminal_session";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}
// Guarded like getToken: these run during prerender and under `node --test`,
// where touching `window` throws — and a throw inside the login path would be
// caught upstream and reported as "Edge unreachable", which is a lie about a
// login that actually succeeded.
export function setToken(t: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * The terminal's own identity, from the signed image (§7.1).
 *
 * Read once from `/local/identity`, which reads `/etc/zuup/terminal-id` on this
 * machine. It is NOT read from `?terminal=`, from localStorage, or from
 * anything else a person in front of the kiosk can set: a terminal that can be
 * told which seat it is can be told to be the seat whose paper it wants.
 *
 * `roles` is normally one entry. It is longer only on the all-in-one image,
 * where one laptop was commissioned as several stations — and even then the
 * list is the MACHINE's, so `?role=` selects among identities this hardware
 * actually holds and can never name one it does not.
 *
 * Null identity means this machine is not commissioned, and the Gate stays shut.
 */
export interface MachineIdentity {
  terminalId: string | null;
  roles: Array<{ role: TerminalCapability; terminalId: string; seatNo?: string }>;
  /** PROVISIONED (an authority registered it) or FIRST_BOOT (it registered itself). */
  commissionedVia: string;
}

// Only a SUCCESSFUL read is cached. On a machine that commissions itself the
// identity appears a few seconds into boot, after the Edge is up — and the
// kiosk may well have loaded this page before then. Caching the miss would
// leave the screen saying "not commissioned" for the rest of the session, on a
// machine that commissioned itself perfectly well ten seconds later.
const NO_IDENTITY: MachineIdentity = { terminalId: null, roles: [], commissionedVia: "PROVISIONED" };
let cachedIdentity: MachineIdentity | undefined;

export async function machineIdentity(): Promise<MachineIdentity> {
  if (cachedIdentity !== undefined) return cachedIdentity;
  try {
    const res = await fetch("/local/identity", { cache: "no-store" });
    const json = (await res.json()) as {
      ok?: boolean; terminalId?: string;
      roles?: MachineIdentity["roles"]; commissionedVia?: string;
    };
    if (res.ok && json.ok && json.terminalId) {
      cachedIdentity = {
        terminalId: json.terminalId,
        roles: json.roles ?? [],
        commissionedVia: json.commissionedVia ?? "PROVISIONED",
      };
      return cachedIdentity;
    }
  } catch {
    // fall through
  }
  return NO_IDENTITY;
}

/**
 * The identity this surface should present.
 *
 * `?role=` names a ROLE, never an id: it is resolved against the machine's own
 * commissioning list, so the worst a URL can do is ask for a station this
 * hardware was already registered as — whose login then has to pass on its own
 * merits anyway.
 */
export async function terminalIdentity(role?: string | null): Promise<string | null> {
  const identity = await machineIdentity();
  // A production terminal publishes no role list: it holds one identity, and
  // the Edge's capability answer is what decides which surface it may open.
  // Returning null here for "the role you asked for is not listed" would lock
  // out every correctly-provisioned single-role machine in the estate.
  if (identity.roles.length === 0) return identity.terminalId;
  if (role) {
    const match = identity.roles.find((r) => r.role === role);
    return match ? match.terminalId : null;
  }
  return identity.terminalId;
}

export class EdgeError extends Error {
  status: number;
  body: { ok?: boolean; reason?: string; failures?: string[] };
  constructor(status: number, body: EdgeError["body"]) {
    super(body.reason ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function call<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.auth !== false) {
    const t = getToken();
    if (t) headers.set("authorization", `Bearer ${t}`);
  }
  if (init?.body) headers.set("content-type", "application/json");
  const res = await fetch(`/api${path}`, { ...init, headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new EdgeError(res.status, json);
  return json as T;
}

// ── §13.1 gate & attestation ──────────────────────────────────────────────
/** Fail-closed liveness (INV-10): any failure means "Centre offline". */
export async function health(): Promise<boolean> {
  try {
    const r = await call<{ ok: boolean }>("/health", { auth: false });
    return r.ok === true;
  } catch {
    return false;
  }
}

export type TerminalCapability = "CANDIDATE_SEAT" | "INVIGILATOR_STATION" | "ADMIN_STATION";

/**
 * Why this terminal will or will not be able to log anyone in.
 *
 * Read once at the Gate and shown on screen. On real hardware you may only get
 * one boot to find out what is missing, and "Denied · TPM_ATTESTATION_INVALID"
 * three screens later is a poor way to learn that a laptop has no TPM.
 */
export interface TerminalReadiness {
  capability: TerminalCapability;
  commissionedVia: string;
  registeredAttestationKey: boolean;
  registeredGoldenPcr: boolean;
  registeredBiometricKey: boolean;
  attestationCurrent: boolean;
  enrolledIdentity: boolean;
}

export async function readiness(terminalId: string): Promise<TerminalReadiness | null> {
  try {
    return await call<TerminalReadiness>(
      `/terminal/${encodeURIComponent(terminalId)}/readiness`,
      { auth: false },
    );
  } catch {
    return null;
  }
}

/** What the on-device daemon reports about its own hardware (§8.4). */
export interface BiometricHealth {
  ok: boolean;
  face: boolean;
  fp: boolean;
  signing: boolean;
}

export async function biometricHealth(): Promise<BiometricHealth | null> {
  try {
    const res = await fetch("/biometric/health", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as BiometricHealth;
  } catch {
    return null; // no daemon at all
  }
}

export async function capability(terminalId: string): Promise<TerminalCapability | null> {
  try {
    const r = await call<{ capability: TerminalCapability }>(
      `/terminal/${encodeURIComponent(terminalId)}/capability`,
      { auth: false },
    );
    return r.capability;
  } catch {
    return null; // unknown terminal → the Gate stays locked (fail closed)
  }
}

// ── §13.2 invigilator console ─────────────────────────────────────────────
export interface CentreExam {
  id: string;
  name: string;
  scheduledAt: string;
  durationMinutes: number;
}
/** The exams THIS centre is running — the console has no hard-coded exam id. */
export const centreExams = () => call<{ exams: CentreExam[] }>("/centre/exams");

export interface RosterRow {
  roll: string;
  name: string;
  status: string;
}
export const roster = (examId: string) =>
  call<{ roster: RosterRow[] }>(`/centre/roster?examId=${encodeURIComponent(examId)}`);

/**
 * Check a candidate in. The scores are inside `bio` — an envelope the station's
 * biometric daemon signed over this nonce and this roll — so this call cannot
 * express "trust me, it matched".
 */
export const checkin = (body: {
  examId: string;
  roll: string;
  challengeNonce: string;
  bio: { envelope: Record<string, unknown>; sig: string };
}) => call<{ ok: boolean; status: string }>("/candidate/checkin", { method: "POST", body: JSON.stringify(body) });

export const assignSeat = (body: { examId: string; roll: string }) =>
  call<{ ok: boolean; seatNo: string; terminalId: string }>("/seat/assign", { method: "POST", body: JSON.stringify(body) });

export interface SeatMapRow {
  terminalId: string;
  seatNo: string;
  capability: string;
  state: string;
  health: string | null;
}
export const seatMap = () => call<{ seats: SeatMapRow[] }>("/centre/seatmap");

export const raiseIncident = (body: { seatNo?: string; type: string; severity?: string; note?: string }) =>
  call<{ ok: boolean }>("/incident", { method: "POST", body: JSON.stringify(body) });

// ── §13.3 candidate seat ──────────────────────────────────────────────────
export interface SeatStateResponse {
  state: string;
  // ASSIGNED → full binding (roll the candidate logs in with); post-attend
  // states → exam id only (roll withheld, but the seat still knows its exam).
  binding: { candidateRoll?: string; examId: string } | null;
}
export const seatState = (terminalId: string) =>
  call<SeatStateResponse>(`/seat/${encodeURIComponent(terminalId)}/state`, { auth: false });

/**
 * Roll + DOB login for this seat. On success the Edge returns the CANDIDATE
 * session that authorises everything after it — the bundle, the beacon and the
 * submission. Stored here so the caller cannot forget to arm it; without it
 * those three routes answer 403 NO_CANDIDATE_SESSION.
 */
export async function candidateLogin(body: { terminalId: string; roll: string; dob: string }) {
  const r = await call<{ ok: boolean; state: string; token?: string }>(
    "/candidate/login", { method: "POST", body: JSON.stringify(body), auth: false },
  );
  if (r.token) setToken(r.token);
  return r;
}

// ── §10.7 question delivery (Edge serves the keyless bundle + gated beacon) ─
import type { SealedBundle } from "@/lib/question-crypto";

export interface BundleResponse {
  questionsRoot: string;
  bundleCid: string | null;
  chainTx: string | null;
  bundle: SealedBundle;
}
/** Fetch the sealed, keyless question bundle for this seat's exam. */
export const questionBundle = (examId: string, terminalId: string) =>
  call<BundleResponse>(`/exam/${encodeURIComponent(examId)}/bundle?terminalId=${encodeURIComponent(terminalId)}`);

export interface BeaconResponse {
  ok: boolean;
  beacon: string;
  hkdfSalt: string;
  t0At: number;
}
/** Poll for the T₀ beacon. Throws EdgeError 425 while still before T₀. */
export const examBeacon = (examId: string, terminalId: string) =>
  call<BeaconResponse>(`/exam/${encodeURIComponent(examId)}/beacon?terminalId=${encodeURIComponent(terminalId)}`);

// ── §11 answer pipeline (seal happens client-side, lib/answer-seal.ts) ─────
/** The System Admin SEALING key (public half) + the centre node pubkey. */
export const sealingKey = () =>
  call<{ pem: string; nodePubkey: string }>("/exam/sealing-key", { auth: false });

export interface Receipt {
  leafIndex: number;
  leaf: string;
  prevRoot: string;
  root: string;
  nodeRootSig: string;
  nodePubkey: string;
}
/** Push a sealed envelope (hex fields) — the Edge recomputes the leaf itself. */
export const submitAnswer = (body: {
  terminalId: string;
  ct: string;
  iv: string;
  tag: string;
  wrappedDk: string;
}) => call<{ ok: boolean; receipt: Receipt }>("/answer/submit", { method: "POST", body: JSON.stringify(body) });
