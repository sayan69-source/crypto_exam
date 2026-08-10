"""
CryptoExam Core — Application Configuration
Centralized settings via pydantic-settings. All secrets from environment.
"""

from pathlib import Path

from pydantic_settings import BaseSettings
from functools import lru_cache

# public/  — this file is public/backend/app/config.py, so up three levels.
# Resolved from __file__ rather than the working directory so the server picks
# up the same config whether it is started from the repo root, from
# public/backend, or by a process manager with its own cwd.
_REPO_PUBLIC_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ── Application ──
    APP_NAME: str = "CryptoExam Core"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    # ── Database ──
    DATABASE_URL: str = "sqlite+aiosqlite:///./cryptoexam.db"

    # ── Redis ──
    REDIS_URL: str = "redis://localhost:6379"

    # ── Auth (RS256 JWT) ──
    JWT_PRIVATE_KEY_PATH: str = "./certs/jwt_private.pem"
    JWT_PUBLIC_KEY_PATH: str = "./certs/jwt_public.pem"
    JWT_ALGORITHM: str = "RS256"
    JWT_EXPIRY_HOURS: int = 4

    # ── OTP / SMS (login second factor) ──
    OTP_TTL_SECONDS: int = 300          # 5 minutes
    OTP_MAX_ATTEMPTS: int = 5
    # Twilio SMS gateway — set these in the environment to deliver real SMS.
    # Leave blank in dev: the OTP is then returned in the API response + logged
    # (clearly flagged delivery="dev") so the flow is testable without a gateway.
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""

    # ── OTP by email (login second factor, no gateway cost) ──
    # The OTP flow was SMS-only, so an account registered with an email and no
    # phone — which is every self-registered setter — could never receive its
    # second factor and could never log in. Plain SMTP over STARTTLS fixes that
    # for free: Gmail with an App Password, Zoho, a university relay, anything.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""                 # e.g. "CryptoExam Core <no-reply@…>"

    # ── Tier-0 System Admin (WebAuthn fingerprint + IP allowlist) ──
    # Enrolment is possible ONLY from these addresses. Comma-separated, plain
    # addresses or CIDR. EMPTY MEANS DISABLED, not open — failing closed is the
    # only safe default for the tier that can decrypt answers. Discover the
    # address to allowlist with GET /api/v1/sysadmin/status.
    SYSTEM_ADMIN_ALLOWED_IPS: str = ""
    # WebAuthn relying party. RP ID must be the site's registered domain (or a
    # parent of it); `localhost` is treated as secure by browsers for testing.
    WEBAUTHN_RP_ID: str = "localhost"
    WEBAUTHN_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # ── Blockchain (Polygon Amoy) ──
    POLYGON_RPC_URL: str = "https://rpc-amoy.polygon.technology"
    POLYGON_CHAIN_ID: int = 80002
    DEPLOYER_PRIVATE_KEY: str = ""
    CRYPTOEXAM_CONTRACT_ADDRESS: str = ""
    ZKVERIFIER_CONTRACT_ADDRESS: str = ""

    # ── Cryptography ──
    DRAND_CHAIN_HASH: str = "8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce"

    # ── Fail-closed switches (default OFF — a missing capability must be an
    #    error, never a convincing-looking substitute) ──────────────────────
    #
    # Each of these used to be an unconditional silent fallback, which is the
    # worst possible shape for a security claim: the guarantee disappears and
    # nothing says so. They are now opt-in, loudly labelled in every response
    # they touch, and must never be set in a demo that claims the guarantee.
    #
    # The time-lock is derived from the drand beacon. Without drand the
    # fallback was sha256(current_unix_second) — computable by anyone for any
    # future second, which means the paper unlocks early for whoever bothers.
    ALLOW_INSECURE_DRAND_FALLBACK: bool = False
    # Groth16 proving needs a compiled circuit + proving key. Without them the
    # code returned hardcoded field elements shaped like a proof.
    ALLOW_SIMULATED_ZK_PROOF: bool = False
    # On-chain anchoring needs an RPC and a deployed contract. Without them the
    # code returned sha256(payload) shaped like a transaction hash.
    ALLOW_SIMULATED_CHAIN_TX: bool = False
    # Mode 1 question "generation" without an LLM emits one grammatical frame
    # per topic whose correct answer is always "A", tagged ai_generated=True.
    ALLOW_TEMPLATE_QUESTIONS: bool = False

    # ── AI / LLM ──
    LLM_BASE_URL: str = "http://localhost:11434/v1"
    LLM_MODEL: str = "llama3.1:70b"
    OPENAI_API_KEY: str = ""

    # ── IPFS ──
    IPFS_API_URL: str = "http://localhost:5001"

    # ── Celery ──
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/1"

    # ── hCaptcha ──
    HCAPTCHA_SECRET_KEY: str = ""

    # ── CORS ──
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:80",
        "http://localhost:3001",
    ]

    # Look for `.env` in BOTH the backend directory and the repo's `public/`.
    #
    # `env_file: ".env"` alone resolves relative to the process's working
    # directory, so it only ever found `public/backend/.env`. Every document in
    # this repo — the README, the setup guide, `.env.example` — tells an
    # operator to configure `public/.env`, which was therefore silently
    # ignored: SMTP credentials could be filled in correctly and the server
    # would still report "no gateway configured". Both paths are read, with the
    # backend-local file winning where they overlap.
    model_config = {
        "env_file": (
            str(_REPO_PUBLIC_DIR / ".env"),   # public/.env  — the documented one
            ".env",                            # public/backend/.env — local override
        ),
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
        "extra": "ignore",
    }


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
