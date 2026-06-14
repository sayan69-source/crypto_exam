# Deploying the public CryptoExam website (free tier)

One-click via the **Render Blueprint** (`render.yaml`): a free Postgres + the
FastAPI backend + the Next.js frontend. ~10 minutes; you authorise once.

> All secrets (JWT keys, admin creds, CORS, API URL) are **pre-filled** in
> `render.yaml`. The deploy is fully autonomous — no manual secret entry needed.

## Steps

1. **Push this repo to GitHub** (if not already done):
   ```bash
   git add -A && git commit -m "chore: prepare for Render deploy" && git push
   ```

2. **Render → New → Blueprint → select this repo.** Render reads `render.yaml`
   and creates `cryptoexam-db`, `cryptoexam-backend`, `cryptoexam-frontend`.

3. **Wait for the build** (~5-10 min for Docker builds on free tier).
   The backend will auto-seed the database on first boot (`SEED_ON_START=true`).

4. **Verify the deploy:**
   - Backend health: `https://cryptoexam-backend.onrender.com/health`
   - Frontend: `https://cryptoexam-frontend.onrender.com`

5. **Post-deploy tuning** (only if Render assigns different service names):
   - Update `CORS_ALLOW_ORIGINS` on the backend to match the actual frontend URL.
   - Update `NEXT_PUBLIC_API_URL` on the frontend to match the actual backend URL.
   - Trigger a **Manual Deploy → Clear build cache & deploy** on the frontend
     (the API URL is baked in at build time).

6. **Login:** `admin@cryptoexam.dev` / `CryptoExam@2026!`
   - Since `DEBUG=true`, the OTP code is returned in the login API response
     (no Twilio SMS needed). The frontend displays it automatically.

## Pre-filled secrets (in render.yaml)

| Key | Value / Source |
|-----|---------------|
| `JWT_PRIVATE_KEY_PEM` | Pre-generated RS256 2048-bit key |
| `JWT_PUBLIC_KEY_PEM` | Matching public key |
| `SEED_ADMIN_EMAIL` | `admin@cryptoexam.dev` |
| `SEED_ADMIN_PASSWORD` | `CryptoExam@2026!` |
| `SEED_ADMIN_PHONE` | `+919000000000` |
| `CORS_ALLOW_ORIGINS` | `https://cryptoexam-frontend.onrender.com` |
| `NEXT_PUBLIC_API_URL` | `https://cryptoexam-backend.onrender.com/api/v1` |
| `DEBUG` | `true` (dev OTP — no Twilio needed) |

## Switching to production (real SMS OTP)

1. Get [Twilio](https://www.twilio.com/) credentials.
2. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` on the backend.
3. Set `DEBUG=false`.
4. Set `SEED_ADMIN_PHONE` to your real phone number.
5. Redeploy.

## Notes / limits
- Free web services **sleep after ~15 min idle** — the first request after a sleep
  is slow (~50s cold start). Fine for a demo; upgrade to paid for always-on.
- Free Postgres **expires after 90 days**.
- The **private/** stack (Edge, ZUUP-OS) is **not** deployed here by design — it is
  the air-gapped centre side and never touches the public internet.
