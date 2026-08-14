"use client";
/**
 * Typed client for the Centre Edge API (§13.4), plus the session token store.
 * Same-origin `/api/*` (proxied to the Edge in dev; served by the Edge in
 * production). No secrets are stored beyond the short-TTL session token, which
 * lives only in this tab and dies with it.
 */

const TOKEN_KEY = "zuup_admin_token";

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

// ── Auth ──────────────────────────────────────────────────────────────────
// The login itself lives in lib/station.ts: it is a protocol (challenge →
// enrolment → signed capture → verdict), not a request body. There is
// deliberately no `LoginProbe` type here any more — a struct of factors that a
// page could fill in is the shape of the defect this portal shipped with.

// ── Counts (§10.3) ──────────────────────────────────────────────────────
export interface CentreCounts {
  invigilatorsActive: number; invigilatorsPending: number;
  candidatesRegistered: number; present: number; inExam: number; submitted: number;
  seatsAvailable: number; seatsAssigned: number; bundlesHeld: number;
}
export const fetchCounts = (examId?: string) =>
  call<CentreCounts>(`/admin/centre/counts${examId ? `?examId=${examId}` : ""}`);

// ── Approvals (§9.2, §9.4) ──────────────────────────────────────────────
export interface PendingApproval {
  requestId: string; applicantName: string; kind: string; fingerprintAuthorised: boolean;
}
export const fetchPending = () => call<{ pending: PendingApproval[] }>("/admin/approvals/pending");
export const issueCode = (id: string) => call<{ code: string; ttl: number }>(`/admin/approvals/${id}/issue-code`, { method: "POST" });
export const authoriseFp = (id: string) => call<{ ok: boolean }>(`/admin/approvals/${id}/authorise-fp`, { method: "POST" });

// ── Blind-courier ledger (INV-6) ─────────────────────────────────────────
export interface LedgerBundle {
  leafIndex: number; leafHash: string; chainRoot: string; nodeRootSig: string; syncState: string;
}
export const fetchLedger = () => call<{ bundles: LedgerBundle[] }>("/admin/ledger");
