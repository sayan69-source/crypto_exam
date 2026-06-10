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
