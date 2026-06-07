"""
CryptoExam Core — Application Configuration
Centralized settings via pydantic-settings. All secrets from environment.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ── Application ──
    APP_NAME: str = "CryptoExam Core"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    # ── Database ──
    DATABASE_URL: str = "postgresql+asyncpg://ce:dev_secret@localhost:5432/cryptoexam"

    # ── Redis ──
    REDIS_URL: str = "redis://localhost:6379"

    # ── Auth (RS256 JWT) ──
    JWT_PRIVATE_KEY_PATH: str = "./certs/jwt_private.pem"
    JWT_PUBLIC_KEY_PATH: str = "./certs/jwt_public.pem"
    JWT_ALGORITHM: str = "RS256"
    JWT_EXPIRY_HOURS: int = 4

    # ── Blockchain (Polygon Amoy) ──
    POLYGON_RPC_URL: str = "https://rpc-amoy.polygon.technology"
    POLYGON_CHAIN_ID: int = 80002
    DEPLOYER_PRIVATE_KEY: str = ""
    CRYPTOEXAM_CONTRACT_ADDRESS: str = ""
    ZKVERIFIER_CONTRACT_ADDRESS: str = ""

    # ── Cryptography ──
    DRAND_CHAIN_HASH: str = "8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce"

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
    ]

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
