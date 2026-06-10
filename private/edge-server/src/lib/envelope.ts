/**
 * Per-submission envelope encryption (§11.2). The terminal seals each answer
 * record to the SYSTEM ADMIN public key; it holds no private key, so neither
 * the terminal nor the Centre Admin store can ever read it (INV-6).
 *
 *   DK          = random 256-bit key                      (per submission)
 *   ct, iv, tag = AES-256-GCM(key=DK, plaintext=bytes(R)) (the sealed answer)
 *   wrapped_DK  = RSA-OAEP-SHA256(SystemAdminPubKey, DK)
 *   leaf        = SHA-256(ct || iv || tag || wrapped_DK)  (the hash-chain leaf)
 *
 * `open()` is the HQ-only inverse: it needs the System Admin PRIVATE key, which
 * lives only in the HSM. It is included here for the HQ ingest service and for
 * the INV-6 test; the Edge never calls it and never possesses the key.
 */
import {
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  privateDecrypt,
  constants,
  randomBytes,
} from "node:crypto";
import { sha256, utf8, canonicalJson } from "./crypto.ts";

export interface Sealed {
  ct: Uint8Array;
  iv: Uint8Array;
  tag: Uint8Array;
  wrappedDk: Uint8Array;
  leaf: Uint8Array;
}

/** Seal raw plaintext bytes to the System Admin public key (PEM SPKI). */
export function seal(plaintext: Uint8Array, systemAdminPubKeyPem: string): Sealed {
  const dk = randomBytes(32); // 256-bit data key, per submission
  const iv = randomBytes(12); // GCM nonce
  const cipher = createCipheriv("aes-256-gcm", dk, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrappedDk = publicEncrypt(
    { key: systemAdminPubKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    dk,
  );
  const leaf = sha256(
    new Uint8Array(ct),
    new Uint8Array(iv),
    new Uint8Array(tag),
    new Uint8Array(wrappedDk),
  );
  return {
    ct: new Uint8Array(ct),
    iv: new Uint8Array(iv),
    tag: new Uint8Array(tag),
    wrappedDk: new Uint8Array(wrappedDk),
    leaf,
  };
}

/** Convenience: seal a structured answer record R via canonical JSON. */
export function sealRecord(record: unknown, systemAdminPubKeyPem: string): Sealed {
  return seal(utf8.encode(canonicalJson(record)), systemAdminPubKeyPem);
}

/**
 * HQ HSM-side inverse (§11.4 steps 3–4). Unwrap DK with the System Admin
 * private key, then AES-GCM-open. Throws if the key is wrong or the ciphertext
 * was tampered (GCM tag mismatch). NEVER called on the Edge.
 */
export function open(sealed: Sealed, systemAdminPrivKeyPem: string): Uint8Array {
  const dk = privateDecrypt(
    { key: systemAdminPrivKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(sealed.wrappedDk),
  );
  const decipher = createDecipheriv("aes-256-gcm", dk, Buffer.from(sealed.iv));
  decipher.setAuthTag(Buffer.from(sealed.tag));
  const pt = Buffer.concat([decipher.update(Buffer.from(sealed.ct)), decipher.final()]);
  return new Uint8Array(pt);
}
