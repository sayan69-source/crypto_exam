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
import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { ingestBundle, type SyncBundle } from "../../../lib/vault";

export const runtime = "nodejs";

/**
 * The HSM stand-in's key material. `HQ_PRIVATE_KEY_PEM_FILE` is the form a
 * deployment can actually use — a PKCS#8 PEM is multi-line, which neither a
 * systemd `Environment=` nor a plain `.env` line carries intact. The inline
 * variable stays supported (with `\n` escapes normalised) so nothing that
 * already set it breaks.
 */
function hqPrivateKey(): string {
  const path = process.env.HQ_PRIVATE_KEY_PEM_FILE;
  if (path) {
    try {
      return readFileSync(path, "utf8").trim();
    } catch {
      return ""; // treated as not provisioned below — never leak the path in a response
    }
  }
  return (process.env.HQ_PRIVATE_KEY_PEM ?? "").replace(/\\n/g, "\n").trim();
}

/**
 * The centre signing keys this HQ recognises, registered at provisioning.
 *
 * `{"<centreId>": "<64-hex ed25519 pubkey>", …}`, from `HQ_CENTRE_NODE_KEYS` or a
 * path in `HQ_CENTRE_NODE_KEYS_FILE`.
 *
 * Without a registry, `ingestBundle` had to verify the centre's signature using
 * the public key carried INSIDE the bundle it was authenticating — which proves
 * only that the sender owns a keypair. Anyone who could deliver a bundle to HQ
 * could forge one, and HQ would then anchor the forger's key on-chain as the
 * centre's. This registry must be populated over a channel that is NOT the
 * channel the bundle travels on.
 */
function centreNodeKeys(): Map<string, Uint8Array> {
  const path = process.env.HQ_CENTRE_NODE_KEYS_FILE;
  let raw = "";
  if (path) {
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return new Map(); // treated as not provisioned — never leak the path
    }
  } else {
    raw = process.env.HQ_CENTRE_NODE_KEYS ?? "";
  }
  if (!raw.trim()) return new Map();

  const out = new Map<string, Uint8Array>();
  try {
    for (const [centreId, hex] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
      if (!/^[0-9a-fA-F]{64}$/.test(hex)) continue; // a malformed key is no key
      out.set(centreId, Uint8Array.from(Buffer.from(hex, "hex")));
    }
  } catch {
    return new Map();
  }
  return out;
}

export async function POST(req: Request): Promise<NextResponse> {
  const pem = hqPrivateKey();
  if (!pem) {
    return NextResponse.json(
      { ok: false, reason: "HQ_KEY_NOT_PROVISIONED", hint: "set HQ_PRIVATE_KEY_PEM_FILE (or HQ_PRIVATE_KEY_PEM) for this portal process (HSM stand-in)" },
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

  // Fail closed: with no registry every signature would have to be checked
  // against a key the sender chose, which is not a check at all.
  const centreKeys = centreNodeKeys();
  if (centreKeys.size === 0) {
    return NextResponse.json(
      {
        ok: false,
        reason: "CENTRE_KEYS_NOT_PROVISIONED",
        hint: "set HQ_CENTRE_NODE_KEYS_FILE (or HQ_CENTRE_NODE_KEYS) to {\"<centreId>\":\"<64-hex ed25519 pubkey>\"} collected during provisioning",
      },
      { status: 503 },
    );
  }

  const result = ingestBundle(bundle, pem, centreKeys);
  // 422: the bundle was well-formed but failed an integrity check — the step
  // trail says exactly which one, so the operator can raise it with the centre.
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
