# ZUUP-OS — DPDP Act 2023 Compliance

Built-in, not retrofitted (spec §18.1). This maps each Digital Personal Data
Protection Act 2023 obligation to the concrete mechanism that satisfies it and
where that mechanism lives.

## Obligation → mechanism → location

| DPDP requirement | Mechanism | Where |
|---|---|---|
| **Consent (S.4)** | Explicit consent at enrolment with IP, timestamp, version | public backend `dpdp_consent*` (existing) |
| **Security safeguards (S.8)** | AES-256-GCM envelope; RAM-only terminal state; no plaintext on terminals; HSM-held keys | `exam-terminal/lib/answer-seal.ts`, `edge-server/src/lib/envelope.ts`, `rootfs/overlay.fstab` |
| **Minors (S.9)** | Parental consent for candidates < 18 | public backend enrolment |
| **Data principal rights (S.16)** | Access / correction / erasure endpoints; `dpdp_audit_log` | public backend |
| **Biometrics** | Never stored raw — only face embedding hash + fingerprint template; capture buffers zeroised | `biometric/README.md`, `/run/biometric` tmpfs |
| **No PII on chain** | Only roots/counts/hashes anchored | `vault.ts` `assertNoPii`, `CryptoExamCore.anchorCentreAnswerRoot` |
| **Retention** | Ciphertext-at-centre auto-expires after sync; policy-bound purge of exam records | `answer_ledger.sync_state`; export marks SYNCED |

## Data-minimisation in the answer pipeline

The §11.2 answer record `R` is built to carry **no direct identifier**:

- `subject_ref` is a **pseudonymous** seat/candidate ref — never name or Aadhaar.
- Questions are referenced by **hash** (`question_hash`), not text.
- The whole record is sealed to the System Admin key before it leaves the seat,
  so the Centre Admin store holds **ciphertext only** (INV-6, tested in
  `rbac.test.ts` / `answer-pipeline.test.ts`).

## What is provably never written to disk at a centre

- Raw face images / fingerprint scans — derived to a hash/template in the
  `/run/biometric` tmpfs, then zeroised (§8.4).
- Candidate answers in plaintext — sealed in RAM, only ciphertext persisted.
- Any session state across power-cycle — every writable mount is tmpfs
  (`rootfs/overlay.fstab`), so power-off is a forensic zero (INV-2).

## No-PII-on-chain: enforced twice

1. **In code, before broadcast:** `hq/vault.ts` `assertNoPii(anchor)` throws if
   an anchor payload contains any of `roll/name/aadhaar/dob/ciphertext/seat`, and
   the FastAPI `/sys/ledger/anchor` repeats the check (`sys_ledger.py`
   `_assert_no_pii`). The anchor carries only `{centreIdHash, examId, answerRoot,
   count, nodePubkey}` — `centreIdHash` is `SHA-256(centreId)`, never the raw id.
2. **On chain:** `CryptoExamCore.anchorCentreAnswerRoot` accepts only `bytes32`
   roots/hashes + a `uint64` count + a pubkey — there is no field that could
   carry a name or a roll.

This satisfies the "no PII on a public ledger" requirement while still giving
every candidate a publicly verifiable receipt (their leaf + inclusion proof
against the anchored root).
