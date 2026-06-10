# Secure Boot & TPM attestation (spec §7.1)

These are the root-of-trust artifacts for the terminal boot chain. They are
authored here and used on the build host + during centre commissioning; nothing
in this folder runs on the developer workstation.

## Boot chain (measured, signed)

```
UEFI firmware  →  shimx64.efi  →  GRUB (signed)  →  kernel+initrd (signed)
   │  PCR 0-7        │ PCR 14         │ PCR 8-9            │ PCR 4
   └────────── each stage extends a PCR into the TPM 2.0 (measured boot) ──────┘
```

Only a kernel + bootloader signed by the **exam authority's key** (enrolled in
UEFI db/KEK/PK) will boot. Editing a single byte of the image breaks the
signature and the machine refuses to boot (§7.1 acceptance).

## What ships where

| Artifact | Lives | Purpose |
|---|---|---|
| `PK.crt`, `KEK.crt`, `db.crt` | HSM-backed, offline | UEFI key hierarchy; enrolled at commissioning |
| `sign-image.sh` | build host | `sbsign` the kernel + dm-verity root hash |
| golden PCR set | the **Edge** terminal registry | remote attestation reference (§7.1) |

## Remote attestation to the Edge (every boot)

1. Terminal boots, TPM holds the measured PCRs.
2. Terminal sends a TPM quote to the Edge — `POST /api/terminal/attest`.
3. The Edge compares against the golden PCR set for that terminal id.
4. **Mismatch → the Edge denies the terminal**; it never reaches the Login Gate.

This is the software counterpart to the runnable check in
`../../edge-server/src/repo.ts` → `attestTerminal()`, which is exercised by the
cascade integration test. On real hardware the quote is a signed TPM 2.0
structure; the Edge function verifies it against `golden_pcr`. Fail-closed: an
unknown terminal or any mismatch returns `false` and the boot HALTs.

## UEFI setup hardening (commissioning checklist)

- Set a UEFI supervisor password; disable the UEFI shell.
- Boot order: centre PXE only. Disable USB / optical / other-network boot.
- Enable Secure Boot in **user mode** with the authority keys (no Microsoft KEK
  on dedicated hardware).
- Where present: ATECC608A for per-terminal ECDSA token signing; tamper-mesh
  GPIO wired to TPM key zeroisation.
