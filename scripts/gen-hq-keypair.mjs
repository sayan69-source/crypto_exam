/**
 * Dev-only HQ keypair generator (§11.2). Produces the RSA-4096 pair that
 * stands in for the HQ HSM during development:
 *
 *   PUBLIC  half → Edge env  SYSTEM_ADMIN_PUBLIC_KEY_PEM  (seals answers)
 *   PRIVATE half → portal env HQ_PRIVATE_KEY_PEM          (opens at HQ only)
 *
 * In production neither variable exists: the public key ships inside the
 * signed OS image and the private key is generated INSIDE the HSM, non-
 * exportable. This script must never run on a production host.
 *
 *   node scripts/gen-hq-keypair.mjs            # print both PEMs
 *   node scripts/gen-hq-keypair.mjs --env      # print as single-line env vars
 */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 4096,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

if (process.argv.includes("--env")) {
  const esc = (p) => p.trim().replace(/\n/g, "\\n");
  console.log(`SYSTEM_ADMIN_PUBLIC_KEY_PEM="${esc(publicKey)}"`);
  console.log("");
  console.log(`HQ_PRIVATE_KEY_PEM="${esc(privateKey)}"`);
} else {
  console.log("── Edge (.env): SYSTEM_ADMIN_PUBLIC_KEY_PEM ──────────────────");
  console.log(publicKey);
  console.log("── System Admin portal (.env.local): HQ_PRIVATE_KEY_PEM ──────");
  console.log(privateKey);
}
