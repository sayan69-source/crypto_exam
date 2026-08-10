/**
 * Edge Server configuration (§6, §13).
 *
 * The Edge is LAN-only. It binds to the centre VLAN interface and has NO route
 * to the public internet (enforced below the app by nftables + routing, §6).
 * This module only reads env; it never reaches out.
 */
export interface EdgeConfig {
  /** Bind host — the centre VLAN address. Default loopback for dev/tests. */
  host: string;
  port: number;
  /** PostgreSQL DSN for the centre-scoped local DB (§12). */
  databaseUrl: string;
  /** This centre's id (UUID). Every query is scoped to it. */
  centreId: string;
  /**
   * Shared secret for the HQ→Edge pre-exam provisioning link (§12). HQ presents
   * it as `x-provisioning-key` when pushing the centre's enrolment bundle BEFORE
   * exam day. Null disables the ingest endpoint (fail-closed).
   */
  provisioningKey: string | null;
  /**
   * System Admin answer-sealing PUBLIC key (PEM, SPKI). Ships in the signed
   * image / Edge config so terminals can seal to it. The matching PRIVATE key
   * lives ONLY in the HQ HSM (INV-6). The Edge never holds a private key.
   */
  systemAdminPublicKeyPem: string | null;
  /** Argon2id cost parameters for one-time codes and DOB hashing (§9.4). */
  argon: { timeCost: number; memoryCostKiB: number; parallelism: number };
  /** HMAC key for privileged session tokens (§9.8). 32 bytes. */
  tokenSecret: Uint8Array;
  /** HMAC key for one-shot seat bind tokens (§9.6). 32 bytes. Never leaves Edge. */
  bindSecret: Uint8Array;
  /**
   * Seed for the centre-node root-signing key (§11.3 `TPM_sign` stand-in,
   * lib/node-sign.ts). On real hardware the TPM holds this; here it ships in
   * the Edge's sealed config. 32 bytes.
   */
  nodeSignSeed: Uint8Array;
}

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Read a PEM from `<NAME>` directly, or from the path in `<NAME>_FILE`.
 *
 * A PEM is multi-line, which is exactly what neither `Environment=` in a
 * systemd unit nor a plain `.env` line can carry — both flatten or truncate it,
 * and a half-read key fails at first use with an opaque parse error. The
 * `_FILE` form is the standard way out (same convention Docker secrets use):
 * the deployment mounts the file and passes a path.
 *
 * `\n` escapes are also normalised, so a PEM pasted into a `.env` still works.
 */
function pem(name: string): string | null {
  const path = process.env[`${name}_FILE`];
  if (path) {
    try {
      return readFileSync(path, "utf8").trim();
    } catch (e) {
      // Loud, not silent: a missing key file means the answer pipeline is dead,
      // and "returns 503 forever" is far harder to diagnose than one line here.
      throw new Error(`${name}_FILE set to ${path} but unreadable: ${(e as Error).message}`);
    }
  }
  const inline = process.env[name];
  return inline ? inline.replace(/\\n/g, "\n").trim() : null;
}

/**
 * True when this Edge is serving a real exam, and must therefore fail closed
 * on a missing secret rather than inventing one.
 *
 * Explicit `ZUUP_ENV` wins so a container can say what it is without depending
 * on `NODE_ENV`, which build tools set for their own reasons.
 */
function isProduction(): boolean {
  const explicit = process.env.ZUUP_ENV;
  if (explicit) return explicit === "production";
  return process.env.NODE_ENV === "production";
}

/**
 * Read a 32-byte secret from a hex env var.
 *
 * The length check MUST be on the decoded key, not the string. `Buffer.from(s,
 * "hex")` does not throw on non-hex input — it stops at the first bad pair and
 * returns however many bytes it managed, so the previous `hex.length >= 32`
 * test accepted a 33-character passphrase (exactly what an operator would
 * naturally write) and produced a **zero-byte** HMAC key. Every session token
 * in the estate was then forgeable by anyone, for any role, with no secret at
 * all. A 32-hex-char value was likewise accepted as a silent 128-bit key.
 *
 * `node-sign.ts` already refuses a seed that is not exactly 32 bytes; this
 * guards more and should be at least as strict.
 */
function secret(name: string): Uint8Array {
  const raw = process.env[name];
  if (!raw) {
    if (isProduction()) {
      throw new Error(
        `Missing required secret ${name}. Set it to exactly 64 hex characters ` +
          `(32 bytes), e.g. \`openssl rand -hex 32\`.`,
      );
    }
    // Dev/test convenience. Sessions do not survive a restart, which is
    // annoying rather than dangerous — and it is announced, because silently
    // inventing a key is how a production deploy with an unmounted config file
    // came to look healthy.
    console.warn(`[edge] ${name} is unset — using an EPHEMERAL per-boot secret (dev only).`);
    return new Uint8Array(randomBytes(32));
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      `${name} must be exactly 64 hex characters (32 bytes); got ${raw.length} ` +
        `character(s). A passphrase is not hex — generate one with \`openssl rand -hex 32\`.`,
    );
  }
  return new Uint8Array(Buffer.from(raw, "hex"));
}

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env ${name}`);
  }
  return v;
}

export function loadConfig(): EdgeConfig {
  return {
    host: env("EDGE_HOST", "127.0.0.1"),
    port: Number(env("EDGE_PORT", "4000")),
    databaseUrl: env(
      "DATABASE_URL",
      "postgres://zuup:zuup@127.0.0.1:5433/zuup_edge",
    ),
    centreId: env("CENTRE_ID", "00000000-0000-0000-0000-000000000000"),
    provisioningKey: process.env.EDGE_PROVISIONING_KEY ?? null,
    systemAdminPublicKeyPem: pem("SYSTEM_ADMIN_PUBLIC_KEY_PEM"),
    argon: {
      timeCost: Number(env("ARGON_TIME_COST", "3")),
      memoryCostKiB: Number(env("ARGON_MEMORY_KIB", "65536")),
      parallelism: Number(env("ARGON_PARALLELISM", "1")),
    },
    tokenSecret: secret("EDGE_TOKEN_SECRET"),
    bindSecret: secret("EDGE_BIND_SECRET"),
    nodeSignSeed: secret("EDGE_NODE_SIGN_SEED"),
  };
}
