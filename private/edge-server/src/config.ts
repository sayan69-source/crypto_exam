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

/** Read a 32-byte secret from a hex env var, or generate a random one (dev). */
function secret(name: string): Uint8Array {
  const hex = process.env[name];
  if (hex && hex.length >= 32) return new Uint8Array(Buffer.from(hex, "hex"));
  return new Uint8Array(randomBytes(32)); // ephemeral, per-boot (dev/test)
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
    systemAdminPublicKeyPem: process.env.SYSTEM_ADMIN_PUBLIC_KEY_PEM ?? null,
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
