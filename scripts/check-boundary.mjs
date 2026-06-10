#!/usr/bin/env node
/**
 * Boundary gate (§14): private/** runtime code MUST NOT import public/** code.
 *
 * The public/ ↔ private/ split is load-bearing. The only data allowed to cross
 * it is (a) the public blockchain anchor and (b) the offline encrypted answer
 * bundle handled by the System Admin tier — never a code/API/DB import.
 *
 * This is the runnable enforcement for Runbook step A1 [check: lint]. It scans
 * every source file under private/ and fails the build if any import or require
 * specifier reaches into the public/ tree.
 *
 * Shared *presentational* UI is allowed via the packages/exam-ui workspace,
 * which contains no secrets, no API calls, and no business logic.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PRIVATE_DIR = join(ROOT, "private");

const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([
  "node_modules", ".next", ".turbo", "dist", "build", "out", ".git",
]);

// Captures the specifier string from: import ... from "x"; import "x";
// require("x"); import("x").
const SPEC_RE =
  /(?:import\s[^'"]*?from\s*|import\s*|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
// A specifier "reaches into public/" if `public/` appears preceded by start
// or a slash (so `some-public/x` is NOT a violation, `../../public/x` is).
const FORBIDDEN = /(^|\/)public\//;

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXTS.has(p.slice(p.lastIndexOf(".")))) out.push(p);
  }
}

const files = [];
walk(PRIVATE_DIR, files);

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    SPEC_RE.lastIndex = 0;
    let m;
    while ((m = SPEC_RE.exec(line)) !== null) {
      const spec = m[1].replace(/\\/g, "/");
      if (FORBIDDEN.test(spec)) {
        violations.push({ file: relative(ROOT, file), line: i + 1, spec });
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    "✗ BOUNDARY VIOLATION — private/** must not import public/** runtime code (§14):",
  );
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}  imports "${v.spec}"`);
  }
  process.exit(1);
}

console.log(
  `✓ boundary clean — scanned ${files.length} private source files, 0 imports of public/**.`,
);
