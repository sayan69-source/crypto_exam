# Deploying CryptoExam Core (public website)

Two paths: **Render Blueprint** (one-click, free tier) or **Docker Compose** (self-hosted).

---

## Path A — Render Blueprint (recommended, ~10 minutes)

`render.yaml` is at the **repo root** — Render picks it up automatically.

### Steps

1. **Push this repo to GitHub** (if not already done):
   ```bash
   git add -A && git commit -m "chore: prepare for Render deploy" && git push
   ```

2. **Render → New → Blueprint → select this repo.**
   Render reads `render.yaml` and creates three services:
   - `cryptoexam-db` — managed PostgreSQL 16
   - `cryptoexam-backend` — FastAPI API (Docker)
   - `cryptoexam-frontend` — Next.js 16 (Docker)

3. **Wait for builds** (~5-10 min on the free tier, longer on first pull).
   The backend auto-seeds the database on first boot (`SEED_ON_START=true`).

4. **Verify the deploy:**
   - Backend health: `https://cryptoexam-backend.onrender.com/health`
   - Frontend: `https://cryptoexam-frontend.onrender.com`

5. **Login:** `admin@cryptoexam.dev` / `CryptoExam@2026!`
   - Since `DEBUG=true`, the OTP code is returned in the API response and
     shown on the login screen automatically — no Twilio SMS gateway needed.

### What's pre-wired in render.yaml

| Key | Value |
|-----|-------|
| `JWT_PRIVATE_KEY_PEM` | Pre-generated RS256 2048-bit private key |
| `JWT_PUBLIC_KEY_PEM` | Matching public key |
| `SEED_ADMIN_EMAIL` | `admin@cryptoexam.dev` |
| `SEED_ADMIN_PASSWORD` | `CryptoExam@2026!` |
| `SEED_ON_START` | `true` (seeds DB on first boot, no-ops after) |
| `DEBUG` | `true` (dev OTP shown in UI — no Twilio needed) |
| `CORS_ALLOW_ORIGINS` | `https://cryptoexam-frontend.onrender.com` |
| `NEXT_PUBLIC_API_URL` | `https://cryptoexam-backend.onrender.com/api/v1` |
| `DATABASE_URL` | Injected from the managed Postgres service |

> **If Render assigns different service names** (e.g. `cryptoexam-backend-abc1`):
> - Update `CORS_ALLOW_ORIGINS` on the backend service to the actual frontend URL.
> - Update `NEXT_PUBLIC_API_URL` in the frontend build args to the actual backend URL.
> - Trigger **Manual Deploy → Clear build cache & deploy** on the frontend
>   (the API URL is baked in at build time).

---

## Path B — Docker Compose (self-hosted / local)

```bash
cd public
cp .env.example .env          # fill in JWT keys + any secrets you need
docker compose up -d          # builds all services
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000/docs |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

The frontend Dockerfile uses a **multi-stage build** with `output: "standalone"`:
- Stage 1 builds the app and inlines `NEXT_PUBLIC_*` env vars into the bundle.
- Stage 2 runs the minimal standalone server — no `node_modules`, no source files.

---

## Switching to production (real SMS OTP)

1. Get [Twilio](https://www.twilio.com/) credentials.
2. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` on the backend.
3. Set `DEBUG=false`.
4. Set `SEED_ADMIN_PHONE` to the real phone number.
5. Rotate the JWT keys (`scripts/gen-hq-keypair.mjs`).
6. Redeploy.

---

## Turning on the centre uplink (ZUUP-OS courier, §12/§13.4)

The public deployment is HQ for every exam centre: the Admin Station inside each
centre's locked OS pulls that centre's bundle from it before exam day and
delivers the sealed answer ledger back afterwards, with nobody logged in. Two
settings turn that on, and until both are done a production Edge will refuse
everything the courier brings it — deliberately.

**1. Give HQ a bundle-signing key** (Render dashboard → the API service →
Environment):

```
HQ_PROVISIONING_SIGNING_SEED = <openssl rand -hex 32>
```

Without it `GET /api/v1/centre-sync/hq-pubkey` answers `"signed": false`, and any
Edge configured with `HQ_PROVISIONING_PUBKEY` rejects its bundles with
`HQ_SIGNATURE_REQUIRED`. That is the correct failure: the signature is what stops
possession of a centre's transport credential — which necessarily sits in
plaintext on the station's USB stick — from being the power to write that
centre's roster.

Then read the public half back and put it on every centre's Edge:

```
curl https://<api>/api/v1/centre-sync/hq-pubkey
```

**2. Mint each centre's credential.** From the tier-0 console (Centre uplinks →
Issue), or from a shell when no System Admin is enrolled yet:

```
python scripts/centre_uplink.py --list
python scripts/centre_uplink.py --mint <centre-id>
```

Shown once — only its SHA-256 is stored. It goes into that centre's
`centre.conf` as `HQ_CENTRE_KEY`, alongside `HQ_BASE_URL=https://<api-host>`,
before `tools/provision-terminal.sh` signs the Admin Station's UKI. The full
sequence is in `private/zuup-os/docs/PRODUCTION-BRINGUP.md` §6.

---

## Notes / limits

- Free Render web services **sleep after ~15 min idle** — the first request after
  sleep takes ~50s. Fine for a demo; upgrade to paid for always-on.
- Free Postgres **expires after 90 days**.
- The **`private/`** stack (Edge, ZUUP-OS) is **not** deployed here by design — it
  is the air-gapped centre side and never touches the public internet.
