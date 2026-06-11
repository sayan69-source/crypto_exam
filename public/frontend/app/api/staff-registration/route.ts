/**
 * HQ staff-registration relay — the PUBLIC website's bridge to a centre Edge.
 *
 * Why this exists: the centre LAN is internet-free by design (ZUUP-OS INV-3),
 * so a NEW Centre Admin / Centre Invigilator — who has no working station yet —
 * could never reach the Edge's register endpoints from outside. Registration
 * CAPTURE therefore happens here on the public website, and this server-side
 * route forwards it to the right centre's Edge over the HQ↔Edge provisioning
 * link (WireGuard in production, EDGE_RELAY_URL in dev).
 *
 * What this deliberately does NOT change (the §9 cascade stays intact):
 *   • the request lands as PENDING_APPROVAL in the same approval_requests
 *     queue — System Admin approves Centre Admins, the centre's own Centre
 *     Admin approves invigilators (canApprove, §3.1);
 *   • ACTIVATION still happens IN PERSON at the centre: the approver-issued
 *     one-time code + a live fingerprint re-supply at a centre station
 *     (§9.2 step 7 / §9.4). A web registration alone can never become ACTIVE,
 *     so this public surface adds no path around INV-4/INV-8.
 *
 * GET  → centre directory (id/name/state) for the registration form
 * POST → { role, centerId, fullName, faceEmbeddingHash } → PENDING request id
 */
import { NextRequest, NextResponse } from "next/server";

const EDGE = process.env.EDGE_RELAY_URL ?? "http://127.0.0.1:4000";
const HEX64 = /^[0-9a-f]{64}$/i;

export async function GET(): Promise<NextResponse> {
  try {
    const r = await fetch(`${EDGE}/api/centres`, { cache: "no-store" });
    if (!r.ok) throw new Error(`edge ${r.status}`);
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json(
      { ok: false, reason: "HQ_EDGE_RELAY_UNAVAILABLE" },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    role?: string;
    centerId?: string;
    fullName?: string;
    faceEmbeddingHash?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "BAD_JSON" }, { status: 400 });
  }

  const role = body.role === "CENTER_ADMIN" ? "CENTER_ADMIN" : body.role === "CENTER_INVIGILATOR" ? "CENTER_INVIGILATOR" : null;
  if (!role || !body.centerId || !body.fullName?.trim()) {
    return NextResponse.json({ ok: false, reason: "MISSING_FIELDS" }, { status: 400 });
  }
  if (!body.faceEmbeddingHash || !HEX64.test(body.faceEmbeddingHash)) {
    return NextResponse.json({ ok: false, reason: "FACE_CAPTURE_REQUIRED" }, { status: 400 });
  }

  // The fingerprint is NOT captured here — a public browser has no trusted
  // reader. It is enrolled in person during activation; until then the stored
  // template is an explicit ENROL-PENDING marker (sha-256 of a tagged nonce),
  // which can never match a live finger (§8.1 fail-closed).
  const pendingFp = await pendingFingerprintMarker();

  const path = role === "CENTER_ADMIN" ? "/api/centeradmin/register" : "/api/invigilator/register";
  try {
    const r = await fetch(`${EDGE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        centerId: body.centerId,
        fullName: body.fullName.trim(),
        faceEmbeddingHash: body.faceEmbeddingHash.toLowerCase(),
        fingerprintTemplate: pendingFp,
        boundIp: null,          // bound at the centre during activation
        boundTerminalId: null,  // bound at the centre during activation
      }),
    });
    const json = await r.json();
    if (!r.ok) {
      return NextResponse.json({ ok: false, reason: json.reason ?? `EDGE_${r.status}` }, { status: r.status });
    }
    return NextResponse.json({
      ok: true,
      requestId: json.requestId,
      status: json.status ?? "PENDING_APPROVAL",
      approver: role === "CENTER_ADMIN" ? "SYSTEM_ADMIN" : "CENTER_ADMIN",
    });
  } catch {
    return NextResponse.json(
      { ok: false, reason: "HQ_EDGE_RELAY_UNAVAILABLE" },
      { status: 503 },
    );
  }
}

async function pendingFingerprintMarker(): Promise<string> {
  const tag = `ZUUP-FP-ENROL-PENDING:${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tag));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
