"""
CryptoExam Core — Async Database Engine
SQLAlchemy 2.0 async with PostgreSQL 16 via asyncpg.
"""

from typing import Awaitable, Callable

from fastapi import Request, Response
from fastapi.routing import APIRoute
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


async def get_db(request: Request) -> AsyncSession:
    """
    FastAPI dependency — yields an async database session.

    The session is also parked on `request.state` so `CommitBeforeResponseRoute`
    can commit it while the client is still waiting. The commit below stays as a
    backstop for anything not served through that route class (and is a no-op
    once the route class has already committed).
    """
    async with async_session() as session:
        request.state.db = session
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


class CommitBeforeResponseRoute(APIRoute):
    """
    Commit the request's session before the response goes out.

    FastAPI runs the teardown half of a `yield` dependency *after* the response
    has been sent, so `get_db`'s commit landed too late: a client that POSTed
    and then immediately GET the thing it had just created could get a 404 for
    a write that was still in flight. Sealing a paper and reading back its root
    failed exactly this way, and the window is wide enough to lose a real user
    interaction, not just a test.

    Committing here closes that window — by the time the caller has its 200, the
    write is durable.
    """

    def get_route_handler(self) -> Callable[[Request], Awaitable[Response]]:
        original = super().get_route_handler()

        async def commit_then_respond(request: Request) -> Response:
            response = await original(request)
            session: AsyncSession | None = getattr(request.state, "db", None)
            if session is not None and session.in_transaction():
                await session.commit()
            return response

        return commit_then_respond


def commit_before_response(router) -> None:
    """
    Make every route on `router` commit before it answers.

    Setting `router.route_class` here would be too late — the decorators have
    already built the routes by the time a module is imported, and
    `include_router` copies each one using `type(route)`. Re-pointing the
    existing instances is what actually takes effect. The subclass adds no state,
    only a wrapper around the handler, so the instances stay valid.

    Called once for all routers in main.py, so a new router cannot forget it.
    """
    for route in router.routes:
        if type(route) is APIRoute:
            route.__class__ = CommitBeforeResponseRoute
