# Deploying the public CryptoExam website (free tier)

One-click via the **Render Blueprint** (`render.yaml`): a free Postgres + the
FastAPI backend + the Next.js frontend. ~10 minutes; you authorise once.

> The repo only needs **you** to log into Render and set the secrets below — the
> code is already wired to real data (no mock), and live exams/candidates/centres
> are real database rows served by the API.

## Steps

1. **Generate a stable JWT keypair** (so logins survive restarts):
   ```bash
   openssl genrsa -out jwt_private.pem 2048
   openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
   ```

2. **Render → New → Blueprint → select this repo.** Render reads `render.yaml`
   and creates `cryptoexam-db`, `cryptoexam-backend`, `cryptoexam-frontend`.

3. **Set the backend secrets** (Environment tab of `cryptoexam-backend`):
   | Key | Value |
   |-----|-------|
   | `JWT_PRIVATE_KEY_PEM` | contents of `jwt_private.pem` |
   | `JWT_PUBLIC_KEY_PEM` | contents of `jwt_public.pem` |
   | `SEED_ADMIN_PASSWORD` | a **strong** password (replaces the public demo one) |
   | `SEED_ADMIN_PHONE` | your admin phone, e.g. `+9190000xxxxx` |
   | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | your Twilio creds (real OTP SMS) |
   | `CORS_ALLOW_ORIGINS` | the frontend URL once known, e.g. `https://cryptoexam-frontend.onrender.com` |

4. **Wire the frontend → backend.** After the backend is live, copy its URL, then
   set `cryptoexam-frontend` → `NEXT_PUBLIC_API_URL` = `https://<backend>.onrender.com/api/v1`
   and **Manual Deploy → Clear build cache & deploy** (it's baked in at build time).

5. Open the frontend URL. Admin login: `admin@cryptoexam.dev` + your
   `SEED_ADMIN_PASSWORD`, then the OTP sent to `SEED_ADMIN_PHONE`.

## Security checklist (for "no flaw")

- [x] `DEBUG=false` — the dev OTP-in-response path is then **off**; codes go only by SMS.
- [x] **Real OTP** requires the Twilio vars above; without them login can't deliver a code.
- [x] **Stable JWT keys** via env (sessions survive restarts).
- [x] **Admin password** set via `SEED_ADMIN_PASSWORD` — the public demo password is never live.
- [x] **CORS** locked to the frontend origin via `CORS_ALLOW_ORIGINS`.
- [ ] Optional: rotate the seeded setter/candidate demo passwords too if this is public-facing.

## Notes / limits
- Free web services **sleep after ~15 min idle** — the first request after a sleep
  is slow (~50s cold start). Fine for a demo; upgrade to paid for always-on.
- Free Postgres **expires after 90 days**.
- The **private/** stack (Edge, ZUUP-OS) is **not** deployed here by design — it is
  the air-gapped centre side and never touches the public internet.
