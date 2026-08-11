#!/usr/bin/env node
/**
 * Refuse to let a secret become a tracked file.
 *
 * The history of this repo is clean — no private key has ever been committed.
 * It came close once: `render.yaml` held the JWT signing key and the tier-0
 * admin credentials while sitting in the working tree, and was caught and
 * gitignored (f436094, e9a65e0) before any commit picked it up. That catch was
 * a person reading a file, which is not a control you can rely on twice.
 *
 * The asymmetry is the point. A secret that reaches a branch is compromised
 * whether or not a later commit removes it — it survives in the history and in
 * every clone, so the only fix is to rotate the key. A build that fails costs
 * two minutes. This fails the build.
 *
 * Two checks, both against `git ls-files` rather than the working tree: a
 * secret sitting on disk and correctly ignored is fine; a tracked one is not.
 *
 *   1. paths that are secrets by name   (*.pem, .env, render.local.yaml)
 *   2. secret-NAMED keys carrying a real value, in tracked config and docs
 *
 * Note on (2): it matches the key's name, never the value's shape. A private
 * key, a transaction hash and a Merkle root are all 32 bytes of hex, so a
 * `0x[0-9a-f]{64}` rule flags every deployment record this project publishes on
 * purpose — it fired on four public artifacts the first time it ran here.
 * `deployer_private_key:` is unambiguous in a way that its value never is.
 *
 *   node scripts/check-no-secrets.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let failures = 0;
const fail = (what, where, why) => {
  failures++;
  console.log(`  FAIL  ${what}\n        ${where}\n        ${why}`);
};

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

// ── 1. Files that are secrets by name ───────────────────────────────────────
const FORBIDDEN_PATHS = [
  [/\.(pem|key|p12|pfx|keystore|jks)$/i, "private key material"],
  [/(^|\/)\.env$/, "a real .env — commit .env.example instead"],
  [/(^|\/)\.env\.(?!example|template|sample)[a-z]+$/i, "an environment file with real values"],
  [/(^|\/)render\.local\.yaml$/, "the render config that holds real secrets"],
  [/(^|\/)id_(rsa|ecdsa|ed25519)$/, "an SSH private key"],
];

let named = 0;
for (const path of tracked) {
  for (const [re, why] of FORBIDDEN_PATHS) {
    if (re.test(path)) { fail("tracked-secret-file", path, why); named++; }
  }
}
if (!named) console.log(`  ok    tracked-secret-file  (${tracked.length} tracked paths)`);

// ── 2. Secret-named keys carrying a real value ──────────────────────────────
const SCANNABLE = /\.(ya?ml|md|json|example|template|toml|ini|cfg|sh)$/i;

// Named after the settings in app/config.py that must never be committed.
const SECRET_KEY_NAME =
  /(private_key|privatekey|secret|password|passwd|mnemonic|auth_token|access_token|api_key|apikey|enrolment_token|enrollment_token)/i;

// A name that merely POINTS at or DESCRIBES a secret is not one:
// JWT_PRIVATE_KEY_PATH is a filename, PUBLIC_KEY is public by definition, and
// `privateKeyEncoding` is an argument to Node's generateKeyPairSync.
const NOT_A_SECRET =
  /(_path|_file|_url|_id$|public_key|_name|encoding$|format$|type$|length$|algorithm$)/i;

// `KEY: value`, `KEY=value`, `"key": "value"` — capture the name and the value.
const ASSIGNMENT = /^[\s"'-]*([A-Za-z_][A-Za-z0-9_.-]*)"?\s*[:=]\s*(.*)$/;

// An example file exists to show the shape; placeholders are the point.
const PLACEHOLDER =
  /^$|(example|placeholder|your[-_ ]?|dummy|sample|xxx+|\.\.\.|<[^>]+>|\{\{|\$\{|\$\(|changeme|replace[-_ ]?me|redacted|generate|paste|fill|TODO|\bnull\b|\btrue\b|\bfalse\b|^0x0+$|^"?\s*"?$)/i;

/**
 * A credential is high-entropy by construction; a stand-in almost never is.
 *
 * Both false-positive shapes this hit on the real tree are caught here and
 * neither is caught by a word list: the documented SMTP example is the strict
 * run `abcdefghijklmnop`, and the all-in-one demo uses `111…aa` / `222…bb` so
 * that edge tokens survive a container restart. A generated App Password or a
 * random 32-byte hex key fails both tests.
 */
function looksGenerated(v) {
  const distinct = new Set(v.toLowerCase()).size;
  if (distinct <= 4) return false;                       // 111…aa, 222…bb, aaaa…
  const seq = [...v].every((c, i, a) => i === 0 || c.charCodeAt(0) === a[i - 1].charCodeAt(0) + 1);
  if (seq) return false;                                 // abcdefghijklmnop, 12345678
  return true;
}

// Unambiguous by shape — these prefixes are issued by one system each.
const HARD_SHAPES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "an inline PEM private key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "a GitHub token"],
  [/\bsk-[A-Za-z0-9]{20,}/, "an API secret key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key id"],
];

let shaped = 0;
for (const path of tracked) {
  if (!SCANNABLE.test(path)) continue;
  let src;
  try { src = readFileSync(path, "utf8"); } catch { continue; }

  // Render (and Compose, and k8s) split a variable across two lines:
  //
  //     - key: DEPLOYER_PRIVATE_KEY
  //       value: 0x5aa9…
  //
  // which is precisely the file that nearly leaked here. Reading line-by-line
  // sees only the names `key` and `value` and matches neither, so carry the
  // pending name forward to the line that actually holds the secret.
  let pendingName = null;
  let pendingLine = 0;

  src.split("\n").forEach((line, i) => {
    for (const [re, why] of HARD_SHAPES) {
      if (re.test(line)) { fail("secret-in-tracked-file", `${path}:${i + 1}`, why); shaped++; }
    }

    const m = line.match(ASSIGNMENT);
    if (!m) return;
    let [, name, rawValue] = m;
    let reportLine = i + 1;

    const value = rawValue.replace(/#.*$/, "").trim().replace(/^["']|["'],?$/g, "").trim();

    if (/^(key|name)$/i.test(name)) {          // ` - key: DEPLOYER_PRIVATE_KEY`
      pendingName = value;
      pendingLine = i + 1;
      return;
    }
    if (/^value$/i.test(name)) {               // `   value: 0x5aa9…`
      if (!pendingName) return;
      name = pendingName;
      reportLine = pendingLine;
      pendingName = null;
    }

    if (!SECRET_KEY_NAME.test(name) || NOT_A_SECRET.test(name)) return;
    if (PLACEHOLDER.test(value)) return;
    if (value.length < 8) return;      // too short to be a live credential
    if (!looksGenerated(value)) return; // a stand-in, not a generated secret

    fail("secret-in-tracked-file", `${path}:${reportLine}`,
      `${name} is set to a real-looking value (${value.length} chars) — use a placeholder`);
    shaped++;
  });
}
if (!shaped) console.log("  ok    secret-in-tracked-file");

console.log();
if (failures) {
  console.log(
    `${failures} problem(s). A secret that reaches a branch is compromised even if a later\n` +
    "commit removes it — it stays in the history and in every clone. Rotate the credential,\n" +
    "then untrack the file (git rm --cached <path>) and add it to .gitignore.",
  );
  process.exit(1);
}
console.log("No secrets tracked by git.");
