# On-device biometric identity (spec §8)

All biometric processing happens **on the terminal / on the Edge, on the LAN,
never on the internet**, and is **privacy-preserving** (DPDP Act 2023): raw
biometrics are computed in RAM (a tmpfs capture buffer), compared, then wiped —
only a hash/template is ever stored (§8.4).

## The four identity factors (§8.1)

| Factor | Captured by | Matched against | Threshold |
|---|---|---|---|
| Face | UVC webcam + TF Lite embedding | enrolled embedding hash | cosine ≥ 0.82 |
| Fingerprint | Mantra/SecuGen reader (CDC-ACM) | enrolled minutiae template | vendor score |
| Source IP | the Edge observes the tunnel source | IP bound to the identity | exact |
| TPM | terminal TPM 2.0 quote | golden PCR set on the Edge | exact |

## The daemon signs what it measures (§8.4)

A score is only worth what the thing that produced it can prove. The daemon
answers on two routes, both of which return a SIGNED envelope and neither of
which returns a bare number:

```
POST /attest/verify  {nonce, subject, enrolled_embedding_hex, enrolled_template_hex}
                     → {envelope: {terminalId, nonce, subject,
                                   faceScoreBp, fpScoreBp, capturedAt}, sig}
POST /attest/enrol   {nonce}
                     → {envelope: {…, faceEmbeddingHash, fingerprintTemplate}, sig}
```

- **`sig`** is over the canonical JSON of `envelope`, made with the Ed25519 key
  at `/etc/zuup/biometric-attest.key`. Its public half is registered as
  `terminals.bio_pubkey_pem` at commissioning; the Edge accepts scores only
  inside an envelope that verifies under it. No key → HTTP 503, never an
  unsigned score.
- **`nonce`** is issued by the Edge moments earlier, so a capture cannot be
  replayed.
- **`subject`** is `LOGIN`, `checkin:<roll>` or `activate:<requestId>` — it binds
  the measurement to WHO it is about. Without it, one genuine capture of one
  candidate would check in a whole hall.
- **`terminalId`** is read from `/etc/zuup/terminal-id` by the daemon itself,
  never from the request: a daemon that signed whatever id it was handed would
  let one compromised station mint envelopes for every seat.
- Scores are integer **basis points** (0–10000), because the verifier is
  JavaScript and `json.dumps(1.0)` ≠ `JSON.stringify(1.0)` — a float would have
  made the perfect match the one score whose signature never verified. The
  daemon refuses to start if its canonical serialiser drifts from the byte
  string pinned in `edge-server/src/test/bio-attest.test.ts`.

Before this, the daemon returned `{"score": 0.94}` and the browser forwarded the
number to the Edge — so the face and fingerprint clauses of the match-all rule
were, at the end of the wire, two integers in an HTTP body.

## The match-all rule lives in the Edge (runnable + tested)

The §8.2 intersection rule — **all** factors must pass inside one ≤20 s login
time-box, else deny + lock + log — is implemented and unit-tested in
`../../edge-server/src/lib/match-all.ts` (`evaluateMatchAll`, INV-4 negative
paths). This folder holds only the **on-device capture** side:

- `tflite-models/` — the face embedding + passive-liveness models (texture/
  moiré/reflection) and the active-challenge (blink/turn) model. Binary model
  blobs are produced by the model pipeline, not stored in git.
- `sdk/` — the fingerprint vendor SDK shim that yields a template + a match
  score (never the raw image).

## Liveness & anti-spoofing (§8.3)

- Passive liveness on every capture; active challenge when risk is elevated.
- Reject if >1 face, no face, or a flat/screen surface is detected.
- During the exam, the candidate seat silently re-checks the same enrolled face
  every 15 min and on anomaly — continuity, not re-identification.

## What is never persisted (§8.4, DPDP)

Raw images and scans are **never** written to any medium. Capture buffers live
in the `/run/biometric` tmpfs (see `../rootfs/overlay.fstab`) and are zeroised
immediately after the embedding/template is derived. Power-off destroys 100% of
it (INV-2).
