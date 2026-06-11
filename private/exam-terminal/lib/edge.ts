"use client";
/**
 * Typed client for the Centre Edge API as seen FROM A TERMINAL (§13.1–§13.3).
 * Same-origin `/api/*` (proxied to the Edge in dev; the Edge over the
 * WireGuard tunnel in production). The terminal never holds credentials —
 * probes go to the Edge, only the Edge's verdict comes back (§7.6).
 */

const TOKEN_KEY = "zuup_terminal_session";
const TERMINAL_KEY = "zuup_terminal_id";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string): void {
  window.sessionStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  window.sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * The terminal's own identity. On a real ZUUP-OS terminal this is baked into
 * the signed image (it IS the device, §7.1); in dev it comes from ?terminal=
 * or localStorage so one browser can stand in for any seat/station.
 */
export function getTerminalId(): string | null {
  if (typeof window === "undefined") return null;
  const fromQuery = new URLSearchParams(window.location.search).get("terminal");
  if (fromQuery) {
    window.localStorage.setItem(TERMINAL_KEY, fromQuery);
    return fromQuery;
  }
  return window.localStorage.getItem(TERMINAL_KEY);
}
export function setTerminalId(id: string): void {
  window.localStorage.setItem(TERMINAL_KEY, id);
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
export interface RosterRow {
  roll: string;
  name: string;
  status: string;
}
export const roster = (examId: string) =>
  call<{ roster: RosterRow[] }>(`/centre/roster?examId=${encodeURIComponent(examId)}`);

export const checkin = (body: { examId: string; roll: string; faceScore: number; fpScore: number }) =>
  call<{ ok: boolean; status: string }>("/candidate/checkin", { method: "POST", body: JSON.stringify(body) });

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

export const candidateLogin = (body: { terminalId: string; roll: string; dob: string }) =>
  call<{ ok: boolean; state: string }>("/candidate/login", { method: "POST", body: JSON.stringify(body), auth: false });

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
  call<BundleResponse>(`/exam/${encodeURIComponent(examId)}/bundle?terminalId=${encodeURIComponent(terminalId)}`, { auth: false });

export interface BeaconResponse {
  ok: boolean;
  beacon: string;
  hkdfSalt: string;
  t0At: number;
}
/** Poll for the T₀ beacon. Throws EdgeError 425 while still before T₀. */
export const examBeacon = (examId: string, terminalId: string) =>
  call<BeaconResponse>(`/exam/${encodeURIComponent(examId)}/beacon?terminalId=${encodeURIComponent(terminalId)}`, { auth: false });

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
}) => call<{ ok: boolean; receipt: Receipt }>("/answer/submit", { method: "POST", body: JSON.stringify(body), auth: false });
