/**
 * Candidate DOB-as-password hashing (§9.7). DOB is the last, low-entropy gate
 * BEHIND the invigilator's in-person face+fingerprint check (§9.5) and the seat
 * binding (INV-5). It is Argon2id-hashed and rate-limited, and is only ever
 * useful inside the live, assigned, LAN-only session. We normalise to digits so
 * "2005-03-14", "14/03/2005", "14 03 2005" all hash equivalently.
 */
import { argonHash, argonVerify, type ArgonParams, DEFAULT_ARGON } from "./argon-hash.ts";

const digitsOnly = (dob: string): string => dob.replace(/\D/g, "");

export function hashDob(dob: string, params: ArgonParams = DEFAULT_ARGON): Uint8Array {
  return argonHash(digitsOnly(dob), params);
}

export function verifyDob(dob: string, storedBytes: Uint8Array): boolean {
  return argonVerify(digitsOnly(dob), storedBytes);
}
