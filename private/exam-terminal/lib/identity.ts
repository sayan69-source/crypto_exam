"use client";
/**
 * Privileged-login client (§9.1) — forms the login challenge and forwards it
 * to the Edge; renders only the Edge's allow/deny verdict (§7.6).
 *
 * On a real ZUUP-OS station the four factors are produced by hardware:
 *   face   — webcam + on-device TF Lite embedding w/ liveness (§8.3)
 *   finger — Mantra/SecuGen SDK template match score
 *   ip     — the Edge observes the WireGuard tunnel source itself
 *   tpm    — TPM 2.0 quote over the golden PCR set (§7.1)
 * In dev, `captureProbe` stands in for the capture step with explicit,
 * visible values — there is no hidden bypass, and the Edge applies the same
 * §8.2 match-all rule either way (deny on ANY missing factor).
 */
import { EdgeError, setToken } from "./edge";

export interface LoginProbe {
  terminalId: string;
  observedIp: string;
  faceScore: number;
  fpScore: number;
  tpmValid: boolean;
  elapsedMs: number;
}

export interface LoginVerdict {
  ok: boolean;
  failures?: string[];
}

/** Dev stand-in for the on-device biometric daemon + TPM quote. */
export function captureProbe(opts: {
  terminalId: string;
  observedIp: string;
  spoof?: "ip" | "face" | "finger" | "tpm" | null;
}): LoginProbe {
  return {
    terminalId: opts.terminalId,
    observedIp: opts.spoof === "ip" ? "10.0.0.99" : opts.observedIp,
    faceScore: opts.spoof === "face" ? 0.41 : 0.95,
    fpScore: opts.spoof === "finger" ? 0.2 : 0.91,
    tpmValid: opts.spoof !== "tpm",
    elapsedMs: 1200, // within the ≤20 s login time-box (§8.2)
  };
}

async function privilegedLogin(path: string, probe: LoginProbe): Promise<LoginVerdict> {
  try {
    const res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(probe),
    });
    const json = await res.json();
    if (res.ok && json.ok && json.token) {
      setToken(json.token);
      return { ok: true };
    }
    return { ok: false, failures: json.failures ?? [json.reason ?? "DENIED"] };
  } catch (e) {
    if (e instanceof EdgeError) return { ok: false, failures: e.body.failures ?? [e.message] };
    return { ok: false, failures: ["EDGE_UNREACHABLE"] }; // fail closed (INV-10)
  }
}

export const invigilatorLogin = (probe: LoginProbe) => privilegedLogin("/invigilator/login", probe);

// ── §9.2 registration (steps 3 + 7) ───────────────────────────────────────
export interface RegistrationInput {
  centerId: string;
  fullName: string;
  boundIp: string | null;
  boundTerminalId: string | null;
}

/** Step 3 — submit the capture; account is created PENDING_APPROVAL. */
export async function registerInvigilator(input: RegistrationInput): Promise<{ requestId: string } | { error: string }> {
  const res = await fetch("/api/invigilator/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...input,
      // Dev stand-ins for the on-device captures (hashes/templates, never raw).
      faceEmbeddingHash: "aa".repeat(32),
      fingerprintTemplate: "bb".repeat(32),
    }),
  });
  const json = await res.json();
  if (!res.ok) return { error: json.reason ?? `HTTP ${res.status}` };
  return { requestId: json.requestId };
}

/** Step 7 — activate with the one-time code + re-supplied fingerprint. */
export async function activateWithCode(input: {
  requestId: string;
  code: string;
  fingerprintMatch: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetch("/api/invigilator/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  return res.ok ? { ok: true } : { ok: false, reason: json.reason ?? `HTTP ${res.status}` };
}
