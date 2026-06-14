"""
CryptoExam Core — FastAPI Application Entry Point

Zero-Trust Examination Infrastructure for India.
Production-grade API with CORS, rate limiting, structured logging,
exception handling, and health endpoints.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
import os

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

    # § 27 — start the exam broadcast service (Redis pub/sub or local fan-out)
    try:
        from app.services.broadcast_service import broadcast_service
        await broadcast_service.startup()
    except Exception as e:
        logger.warning(f"Broadcast service startup skipped: {e}")

    # Seed on startup in dev (DEBUG) OR when SEED_ON_START=true (set this on a
    # prod deploy so a fresh DB gets its admin/exams/centres without turning DEBUG
    # on). The seeder is idempotent — it no-ops once the DB is already seeded.
    if settings.DEBUG or os.getenv("SEED_ON_START", "").lower() == "true":
        try:
            from app.services.seeder import seed_database
            from app.database import async_session
            async with async_session() as session:
                result = await seed_database(session)
                await session.commit()
                logger.info(f"Auto-seed result: {result}")
        except Exception as e:
            logger.warning(f"Auto-seed skipped: {e}")

    yield

    # Shutdown
    try:
        from app.services.broadcast_service import broadcast_service
        await broadcast_service.shutdown()
    except Exception:
        pass
    await engine.dispose()
    logger.info("CryptoExam Core — Shutdown complete")


# ── App Instance ──
app = FastAPI(
    title="CryptoExam Core API",
    description=(
        "Zero-Trust Examination Infrastructure for India. "
        "AES-GCM-256 encryption, ZK-SNARK difficulty proofs (Groth16), "
        "Merkle answer commitments on Polygon PoS."
    ),
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──
# Production hosts set CORS_ALLOW_ORIGINS to the deployed frontend URL(s),
# comma-separated; it is merged with the local dev defaults.
import os as _os
_extra_origins = [o.strip() for o in _os.getenv("CORS_ALLOW_ORIGINS", "").split(",") if o.strip()]
_allow_origins = list(dict.fromkeys([*settings.CORS_ORIGINS, *_extra_origins]))
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
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
            "database": "up",
            "redis": "pending",
            "blockchain": "configured" if settings.CRYPTOEXAM_CONTRACT_ADDRESS else "not_configured",
        },
        "crypto_engine": {
            "aes_gcm_256": "ready",
            "drand_client": "ready",
            "merkle_tree": "ready",
            "shamir_sss": "ready",
            "zk_snark": "ready",
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
        "about": "/api/v1/about",
        "transparency": "/api/v1/about/transparency",
        "api": {
            "about": "/api/v1/about",
            "auth": "/api/v1/auth",
            "exams": "/api/v1/exams",
            "sessions": "/api/v1/sessions",
            "crypto": "/api/v1/crypto",
            "blockchain": "/api/v1/blockchain",
            "admin": "/api/v1/admin",
            "generation": "/api/v1/generation",
            "invigilator": "/api/v1/invigilator",
        },
    }


@app.post("/api/v1/seed", tags=["System"])
async def seed_data():
    """
    Trigger database seeding with demo data.
    Only available in DEBUG mode.
    """
    if not settings.DEBUG:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=403, content={"error": "Seeding disabled in production"})

    try:
        from app.services.seeder import seed_database
        from app.database import async_session
        async with async_session() as session:
            result = await seed_database(session)
            await session.commit()
            return {"status": "success", "data": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ── API Router Registration ──
from app.api.v1 import auth, exams, sessions, crypto, blockchain, admin, websockets, invigilator, question_modes, broadcast, complaint, emergency, ceremony, about, delivery, sys_ledger, staff_reg, provisioning
from app.api.routes.generation import router as generation_router
from app.api.routes.lifecycle import router as lifecycle_router

app.include_router(about.router, prefix="/api/v1/about", tags=["About / Transparency (public)"])
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(exams.router, prefix="/api/v1/exams", tags=["Exams"])
app.include_router(sessions.router, prefix="/api/v1/sessions", tags=["Sessions"])
app.include_router(crypto.router, prefix="/api/v1/crypto", tags=["Cryptography"])
app.include_router(delivery.router, prefix="/api/v1/delivery", tags=["Sealed Question Delivery (§10.7)"])
app.include_router(blockchain.router, prefix="/api/v1/blockchain", tags=["Blockchain"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["Admin"])
app.include_router(websockets.router, prefix="/ws", tags=["WebSocket"])
app.include_router(invigilator.router, prefix="/api/v1/invigilator", tags=["Invigilator"])
app.include_router(question_modes.router, prefix="/api/v1/question-modes", tags=["Question Modes"])
app.include_router(broadcast.router, prefix="/api/v1/broadcast", tags=["Mass Delivery (§27)"])
app.include_router(complaint.router, prefix="/api/v1/complaint", tags=["Complaint Resolution (V3 §9)"])
app.include_router(emergency.router, prefix="/api/v1/emergency", tags=["Emergency Dual-Control (V3 §10)"])
app.include_router(ceremony.router, prefix="/api/v1/ceremony", tags=["Key Ceremony (CC-SSS §§54-55)"])
app.include_router(generation_router, prefix="/api/v1/generation", tags=["AI Generation"])
app.include_router(lifecycle_router, prefix="/api/v1/lifecycle", tags=["Exam Lifecycle"])
app.include_router(sys_ledger.router, prefix="/api/v1/sys", tags=["System Admin Answer Ledger (ZUUP-OS §13.5)"])
app.include_router(staff_reg.router, prefix="/api/v1/staff", tags=["Centre Staff Registration (public → Edge relay)"])
app.include_router(provisioning.router, prefix="/api/v1/provisioning", tags=["HQ→Edge Pre-Exam Provisioning (§12)"])


