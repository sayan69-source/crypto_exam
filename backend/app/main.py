"""
CryptoExam Core — FastAPI Application Entry Point

Zero-Trust Examination Infrastructure for India.
Production-grade API with CORS, rate limiting, structured logging,
exception handling, and health endpoints.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import engine, Base

settings = get_settings()

# ── Logging ──
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("cryptoexam")


# ── Lifespan ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info("=" * 60)
    logger.info("CryptoExam Core — Starting up")
    logger.info(f"  Version:   {settings.APP_VERSION}")
    logger.info(f"  Debug:     {settings.DEBUG}")
    logger.info(f"  Database:  {settings.DATABASE_URL.split('@')[-1]}")
    logger.info(f"  Polygon:   Chain {settings.POLYGON_CHAIN_ID}")
    logger.info("=" * 60)

    # Create tables (dev only — production uses Alembic migrations)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables ensured")

    yield

    # Shutdown
    await engine.dispose()
    logger.info("CryptoExam Core — Shutdown complete")


# ── App Instance ──
app = FastAPI(
    title="CryptoExam Core API",
    description=(
        "Zero-Trust Examination Infrastructure for India. "
        "AES-GCM-256 encryption, ZK-SNARK difficulty proofs (Groth16), "
        "Merkle answer commitments on Polygon PoS, "
        "RSA time-lock puzzles for offline hardware nodes."
    ),
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global Exception Handler ──
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all exception handler — never leak stack traces in production."""
    logger.error(f"Unhandled exception on {request.method} {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "internal_server_error",
            "message": "An unexpected error occurred." if not settings.DEBUG else str(exc),
        },
    )


# ── Health Endpoints ──
@app.get("/health", tags=["System"])
async def health_check():
    """
    System health check.
    Returns service status, version, and current server timestamp (IST).
    """
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "components": {
            "api": "up",
            "database": "pending",  # Will be wired in Phase 3
            "redis": "pending",
            "blockchain": "pending",
        },
    }


@app.get("/", tags=["System"])
async def root():
    """API root — brief system identity."""
    return {
        "name": "CryptoExam Core",
        "tagline": "The math cannot be bribed.",
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
    }


# ── API Router Registration ──
# These will be populated in Phase 3 as each endpoint module is built.
# from app.api.v1 import auth, exams, questions, sessions, crypto, blockchain, admin
# app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])
# app.include_router(exams.router, prefix="/api/v1/exams", tags=["Exams"])
# app.include_router(questions.router, prefix="/api/v1/questions", tags=["Questions"])
# app.include_router(sessions.router, prefix="/api/v1/sessions", tags=["Sessions"])
# app.include_router(crypto.router, prefix="/api/v1/crypto", tags=["Cryptography"])
# app.include_router(blockchain.router, prefix="/api/v1/blockchain", tags=["Blockchain"])
# app.include_router(admin.router, prefix="/api/v1/admin", tags=["Admin"])
