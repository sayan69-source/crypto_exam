# HQ answer-sealing keypair — DEMO MATERIAL, NOT PRODUCTION

> **The private half of a production keypair never exists as a file.** It is
> generated inside an HSM and can only be *used*, never *read*. This directory
> exists because a demo has no HSM, and without a real keypair the entire §11
> answer pipeline is unreachable: the Edge returns `SEALING_KEY_NOT_PROVISIONED`,
> terminals cannot seal, and HQ has nothing to open. Treat every byte here as
> public knowledge.

RSA-4096, the exact shape `hq/vault.ts` and `system-admin/lib/vault.ts` expect:
SPKI public / PKCS#8 private, wrapped with RSA-OAEP + SHA-256.

| File | Goes to | Read as |
|---|---|---|
| `hq-demo-public.pem` | every Centre Edge | `SYSTEM_ADMIN_PUBLIC_KEY_PEM_FILE` |
| `hq-demo-private.pem` | the System Admin portal process only | `HQ_PRIVATE_KEY_PEM_FILE` |

## Why the split matters

This is invariant **INV-6** made physical. A centre holds only the public half,
so a centre that is fully compromised — Edge database, terminals, staff, the lot
— yields **ciphertext**. Every answer is AES-GCM sealed under a per-record data
key, and that data key is wrapped to this public key. Nothing inside the centre
can unwrap it. Decryption happens once, at HQ, behind the private half.

Keep it that way in the demo too: the private PEM belongs to the System Admin
portal's environment and must never be handed to the Edge, a terminal, or the
image build. If it ever appears on the centre side, the demo is claiming a
property the deployment no longer has.

## Regenerating

```bash
node -e 'const{generateKeyPairSync}=require("node:crypto"),fs=require("node:fs");
const k=generateKeyPairSync("rsa",{modulusLength:4096,
  publicKeyEncoding:{type:"spki",format:"pem"},
  privateKeyEncoding:{type:"pkcs8",format:"pem"}});
fs.writeFileSync("hq-demo-public.pem",k.publicKey);
fs.writeFileSync("hq-demo-private.pem",k.privateKey);'
```

Bundles sealed under the old public key cannot be opened by the new private one,
so regenerating invalidates any previously exported sync bundle. Re-seed after.
