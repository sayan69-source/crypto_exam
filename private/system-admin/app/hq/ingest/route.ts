/**
 * POST /hq/ingest — the HQ decrypt boundary (§11.4, §13.5).
 *
 * Deliberately NOT under /api/* : every /api/* path is proxied to a centre
 * Edge (see next.config.ts), and this route must never be servable by — or
 * confused with — anything a centre runs. It executes inside the System Admin
 * portal's own server process, which is the HSM stand-in: the private key is
 * read from THIS process's environment and never appears in any response,
 * any log, or any centre-bound request.
 *
 * Input:  a §13.4 sync bundle (the centre's ciphertext-only export).
 * Output: the verification step trail + decrypted records + NO-PII anchors.
 * Fail-closed: a bundle that fails any integrity check decrypts nothing.
 */
import { NextResponse } from "next/server";
import { ingestBundle, type SyncBundle } from "../../../lib/vault";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  // .env files commonly store PEMs with literal \n — normalise either form.
  const pem = (process.env.HQ_PRIVATE_KEY_PEM ?? "").replace(/\\n/g, "\n").trim();
  if (!pem) {
    return NextResponse.json(
      { ok: false, reason: "HQ_KEY_NOT_PROVISIONED", hint: "set HQ_PRIVATE_KEY_PEM for this portal process (HSM stand-in)" },
      { status: 503 },
    );
  }

  let bundle: SyncBundle;
  try {
    bundle = (await req.json()) as SyncBundle;
  } catch {
    return NextResponse.json({ ok: false, reason: "BAD_JSON" }, { status: 400 });
  }
  if (!bundle?.manifest?.records || !bundle.manifestHash || !bundle.nodeSig || !bundle.nodePubkey) {
    return NextResponse.json({ ok: false, reason: "NOT_A_SYNC_BUNDLE" }, { status: 400 });
  }

  const result = ingestBundle(bundle, pem);
  // 422: the bundle was well-formed but failed an integrity check — the step
  // trail says exactly which one, so the operator can raise it with the centre.
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
