/**
 * Centre-node root signing (§11.3): `sig_n = TPM_sign(centre_node, root_n)`.
 *
 * On production hardware this is the TPM 2.0 (or ATECC608A) signing the rolling
 * chain root so the centre node attests every commitment. This module is the
 * software stand-in with the SAME interface and verifiable output: Ed25519 over
 * the root, keyed from a 32-byte seed that ships in the Edge's sealed config.
 * The verify side (HQ, auditors, candidates checking receipts) only ever needs
 * the public key, which is published per centre.
 */
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

// Fixed DER scaffolding for raw Ed25519 keys (RFC 8410).
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface NodeSigner {
  /** Sign a chain root. 64-byte Ed25519 signature. */
  signRoot(root: Uint8Array): Uint8Array;
  /** Raw 32-byte public key (hex-published per centre). */
  publicKey: Uint8Array;
}

export function makeNodeSigner(seed32: Uint8Array): NodeSigner {
  if (seed32.length !== 32) throw new Error("node sign seed must be 32 bytes");
  const priv = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed32)]),
    format: "der",
    type: "pkcs8",
  });
  const pubDer = createPublicKey(priv).export({ format: "der", type: "spki" }) as Buffer;
  const publicKey = new Uint8Array(pubDer.subarray(pubDer.length - 32));
  return {
    publicKey,
    signRoot: (root) => new Uint8Array(sign(null, Buffer.from(root), priv)),
  };
}

/** Verify a node signature over a root, given the raw 32-byte public key. */
export function verifyRootSig(publicKey32: Uint8Array, root: Uint8Array, sig: Uint8Array): boolean {
  if (publicKey32.length !== 32 || sig.length !== 64) return false;
  const pub: KeyObject = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey32)]),
    format: "der",
    type: "spki",
  });
  return verify(null, Buffer.from(root), pub, Buffer.from(sig));
}
