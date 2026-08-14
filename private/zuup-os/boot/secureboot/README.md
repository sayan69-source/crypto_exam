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
| AK public half | the **Edge** terminal registry | proves a quote came from THIS TPM |

Both registry values arrive through the HQ provisioning bundle
(`terminals[].golden_pcr`, `terminals[].ak_pubkey_pem` — see
`edge-server/src/provision.ts --schema`). A terminal missing either cannot
attest, and therefore cannot boot into the Gate. That is the intended state for
an uncommissioned machine.

## Remote attestation to the Edge (every boot)

1. Terminal boots; the TPM holds the measured PCRs.
2. Terminal takes a one-shot nonce — `POST /api/terminal/attest/challenge`.
3. `tpm2_quote` signs {nonce, PCR digest} with the restricted Attestation Key.
4. Terminal posts quote + signature + PCR values — `POST /api/terminal/attest`.
5. The Edge verifies the AK signature, that `extraData` is the nonce it just
   issued, that the quote covers exactly the commissioned PCR selection, that
   the submitted values hash to the signed digest, and that those values are the
   golden ones.
6. **Any clause failing → the Edge denies the terminal**; the boot HALTs and it
   never reaches the Login Gate.

The runnable counterpart is `../../edge-server/src/lib/tpm-quote.ts`, pinned by
`edge-server/src/test/tpm-quote.test.ts` — which includes the case this design
exists for: PCR values copied off another (genuine) terminal do not attest,
because they carry no signature over our nonce.

## UEFI setup hardening (commissioning checklist)

- Set a UEFI supervisor password; disable the UEFI shell.
- Boot order: centre PXE only. Disable USB / optical / other-network boot.
- Enable Secure Boot in **user mode** with the authority keys (no Microsoft KEK
  on dedicated hardware).
- Where present: ATECC608A for per-terminal ECDSA token signing; tamper-mesh
  GPIO wired to TPM key zeroisation.
