#!/usr/bin/env node
/**
 * Guard against the defect class this project keeps producing: code that looks
 * finished and does nothing, or reports something it never checked.
 *
 * Every rule below exists because the exact thing it forbids shipped at least
 * once, and was found by a person reading the screen rather than by a test:
 *
 *   - eight buttons that rendered with no handler, including all three setter
 *     "Finalize & Lock" actions and the public audit's "Verify Inclusion"
 *   - a fabricated Polygon transaction hash, called "believable" in its own
 *     comment, on the page whose claim is that anyone can check the chain
 *   - five contact addresses on domains that cannot exist (".core" is not a TLD)
 *   - readiness checks written as `Math.random() > 0.05`, telling candidates
 *     their webcam and clock were fine without examining either
 *   - USE_MOCK defaulting to ON, so a deploy that forgot one variable would
 *     have served fixtures to real users while looking entirely normal
 *
 * None of these are caught by tsc, by a build, or by a unit test. They are
 * caught by grep — which is what this is.
 *
 *   node scripts/check-no-fakes.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const FRONTEND = join(ROOT, "public", "frontend");

let failures = 0;
const fail = (rule, where, detail) => {
  failures++;
  console.log(`  FAIL  ${rule}\n        ${where}\n        ${detail}`);
};
const pass = (rule, note) => console.log(`  ok    ${rule}${note ? `  (${note})` : ""}`);

/**
 * Blank out comments, preserving line numbers.
 *
 * Without this the guard flags its own explanations: a comment recording that
 * `Math.random() > 0.05` used to decide a readiness check reads identically to
 * the defect itself. These rules must match CODE, never prose about code.
 * Replacing each comment with the same number of newlines keeps reported line
 * numbers pointing at the real line.
 */
function stripComments(src, lang) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  if (lang === "py") {
    return src
      .replace(/"""[\s\S]*?"""/g, blank)
      .replace(/'''[\s\S]*?'''/g, blank)
      .replace(/#[^\n]*/g, blank);
  }
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)   // block and JSX comments
    .replace(/\/\/[^\n]*/g, blank);        // line comments
}

// Build output is skipped by name, not just by extension: `image-build/out`
// holds an unpacked kernel tree whose ~80k files include paths this process
// cannot stat at all — and an unhandled EACCES there would take the whole guard
// down, which reads as "checks passed" to anyone not watching the exit code.
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "out", "dist", "build", "__pycache__"]);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let stats;
    try { stats = statSync(p); } catch { continue; }
    if (stats.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const tsxFiles = walk(FRONTEND).filter((f) => f.endsWith(".tsx"));
const rel = (f) => relative(ROOT, f).split(sep).join("/");
const lineOf = (src, index) => src.slice(0, index).split("\n").length;

/**
 * Split on either line ending.
 *
 * A trailing \r is a LINE TERMINATOR to a JS regex, so `.` will not match it and
 * `$` will not step over it: any rule anchored with `$` matches nothing at all
 * on a CRLF file, and the checker then reports "ok" having read zero lines. The
 * rules below happen to be unanchored, so this is prevention rather than a fix —
 * but the sibling check-no-secrets did exactly this, passing clean on Windows
 * while finding real lines on the Linux runner.
 */
const lines = (src) => src.split(/\r?\n/);

// ── 1. Controls that render and do nothing ──────────────────────────────────
{
  let dead = 0;
  for (const file of tsxFiles) {
    // The shared <Button> spreads {...props}, so a handler passes through it.
    if (file.endsWith(join("components", "ui", "Button.tsx"))) continue;
    const src = stripComments(readFileSync(file, "utf8"), "ts");
    const re = /<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g;
    let m;
    while ((m = re.exec(src))) {
      const [attrs, inner] = [m[1], m[2]];
      if (/onClick|type=["{']?submit/.test(attrs)) continue;
      // A button wrapped in <Link> navigates — that is a real action.
      if (/<Link\b[^>]*>\s*$/.test(src.slice(Math.max(0, m.index - 120), m.index))) continue;
      const label = inner.replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "").trim();
      if (!label) continue;
      fail("dead-button", `${rel(file)}:${lineOf(src, m.index)}`,
        `"${label.slice(0, 50)}" has no onClick and is not a submit`);
      dead++;
    }
  }
  if (!dead) pass("dead-button", `${tsxFiles.length} components scanned`);
}

// ── 2. Contact details that cannot receive mail ─────────────────────────────
{
  let bad = 0;
  for (const file of tsxFiles) {
    const src = stripComments(readFileSync(file, "utf8"), "ts");
    lines(src).forEach((line, i) => {
      const m = line.match(/mailto:[^"'`\s)]+@([a-z0-9.-]+)/i);
      if (!m) return;
      const domain = m[1].toLowerCase();
      if (/\.core$/.test(domain) || domain === "cryptoexamcore.in") {
        fail("unreachable-contact", `${rel(file)}:${i + 1}`,
          `mailto: on ${domain}, which cannot receive mail`);
        bad++;
      }
    });
  }
  if (!bad) pass("unreachable-contact");
}

// ── 3. Values shaped like real artifacts, invented ──────────────────────────
{
  const SUSPECT = [
    [/\bbelievable\b[^\n]*\b(hash|tx|transaction|proof)\b/i,
      "a value described as 'believable' is a forgery by another name"],
    [/Math\.random\(\)\s*[<>]/,
      "a pass/fail decided by Math.random is a fabricated result"],
  ];
  let bad = 0;
  for (const file of tsxFiles) {
    const src = stripComments(readFileSync(file, "utf8"), "ts");
    lines(src).forEach((line, i) => {
      // Cosmetic randomness is fine — timing, jitter, decoration.
      if (/delay|duration|jitter|shimmer|particle|sparkle|animation|opacity/i.test(line)) return;
      for (const [re, why] of SUSPECT) {
        if (re.test(line)) { fail("fabricated-value", `${rel(file)}:${i + 1}`, why); bad++; }
      }
    });
  }
  if (!bad) pass("fabricated-value");
}

// ── 4. Mock data must never be the default ──────────────────────────────────
{
  const client = join(FRONTEND, "lib", "api", "client.ts");
  const src = readFileSync(client, "utf8");
  const line = lines(src).find((l) => l.includes("const USE_MOCK"));
  if (!line || !line.includes("=== 'true'")) {
    fail("mock-opt-in", rel(client),
      "USE_MOCK must be opt-IN (=== 'true'). Defaulting it on means a deploy that " +
      "forgets NEXT_PUBLIC_USE_MOCK serves fixtures to real users.");
  } else {
    pass("mock-opt-in");
  }
}

// ── 5. Biometrics must be captured and signed, never stated ─────────────────
//
// Every portal in private/ once logged in by POSTing its own factors:
//
//     { faceScore: 0.95, fpScore: 0.9, tpmValid: true, elapsedMs: 1200 }
//
// and the invigilator console checked candidates in with the same two constants
// for all 487 of them. A page that can name a biometric score is a page that
// decides one. The scores now arrive inside an envelope signed by the on-device
// daemon, and no client code has any business writing these identifiers.
//
// Scoped to private/** (the ZUUP-OS portals). The public website is a different
// stack with its own WebAuthn/face-api flow.
{
  // The three ZUUP-OS portals — the client surfaces that talk to the Edge.
  const PORTALS = ["exam-terminal", "centre-admin", "system-admin"].map((d) =>
    join(ROOT, "private", d),
  );
  const CLIENT_FORBIDDEN = [
    [/\b(faceScore|fpScore|faceScoreBp|fpScoreBp)\s*[:=]/,
      "a biometric score written in client code is a score the client decides"],
    [/\btpmValid\s*[:=]/,
      "attestation is a server-side fact; a client cannot assert its own TPM"],
    [/\bfingerprintMatch\s*[:=]/,
      "whether a fingerprint matched is measured by the daemon, not declared"],
    [/SIMULATE_BIOMETRICS/,
      "a simulation switch is one deploy away from being the login path"],
  ];
  const files = PORTALS.flatMap((dir) => walk(dir)).filter(
    (f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith(".test.ts"),
  );
  let bad = 0;
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"), "ts");
    lines(src).forEach((line, i) => {
      for (const [re, why] of CLIENT_FORBIDDEN) {
        if (re.test(line)) { fail("client-asserted-biometric", `${rel(file)}:${i + 1}`, why); bad++; }
      }
    });
  }
  if (!bad) pass("client-asserted-biometric", `${files.length} private client files scanned`);
}

// ── 6. Health must be probed, not asserted ──────────────────────────────────
{
  let bad = 0;
  for (const f of ["app/main.py", "app/api/v1/admin.py"]) {
    const file = join(ROOT, "public", "backend", ...f.split("/"));
    let src;
    try { src = stripComments(readFileSync(file, "utf8"), "py"); } catch { continue; }
    lines(src).forEach((line, i) => {
      if (/"(redis|database|ipfs|blockchain)":\s*"(healthy|up|connected|ready|pending)"/.test(line)) {
        fail("asserted-health", `${rel(file)}:${i + 1}`,
          `${line.trim()} — report what a probe returned, not a literal`);
        bad++;
      }
    });
  }
  if (!bad) pass("asserted-health");
}

console.log();
if (failures) {
  console.log(`${failures} problem(s). Each rule here exists because that defect shipped once.`);
  process.exit(1);
}
console.log("No fabricated values, dead controls or unreachable contacts found.");
