# ZUUP-OS / CryptoExam — Security Review

**Scope:** full audit — `private/edge-server`, `private/exam-terminal`, `private/centre-admin`,
`private/system-admin`, `private/zuup-os` (image + boot chain), `public/frontend`.
**Method:** manual source review against the stated invariants (INV-1…INV-10) in the READMEs.
**Date:** 2026-08-09

> **Honesty note on verification.** The Linux sandbox available to this review failed to
> boot, so I could **not execute** the proof-of-concept suite or the existing test suite.
> Every finding below was derived by reading the code and verified by hand-tracing the
> relevant paths. The PoCs in `private/edge-server/src/test/SECURITY-POC.test.ts` are
> written against the real modules and should run with `npm test -w edge-server` —
> **please run them before acting on this report.** Each PoC currently *passes*, meaning
> the attack works; when a finding is fixed, its test will start failing.

---

## Verdict

The cryptographic *primitives* are competent. The problem is that almost nothing that
matters is actually **verified server-side**. Four separate paths let an attacker on the
centre LAN reach full privilege or corrupt exam results, and three of them are one-line
mistakes rather than deep design flaws.

The most important structural observation: **the system's documentation describes checks
that the code does not perform.** `token.ts` says sessions are "re-validated server-side on
every call" — they are not. The edge README says the HQ ingest "refuses a forged node sig" —
it cannot. `match-all.ts` documents an intersection of biometric, TPM and network facts —
every one of which arrives in the request body. That gap between claim and implementation is
the single biggest risk here, because it means the invariants are being *trusted* rather than
*enforced*.

| Severity | Count |
|---|---|
| Critical | 4 |
| High | 5 |
| Medium | 10 |
| Low / Note | 6 |

---

# CRITICAL

## C1 — Privileged login accepts self-asserted biometrics, TPM state and source IP

**Files:** `private/edge-server/src/http.ts` (lines ~165, ~241, ~281)
**Breaks:** INV-4 (multi-factor, hardware-bound login) — completely.
**PoC:** `F2`, `F2b`

All three privileged login routes read every authentication factor out of the request body:

```ts
const b = req.body as {
  terminalId: string; observedIp: string;
  faceScore: number; fpScore: number; tpmValid: boolean; elapsedMs: number;
};
const verdict = evaluateMatchAll(
  { faceScore: b.faceScore, fpScore: b.fpScore,
    sourceIp: b.observedIp,            // ← named "observed", read from the client
    tpmValid: b.tpmValid,              // ← the client asserts its own TPM state
    elapsedMs: b.elapsedMs },          // ← the client asserts its own timing
  { boundIp: ident.boundIp, status: ident.status, revoked: ident.revoked },
  DEFAULT_POLICY,
);
```

`evaluateMatchAll` itself is correct — it is a pure function and it fails closed on NaN
(`!(x >= τ)` is deliberate and good). But it is being fed attacker-controlled input. The
only server-side facts in the whole gate are `status` and `revoked` from the DB.

**Exploit.** One unauthenticated HTTP request over the WireGuard tunnel:

```http
POST /api/system/login
{"terminalId":"<any admin station id>","observedIp":"<that station's LAN IP>",
 "faceScore":1,"fpScore":1,"tpmValid":true,"elapsedMs":0}
```

returns a valid `SYSTEM_ADMIN` token. `boundIp` is the terminal's own LAN address and is
guessable or enumerable across a /24; `terminalId` leaks from the unauthenticated
`GET /api/terminal/:id/capability` probe the kiosk itself performs.

`/api/terminal/attest` compounds this: it computes an attestation verdict and then
**throws it away** — it writes nothing and is never consulted. The login handlers hardcode
`tpm: "attested"` into the issued token regardless.

**Fix.**

1. Take the source IP from the connection, never the body:
   ```ts
   sourceIp: req.ip,
   ```
   **Important caveat:** the all-in-one image puts Caddy in front of the Edge
   (`security/allinone/Caddyfile`), so `req.ip` will be `127.0.0.1` unless you enable
   `Fastify({ trustProxy: true })` *and* pin the trusted hop. Get this right or you will
   convert C1 into "everyone is the proxy".
2. Compute `elapsedMs` server-side. Issue a challenge (`POST /api/…/challenge` → nonce +
   `issuedAt`, stored in Redis with a 20 s TTL) and measure the delta yourself. The client
   should never be able to claim it was fast.
3. Move biometric scoring behind a server-side trust boundary. `zuup-biometricd` already
   runs on the terminal and is the right component — but its output must reach the Edge
   over a channel the browser cannot forge. Minimum viable version: have `zuup-biometricd`
   sign its score with a per-terminal key held outside the browser, and have the Edge verify
   that signature. Scores that arrive as plain JSON from a kiosk page are not a factor.
4. Bind the token to a *recorded* attestation. Persist the result of
   `/api/terminal/attest` (terminal id, PCR digest, timestamp) and have the login handler
   require a fresh, passing row rather than reading `b.tpmValid`.

---

## C2 — `secret()` measures the hex string, not the key — a passphrase yields a zero-byte HMAC key

**File:** `private/edge-server/src/config.ts` (lines 71–76)
**Breaks:** every session token in the estate.
**PoC:** `F1a`–`F1d`

```ts
function secret(name: string): Uint8Array {
  const hex = process.env[name];
  if (hex && hex.length >= 32) return new Uint8Array(Buffer.from(hex, "hex"));
  return new Uint8Array(randomBytes(32)); // ephemeral, per-boot (dev/test)
}
```

`hex.length >= 32` counts **characters**, and `Buffer.from(s, "hex")` does not throw on
invalid input — it stops at the first non-hex pair and returns what it managed to decode.

- `EDGE_TOKEN_SECRET="correct-horse-battery-staple-2026"` (33 chars — exactly what a
  sensible operator would write) → **`Buffer` of length 0**. The HMAC key is empty.
  Anyone can now mint a `SYSTEM_ADMIN` token with no secret at all (PoC `F1b`).
- `EDGE_TOKEN_SECRET` = 32 hex chars → a **128-bit** key where the type comment promises
  256. Silent.
- Unset → a random per-boot secret and **no error**. A production deploy that forgets to
  mount its sealed config starts happily, invalidates every session on each restart, and
  gives no signal that the config is missing.

Note the contrast: `node-sign.ts` gets this right —
`if (seed32.length !== 32) throw new Error("node sign seed must be 32 bytes")`.
`config.ts` should be at least as strict, since it guards more.

**Fix.**

```ts
function secret(name: string, { required }: { required: boolean }): Uint8Array {
  const raw = process.env[name];
  if (!raw) {
    if (required) throw new Error(`Missing required secret ${name} (64 hex chars)`);
    console.warn(`[edge] ${name} unset — generating an EPHEMERAL dev secret`);
    return new Uint8Array(randomBytes(32));
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`${name} must be exactly 64 hex characters (32 bytes); got ${raw.length} chars`);
  }
  return new Uint8Array(Buffer.from(raw, "hex"));
}
```

Drive `required` from `NODE_ENV === "production"` (or better, an explicit `ZUUP_ENV=production`),
so production fails closed and dev keeps its convenience. Apply the same validation to
`bindSecret` and `nodeSignSeed`.

---

## C3 — The candidate/seat API has no session at all; seat identity is a client-supplied string

**Files:** `private/edge-server/src/http.ts` (candidate login, `/api/answer/submit`,
`/api/exam/:examId/bundle`, `/api/exam/:examId/beacon`, `/api/seat/:id/state`);
`private/exam-terminal/lib/edge.ts`
**Breaks:** INV-5 (terminal binding), and the integrity of the answer ledger.

`POST /api/candidate/login` succeeds and returns **no token**:

```ts
return { ok: true, state: "ATTENDED" };
```

Every subsequent candidate operation is therefore authenticated by nothing but a
`terminalId` string in the request body. The terminal client is explicit about where that
string comes from (`lib/edge.ts`):

> `// or localStorage so one browser can stand in for any seat/station.`

`POST /api/answer/submit` checks only that the named terminal exists and is in state
`ATTENDED`/`IN_EXAM`. It never checks *who is asking*.

**Exploit chain (no credentials needed, just LAN/wg reachability):**

1. Enumerate seat ids via `GET /api/seat/:id/state` (unauthenticated) until you find one in
   `ATTENDED`.
2. `POST /api/answer/submit` with that `terminalId` and a garbage envelope.
3. The Edge appends it to the hash-chain and sets the seat to `SUBMITTED`.
4. The real candidate, still writing, now gets `409 SEAT_NOT_IN_EXAM(SUBMITTED)` forever.
   Their answers are unrecoverable — and the ledger contains a valid, node-signed,
   tamper-evident commitment to the attacker's junk.

Repeat across the hall and you have destroyed the exam while every integrity check still
reports green. The same trick pulls any seat's question bundle and (after T₀) its beacon,
from a machine that is not in the exam hall.

The design already anticipated this and then dropped it: `assignRandomSeat` computes and
stores a `bind_token` HMAC, `AssignResult` returns it — and **nothing ever reads it**.
`http.ts` discards it, and `/api/candidate/login` never checks one.

**Fix.** Issue the candidate a real session on successful DOB login and require it thereafter.

```ts
// on successful candidate login
const token = issueToken(config.tokenSecret, {
  sub: `cand:${b.roll}`, tid: b.terminalId, tpm: "attested",
  role: "CANDIDATE", centre: term.centerId,
  exp: now() + EXAM_SESSION_MS,
});
return { ok: true, state: "ATTENDED", token };
```

Then gate `/api/answer/submit`, `/api/exam/:id/bundle` and `/api/exam/:id/beacon` on
`claims.role === "CANDIDATE" && claims.tid === b.terminalId`. Revive the `bind_token` as the
one-shot proof that this browser is the seat that was assigned — it is already generated and
persisted, so this is plumbing, not new design.

---

## C4 — HQ verifies the centre's signature against the public key the bundle supplies

**File:** `private/edge-server/src/hq/vault.ts` (lines 87–93)
**Breaks:** INV-9's "tamper in transit" claim entirely.
**PoC:** `F4`

```ts
if (!verifyRootSig(fromHex(bundle.nodePubkey), manifestHash, fromHex(bundle.nodeSig))) {
  throw new IngestError("NODE_SIGNATURE_INVALID");
}
```

The key comes from `bundle.nodePubkey` — i.e. from the object being authenticated. A
signature checked against a key the signer chose proves only that the signer can run
Ed25519. Anyone able to deliver a bundle to HQ generates a keypair, signs their own forged
manifest, and passes.

Worse, the forged key is then propagated: `ingest()` copies `bundle.nodePubkey` straight into
the `AnchorPayload`, so HQ would publish the attacker's key on-chain as the centre's
attestation key.

**Fix.** Pin the expected key per centre and never read it from the bundle:

```ts
export function ingest(
  bundle: SyncBundle,
  systemAdminPrivKeyPem: string,
  centreNodePubkeys: Map<string, Uint8Array>,   // provisioned at HQ, out of band
): IngestResult {
  const expected = centreNodePubkeys.get(bundle.manifest.centreId);
  if (!expected) throw new IngestError("UNKNOWN_CENTRE");
  if (bundle.nodePubkey && toHex(expected) !== bundle.nodePubkey.toLowerCase()) {
    throw new IngestError("NODE_PUBKEY_NOT_REGISTERED_FOR_CENTRE");
  }
  if (!verifyRootSig(expected, manifestHash, fromHex(bundle.nodeSig))) {
    throw new IngestError("NODE_SIGNATURE_INVALID");
  }
  // …and anchor `toHex(expected)`, never bundle.nodePubkey
```

The centre's public key must be registered at HQ during provisioning, over a channel that
is not the same channel the bundle travels on.

---

# HIGH

## H1 — The hash-chain detects edits but not deletions; `manifest.count` is unchecked

**Files:** `src/lib/merkle-chain.ts`, `src/hq/vault.ts`
**PoC:** `F5`, `F5b`

`verifyChain()` walks from GENESIS and confirms each link. That catches modification. It
cannot catch **truncation**: `records.slice(0, 7)` of a 10-record chain verifies perfectly
clean (`ok: true, brokenAt: null`). A compromised Centre Admin drops the last N candidates'
answers before export and every integrity check downstream reports green.

`manifest.count` would catch it — except `ingest()` never compares `manifest.count` to
`records.length`, and `count` is produced by the same party that would truncate anyway.

The README's claim — *"editing any answer leaf / audit row / chain root breaks the re-walk"* —
is true. The gap is that omission is not editing.

**Fix (layered, all three are cheap):**

1. Assert the obvious in `ingest()`:
   ```ts
   if (bundle.manifest.count !== bundle.manifest.records.length) {
     throw new IngestError("MANIFEST_COUNT_MISMATCH");
   }
   ```
2. Have HQ cross-check against a figure the centre cannot revise after the fact — the
   `presentCount` from `egressStatus` at window close, signed and submitted *separately*
   from the answer bundle.
3. **Publish the final chain root at exam close, before export.** Once the root and leaf
   count for `(centre, exam)` are anchored, any later truncation is detectable by anyone.
   You already have the anchor mechanism; it just needs to fire earlier.

Candidates hold receipts containing `leafIndex`, so an individual can prove their answer was
dropped — but only by complaining. The system should not depend on that.

## H2 — Sessions are never re-validated; revocation does nothing for 8 minutes

**Files:** `src/lib/token.ts`, all handlers in `src/http.ts`
**PoC:** `F3`

`token.ts`'s own header states the session is *"bound to {identity_id, terminal_id,
tpm_anchor}, re-validated server-side on every call."* `verifyToken` checks the HMAC and
`exp` and nothing else. No handler re-loads the identity.

So `POST /api/admin/identity/:id/revoke` flips a DB column and the revoked invigilator keeps
working with their existing token for the remainder of `DEFAULT_IDLE_MS` (8 min). During a
live incident — the exact scenario revocation exists for — that is a long time.

`tid` and `tpm` are carried in the claims but never compared against anything either.

**Fix.** Add one lookup to `auth()`:

```ts
const auth = async (req: FastifyRequest): Promise<TokenClaims | null> => {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const claims = verifyToken(config.tokenSecret, h.slice(7), now());
  if (!claims) return null;
  const ident = await repo.getIdentity(pool, claims.sub);
  if (!ident || ident.revoked || ident.status !== "ACTIVE") return null;
  if (ident.role !== claims.role || ident.centerId !== claims.centre) return null;
  return claims;
};
```

Cache it for a few seconds if the extra query matters. Also fix the comment if you keep a
window — a stale doc comment is how this kind of gap survives review.

## H3 — Unauthenticated registration can permanently shadow any station's staff login

**Files:** `src/http.ts` (`/api/invigilator/register`, `/api/centeradmin/register`),
`src/repo.ts` (`findStaffByStation`)

`findStaffByStation` resolves a login by:

```sql
SELECT * FROM staff_identities
 WHERE role = $1 AND bound_terminal_id = $2
 ORDER BY created_at DESC LIMIT 1
```

Newest row wins, **regardless of status**. And `/api/invigilator/register` is completely
unauthenticated, accepts an arbitrary `boundTerminalId`, and has no rate limit.

**Exploit.** Register a bogus invigilator bound to the real invigilator station. Your
`PENDING_APPROVAL` row is now the newest, so the legitimate invigilator's login resolves to
*your* record and fails `IDENTITY_NOT_ACTIVE` — permanently. Repeat per station to lock the
centre out of its own console on exam morning. The same request loop also inserts unbounded
rows into `staff_identities` and `approval_requests`.

**Fix.**

```sql
SELECT * FROM staff_identities
 WHERE role = $1 AND bound_terminal_id = $2
   AND status = 'ACTIVE' AND revoked_at IS NULL
 ORDER BY created_at DESC LIMIT 1
```

Add a partial unique index so a station can only ever have one active holder
(`CREATE UNIQUE INDEX ON staff_identities (bound_terminal_id) WHERE status='ACTIVE'`), and
put registration behind either the provisioning key or a strict per-IP rate limit. Staff
onboarding is a pre-exam-day activity; it does not need an open endpoint on exam day.

## H4 — The question-bundle integrity check is circular, and its only anchor fails open

**Files:** `private/exam-terminal/app/candidate/page.tsx:272`,
`lib/chain-bridge.ts:254-288`, `lib/chain-config.ts:42`

```ts
const b = await questionBundle(examId, terminalId);
const ok = await verifyBundleAgainstRoot(b.bundle, b.questionsRoot);
```

Both the bundle **and** the root it is checked against come from the same Edge response.
The check proves only that the Edge is self-consistent.

To the team's credit, `chain-bridge.ts` says this out loud in its own comments and exists
precisely to fix it. The problem is what happens in production:

- `CHAIN` requires an internet route — which INV-3 forbids at a sealed centre.
- `PINNED` requires `NEXT_PUBLIC_PINNED_EXAM_ROOTS`, which `chain-config.ts` documents as
  *"Empty until the provisioning pipeline populates it."*
- `EDGE_ONLY` is returned, not thrown, and `candidate/page.tsx` renders the paper anyway.

So on exam day, with the hall sealed and the pinning pipeline unbuilt, provenance is
**always** `EDGE_ONLY` and the on-chain guarantee never actually applies. The honest
comments mean this is a known gap rather than a hidden one — but it is still the gap.

**Fix.** Finish the pinning pipeline and make it mandatory. Bake `questionsRoot` per exam into
the signed image at provisioning, and have `candidate/page.tsx` refuse to render on
`EDGE_ONLY`:

```ts
const prov = await verifyRootProvenance(...);
if (prov.kind === "EDGE_ONLY") {
  return onError("This paper's root could not be independently verified — refusing to render.");
}
```

Fail-open on the one control that makes the commitment meaningful is worth more than the
commitment itself.

## H5 — The question leaf commitment is not injective, and leaves are indistinguishable from internal nodes

**Files:** `private/exam-terminal/lib/question-crypto.ts:83`,
`private/edge-server/src/lib/question-seal.ts:104`
**PoC:** `F6`, `F6b`, `F7b`

```
leaf = SHA-256( utf8(id) ‖ iv ‖ ct ‖ tag )
```

Two variable-length fields (`id`, `ct`), concatenated with no length prefixes and no
separators. The mapping from tuple to leaf is therefore many-to-one:

- Slide the `id`/`iv` boundary one byte left and let `ct` absorb the byte: `("Q17", iv, ct, tag)`
  and `("Q1", "7"‖iv[0..11], iv[11]‖ct, tag)` hash **identically**, and both are structurally
  valid `SealedItem`s. `question_id` is what `questionAesKey()` derives from and what the UI
  shows the candidate (PoC `F6`).
- Slide the `ct`/`tag` boundary and the item still verifies *and still decrypts correctly*,
  because `openQuestion` re-concatenates them (PoC `F6b`).

Separately, internal nodes are `SHA-256(left ‖ right)` — plain SHA-256 over 64 bytes, with no
domain separation from leaves. A crafted 64-byte leaf preimage is bit-identical to an
internal node, so a fabricated "question" plus a truncated proof verifies against the same
root (PoC `F7b`). This is the classic Merkle second-preimage weakness.

**Fix.** Domain-separate and length-prefix. Both implementations must change together —
`question-seal.ts` and `question-crypto.ts` are deliberate independent copies, which is good
design but means a one-sided fix breaks the pipeline.

```ts
// leaf
sha256(concat(
  Uint8Array.of(0x00),                       // leaf domain tag
  u32be(idBytes.length), idBytes,
  u32be(iv.length),      iv,
  u32be(ct.length),      ct,
  u32be(tag.length),     tag,
));

// internal
sha256(concat(Uint8Array.of(0x01), left, right));
```

`question-seal.test.ts` already proves byte-compatibility between the two — extend it to
cover the new format and it will keep them honest.

---

# MEDIUM

## M1 — The audit hash-chain forks under concurrency and reads as tampered
**File:** `src/audit.ts:32-40` · **PoC:** `F8`

`appendAudit` does `SELECT entry_hash … ORDER BY seq DESC LIMIT 1` with **no `FOR UPDATE`
and no advisory lock**, then inserts. Under `READ COMMITTED`, two concurrent transactions read
the same tail and both chain off it. `verifyAuditChain` then walks by `seq` and reports a break.

`repo.lockChainTail` takes `pg_advisory_xact_lock` for the *answer* chain — correctly, and
with a good comment about why an advisory lock beats `FOR UPDATE` on an empty chain. The
audit chain simply never got the same treatment.

This bites hardest where it is least visible: every candidate-login audit row is written with
`centerId: null`, so the entire estate's candidate activity shares **one** chain. A hall of
200 seats logging in together will fork it within seconds, and the tamper-evidence signal
becomes permanent noise — which is worse than no signal, because nobody will trust the alarm
when it matters.

**Fix.** Reuse the pattern that already works:
```ts
await client.query(
  `SELECT pg_advisory_xact_lock(hashtextextended(COALESCE($1,'GLOBAL'), 42))`,
  [entry.centerId],
);
```
before the tail read. Consider also partitioning the null-centre chain by terminal, or
attributing candidate events to their centre so they stop sharing one global chain.

## M2 — Merkle duplicate-last-node (CVE-2012-2459)
**File:** `src/lib/question-seal.ts:72` · **PoC:** `F7`

`const right = hasRight ? level[i + 1]! : level[i]!;` — duplicating the last node on odd
levels means `[A,B,C]` and `[A,B,C,C]` produce the **same root**. `questionsRoot` therefore
does not uniquely commit to the question set.

**Fix.** Reject odd levels, or fold the orphan up a level unchanged instead of duplicating it,
or (best) adopt the domain-separated construction from H5, which makes the duplicate
distinguishable. Also enforce `bundle.items.length === bundle.count` in
`verifyBundleAgainstRoot`.

## M3 — `hex()` silently truncates, and one bad row kills the whole exam's decrypt
**File:** `src/http.ts:32` · **PoC:** `F9`, `F9b`

```ts
const hex = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "hex"));
```

`Buffer.from("zz","hex")` returns an **empty** buffer; `"aabbZZccdd"` returns 2 bytes;
odd-length input drops a nibble. No validation anywhere. `/api/answer/submit` checks only
that the strings are non-empty, so `{"ct":"zz","iv":"zz","tag":"zz","wrappedDk":"zz"}` is
accepted and committed.

The real damage is downstream: `hq/vault.ts:127` calls `open()` inside an unguarded loop, so
`privateDecrypt` on a zero-byte `wrappedDk` **throws out of `ingest()` entirely**. One
poisoned submission blocks decryption of every other candidate's answer for that exam.

**Fix.** Validate at the edge and isolate at HQ:
```ts
const HEX = /^[0-9a-fA-F]+$/;
function hexStrict(s: unknown, name: string, expectBytes?: number): Uint8Array {
  if (typeof s !== "string" || s.length % 2 !== 0 || !HEX.test(s)) {
    throw new BadRequest(`INVALID_HEX:${name}`);
  }
  const b = new Uint8Array(Buffer.from(s, "hex"));
  if (expectBytes !== undefined && b.length !== expectBytes) {
    throw new BadRequest(`BAD_LENGTH:${name}`);
  }
  return b;
}
```
Enforce `iv` = 12 bytes, `tag` = 16, `wrappedDk` = modulus size, `ct` non-empty and under a
sane cap. At HQ, wrap each `open()` in try/catch and quarantine the failing record rather
than aborting the batch.

## M4 — Any seat can be locked out permanently, unauthenticated
**File:** `src/http.ts:621-630`

```ts
const attempts = new Map<string, number>(); // simple per-terminal rate-limit
```

Three problems in three lines: the map is **in-memory** (lost on restart, and wrong behind
more than one Edge process), it has **no TTL or reset window** (three failures locks the seat
until the process restarts), and it is keyed by an **attacker-supplied** `terminalId` with no
bound on distinct keys.

So: an unauthenticated client sends three bad logins per terminal id and locks every seat in
the hall before the exam starts. The same loop with random ids grows the map without limit
until the process OOMs.

**Fix.** Move the counter to Redis (already in the compose file) keyed by
`(terminalId, examId)`, with a sliding window and an expiry — e.g. 5 attempts per 15 minutes,
auto-clearing. Require an invigilator action to clear a genuine lockout. Cap distinct keys.

## M5 — `markSynced` fires before HQ confirms, and there is no re-export path
**Files:** `src/http.ts:501-508`, `src/repo.ts:479-487`

Export marks rows `SYNCED` in the same transaction that builds the bundle, and
`listSealedForExport` filters on `sync_state='SEALED'`. If the bundle is lost in transit —
corrupted USB, failed upload, HQ rejects it — those answers can **never be exported again**.
The comment ("idempotent re-export skips them") describes the mechanism but not the risk.

**Fix.** Add an `EXPORTED` state distinct from `SYNCED`, and only advance to `SYNCED` on a
signed acknowledgement from HQ. Allow re-export of `EXPORTED` rows. Given these are exam
answers with no other copy, a re-export path is not optional.

## M6 — nftables permits the WireGuard handshake to *any* destination
**File:** `private/zuup-os/security/nftables.conf:32`

```
udp dport 51820 oifname "eth0" accept   # raw WireGuard handshake to the Edge endpoint
```

The comment says "to the Edge endpoint"; the rule says to anywhere. Any process that reaches
the network stack can send arbitrary UDP to port 51820 on any reachable host — a covert
egress channel through the layer that exists specifically to prevent egress (INV-3).

**Fix.** `ip daddr <edge-ip> udp dport 51820 oifname "eth0" accept`, templated from the same
provisioning value that fills `wg0.conf.template`. Add `ct state invalid drop` and rate-limit
the two `log` rules so they cannot flood the tmpfs ring buffer.

## M7 — Seat assignment validates nothing about the roll
**File:** `src/services/assignment-service.ts`

`assignRandomSeat` binds whatever `roll` string it is handed. It does not check that the roll
is enrolled at this centre, that the candidate is `PRESENT`, or that the roll is not already
bound to another seat. One roll can therefore hold several seats simultaneously — and with
C3, submit from all of them.

The random-seat logic itself is good: `ORDER BY random() … FOR UPDATE SKIP LOCKED` is the
correct atomic-claim pattern and the `NoFreeSeatError` path is properly fail-closed.

**Fix.** Inside the same transaction, require an enrolment row with `status='PRESENT'` for
`(centre, exam, roll)`, and add a partial unique index on `seat_bindings (exam_id,
candidate_roll) WHERE consumed_at IS NULL`.

## M8 — Firefox's content sandbox is fully disabled
**File:** `private/zuup-os/security/kiosk/zuup-kiosk-launch.sh:110`

```js
user_pref("security.sandbox.content.level", 0);
```

The justification given ("no user namespaces in this kernel") is accurate, and turning off
the JITs meaningfully shrinks the attack surface. But level 0 removes the strongest boundary
around the renderer — the process that parses fonts, images, and media from the question
bundle. Seccomp, AppArmor and Tetragon remain, and they are real, but they are coarse
compared to what the content sandbox provides.

**Fix.** Enable `CONFIG_USER_NS` in `kernel/zuup.config` and constrain unprivileged userns
via AppArmor (`userns` rules) rather than removing it wholesale — that restores levels 3–4.
If userns must stay off, raise the level as far as it will go rather than to 0, and document
the residual risk in `docs/` threat model.

## M9 — `argonVerify` trusts cost parameters read from storage
**File:** `src/lib/argon-hash.ts:60-65`

`t`, `m`, `p` are parsed from the stored envelope and passed to `argon2id` unvalidated. A row
with `m: 2**31` turns a single verify into an out-of-memory kill. Not reachable today (the
column is only ever written by this module), but it is one SQL-injection or one bad migration
away from being a remote DoS, and validation costs three lines.

**Fix.**
```ts
if (!(stored.t >= 1 && stored.t <= 10)) return false;
if (!(stored.m >= 8 * 1024 && stored.m <= 256 * 1024)) return false;
if (!(stored.p >= 1 && stored.p <= 4)) return false;
```

## M10 — The egress gate counts ledger rows, so C3 can open the internet early
**File:** `src/repo.ts:731-759`

`pendingCount = max(0, presentCount - submittedCount)` where `submittedCount` is
`count(*) FROM answer_ledger`. Using C3, an attacker submits junk envelopes for every
`ATTENDED` seat; `submittedCount` reaches `presentCount`, `pendingCount` clamps to 0, and
`mayOpen` becomes true the moment the window closes — even though real candidates never
submitted. The uplink opens on a false "everyone is done".

**Fix.** Count **distinct seats with a committed answer** and compare against the specific
present candidates, not a bare total:
```sql
SELECT count(DISTINCT seat_no) n FROM answer_ledger WHERE center_id=$1 AND exam_id=$2
```
Fixing C3 removes the injection vector; this fixes the arithmetic regardless.

---

# LOW / NOTES

- **L1 — `assertNoPii` cannot fire where it matters.** `hq/vault.ts:149`. The blocklist
  (`roll`, `name`, `dob`, `seat`…) is checked against a JSON blob whose non-`examId` fields
  are all hex — and none of those words are spellable in hex. Meanwhile `examId`, the one
  free-text field, is excluded from the format check on line 155. Either validate `examId`
  (UUID regex) or drop the blocklist; as written it provides assurance it cannot deliver.

- **L2 — `verifyInclusion` has no proof-length bound.** `question-crypto.ts:87`. A hostile
  bundle can attach a multi-million-step proof; each step is a SHA-256. Cap at
  `ceil(log2(bundle.count)) + 1`.

- **L3 — `sed`-into-HTML in the kiosk launcher.** `zuup-kiosk-launch.sh:123-127` substitutes
  `$EDGE`/`$TID` into an HTML template rendered from a `file://` origin. Not currently
  exploitable — `/etc/zuup/terminal-id` sits on the read-only dm-verity root — but it is one
  provisioning change away from being so. HTML-escape, or render the values via JS
  `textContent`.

- **L4 — `trustProxy` will matter when you fix C1.** The all-in-one Caddyfile proxies
  `/api/*` to the Edge. `req.ip` will be the proxy unless Fastify is configured with
  `trustProxy` pinned to the loopback hop. Getting this wrong turns the C1 fix into a
  different bypass.

- **L5 — Provisioned staff can never log in.** `services/provisioning.ts:86-98` inserts
  `staff_identities` without `bound_ip` or `bound_terminal_id`. `evaluateMatchAll` then
  returns `NO_BOUND_IP` for every such identity. The provisioning path and the login path
  disagree about what a complete identity is. Separately, `ingestBundle` accepts arbitrary
  `role` and `status`, so the provisioning key is effectively a root credential — worth
  stating explicitly in the threat model, and worth rotating on a schedule.

- **L6 — `/api/answer/receipt/:leaf` is unauthenticated.** Hashes only, so disclosure is
  minor, but it allows enumeration of the ledger's shape and confirmation of whether a given
  leaf was committed. Low priority; consider requiring the candidate session from C3.

---

# What the code gets right

Worth stating plainly, because it is a decent amount and it should not be lost in the list above.

- **No SQL injection anywhere.** Every query in `repo.ts`, `audit.ts`, `provisioning.ts` and
  `assignment-service.ts` is parameterised. The two places that interpolate
  (`centreCounts`, `listSealedForExport`) splice fixed literal fragments, not user data. This
  is consistently done and it is the single most common failure in code like this.
- **The envelope construction is correct.** AES-256-GCM with a fresh 12-byte IV and a fresh
  256-bit DK per submission, wrapped with RSA-OAEP-SHA256. No ECB, no static IV, no
  unauthenticated mode, no key reuse.
- **`constantTimeEqual` is used consistently** for every secret comparison, and correctly
  short-circuits on length mismatch rather than calling `timingSafeEqual` with mismatched
  buffers (which would throw).
- **Argon2id with sane defaults** (t=3, m=64 MiB, p=1) and a self-describing stored envelope.
  One-time codes are 128-bit CSPRNG in Crockford base32, and the `normalize()` look-alike
  mapping correctly loses no entropy because the generator excludes exactly those characters.
- **`evaluateMatchAll` fails closed on NaN.** `!(x >= τ)` rather than `x < τ` is a deliberate
  and correct choice.
- **The answer leaf is recomputed server-side.** `http.ts:718` — *"Never trust a
  client-supplied leaf"* — and it doesn't. Good instinct, applied.
- **`lockChainTail` is right.** The advisory transaction lock, and the comment explaining why
  it beats `FOR UPDATE` when the chain is empty, show real care. M1 is the same care not
  being applied to the audit chain.
- **`node-sign.ts` validates its seed length** and returns `false` rather than throwing on
  malformed input. C2 is `config.ts` failing to meet the standard this file sets.
- **The initramfs `/init` is genuinely well built.** Two device-discovery methods where
  dm-verity proves the bytes regardless of which one wins, so a wrong guess fails safe;
  `poweroff -f` on every error path; no rescue shell; tmpfs mounted before systemd can touch
  persistent storage; and the `mode=1777` comment on `/tmp` shows someone debugged this on
  real hardware. This is the strongest part of the codebase.
- **The approval cascade is correct.** `canApprove` properly enforces that no tier admits
  itself, and the same-centre constraint on invigilator approval is right.
- **`chain-bridge.ts` is honest about its own weakness.** The `EDGE_ONLY` comment states
  plainly that the check "only proves the Edge is self-consistent". H4 is a gap, but it is a
  documented gap, and that is a meaningfully better starting position than a hidden one.

---

# Suggested order of work

| # | Finding | Effort | Why first |
|---|---|---|---|
| 1 | **C2** secret validation | ~10 lines | Smallest fix, largest blast radius. Do it today. |
| 2 | **C1** server-side login factors | Medium | Everything else assumes authentication means something. |
| 3 | **C3** candidate sessions | Medium | `bind_token` already exists; this is plumbing. |
| 4 | **C4** pin centre node keys at HQ | Small | Restores the meaning of every signature you produce. |
| 5 | **H2** re-validate on every call | ~8 lines | Cheap, and makes revocation real. |
| 6 | **H3** status filter + unique index | Small | Trivially triggered pre-exam DoS. |
| 7 | **M1** advisory lock on audit | ~4 lines | Otherwise tamper-evidence is permanent noise. |
| 8 | **M3** strict hex + HQ isolation | Small | Prevents one row destroying an exam's decrypt. |
| 9 | **H1 / H5 / M2** commitment hardening | Larger | Needs coordinated change across both Merkle impls. |
| 10 | **H4** finish root pinning | Larger | Depends on the provisioning pipeline. |

---

## Running the PoCs

```bash
npm install
npm test -w edge-server
# or just this suite:
cd private/edge-server
node --test --experimental-strip-types "src/test/SECURITY-POC.test.ts"
```

All PoCs are hermetic — no database, no network. Every test currently **passes**, which means
the corresponding attack works. Fixing a finding should make its test **fail**; convert it to
a regression test (invert the assertion) at that point.

---

# Remediation status — verified 2026-08-10

Every finding above was re-checked against the source before anything was changed.
**All 24 were real.** One PoC was not: `F7b` asserted a 64-byte leaf preimage but
built a 52-byte one, so it failed rather than passed — the finding it named (no
leaf/internal domain separation) is nonetheless genuine, and a corrected construction
demonstrates it. The review's claim that "every PoC currently passes" was therefore
17/18, not 18/18.

**Suite after remediation: 69 passing in edge-server (was 51), 15 in exam-terminal,
71 in backend, 32 in contracts. 0 failing.**

| ID | Status | What landed |
|---|---|---|
| **C1** | **Fixed** | `req.ip` from the connection with `trustProxy` pinned to loopback; `elapsedMs` measured from a server-issued nonce (`POST /api/login/challenge`, one-shot, 60 s TTL); `tpmValid` from a persisted attestation row (`terminals.last_attest_ok/at`, 12 h TTL) instead of the body. **Partial:** the two biometric scores still arrive from the terminal — closing that needs `zuup-biometricd` to sign its output with a key outside the browser. |
| **C2** | **Fixed** | `secret()` validates the DECODED key: exactly 64 hex chars, or throw. Missing secret throws in production, warns in dev. |
| **C3** | **Fixed** | Candidate login issues a `CANDIDATE` token bound to the seat; `answer/submit`, `bundle` and `beacon` require it and check `claims.tid === terminalId`. |
| **C4** | **Fixed** | `ingest`/`ingestBundle` take a per-centre key registry and refuse `UNKNOWN_CENTRE`; the anchor carries the REGISTERED key. HQ portal reads it from `HQ_CENTRE_NODE_KEYS[_FILE]` and 503s when unprovisioned. |
| **H1** | **Fixed (partial)** | `MANIFEST_COUNT_MISMATCH` on ingest. Pre-export root anchoring — the part that actually detects truncation by a centre that also writes the count — is **not** done. |
| **H2** | **Fixed** | `auth()` re-loads the identity every call and compares role + centre; revocation now takes effect immediately. |
| **H3** | **Fixed** | `findStaffByStation` filters `status='ACTIVE' AND revoked_at IS NULL`, plus a partial unique index. Registration is still unauthenticated and unthrottled — **open**. |
| **H4** | **Open** | Root pinning is still empty, so provenance is `EDGE_ONLY` and the paper still renders. Needs the provisioning pipeline. |
| **H5** | **Fixed** | Leaf is `SHA-256(0x00 ‖ len‖id ‖ len‖iv ‖ len‖ct ‖ len‖tag)`; nodes are `SHA-256(0x01 ‖ l ‖ r)`. Changed in both implementations together; `seal-compat` proves they still agree byte-for-byte. |
| **M1** | **Fixed** | `pg_advisory_xact_lock` before the tail read in `appendAudit`; candidate events now carry their centre instead of sharing one global chain. |
| **M2** | **Fixed** | Odd nodes are promoted, not duplicated (CVE-2012-2459); `verifyBundleAgainstRoot` checks `count === items.length`. |
| **M3** | **Fixed** | `hexStrict` with fixed lengths for iv/tag; HQ quarantines an unopenable record instead of aborting the batch — but still throws when NOTHING opens, which is a key problem, not a data one. |
| **M4** | **Fixed** | Sliding 15-min window, 5 attempts, bounded at 5,000 tracked seats. In-process, so still per-instance — Redis when there is more than one Edge. |
| **M5** | **Open** | `markSynced` still flips to SYNCED at export time; no `EXPORTED` state and no re-export path. |
| **M6** | **Open** | `nftables.conf` still permits the WireGuard handshake to any destination. |
| **M7** | **Fixed** | Seat assignment requires a `PRESENT` enrolment and refuses a roll that already holds a live binding; partial unique index enforces it. |
| **M8** | **Open** | Firefox content sandbox still at level 0; needs `CONFIG_USER_NS` in the kernel config. |
| **M9** | **Fixed** | Argon cost parameters bounds-checked before use. |
| **M10** | **Fixed** | Egress gate counts `DISTINCT seat_no`, not ledger rows. |
| **L1** | **Fixed** | `assertNoPii` checks every field's shape, including `examId`, and rejects unexpected keys — the substring blocklist could previously only fire on the one field it did not check. |
| **L2** | **Fixed** | Proof length capped at `ceil(log2(count)) + 1`. |
| **L3–L6** | **Open** | Kiosk HTML escaping, provisioned-staff bound_ip gap, unauthenticated receipt lookup. |

**Migration required:** `private/edge-server/migrations/003_security_hardening.sql`
(attestation columns + two partial unique indexes). It has not been applied to any
database — there is no Postgres running here.

**Not verified at runtime:** the edge-server integration tests need `DATABASE_URL` and
stayed skipped (17 of them), so C1/C3/H2/H3/M1/M7 are proven by typecheck, unit tests
and code review, not by a live request against Postgres. Run
`npm run test:db -w edge-server` with a database before trusting them in production.
