"use client";
/**
 * Station identity + privileged login for the HQ workstation (§8.2, §13.5).
 *
 * This portal used to log in by POSTing `{faceScore: 0.95, fpScore: 0.9,
 * tpmValid: true, elapsedMs: 1200}` — four literals in a React component —
 * against a hard-coded demo workstation id, and it never asked the Edge for a
 * login challenge at all. After the login gate started measuring the elapsed
 * time from a nonce it issues, that omission meant tier-0 could not log in AT
 * ALL: with no nonce the Edge has no measurement, treats the time-box as
 * expired, and denies every attempt. The root of trust was locked out of its
 * own estate, and the reason was invisible from the screen.
 *
 * Now it does exactly what the exam terminal does, for the same reasons:
 *   1. take a one-shot nonce from the Edge (freshness it measures itself),
 *   2. pull the enrolled templates for the identity bound to THIS station,
 *   3. have the on-device daemon capture and SIGN the scores,
 *   4. forward the sealed envelope and render the verdict.
 *
 * Nothing here can state a factor. The IP comes from the connection, the TPM
 * verdict from a verified quote, the time from the nonce, the biometrics from a
 * signature this process cannot forge.
 *
 * Paired with private/centre-admin/lib/station.ts and
 * private/exam-terminal/lib/identity.ts — same protocol, same failure
 * vocabulary. Change one, change the others.
 */

export interface SignedEnvelope {
  envelope: Record<string, unknown>;
  sig: string;
}

export interface LoginResult {
  ok: boolean;
  token?: string;
  failures?: string[];
}

const CAPTURE_TIMEOUT_MS = 8_000;

/**
 * This app's own base path.
 *
 * The Centre Admin portal is served under /admin on the all-in-one image, so a
 * bare `/local/identity` would leave this app entirely and be answered by
 * whichever surface owns the origin root — the exam terminal. It happens to
 * read the same machine files there, which is exactly the kind of coincidence
 * that works until the two portals are on different machines and then fails
 * with no obvious cause. Ask THIS app.
 *
 * `/api/*` and `/biometric/*` are deliberately NOT prefixed: those are the
 * centre origin's own routes (the proxy sends them to the Edge and to the
 * on-device daemon), not this app's.
 */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * This machine's commissioned identity, from `/local/identity` (which reads
 * /etc/zuup/terminal-id in the signed image). Never from a form field: a
 * workstation that can be told which workstation it is can be told to be one
 * whose operator is not standing in front of it.
 */
let cached: string | null | undefined;
export async function stationId(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(`${BASE}/local/identity`, { cache: "no-store" });
    const json = (await res.json()) as {
      ok?: boolean;
      terminalId?: string;
      roles?: Array<{ role?: string; terminalId?: string }>;
    };
    // A miss is NOT cached: on a machine that commissions itself the identity
    // appears seconds into boot, and caching the miss would leave this portal
    // saying "not commissioned" for the rest of the session.
    if (!res.ok || !json.ok || !json.terminalId) return null;
    // A machine commissioned as several stations (the all-in-one, where one
    // laptop stands in for a centre) publishes a role list; take the HQ workstation
    // identity from it. A production machine publishes none and holds exactly
    // one identity, which is the one returned here.
    const roles = json.roles ?? [];
    const match = roles.find((r) => r.role === "ADMIN_STATION");
    cached = roles.length === 0 ? json.terminalId : (match?.terminalId ?? null);
  } catch {
    return null;
  }
  return cached;
}

async function loginChallenge(terminalId: string): Promise<string | null> {
  try {
    const res = await fetch("/api/login/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ terminalId }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { nonce?: string };
    return typeof json.nonce === "string" ? json.nonce : null;
  } catch {
    return null;
  }
}

async function stationEnrolment(
  terminalId: string,
  challengeNonce: string,
): Promise<{ faceEmbeddingHash: string; fingerprintTemplate: string } | null> {
  try {
    const qs = new URLSearchParams({ terminalId, challengeNonce }).toString();
    const res = await fetch(`/api/station/enrolment?${qs}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Capture + sign, or say plainly which piece of hardware is missing. */
async function capture(
  terminalId: string,
  nonce: string,
  enrolment: { faceEmbeddingHash: string; fingerprintTemplate: string },
): Promise<SignedEnvelope | { reason: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CAPTURE_TIMEOUT_MS);
  try {
    const res = await fetch("/biometric/attest/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nonce,
        subject: "LOGIN",
        enrolled_embedding_hex: enrolment.faceEmbeddingHash,
        enrolled_template_hex: enrolment.fingerprintTemplate,
      }),
      signal: ctl.signal,
    });
    if (res.status === 503) {
      const j = (await res.json().catch(() => ({}))) as { reason?: string };
      return {
        reason: j.reason === "NO_ATTESTATION_KEY"
          ? "This station has no biometric attestation key — it has not been commissioned."
          : "The camera or fingerprint reader is unavailable on this station.",
      };
    }
    if (!res.ok) return { reason: `The biometric unit refused the capture (HTTP ${res.status}).` };
    const json = (await res.json()) as SignedEnvelope;
    if (!json?.sig || !json?.envelope) return { reason: "The biometric unit returned an unsigned capture." };
    return json;
  } catch {
    return { reason: "The biometric unit did not answer (zuup-biometricd on 127.0.0.1:7700)." };
  } finally {
    clearTimeout(timer);
  }
}

/** `path` is /admin/login for a Centre Admin, /system/login for tier-0. */
export async function stationLogin(path: string, terminalId: string): Promise<LoginResult> {
  const nonce = await loginChallenge(terminalId);
  if (!nonce) return { ok: false, failures: ["EDGE_UNREACHABLE"] };

  const enrolment = await stationEnrolment(terminalId, nonce);
  if (!enrolment) return { ok: false, failures: ["NO_ENROLMENT_FOR_STATION"] };

  const captured = await capture(terminalId, nonce, enrolment);
  if ("reason" in captured) return { ok: false, failures: [captured.reason] };

  try {
    const res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ terminalId, challengeNonce: nonce, bio: captured }),
    });
    const json = await res.json();
    if (res.ok && json.ok && json.token) return { ok: true, token: json.token };
    return { ok: false, failures: json.failures ?? [json.reason ?? "DENIED"] };
  } catch {
    return { ok: false, failures: ["EDGE_UNREACHABLE"] }; // fail closed (INV-10)
  }
}
