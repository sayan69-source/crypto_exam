/**
 * Guard: no CRLF in a file Linux has to execute.
 *
 * `.gitattributes` pins everything to LF *in the repository*, which is the right
 * policy and does not help here — `image-build/docker-build.sh` mounts the
 * WORKING TREE into the builder container, so what runs is whatever is on disk
 * right now. A shell script that picked up CRLF from a Windows-side edit fails
 * inside the container with `syntax error near unexpected token $'do\r'`, tens
 * of minutes into a build, having already compiled a kernel.
 *
 * That is exactly what happened on 2026-08-17: a scripted edit to
 * 20-stage-rootfs.sh rewrote it with CRLF, and nothing would have caught it
 * until the next full build died in stage 20.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// Files a Linux kernel, shell or systemd will read. A .md with CRLF is
// cosmetic; a .sh with CRLF is a broken image.
const EXECUTED = /\.(sh|service|target|mount|network|conf|nft|fstab|rules|cfg)$/;

// Pre-existing and not on the terminal image's execution path. Listed rather
// than silently skipped so the exemption is visible.
const ALLOW = new Set(["public/nginx.conf"]);

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => f && EXECUTED.test(f) && !ALLOW.has(f));

const bad = [];
for (const f of files) {
  let buf;
  try {
    buf = readFileSync(f);
  } catch {
    continue; // deleted in the working tree; git ls-files still lists it
  }
  if (buf.includes("\r\n")) bad.push(f);
}

if (bad.length) {
  console.error("  FAIL  crlf-in-executed-file");
  for (const f of bad) console.error(`        ${f}`);
  console.error(
    "\n  These are read by Linux at build or boot time. CRLF makes a shell script\n" +
      "  fail with `syntax error near unexpected token $'do\\r'` and a systemd unit\n" +
      "  parse wrongly. Convert to LF before building an image.",
  );
  process.exit(1);
}

console.log(`  ok    crlf-in-executed-file  (${files.length} executed files scanned)`);
