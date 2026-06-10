"use client";
/**
 * Typed client for the §13.5 SYSTEM ADMIN (tier-0) API on the Centre Edge,
 * plus the session token store. Same-origin `/api/*` (proxied to the Edge in
 * dev; carried over the HQ WireGuard link in production). The token lives only
 * in this tab and dies with it.
 *
 * Note what is ABSENT: nothing here can fetch ciphertext keys or plaintext
 * answers from a centre. Decryption happens only in this app's own /hq/ingest
 * route (the HSM stand-in) — see lib/vault.ts.
 */

const TOKEN_KEY = "zuup_system_token";

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
  if (!res.ok) throw Object.assign(new Error(json.reason ?? `HTTP ${res.status}`), { status: res.status, body: json });
  return json as T;
}

// ── Gate liveness (fail-closed, INV-10) ──────────────────────────────────
export async function health(): Promise<boolean> {
  try {
    const r = await call<{ ok: boolean }>("/health", { auth: false });
    return r.ok === true;
  } catch {
    return false;
  }
}

// ── Auth (§8.2 match-all at tier-0) ──────────────────────────────────────
export interface LoginProbe {
  terminalId: string; observedIp: string;
  faceScore: number; fpScore: number; tpmValid: boolean; elapsedMs: number;
}
export async function systemLogin(probe: LoginProbe): Promise<{ ok: boolean; token?: string; failures?: string[] }> {
  // A denial (401) is a *result* here, not an exception — the page renders the
  // failed factors so the operator can see why the match-all rule said no.
  try {
    return await call("/system/login", { method: "POST", body: JSON.stringify(probe), auth: false });
  } catch (e) {
    const body = (e as { body?: { ok?: boolean; failures?: string[] } }).body;
    if (body && body.ok === false) return { ok: false, failures: body.failures ?? ["DENIED"] };
    throw e;
  }
}

// ── Nationwide oversight (§13.5 — counts only, no PII) ───────────────────
export interface CentreOverviewRow {
  centerId: string;
  centreName: string;
  state: string | null;
  centerAdminsActive: number;
  centerAdminPending: number;
  invigilatorsActive: number;
  invigilatorsPending: number;
  candidatesRegistered: number;
  bundlesHeld: number;
  bundlesSynced: number;
}
export const fetchOverview = () => call<{ centres: CentreOverviewRow[] }>("/system/centres");

// ── Centre Admin approvals (§9.3 — tier-0 issues the code) ───────────────
export interface PendingCenterAdmin {
  requestId: string;
  applicantName: string;
  centerId: string;
  centreName: string;
  fingerprintAuthorised: boolean;
  codeIssued: boolean;
}
export const fetchPendingCA = () => call<{ pending: PendingCenterAdmin[] }>("/system/approvals/pending");
export const issueCode = (id: string) => call<{ code: string; ttl: number }>(`/system/approvals/${id}/issue-code`, { method: "POST" });
export const authoriseFp = (id: string) => call<{ ok: boolean }>(`/system/approvals/${id}/authorise-fp`, { method: "POST" });
