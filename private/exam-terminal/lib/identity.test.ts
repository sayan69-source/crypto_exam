/**
 * The capture step must fail CLOSED (§8.2).
 *
 * `captureProbe` used to return a hardcoded 0.95/0.91 with no hardware involved,
 * which meant the four-factor login always presented two passing biometrics
 * whatever the station was doing. These cases pin the replacement: a score only
 * comes from the daemon, and anything else is a zero the Edge will deny on.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { captureProbe } from "./identity.ts";

const BASE = { terminalId: "station-1", observedIp: "10.0.0.6" };

/** Stub the daemon's two verify endpoints. `null` = endpoint refuses/absent. */
function stubDaemon(face: unknown, finger: unknown) {
  globalThis.fetch = mock.fn(async (url: string | URL) => {
    const path = String(url);
    const body = path.includes("/face/verify") ? face : finger;
    if (body === null) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

test("scores come from the on-device daemon, not from this process", async () => {
  stubDaemon({ score: 0.88, liveness: 0.93, faces: 1 }, { score: 0.77 });
  const probe = await captureProbe(BASE);
  assert.equal(probe.faceScore, 0.88);
  assert.equal(probe.fpScore, 0.77);
  assert.deepEqual(probe.source, { face: "device", finger: "device", detail: undefined });
});

test("an unreachable daemon scores 0 — never a passing default", async () => {
  stubDaemon(null, null);
  const probe = await captureProbe(BASE);
  assert.equal(probe.faceScore, 0);
  assert.equal(probe.fpScore, 0);
  assert.equal(probe.source.face, "unavailable");
  assert.equal(probe.source.finger, "unavailable");
  assert.match(probe.source.detail ?? "", /7700/);
});

test("one working factor does not carry the other", async () => {
  stubDaemon({ score: 0.95 }, null);
  const probe = await captureProbe(BASE);
  assert.equal(probe.faceScore, 0.95);
  assert.equal(probe.fpScore, 0, "a missing reader must not inherit the face score");
  assert.equal(probe.source.finger, "unavailable");
});

test("a daemon answering without a score is treated as no score", async () => {
  stubDaemon({ error: "no camera" }, { error: "no reader" });
  const probe = await captureProbe(BASE);
  assert.equal(probe.faceScore, 0);
  assert.equal(probe.fpScore, 0);
});

test("simulation is opt-in and says so", async () => {
  stubDaemon(null, null);
  const probe = await captureProbe({ ...BASE, simulate: true });
  assert.equal(probe.faceScore, 0.95);
  assert.equal(probe.source.face, "simulated");
  assert.equal(probe.source.finger, "simulated");
  assert.match(probe.source.detail ?? "", /stand-ins/);
});

test("the spoof controls still override, so the deny path stays demonstrable", async () => {
  stubDaemon({ score: 0.99 }, { score: 0.99 });
  const face = await captureProbe({ ...BASE, spoof: "face" });
  assert.ok(face.faceScore < 0.5);
  const ip = await captureProbe({ ...BASE, spoof: "ip" });
  assert.notEqual(ip.observedIp, BASE.observedIp);
});

test("capture stays inside the login time-box even when the daemon hangs", async () => {
  globalThis.fetch = (async (_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;

  const started = Date.now();
  const probe = await captureProbe({ ...BASE, timeoutMs: 150 });
  assert.ok(Date.now() - started < 3000, "must not block the 20 s login box");
  assert.equal(probe.faceScore, 0);
  assert.equal(probe.fpScore, 0);
});
