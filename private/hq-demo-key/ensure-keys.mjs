/**
 * Create the demo HQ keypair if it is not already on this machine.
 *
 * The keys are deliberately NOT committed: the repo's .gitignore drops `*.pem`,
 * and a private key in a public repo is both bad practice and something host
 * secret-scanners block outright. But the answer pipeline is unreachable
 * without one — the Edge answers SEALING_KEY_NOT_PROVISIONED and no candidate
 * can submit — so "not committed" must not mean "not there". Every path that
 * needs the pair calls this first, which makes a fresh clone work with no
 * manual step while keeping the private half off the wire.
 *
 * Idempotent: if both files exist it does nothing, so it can be wired into a
 * build script or a test without regenerating keys under a running demo (which
 * would invalidate any already-exported sync bundle).
 *
 *   node private/hq-demo-key/ensure-keys.mjs
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PUBLIC_PEM = join(HERE, "hq-demo-public.pem");
export const PRIVATE_PEM = join(HERE, "hq-demo-private.pem");

/** @returns {"created"|"present"} */
export function ensureDemoKeypair() {
  // Both or neither: a lone public half is the failure this whole file exists
  // to prevent — it looks provisioned, seals fine, and nothing can ever open it.
  if (existsSync(PUBLIC_PEM) && existsSync(PRIVATE_PEM)) return "present";

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096, // §11.2 — RSA-OAEP/SHA-256 wrap of the per-record data key
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  writeFileSync(PUBLIC_PEM, publicKey);
  writeFileSync(PRIVATE_PEM, privateKey, { mode: 0o600 });
  return "created";
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("ensure-keys.mjs")) {
  const what = ensureDemoKeypair();
  console.log(
    what === "created"
      ? `[hq-demo-key] generated a fresh RSA-4096 demo keypair\n  public  → ${PUBLIC_PEM}\n  private → ${PRIVATE_PEM}`
      : `[hq-demo-key] keypair already present — left untouched`,
  );
}
