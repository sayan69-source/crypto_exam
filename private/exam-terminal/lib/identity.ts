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
// Explicit extension, as in chain-bridge.ts: it lets `node --test
// --experimental-strip-types` resolve this module, and the bundler is fine
// either way (allowImportingTsExtensions).
import { EdgeError, setToken } from "./edge.ts";

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

/**
 * The on-device biometric daemon (`zuup-biometricd.service`), on loopback only.
 *
 * Reached through the terminal's own origin so the kiosk CSP does not have to
 * allow a second host; the Next rewrite in next.config.ts maps it to
 * 127.0.0.1:7700. It is the daemon that owns the camera and the reader — this
 * process never sees a pixel or a template, only scores (§8.4).
 */
const BIOMETRIC_BASE = "/biometric";

export interface CaptureSource {
  /** Where each score came from, so the UI can never imply hardware that is absent. */
  face: "device" | "unavailable" | "simulated";
  finger: "device" | "unavailable" | "simulated";
  detail?: string;
}

export interface CaptureResult extends LoginProbe {
  source: CaptureSource;
}

async function daemon(path: string, body: unknown, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BIOMETRIC_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null; // unreachable daemon is a missing factor, not a passing one
  }
}

/**
 * Capture the four §8.1 login factors from the hardware.
 *
 * Every abnormal path — no daemon, no camera, no reader, no face, more than one
 * face, liveness below the floor — yields a score of 0, which the Edge's §8.2
 * match-all rule turns into a denial. There is no degraded "assume human" mode
 * and no client-side threshold: the Edge still owns the decision.
 *
 * `simulate` exists for the Docker proving ground, which has no camera at all.
 * It is opt-in per call, it is reported in `source`, and it never activates by
 * itself — a silent fallback to 0.95 is how a demo starts claiming biometrics
 * it never performed.
 */
export async function captureProbe(opts: {
  terminalId: string;
  observedIp: string;
  enrolledFaceHex?: string;
  enrolledFingerHex?: string;
  spoof?: "ip" | "face" | "finger" | "tpm" | null;
  simulate?: boolean;
  timeoutMs?: number;
}): Promise<CaptureResult> {
  const started = Date.now();
  const observedIp = opts.spoof === "ip" ? "10.0.0.99" : opts.observedIp;

  if (opts.simulate) {
    return {
      terminalId: opts.terminalId,
      observedIp,
      faceScore: opts.spoof === "face" ? 0.41 : 0.95,
      fpScore: opts.spoof === "finger" ? 0.2 : 0.91,
      tpmValid: opts.spoof !== "tpm",
      elapsedMs: Date.now() - started,
      source: { face: "simulated", finger: "simulated", detail: "No capture hardware — scores are stand-ins." },
    };
  }

  // §8.2 puts a 20 s time-box on the whole login; cap the capture well inside it.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 8000);
  try {
    const [face, finger] = await Promise.all([
      daemon("/face/verify", { enrolled_embedding_hex: opts.enrolledFaceHex ?? "" }, ctl.signal),
      daemon("/fp/verify", { enrolled_template_hex: opts.enrolledFingerHex ?? "" }, ctl.signal),
    ]);

    const faceScore = typeof face?.score === "number" ? face.score : 0;
    const fpScore = typeof finger?.score === "number" ? finger.score : 0;

    return {
      terminalId: opts.terminalId,
      observedIp,
      faceScore: opts.spoof === "face" ? 0.41 : faceScore,
      fpScore: opts.spoof === "finger" ? 0.2 : fpScore,
      // The TPM quote is produced by the boot chain and checked by the Edge
      // against the golden PCR set; the browser cannot attest to itself.
      tpmValid: opts.spoof !== "tpm",
      elapsedMs: Date.now() - started,
      source: {
        face: face ? "device" : "unavailable",
        finger: finger ? "device" : "unavailable",
        detail:
          face && finger
            ? undefined
            : "zuup-biometricd did not answer on 127.0.0.1:7700 — the missing factors score 0 and the Edge will deny.",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function privilegedLogin(path: string, probe: LoginProbe): Promise<LoginVerdict> {
  try {
    // The Edge times the login itself, from a nonce it issued (§8.2). The
    // terminal cannot claim to have been fast; without a nonce the elapsed
    // factor is unmeasurable and the gate denies.
    let challengeNonce: string | undefined;
    try {
      const ch = await fetch("/api/login/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terminalId: probe.terminalId }),
      });
      if (ch.ok) challengeNonce = (await ch.json()).nonce;
    } catch {
      // Leave it undefined — the Edge denies rather than assuming.
    }

    const res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...probe, challengeNonce }),
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
