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
export interface LoginProbe {
  terminalId: string; observedIp: string;
  faceScore: number; fpScore: number; tpmValid: boolean; elapsedMs: number;
}
export async function adminLogin(probe: LoginProbe): Promise<{ ok: boolean; token?: string; failures?: string[] }> {
  // A denial (401) is a *result* here, not an exception — the page renders the
  // failed factors so the operator can see why the match-all rule said no.
  try {
    return await call("/admin/login", { method: "POST", body: JSON.stringify(probe), auth: false });
  } catch (e) {
    const body = (e as { body?: { ok?: boolean; failures?: string[] } }).body;
    if (body && body.ok === false) return { ok: false, failures: body.failures ?? ["DENIED"] };
    throw e;
  }
}

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
