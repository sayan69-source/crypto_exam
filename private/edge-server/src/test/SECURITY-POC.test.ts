/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SECURITY PROOF-OF-CONCEPT SUITE  —  adversarial, not a regression suite.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ORIGINAL INTENT: every test asserted that an attack SUCCEEDS, so a passing
 * suite meant a vulnerable system and a fix would show up as a failure.
 *
 * STATUS 2026-08-10 — the fixes landed, so the tests were inverted rather than
 * deleted: `[FIXED]` cases now assert the attack is REFUSED, and several were
 * repointed at the real modules because they had been testing inline copies of
 * the old algorithms and would have kept passing forever.
 *
 * The cases WITHOUT `[FIXED]` still pass, and that is correct — they exercise a
 * pure function that was never the bug:
 *
 *   F2  `evaluateMatchAll` is correct in isolation and unchanged. The bug was
 *       the CALL SITE handing it request-body values. Every factor is now
 *       measured: the IP from the connection, the elapsed time from a nonce the
 *       Edge issued, the TPM from a verified quote (F2b), and the biometrics
 *       from a daemon-signed envelope (F2c). The wiring needs Fastify, which
 *       this hermetic suite deliberately avoids — see the integration tests —
 *       but the two verifiers it now depends on are pure and are exercised here
 *       and in tpm-quote.test.ts / bio-attest.test.ts.
 *   F3  `verifyToken` still only checks HMAC + expiry, by design. Revocation is
 *       enforced one layer up, in `auth()`, which re-loads the identity.
 *   F5  A hash chain genuinely cannot detect truncation — that is a true
 *       statement about the primitive, not a defect to fix. Detection comes
 *       from the manifest-count check (F5b) and pre-export anchoring.
 *   F8  `computeEntryHash` is a pure function; the fork was a missing advisory
 *       lock in `appendAudit`, which needs a database to exercise.
 *   F9  `Buffer.from(s,"hex")` still truncates — that is Node. The route now
 *       uses `hexStrict`, which rejects before anything reaches the ledger.
 *
 * Leaving these as-is is deliberate: rewriting them to assert the fix would
 * make the suite claim coverage it does not have.
 *
 * Run:  npm test -w edge-server
 *   (or)  node --test --experimental-strip-types "src/test/SECURITY-POC.test.ts"
 *
 * Findings exercised here (see SECURITY-REVIEW.md for full write-ups):
 *   F1  config.secret() length check is on hex CHARS → empty/short HMAC key
 *   F2  privileged login trusts client-supplied biometrics / TPM / source IP
 *   F3  session token is never re-validated against identity state (revocation)
 *   F4  HQ vault trusts the node public key carried inside the bundle it verifies
 *   F5  Merkle hash-chain does not detect tail truncation (answer deletion)
 *   F6  question leaf = SHA-256(id‖iv‖ct‖tag) is not injective (no length prefix)
 *   F7  question Merkle root is ambiguous (duplicate-last-node, CVE-2012-2459)
 *   F8  audit hash-chain forks under concurrent appends (read-tail, no lock)
 *   F9  hex() silently truncates invalid input instead of rejecting it
 *
 * No database and no network are required. F2/F3 exercise the pure gate + token
 * modules directly rather than booting Fastify, so the suite stays hermetic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";

import { loadConfig } from "../config.ts";
import { evaluateMatchAll, DEFAULT_POLICY } from "../lib/match-all.ts";
import { verifyQuote } from "../lib/tpm-quote.ts";
import { verifyBioEnvelope } from "../lib/bio-attest.ts";
import { buildQuote, goldenPcrSet, signQuote } from "./helpers/commissioning.ts";
import { issueToken, verifyToken, type TokenClaims } from "../lib/token.ts";
import { GENESIS, appendLeaf, verifyChain, type ChainRecord } from "../lib/merkle-chain.ts";
import { makeNodeSigner } from "../lib/node-sign.ts";
import { seal } from "../lib/envelope.ts";
import { sha256, toHex, utf8, canonicalJson } from "../lib/crypto.ts";
import { computeEntryHash, type AuditRow } from "../audit.ts";
import { questionLeaf, hashNode } from "../lib/question-seal.ts";
import { ingest, type SyncBundle, type ExportRecord } from "../hq/vault.ts";

// ═══════════════════════════════════════════════════════════════════════════
// F1 — CRITICAL. config.ts `secret()` validates the length of the HEX STRING,
//      not the decoded key. Node's Buffer.from(s,"hex") stops at the first
//      non-hex character and returns what it got — silently.
//
//        function secret(name) {
//          const hex = process.env[name];
//          if (hex && hex.length >= 32) return new Uint8Array(Buffer.from(hex,"hex"));
//          return new Uint8Array(randomBytes(32));
//        }
//
//      An operator who sets EDGE_TOKEN_SECRET to a passphrase (>= 32 chars, the
//      natural thing to do) gets a ZERO-BYTE HMAC key. Every session token in
//      the estate becomes forgeable by anyone, for any role.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The SHIPPED parser, exercised through loadConfig() rather than copied.
 *
 * The original PoC inlined config.ts's old `secret()`, which meant it kept
 * passing after the fix — it was testing history, not the code. These call the
 * real thing.
 */
function loadWith(env: Record<string, string | undefined>): () => unknown {
  return () => {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(env)) {
      saved[k] = process.env[k];
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    try {
      return loadConfig();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}
const HEX64 = "a".repeat(64);

test("F1a [FIXED]: a 32+ char passphrase is REFUSED, not silently decoded to nothing", () => {
  // 33 chars, not hex — what a sensible operator would actually write. The old
  // parser accepted it and produced a ZERO-BYTE HMAC key.
  assert.throws(
    loadWith({ EDGE_TOKEN_SECRET: "correct-horse-battery-staple-2026" }),
    /must be exactly 64 hex characters/,
  );
});

test("F1b [FIXED]: no configuration can yield an empty or short token secret", () => {
  // The forgery in the original PoC only worked because the key was empty.
  const cfg = loadWith({
    EDGE_TOKEN_SECRET: HEX64, EDGE_BIND_SECRET: HEX64, EDGE_NODE_SIGN_SEED: HEX64,
  })() as { tokenSecret: Uint8Array };
  assert.equal(cfg.tokenSecret.length, 32, "a valid secret must decode to a full 256-bit key");

  const forged = issueToken(new Uint8Array(0), {
    sub: "attacker", tid: "any-terminal", tpm: "attested",
    role: "SYSTEM_ADMIN", centre: null, exp: Date.now() + 3_600_000,
  });
  assert.equal(verifyToken(cfg.tokenSecret, forged, Date.now()), null,
    "a token minted with no secret must not verify");
});

test("F1c [FIXED]: a 32-char hex value is refused, not accepted as a 128-bit key", () => {
  assert.throws(loadWith({ EDGE_TOKEN_SECRET: "a".repeat(32) }), /64 hex characters/);
});

test("F1d [FIXED]: a missing secret fails closed in production", () => {
  assert.throws(
    loadWith({ ZUUP_ENV: "production", EDGE_TOKEN_SECRET: undefined }),
    /Missing required secret/,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// F2 — CRITICAL. INV-4 ("login exists iff ALL factors pass in one box") is
//      evaluated entirely over values the CLIENT sends. In http.ts:
//
//        const b = req.body as { terminalId; observedIp; faceScore;
//                                fpScore; tpmValid; elapsedMs };
//        evaluateMatchAll({ faceScore: b.faceScore, fpScore: b.fpScore,
//                           sourceIp: b.observedIp, tpmValid: b.tpmValid,
//                           elapsedMs: b.elapsedMs }, ...)
//
//      `observedIp` is named for what the Edge observed, but is read from the
//      request body. No factor is measured server-side. The gate is a formality.
// ═══════════════════════════════════════════════════════════════════════════

test("F2: every match-all factor is attacker-supplied, so the gate always opens", () => {
  // Only server-side facts: whatever the DB holds for the identity bound to
  // this station. An attacker learns boundIp trivially (it is the terminal's
  // own LAN address) or enumerates the /24.
  const serverSideFacts = { boundIp: "10.20.0.31", status: "ACTIVE", revoked: false };

  // Everything the attacker asserts about themselves:
  const attackerClaims = {
    faceScore: 1.0,        // "my face matched perfectly"
    fpScore: 1.0,          // "my fingerprint matched perfectly"
    sourceIp: "10.20.0.31", // "I am at the bound station"
    tpmValid: true,        // "my TPM attested"
    elapsedMs: 0,          // "I was instant"
  };

  const verdict = evaluateMatchAll(attackerClaims, serverSideFacts, DEFAULT_POLICY);
  assert.equal(verdict.ok, true, "no biometric or TPM factor was actually verified");
  assert.deepEqual(verdict.failures, []);
  // http.ts then issues a real signed token for ident.role — CENTER_ADMIN or
  // SYSTEM_ADMIN included, via /api/admin/login and /api/system/login.
});

test("F2b [FIXED]: PCR values alone no longer attest — a quote must be signed", () => {
  // The original defect had two halves. /api/terminal/attest returned {ok} and
  // wrote nothing, so no login could consult it; and the check it performed was
  // `JSON.stringify(golden) === JSON.stringify(provided)`, over values that are
  // PUBLIC and identical across every correctly-built terminal in the estate.
  // Anyone who could read one machine's PCRs could present them for any other.
  //
  // Now the Edge records the verdict (repo.recordAttestation, consulted by
  // hasFreshAttestation) and the check is a signature over a nonce it issued.
  const golden = goldenPcrSet();
  const impostor = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const genuine = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const nonce = new Uint8Array(32).fill(3);
  const quote = buildQuote({ nonce, pcrs: golden });

  // The attacker has the right PCR values and signs with a key of their own.
  const verdict = verifyQuote(
    { quote, signature: signQuote(quote, impostor.privateKey), pcrs: golden },
    {
      akPubkeyPem: genuine.publicKey.export({ type: "spki", format: "pem" }).toString(),
      nonce,
      goldenPcr: golden,
    },
  );
  assert.equal(verdict.ok, false, "correct measurements from the wrong TPM must not attest");
  assert.ok(verdict.failures.includes("QUOTE_SIGNATURE_INVALID"));
});

test("F2c [FIXED]: biometric scores in a request body are refused outright", () => {
  // The last self-asserted factor after the 2026-08-10 remediation: the two
  // scores still arrived as plain numbers, so `{"faceScore":1,"fpScore":1}`
  // satisfied both biometric clauses of INV-4 with no camera in the room.
  const daemon = generateKeyPairSync("ed25519");
  const pem = daemon.publicKey.export({ type: "spki", format: "pem" }).toString();

  const asserted = verifyBioEnvelope(
    { faceScoreBp: 10000, fpScoreBp: 10000 } as never,
    { bioPubkeyPem: pem, terminalId: "t-1", nonce: "n-1", subject: "LOGIN", now: Date.now() },
  );
  assert.equal(asserted.ok, false);
  assert.deepEqual(asserted.failures, ["BIOMETRIC_ENVELOPE_MISSING"]);
  assert.equal(asserted.faceScore, 0, "a denied verdict must not carry usable scores");

  // And the scores that DO reach evaluateMatchAll are the zeroes above, not the
  // attacker's tens of thousands — so the gate denies rather than opens.
  const verdict = evaluateMatchAll(
    {
      faceScore: asserted.faceScore, fpScore: asserted.fpScore,
      sourceIp: "10.20.0.31", tpmValid: true, elapsedMs: 100,
    },
    { boundIp: "10.20.0.31", status: "ACTIVE", revoked: false },
    DEFAULT_POLICY,
  );
  assert.equal(verdict.ok, false);
  assert.ok(verdict.failures.includes("FACE_BELOW_THRESHOLD"));
});

// ═══════════════════════════════════════════════════════════════════════════
// F3 — HIGH. token.ts's header claims the session is "re-validated server-side
//      on every call". verifyToken checks the HMAC and `exp` only. No handler
//      re-loads the identity, so /api/admin/identity/:id/revoke does not end
//      the revoked user's session.
// ═══════════════════════════════════════════════════════════════════════════

test("F3: a revoked identity's token keeps working until it expires", () => {
  const secret = new Uint8Array(32).fill(9);
  const t0 = Date.now();
  const token = issueToken(secret, {
    sub: "inv-42", tid: "t-9", tpm: "attested", role: "CENTER_INVIGILATOR",
    centre: "centre-1", exp: t0 + 8 * 60_000, // DEFAULT_IDLE_MS
  });

  // The Centre Admin revokes inv-42 one second later. The DB row flips to
  // REVOKED. Nothing in the request path reads it again.
  const stillValid = verifyToken(secret, token, t0 + 1_000);
  assert.notEqual(stillValid, null, "revocation had no effect on the live session");
  assert.equal(stillValid!.role, "CENTER_INVIGILATOR");

  // ...and it stays valid for the full idle window.
  assert.notEqual(verifyToken(secret, token, t0 + 7 * 60_000), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// F4 — CRITICAL. hq/vault.ts verifies the centre's signature using the public
//      key carried INSIDE the bundle being verified:
//
//        verifyRootSig(fromHex(bundle.nodePubkey), manifestHash,
//                      fromHex(bundle.nodeSig))
//
//      A signature you check against a key the signer chose proves nothing.
//      Anyone who can produce a bundle can produce a valid one.
// ═══════════════════════════════════════════════════════════════════════════

function makeSealedRecord(examId: string, leafIndex: number, prevRoot: Uint8Array,
                          answer: unknown, pubPem: string): { rec: ExportRecord; root: Uint8Array } {
  const s = seal(utf8.encode(canonicalJson(answer)), pubPem);
  const root = sha256(prevRoot, s.leaf);
  return {
    root,
    rec: {
      examId, seatNo: `S${leafIndex}`, leafIndex,
      leaf: toHex(s.leaf), prevRoot: toHex(prevRoot), chainRoot: toHex(root),
      nodeRootSig: "00".repeat(64), // per-record sig is never checked by ingest()
      ciphertext: toHex(s.ct), iv: toHex(s.iv), authTag: toHex(s.tag),
      wrappedDk: toHex(s.wrappedDk),
    },
  };
}

test("F4 [FIXED]: HQ ingest refuses a bundle signed by a key the attacker generated", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  // A wholly fabricated centre export. The attacker never saw the real centre's
  // node key — they made their own.
  const examId = "exam-forged";
  const a = makeSealedRecord(examId, 0, GENESIS, { roll: "R001", answers: { q1: "A" } }, pubPem);
  const b = makeSealedRecord(examId, 1, a.root, { roll: "R002", answers: { q1: "A" } }, pubPem);

  const manifest = {
    centreId: "centre-under-attack",
    count: 2,
    records: [a.rec, b.rec],
    exportedAt: Date.now(),
  };
  const manifestHash = sha256(utf8.encode(canonicalJson(manifest)));

  // Attacker's OWN Ed25519 node key — not the centre's.
  const rogueSigner = makeNodeSigner(new Uint8Array(32).fill(0xAB));
  const bundle: SyncBundle = {
    manifest,
    manifestHash: toHex(manifestHash),
    nodeSig: toHex(rogueSigner.signRoot(manifestHash)),
    nodePubkey: toHex(rogueSigner.publicKey), // ← self-supplied, and trusted
  };

  // HQ now pins each centre's signing key at provisioning. The real centre's
  // key is the only one registered, so the rogue bundle cannot verify.
  const realCentreKey = makeNodeSigner(new Uint8Array(32).fill(0x01)).publicKey;
  const registry = new Map([["centre-under-attack", realCentreKey]]);

  assert.throws(
    () => ingest(bundle, privPem, registry),
    /NODE_PUBKEY_NOT_REGISTERED_FOR_CENTRE|NODE_SIGNATURE_INVALID/,
    "a bundle signed with a key HQ never registered must be refused",
  );

  // And a centre HQ has never heard of is refused outright rather than trusted.
  assert.throws(() => ingest(bundle, privPem, new Map()), /UNKNOWN_CENTRE/);
});

// ═══════════════════════════════════════════════════════════════════════════
// F5 — HIGH. verifyChain() re-walks from GENESIS and confirms each link. A
//      hash CHAIN (unlike a signed count or an anchored root) cannot detect
//      that the tail was cut off. Dropping the last N answers verifies clean.
// ═══════════════════════════════════════════════════════════════════════════

test("F5: deleting the last N answers leaves the chain fully valid", () => {
  const full: ChainRecord[] = [];
  for (let i = 0; i < 10; i++) full.push(appendLeaf(full, sha256(utf8.encode(`answer-${i}`))));
  assert.equal(verifyChain(full).ok, true);

  // A compromised Centre Admin drops candidates 7, 8 and 9 before export.
  const truncated = full.slice(0, 7);
  const verdict = verifyChain(truncated);
  assert.equal(verdict.ok, true, "three candidates' answers vanished with no trace");
  assert.equal(verdict.brokenAt, null);
});

test("F5b [FIXED]: HQ ingest cross-checks manifest.count against the records", () => {
  // manifest.count is generated by the same party that could truncate, so it is
  // not sufficient on its own — but a bundle whose declared count disagrees with
  // what it carries is now refused rather than silently accepted.
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const a = makeSealedRecord("e1", 0, GENESIS, { roll: "R001" }, pubPem);
  const manifest = { centreId: "c1", count: 999, records: [a.rec], exportedAt: 0 };
  const manifestHash = sha256(utf8.encode(canonicalJson(manifest)));
  const signer = makeNodeSigner(new Uint8Array(32).fill(1));
  const registry = new Map([["c1", signer.publicKey]]);

  assert.throws(
    () => ingest({
      manifest, manifestHash: toHex(manifestHash),
      nodeSig: toHex(signer.signRoot(manifestHash)), nodePubkey: toHex(signer.publicKey),
    }, privPem, registry),
    /MANIFEST_COUNT_MISMATCH/,
  );

  // The honest bundle still ingests.
  const honest = { centreId: "c1", count: 1, records: [a.rec], exportedAt: 0 };
  const honestHash = sha256(utf8.encode(canonicalJson(honest)));
  const ok = ingest({
    manifest: honest, manifestHash: toHex(honestHash),
    nodeSig: toHex(signer.signRoot(honestHash)), nodePubkey: toHex(signer.publicKey),
  }, privPem, registry);
  assert.equal(ok.decrypted.length, 1);
  assert.deepEqual(ok.quarantined, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// F6 — HIGH. exam-terminal/lib/question-crypto.ts (and its sealer twin,
//      lib/question-seal.ts) compute:
//
//        leaf = SHA-256( utf8(id) ‖ iv ‖ ct ‖ tag )
//
//      with two VARIABLE-length fields and no length prefixes or separators.
//      The map from (id, iv, ct, tag) to leaf is therefore not injective:
//      distinct items hash identically, so the same Merkle proof "commits" to
//      more than one question object. "The terminal refuses any question not
//      committed to that root" does not hold as stated.
// ═══════════════════════════════════════════════════════════════════════════

const enc = new TextEncoder();
function cat(...p: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let o = 0; for (const x of p) { out.set(x, o); o += x.length; }
  return out;
}
async function wcSha256(d: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", d as BufferSource));
}
/** The OLD construction, kept so the tests can show what changed. */
async function legacyLeaf(id: string, iv: Uint8Array, ct: Uint8Array, tag: Uint8Array) {
  return wcSha256(cat(enc.encode(id), iv, ct, tag));
}

test("F6 [FIXED]: sliding the id/iv boundary no longer collides", async () => {
  const iv = new Uint8Array(12).fill(0x11);
  const ct = new Uint8Array(40).fill(0x22);
  const tag = new Uint8Array(16).fill(0x33);

  // The collision the old construction admitted: "Q17" and "Q1" with the
  // displacement absorbed by ct. Both are structurally valid SealedItems.
  const forgedId = "Q1";
  const forgedIv = cat(enc.encode("7"), iv.subarray(0, 11));
  const forgedCt = cat(iv.subarray(11), ct);

  assert.deepEqual(
    Array.from(await legacyLeaf("Q17", iv, ct, tag)),
    Array.from(await legacyLeaf(forgedId, forgedIv, forgedCt, tag)),
    "sanity: the OLD construction did collide",
  );
  assert.notDeepEqual(
    Array.from(await questionLeaf("Q17", iv, ct, tag)),
    Array.from(await questionLeaf(forgedId, forgedIv, forgedCt, tag)),
    "length prefixes must make the encoding injective",
  );
});

test("F6b [FIXED]: moving the ct/tag boundary no longer collides", async () => {
  const iv = new Uint8Array(12).fill(0xAA);
  const ct = new Uint8Array(32).fill(0xBB);
  const tag = new Uint8Array(16).fill(0xCC);
  assert.notDeepEqual(
    Array.from(await questionLeaf("Q1", iv, ct, tag)),
    Array.from(await questionLeaf("Q1", iv, cat(ct, tag.subarray(0, 1)), tag.subarray(1))),
  );
});

test("F6c [FIXED]: verifyInclusion bounds the proof length", async () => {
  // verifyBundleAgainstRoot now caps proofs at ceil(log2(count))+1, so a
  // multi-million-step proof is rejected before a single hash is computed.
  const { verifyBundleAgainstRoot } = await import(
    "../../../exam-terminal/lib/question-crypto.ts"
  );
  const bundle = {
    examId: "e", questionsRoot: "00".repeat(32), count: 1,
    items: [{
      question_id: "Q1", sequence_number: 1,
      iv: "11".repeat(12), ct: "22".repeat(8), tag: "33".repeat(16), leaf: "00".repeat(32),
      proof: Array.from({ length: 5_000_000 }, () => ({ hash: "00".repeat(32), position: "right" as const })),
    }],
  };
  const t0 = Date.now();
  assert.equal(await verifyBundleAgainstRoot(bundle, "00".repeat(32)), false);
  assert.ok(Date.now() - t0 < 2_000, "must reject on length, not grind through 5M hashes");
});

// ═══════════════════════════════════════════════════════════════════════════
// F7 — MEDIUM. lib/question-seal.ts duplicates the last node on odd levels:
//        const right = hasRight ? level[i + 1]! : level[i]!;
//      That is CVE-2012-2459. Distinct leaf sets share a root, so questionsRoot
//      does not uniquely commit to the paper. There is also no leaf/internal
//      domain separation, so a 64-byte leaf preimage can impersonate an
//      internal node.
// ═══════════════════════════════════════════════════════════════════════════

/** The shipped tree: orphan promoted, internal nodes domain-tagged. */
async function merkleRoot(leaves: Uint8Array[]): Promise<Uint8Array> {
  let level = leaves.slice();
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) { next.push(level[i]!); continue; }
      next.push(await hashNode(level[i]!, level[i + 1]!));
    }
    level = next;
  }
  return level[0]!;
}

test("F7 [FIXED]: [A,B,C] and [A,B,C,C] no longer share a root", async () => {
  const A = await wcSha256(enc.encode("qA"));
  const B = await wcSha256(enc.encode("qB"));
  const C = await wcSha256(enc.encode("qC"));
  assert.notDeepEqual(
    Array.from(await merkleRoot([A, B, C])),
    Array.from(await merkleRoot([A, B, C, C])),
    "duplicate-last-node (CVE-2012-2459) must not make two papers share a root",
  );
});

test("F7b [FIXED]: a leaf preimage cannot impersonate an internal node", async () => {
  const left = await wcSha256(enc.encode("L"));
  const right = await wcSha256(enc.encode("R"));

  // id="" (0) + iv(12) + ct(36) + tag(16) = exactly 64 bytes = left‖right.
  // (The original PoC mis-sliced this to 52 bytes, so it never demonstrated
  // the weakness it named — the weakness was real regardless.)
  const iv = left.subarray(0, 12);
  const ct = cat(left.subarray(12), right.subarray(0, 16));
  const tag = right.subarray(16, 32);
  assert.equal(iv.length + ct.length + tag.length, 64, "preimage must be node-sized");

  assert.deepEqual(
    Array.from(await legacyLeaf("", iv, ct, tag)),
    Array.from(await wcSha256(cat(left, right))),
    "sanity: the OLD construction did allow the impersonation",
  );
  assert.notDeepEqual(
    Array.from(await questionLeaf("", iv, ct, tag)),
    Array.from(await hashNode(left, right)),
    "domain tags must separate leaves from internal nodes",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// F8 — MEDIUM. audit.ts appendAudit() does:
//        SELECT entry_hash ... ORDER BY seq DESC LIMIT 1   -- no FOR UPDATE,
//                                                          -- no advisory lock
//      then INSERTs. Two concurrent transactions read the same tail and both
//      chain off it. verifyAuditChain() walks by seq and reports TAMPERING.
//      repo.lockChainTail() takes pg_advisory_xact_lock for the answer chain;
//      the audit chain got no equivalent. Every centre-less row (candidate
//      logins, all of which pass centerId: null) shares ONE chain, so a hall
//      logging in together forks it immediately.
// ═══════════════════════════════════════════════════════════════════════════

test("F8: two concurrent appends fork the audit chain and it reads as tampered", () => {
  const row = (action: string, target: string): AuditRow =>
    ({ center_id: null, actor_id: null, action, target, details: null });

  // Committed tail.
  const tail = computeEntryHash(new Uint8Array(32), row("CANDIDATE_ATTENDED", "t-000"));

  // Two requests land at once. Both SELECT the same tail before either INSERTs.
  const rowA = row("CANDIDATE_ATTENDED", "t-101");
  const rowB = row("CANDIDATE_ATTENDED", "t-102");
  const hashA = computeEntryHash(tail, rowA); // seq n+1, prev_hash = tail
  const hashB = computeEntryHash(tail, rowB); // seq n+2, prev_hash = tail  ← fork

  // Now re-walk exactly as verifyAuditChain() does, in seq order.
  let prev = tail;
  // seq n+1 verifies.
  assert.deepEqual(Array.from(hashA), Array.from(computeEntryHash(prev, rowA)));
  prev = hashA;
  // seq n+2 does not: its stored prev_hash is `tail`, but the walk expects hashA.
  assert.notDeepEqual(Array.from(tail), Array.from(prev),
    "the second row's prev_hash no longer matches the walk — chain reports broken");
  assert.notDeepEqual(Array.from(hashB), Array.from(computeEntryHash(prev, rowB)),
    "and its entry_hash does not recompute either");
});

// ═══════════════════════════════════════════════════════════════════════════
// F9 — MEDIUM. http.ts's hex() helper is Buffer.from(s,"hex") with no
//      validation. Node truncates at the first invalid pair and returns a
//      SHORT buffer rather than throwing. /api/answer/submit accepts whatever
//      comes back and commits it to the ledger.
// ═══════════════════════════════════════════════════════════════════════════

const hex = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "hex"));

test("F9: garbage hex becomes an empty buffer, not a 400", () => {
  assert.equal(hex("not-hex-at-all").length, 0);
  assert.equal(hex("aabbZZccdd").length, 2, "silently truncated at the bad pair");
  assert.equal(hex("abc").length, 1, "odd length silently drops the trailing nibble");
});

test("F9b: an empty envelope still produces a well-formed, chainable leaf", () => {
  // A submission of ct="", iv="", tag="", wrappedDk="" passes the
  // `!b.ct || !b.iv ...` presence check only if the strings are non-empty —
  // so send junk instead. All four decode to zero bytes.
  const ct = hex("zz"), iv = hex("zz"), tag = hex("zz"), wrappedDk = hex("zz");
  const leaf = sha256(ct, iv, tag, wrappedDk);
  assert.equal(leaf.length, 32, "the ledger accepts a leaf over four empty fields");
  // At HQ this record fails LEAF_ENVELOPE_MISMATCH? No — the leaf recomputes
  // fine. It fails later at RSA unwrap, which throws and aborts ingest() for
  // the WHOLE exam: one poisoned row blocks every other candidate's decrypt.
  assert.equal(toHex(sha256(hex(""), hex(""), hex(""), hex(""))), toHex(leaf));
});
