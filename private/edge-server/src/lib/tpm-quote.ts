/**
 * TPM 2.0 quote verification (§7.1) — the real TPM factor of the §8.2 match-all
 * rule.
 *
 * What the Edge used to do was compare a JSON blob of PCR values to a stored
 * one. That is not attestation. PCR values are not secret: they are the same on
 * every correctly-built terminal in the estate, and any machine on the LAN could
 * read one terminal's values and POST them for another. The check proved that
 * SOMEONE knew the golden measurements, never that THIS machine had just booted
 * them.
 *
 * A TPM quote is different in one decisive way: the TPM signs, with a restricted
 * Attestation Key that cannot leave the chip and cannot be used to sign
 * arbitrary data, a structure that the TPM itself filled in — containing the
 * digest of the current PCR values and a nonce we chose a moment ago. So a
 * verifying signature means:
 *
 *   • the quote came from the TPM whose AK we registered at commissioning
 *     (identity — not just "some TPM"),
 *   • it was produced after we issued the nonce (freshness — no replay of
 *     yesterday's good boot, no relay of the machine next door),
 *   • and the PCRs it covers are the ones we consider golden (integrity — the
 *     boot chain that ran is the boot chain we signed).
 *
 * All three are required. This module is pure: bytes in, verdict + failure list
 * out, no I/O, no database. `http.ts` decides what to do with the verdict and
 * `repo.ts` records it.
 *
 * Wire format (produced by boot/attest/zuup-attest.sh on the terminal):
 *
 *   tpm2_quote -c ak.ctx -l sha256:0,4,7,8,9,14 -q <nonce-hex> \
 *              -m quote.msg -s quote.sig -o pcrs.out -f plain
 *
 *   quote      = the raw TPMS_ATTEST bytes from -m
 *   signature  = the raw signature bytes from -s -f plain
 *   pcrs       = {"<index>": "<sha256 hex>"} read back with tpm2_pcrread
 */
import { createVerify, createPublicKey, type KeyObject } from "node:crypto";
import { constantTimeEqual, sha256, toHex } from "./crypto.ts";

/** TPMS_ATTEST.magic — "\xFFTCG". A structure without it never came from a TPM. */
const TPM_GENERATED_VALUE = 0xff544347;
/** TPM_ST_ATTEST_QUOTE. Any other attestation type answers a different question. */
const TPM_ST_ATTEST_QUOTE = 0x8018;
/** TPM_ALG_SHA256. SHA-1 banks are refused rather than tolerated. */
const TPM_ALG_SHA256 = 0x000b;
const SHA256_LEN = 32;

export interface QuoteSubmission {
  /** Raw TPMS_ATTEST bytes (`tpm2_quote -m`). */
  quote: Uint8Array;
  /** Raw signature over the quote (`tpm2_quote -s … -f plain`). */
  signature: Uint8Array;
  /** PCR index → sha256 digest hex, as read back from the same boot. */
  pcrs: Record<string, string>;
}

export interface QuoteExpectation {
  /** SPKI PEM of the terminal's registered Attestation Key (public half). */
  akPubkeyPem: string;
  /** The nonce this Edge issued for THIS attestation, one-shot. */
  nonce: Uint8Array;
  /** The commissioned golden PCR set: index → sha256 digest hex. */
  goldenPcr: Record<string, string> | null;
  /**
   * The FLEET reference for the image-determined PCRs — index → sha256 hex.
   *
   * Golden PCRs alone are trust-on-first-use. They are recorded from whatever
   * the machine measured at enrolment, so if a terminal was already carrying a
   * modified image at that moment, its measurements of that modified image
   * become its golden set and every later boot of the compromise verifies
   * perfectly, forever. The check proves the machine boots the same thing it
   * booted at enrolment — not that the thing is the image we signed.
   *
   * The split that fixes it follows the boot chain rather than the storage:
   *
   *   IMAGE-BOUND    PCR 4  the UKI's own hash, as the firmware measured it
   *                  PCR 11 systemd-stub's measurements of the kernel, initrd
   *                         and cmdline INSIDE that UKI
   *                  Identical on every correctly-built terminal in the estate,
   *                  and derivable from the signed artifact without booting
   *                  anything. Pinned here, fleet-wide.
   *
   *   MACHINE-BOUND  PCR 0  firmware code — differs per model and per firmware
   *                         revision
   *                  PCR 7  Secure Boot state — depends on the enrolled key set
   *                         and the vendor's own db entries
   *                  Cannot be predicted centrally, so these stay per-terminal
   *                  in `goldenPcr`, recorded at supervised enrolment.
   *
   * Null disables the fleet check and falls back to pure per-terminal matching,
   * which is the pre-existing behaviour — correct for the all-in-one, where one
   * self-commissioned laptop is the entire estate and there is no fleet to
   * reference.
   */
  fleetPcr?: Record<string, string> | null;
}

export interface QuoteVerdict {
  ok: boolean;
  /** Exact clauses that failed, for the audit row. Empty iff ok. */
  failures: string[];
  /** PCR indices the quote actually covered, ascending. */
  selectedPcrs: number[];
}

/** Parsed TPMS_ATTEST — only the fields a quote verification needs. */
export interface ParsedQuote {
  extraData: Uint8Array;
  pcrDigest: Uint8Array;
  selectedPcrs: number[];
}

/** Thrown for a structurally impossible quote; callers turn it into a failure. */
export class QuoteParseError extends Error {}

/**
 * Big-endian reader that refuses to run off the end.
 *
 * A hand-rolled parser over attacker-supplied bytes is exactly where a silent
 * short read turns into a spurious pass, so every accessor bounds-checks and
 * throws rather than returning a truncated value.
 */
class Reader {
  private off = 0;
  private readonly buf: Uint8Array;

  // Written out rather than as a parameter property: `node --test
  // --experimental-strip-types` runs this file without a compiler, and
  // strip-only mode cannot emit the assignment a parameter property implies.
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  private need(n: number): number {
    if (this.off + n > this.buf.length) {
      throw new QuoteParseError(`quote truncated: need ${n} bytes at offset ${this.off}`);
    }
    const at = this.off;
    this.off += n;
    return at;
  }

  // The `!`s below are load-bearing only for the type checker: `need()` has
  // already proved every one of these indices is inside the buffer.
  u8(): number {
    return this.buf[this.need(1)]!;
  }
  u16(): number {
    const a = this.need(2);
    return (this.buf[a]! << 8) | this.buf[a + 1]!;
  }
  u32(): number {
    const a = this.need(4);
    // `>>> 0` keeps the magic comparable as an unsigned value.
    return ((this.buf[a]! << 24) | (this.buf[a + 1]! << 16) | (this.buf[a + 2]! << 8) | this.buf[a + 3]!) >>> 0;
  }
  bytes(n: number): Uint8Array {
    return this.buf.subarray(this.need(n), this.off);
  }
  /** TPM2B_* — a UINT16 length followed by that many bytes. */
  sized(): Uint8Array {
    return this.bytes(this.u16());
  }
  skip(n: number): void {
    this.need(n);
  }
}

/**
 * Parse a TPMS_ATTEST containing a TPMS_QUOTE_INFO.
 *
 * Layout (TPM 2.0 Library Part 2, §10.12.8):
 *   UINT32            magic
 *   UINT16            type
 *   TPM2B_NAME        qualifiedSigner
 *   TPM2B_DATA        extraData          ← our nonce
 *   TPMS_CLOCK_INFO   clockInfo          (17 bytes)
 *   UINT64            firmwareVersion    (8 bytes)
 *   TPML_PCR_SELECTION pcrSelect
 *   TPM2B_DIGEST      pcrDigest
 */
export function parseQuote(quote: Uint8Array): ParsedQuote {
  const r = new Reader(quote);

  if (r.u32() !== TPM_GENERATED_VALUE) throw new QuoteParseError("not a TPM-generated structure");
  if (r.u16() !== TPM_ST_ATTEST_QUOTE) throw new QuoteParseError("attestation is not a quote");

  r.sized(); // qualifiedSigner — the AK's Name; the signature already binds identity
  const extraData = r.sized();
  r.skip(17); // clockInfo
  r.skip(8); // firmwareVersion

  const selectedPcrs: number[] = [];
  const selectionCount = r.u32();
  if (selectionCount === 0) throw new QuoteParseError("quote selects no PCR bank");
  if (selectionCount > 8) throw new QuoteParseError(`implausible PCR selection count ${selectionCount}`);
  for (let i = 0; i < selectionCount; i++) {
    const hashAlg = r.u16();
    const sizeOfSelect = r.u8();
    if (sizeOfSelect > 8) throw new QuoteParseError(`implausible PCR bitmap size ${sizeOfSelect}`);
    const bitmap = r.bytes(sizeOfSelect);
    if (hashAlg !== TPM_ALG_SHA256) {
      // A second bank (e.g. sha1) in the same quote is not an error in itself,
      // but we neither select nor accept it — leave it out of the digest order.
      continue;
    }
    for (let byte = 0; byte < bitmap.length; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        if (bitmap[byte]! & (1 << bit)) selectedPcrs.push(byte * 8 + bit);
      }
    }
  }
  selectedPcrs.sort((a, b) => a - b);

  const pcrDigest = r.sized();
  return { extraData, pcrDigest, selectedPcrs };
}

/**
 * The TPM's own digest rule: sha256 over the selected PCR values concatenated
 * in ascending index order. Recomputing it here is what ties the readable PCR
 * list to the single digest the TPM actually signed.
 */
export function pcrDigestOf(pcrs: Record<string, string>, selected: number[]): Uint8Array {
  const parts = selected.map((i) => {
    const hex = normaliseDigest(pcrs[String(i)]);
    if (hex === null) throw new QuoteParseError(`quote covers PCR ${i} but no value was submitted for it`);
    return Buffer.from(hex, "hex");
  });
  return sha256(...parts.map((p) => new Uint8Array(p)));
}

/**
 * Accept the shapes operators and tools actually produce — `0x` prefixes and
 * upper case — while refusing anything that is not a full sha256 digest. A
 * lenient reader here prevents a commissioning typo from silently becoming a
 * mismatch nobody can explain on exam morning; a lenient LENGTH would let a
 * short value compare equal to itself and prove nothing.
 */
function normaliseDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^0x/i, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** Verify the AK signature over the quote bytes. RSASSA or ECDSA, SHA-256. */
function signatureVerifies(quote: Uint8Array, signature: Uint8Array, key: KeyObject): boolean {
  // tpm2_quote's `-f plain` emits the bare signature: PKCS#1 v1.5 for an RSA AK
  // (tpm2_createak's default), or r‖s for an ECDSA one. `ieee-p1363` is how Node
  // is told to expect the latter; it is ignored for RSA keys.
  const attempt = (dsaEncoding: "ieee-p1363" | "der"): boolean => {
    try {
      const v = createVerify("sha256");
      v.update(quote);
      v.end();
      return v.verify({ key, dsaEncoding }, Buffer.from(signature));
    } catch {
      // A malformed signature makes OpenSSL throw rather than return false.
      return false;
    }
  };
  return attempt("ieee-p1363") || attempt("der");
}

/**
 * Verify a quote against a terminal's commissioned expectations.
 *
 * Fail-closed everywhere: a missing key, a missing golden set, an unparseable
 * quote and a bad signature are all denials, and each names itself so the audit
 * row says which clause failed rather than "attestation failed".
 */
export function verifyQuote(sub: QuoteSubmission, exp: QuoteExpectation): QuoteVerdict {
  const failures: string[] = [];

  if (!exp.akPubkeyPem) {
    // An uncommissioned terminal. There is no safe default: without a registered
    // AK there is nothing that could make this quote meaningful.
    return { ok: false, failures: ["NO_ATTESTATION_KEY_REGISTERED"], selectedPcrs: [] };
  }
  if (!exp.goldenPcr || Object.keys(exp.goldenPcr).length === 0) {
    return { ok: false, failures: ["NO_GOLDEN_PCR_REGISTERED"], selectedPcrs: [] };
  }

  let key: KeyObject;
  try {
    key = createPublicKey(exp.akPubkeyPem);
  } catch {
    return { ok: false, failures: ["ATTESTATION_KEY_UNREADABLE"], selectedPcrs: [] };
  }

  // Signature first: until it verifies, the quote's contents are just bytes an
  // unauthenticated caller sent us, and reasoning about them would be theatre.
  if (!signatureVerifies(sub.quote, sub.signature, key)) failures.push("QUOTE_SIGNATURE_INVALID");

  let parsed: ParsedQuote;
  try {
    parsed = parseQuote(sub.quote);
  } catch (e) {
    failures.push(e instanceof QuoteParseError ? "QUOTE_MALFORMED" : "QUOTE_UNPARSEABLE");
    return { ok: false, failures, selectedPcrs: [] };
  }

  // Freshness — the nonce we issued must be the nonce the TPM signed over.
  if (!constantTimeEqual(parsed.extraData, exp.nonce)) failures.push("QUOTE_NONCE_MISMATCH");

  // The quote must cover exactly the PCRs we commissioned: a terminal that
  // quotes only PCR 0 would otherwise pass while saying nothing about the
  // kernel, the initrd or the secure-boot state.
  const golden = Object.keys(exp.goldenPcr)
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  const covered = parsed.selectedPcrs;
  if (golden.length !== covered.length || golden.some((n, i) => n !== covered[i])) {
    failures.push("QUOTE_PCR_SELECTION_MISMATCH");
  }

  // The submitted values must hash to the digest inside the signed structure…
  try {
    if (!constantTimeEqual(pcrDigestOf(sub.pcrs, covered), parsed.pcrDigest)) {
      failures.push("QUOTE_PCR_DIGEST_MISMATCH");
    }
  } catch {
    failures.push("QUOTE_PCR_VALUES_INCOMPLETE");
  }

  // …and those values must be the expected ones.
  //
  // For an image-determined PCR the FLEET reference wins over what this machine
  // recorded at enrolment. That ordering is the whole point: a terminal enrolled
  // while already compromised would have recorded the compromise as its own
  // golden set, and comparing it only against itself would verify that forever.
  // Where a fleet value exists, the per-terminal one is not consulted at all.
  for (const index of golden) {
    const key = String(index);
    const fleet = exp.fleetPcr ? normaliseDigest(exp.fleetPcr[key]) : null;
    const want = fleet ?? normaliseDigest(exp.goldenPcr[key]);
    const got = normaliseDigest(sub.pcrs[key]);
    if (want === null) {
      failures.push(`GOLDEN_PCR_${index}_MALFORMED`);
      continue;
    }
    if (got === null || got !== want) {
      // Name which reference it failed against. "PCR 4 differs from the fleet"
      // is a tampered or mis-built image and affects every terminal; "PCR 0
      // differs from this machine's record" is one box whose firmware changed.
      // Sending an operator down the wrong one of those on exam morning costs
      // the whole hall.
      failures.push(fleet !== null ? `FLEET_PCR_${index}_MISMATCH` : `PCR_${index}_MISMATCH`);
    }
  }

  // A fleet reference that names a PCR the quote never covered is a
  // misconfiguration that would otherwise pass silently: the loop above only
  // walks the indices the terminal was commissioned with, so an image-bound PCR
  // missing from that set would simply never be checked.
  for (const key of Object.keys(exp.fleetPcr ?? {})) {
    if (!golden.includes(Number(key))) {
      failures.push(`FLEET_PCR_${key}_NOT_COMMISSIONED`);
    }
  }

  return { ok: failures.length === 0, failures, selectedPcrs: covered };
}

/** Hex of the digest a quote committed to — handy for audit rows. */
export const quoteDigestHex = (q: ParsedQuote): string => toHex(q.pcrDigest);
