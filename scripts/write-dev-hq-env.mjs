/**
 * Dev helper: (re)write the HQ dev keypair env wiring deterministically.
 *
 *   node scripts/write-dev-hq-env.mjs
 *
 * Produces:
 *   private/edge-server/.hq-pub.pem          — plain PEM the Edge launcher cats
 *   private/system-admin/.env.local          — HQ_PRIVATE_KEY_PEM single line (\n escaped)
 *
 * Re-uses the existing pair if both files are present (so the Edge and portal
 * stay in sync across restarts); pass --rotate to force a new pair.
 */
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pubPath = join(root, "private/edge-server/.hq-pub.pem");
const envPath = join(root, "private/system-admin/.env.local");

let publicKey, privateKey;

if (!process.argv.includes("--rotate") && existsSync(envPath) && existsSync(pubPath)) {
  const env = readFileSync(envPath, "utf8");
  const m = env.match(/HQ_PRIVATE_KEY_PEM="([\s\S]*?)"/);
  if (m) {
    privateKey = m[1].includes("\\n") ? m[1].replaceAll("\\n", "\n") : m[1];
    try {
      publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    } catch {
      privateKey = undefined; // unreadable — regenerate below
    }
  }
}

if (!privateKey) {
  ({ publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  }));
}

writeFileSync(pubPath, publicKey.trim() + "\n");
writeFileSync(
  envPath,
  [
    "EDGE_URL=http://127.0.0.1:4000",
    // single line, \n-escaped — the vault route normalises this form
    `HQ_PRIVATE_KEY_PEM="${privateKey.trim().replaceAll("\n", "\\n")}"`,
    "",
  ].join("\n"),
);
console.log("wrote", pubPath);
console.log("wrote", envPath, "(key matches the Edge public half)");
