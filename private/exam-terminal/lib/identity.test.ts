/**
 * The capture step must fail CLOSED (§8.2), and this process must never be able
 * to produce, alter or stand in for a biometric.
 *
 * History, because each case is a defect that shipped: `captureProbe` once
 * returned a hardcoded 0.95/0.91 with no hardware involved; then it read real
 * scores from the daemon but still ASSEMBLED the login body here, so the client
 * stated the facts the gate decided on; and it carried a `simulate` switch that
 * turned a station with no camera into a passing login. What it forwards now is
 * an opaque signed envelope — the client cannot even name the fields.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { invigilatorLogin, registerStaff, captureCheckin } from "./identity.ts";

const STATION = "55555555-5555-5555-5555-555555555555";

const ENVELOPE = {
  envelope: {
    terminalId: STATION,
    nonce: "n0nce",
    subject: "LOGIN",
    faceScoreBp: 9400,
    fpScoreBp: 8800,
    capturedAt: 1_800_000_000_000,
  },
  sig: "abcd",
};

interface Route {
  status?: number;
  body: unknown;
  /** Throw instead of answering — an unreachable service. */
  down?: boolean;
}

/** Record every request so a test can assert what the client actually sent. */
function stub(routes: Record<string, Route>) {
  const seen: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = mock.fn(async (url: string | URL, init?: RequestInit) => {
    const path = String(url).split("?")[0]!;
    seen.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[path];
    if (!route || route.down) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return seen;
}

const CHALLENGE = { body: { ok: true, nonce: "n0nce" } };
const ENROLMENT = { body: { faceEmbeddingHash: "aa".repeat(32), fingerprintTemplate: "bb".repeat(32) } };

test("the login body carries only the envelope — no scores, no IP, no elapsed time", async () => {
  const seen = stub({
    "/api/login/challenge": CHALLENGE,
    "/api/station/enrolment": ENROLMENT,
    "/biometric/attest/verify": { body: ENVELOPE },
    "/api/invigilator/login": { body: { ok: true, token: "t" } },
  });

  const verdict = await invigilatorLogin(STATION);
  assert.equal(verdict.ok, true);

  const login = seen.find((s) => s.url === "/api/invigilator/login")!;
  const body = login.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["bio", "challengeNonce", "terminalId"]);
  for (const forbidden of ["faceScore", "fpScore", "tpmValid", "observedIp", "elapsedMs"]) {
    assert.ok(!(forbidden in body), `${forbidden} must not be assertable by the client`);
  }
  assert.deepEqual(body.bio, ENVELOPE, "the envelope is forwarded byte-for-byte, unread");
});

test("the enrolled template reaches the daemon — a match needs something to match", async () => {
  const seen = stub({
    "/api/login/challenge": CHALLENGE,
    "/api/station/enrolment": ENROLMENT,
    "/biometric/attest/verify": { body: ENVELOPE },
    "/api/invigilator/login": { body: { ok: true, token: "t" } },
  });
  await invigilatorLogin(STATION);

  const capture = seen.find((s) => s.url === "/biometric/attest/verify")!;
  const body = capture.body as Record<string, unknown>;
  // The old client sent "" here, so the cosine was taken against nothing and
  // the face factor could only ever score zero.
  assert.equal(body.enrolled_embedding_hex, ENROLMENT.body.faceEmbeddingHash);
  assert.equal(body.enrolled_template_hex, ENROLMENT.body.fingerprintTemplate);
  assert.equal(body.subject, "LOGIN");
  assert.equal(body.nonce, "n0nce");
});

test("an unreachable daemon denies, and says so in words about hardware", async () => {
  const verdict = await (async () => {
    stub({
      "/api/login/challenge": CHALLENGE,
      "/api/station/enrolment": ENROLMENT,
      "/biometric/attest/verify": { body: {}, down: true },
    });
    return invigilatorLogin(STATION);
  })();
  assert.equal(verdict.ok, false);
  assert.match(verdict.failures?.[0] ?? "", /7700|did not answer/);
});

test("a station with no attestation key cannot log in", async () => {
  stub({
    "/api/login/challenge": CHALLENGE,
    "/api/station/enrolment": ENROLMENT,
    "/biometric/attest/verify": { status: 503, body: { ok: false, reason: "NO_ATTESTATION_KEY" } },
  });
  const verdict = await invigilatorLogin(STATION);
  assert.equal(verdict.ok, false);
  assert.match(verdict.failures?.[0] ?? "", /commissioned/);
});

test("an unsigned answer from the daemon is refused before it reaches the Edge", async () => {
  const seen = stub({
    "/api/login/challenge": CHALLENGE,
    "/api/station/enrolment": ENROLMENT,
    // Exactly the shape the old daemon returned.
    "/biometric/attest/verify": { body: { score: 0.99 } },
    "/api/invigilator/login": { body: { ok: true, token: "t" } },
  });
  const verdict = await invigilatorLogin(STATION);
  assert.equal(verdict.ok, false);
  assert.ok(!seen.some((s) => s.url === "/api/invigilator/login"), "nothing should have been posted");
});

test("no Edge, no login — the client cannot proceed without a challenge", async () => {
  stub({ "/api/login/challenge": { body: {}, down: true } });
  const verdict = await invigilatorLogin(STATION);
  assert.deepEqual(verdict.failures, ["EDGE_UNREACHABLE"]);
});

test("registration sends no centre and no bindings — the Edge decides those", async () => {
  const seen = stub({
    "/api/login/challenge": CHALLENGE,
    "/biometric/attest/enrol": {
      body: { envelope: { subject: "ENROL", nonce: "n0nce" }, sig: "beef" },
    },
    "/api/invigilator/register": { body: { requestId: "req-1" } },
  });

  const r = await registerStaff("/invigilator/register", { terminalId: STATION, fullName: "Arun Joshi" });
  assert.deepEqual(r, { requestId: "req-1" });

  const body = seen.find((s) => s.url === "/api/invigilator/register")!.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["challengeNonce", "enrol", "fullName", "terminalId"]);
  for (const forbidden of ["centerId", "boundIp", "boundTerminalId", "faceEmbeddingHash", "fingerprintTemplate"]) {
    assert.ok(!(forbidden in body), `${forbidden} must not be chosen by the applicant`);
  }
});

test("check-in binds the capture to the roll standing at the desk", async () => {
  const seen = stub({
    "/api/login/challenge": CHALLENGE,
    "/api/candidate/enrolment": ENROLMENT,
    "/biometric/attest/verify": { body: ENVELOPE },
  });

  const out = await captureCheckin({ stationId: STATION, examId: "exam-1", roll: "R-1461" });
  assert.ok(!("error" in out));

  const capture = seen.find((s) => s.url === "/biometric/attest/verify")!.body as Record<string, unknown>;
  assert.equal(capture.subject, "checkin:R-1461");
});

test("a candidate with no enrolment on file cannot be checked in", async () => {
  stub({
    "/api/login/challenge": CHALLENGE,
    "/api/candidate/enrolment": { status: 404, body: { ok: false, reason: "ROLL_NOT_ON_ROSTER" } },
  });
  const out = await captureCheckin({ stationId: STATION, examId: "exam-1", roll: "R-9999" });
  assert.ok("error" in out);
});

test("capture stays inside the login time-box even when the daemon hangs", async () => {
  let calls = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = String(url).split("?")[0];
    if (path === "/api/login/challenge") return new Response(JSON.stringify({ nonce: "n0nce" }));
    if (path === "/api/station/enrolment") return new Response(JSON.stringify(ENROLMENT.body));
    calls++;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as unknown as typeof fetch;

  const started = Date.now();
  const verdict = await invigilatorLogin(STATION);
  assert.ok(Date.now() - started < 10_000, "must not block past the 20 s login box");
  assert.equal(verdict.ok, false);
  assert.equal(calls, 1);
});
