# What is not done

Last updated 2026-08-15. This file is deliberately unflattering. Anything absent
from it is a claim that it works, so a gap discovered later belongs here first
and in a commit message second.

Ordered by consequence, not by effort.

---

## Blocking — the system cannot conduct a real examination without these

### 1. Results do not exist at all — public

There is **no scoring code, no result endpoint and no publication surface**
anywhere in the repository. The chain runs authoring → assembly → sealed
delivery → encrypted answers → Merkle ledger → HQ decryption, and then stops.
`answer_merkle_root` and `polygon_answer_tx` exist on the exam record for
anchoring, but nothing computes a mark.

This is a larger problem than it sounds, and it is not simply "write a marking
loop". At minimum it needs:

- a scoring model that survives the fact that **different candidates sat
  different forms** drawn at T₀, so raw marks are not comparable between them;
- score equating across forms, which is what the IRT calibration was for;
- negative marking, partial credit and per-subject aggregation, given candidates
  may have chosen different optional subjects;
- an answer-key release that cannot be used to reverse-engineer the pool;
- a re-evaluation and grievance path, because a result nobody can contest is not
  a result anybody will accept;
- publication that is verifiable against the on-chain root without exposing
  another candidate's answers.

Until this exists the platform can run an examination and cannot finish one.

### 2. Nothing has ever been driven at scale — both

487 candidates have been simulated in a database. They have never been driven
through 487 terminals, and no load, soak or adversarial testing has been done.
Seat allotment under genuine contention, the answer ledger under concurrent
submission, and the Edge under a full hall are all untested.

### 3. No real TPM has produced a quote for this verifier — private

The quote parser is driven entirely by hand-built structures pinned to the TPM
2.0 specification. Every failure clause is covered. Agreement with the byte
layout a real `tpm2_quote` emits is **not** — the target laptop has no TPM 2.0,
so this has never been exercised against hardware.

### 4. The camera and reader path has never run — private

The face engine and the fingerprint shim are exercised by nothing automated. The
signing envelope around them is tested; the capture inside it is not. Thresholds
are defaults, not measurements, and the false-reject rate — the thing that ruins
an exam day by turning away a genuine candidate — is unknown.

---

## Serious — live weaknesses, mostly configuration

### 5. `DEBUG=true` in production — public

**Partly fixed 2026-08-16.** Two unauthenticated endpoints were gated on
`if not DEBUG`, and the deployment runs with `DEBUG=true`, so both were live:

- `POST /auth/seed-admin` minted an administrator with a password written in the
  source and returned a signed JWT for it. **Deleted** — the seeder already
  creates one from operator-supplied values, so it was a second, weaker way in.
- `POST /api/v1/seed`, an unauthenticated write endpoint, now needs a dedicated
  `ALLOW_HTTP_SEED` opt-in that no production environment sets.

**Still outstanding: `DEBUG=true` itself.** It remains set in the deployment and
should not be. `DEBUG` is a developer-convenience switch and was never a security
boundary — treating it as one is what put both of those endpoints on the
internet, and the next thing gated that way will be exposed the same day it is
written. Anything else it loosens (verbose errors, permissive CORS, stack traces
in responses) has not been surveyed.

### 6. Secrets are development material — private

The all-in-one unit files carry fixed token, bind and node-signing secrets and a
demo HQ keypair. Production needs real secrets and an HSM for the HQ private
half.

### 7. Not deployed on-chain — public

Contracts pass against a local node. Polygon Amoy needs a funded key. Until then
the "don't trust us, check the chain" claim has no contract for anyone to look
up.

### 8. Known-open findings from the security review — private

- Root pinning is empty, so provenance is always `EDGE_ONLY` and the paper still
  renders.
- No re-export path once a ledger has been exported.
- The firewall permits the WireGuard handshake from anywhere.
- Firefox runs at sandbox level 0, because the kernel ships without user
  namespaces.
- Invigilator registration is unauthenticated.

---

## Incomplete — built but not finished

### 9. No interface for the setter chain — public

Nomination, approval and redemption are **API-only**. There is no page for an
administrator to nominate from, none for tier-0 to approve, and none for a
nominee to redeem their token. The chain is enforced and tested; it is not
usable by a human.

### 10. No self-service administrator registration — public

Per-exam administrators are named on the exam request, which is how the approval
chain gets its authority. But there is no way for an administrator to *register*
themselves, and no page behind which they manage their exam. The deployed site
has an administrator only because the seeder creates one.

### 11. Locations are not centres — both

An exam location becomes a real centre only when one is commissioned for it.
Until then a candidate is enrolled against a location with no `center_id`, and
therefore appears in no provisioning bundle. The registration flow says so
honestly, but the bridge from "a place the organisation named" to "a
commissioned centre" is not built.

### 12. The ZK proof caps at 16 questions — public

A Poseidon input limit, with a single-contributor trusted setup. Neither is
acceptable for a real paper.

### 13. Result of the second hardware boot is unverified — private

The image containing the ordering fix booted and commissioned successfully. The
image containing the *console* session fix has not been rebuilt or reflashed, so
that fix is in the repository but not on the stick.

---

## Unknown — not yet looked at

The operator has stated there are further flaws not yet identified, particularly
around result publication. This section exists so that stays visible rather than
being quietly forgotten. Nothing here has been surveyed:

- what happens to a candidate who is present but whose biometrics never match;
- what happens when a terminal dies mid-exam with sealed answers on it;
- clock trust — the exam window depends on time nobody has verified;
- whether a centre can be made to replay an old, validly-signed ledger;
- data retention and erasure duties under DPDP once results exist.
