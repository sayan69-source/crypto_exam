"""
CryptoExam Core — Async Database Engine
SQLAlchemy 2.0 async with PostgreSQL 16 via asyncpg.
"""

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()


def _normalise_db_url(url: str) -> str:
    """Managed Postgres hosts (Render, Heroku, Supabase) hand out
    `postgres://` / `postgresql://` URLs, but SQLAlchemy's async engine needs
    the asyncpg driver. Rewrite the scheme so DATABASE_URL works as-is."""
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    # asyncpg rejects libpq's ?sslmode= query arg; strip it (TLS is negotiated).
    if "+asyncpg" in url and "sslmode=" in url:
        import re
        url = re.sub(r"[?&]sslmode=[^&]+", "", url)
    return url


DATABASE_URL = _normalise_db_url(settings.DATABASE_URL)

_engine_kwargs = {
    "echo": settings.DEBUG,
}
if "sqlite" not in DATABASE_URL:
    _engine_kwargs.update(pool_size=20, max_overflow=10, pool_pre_ping=True)

engine = create_async_engine(
    DATABASE_URL,
    **_engine_kwargs,
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency — yields an async database session."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
