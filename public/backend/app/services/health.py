"""
Real health probes for the admin dashboard.

WHY THIS EXISTS
---------------
`/admin/dashboard` returned this, unconditionally:

    "system_health": {
        "database": "healthy", "redis": "healthy",
        "blockchain": "connected", "ipfs": "connected",
    }

Four string literals. Nothing was checked. On this machine Redis and IPFS are
not running at all and the dashboard still reported them connected — and the
"System Healthy" badge in the console header read from exactly that. A console
whose job is to report the state of an examination system was inventing it.

Each probe below answers one question by actually asking, reports UNCONFIGURED
distinctly from DOWN (a service you never set up is not a fault), and is bounded
by a short timeout so a hung dependency cannot hang the dashboard.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

logger = logging.getLogger(__name__)

# A dashboard must render promptly even when a dependency is wedged. Each probe
# gets its own budget and they all run concurrently.
_TIMEOUT = 2.5

UP = "up"
DOWN = "down"
UNCONFIGURED = "unconfigured"      # not set up — not the same as broken
DEGRADED = "degraded"


async def _probe_database(db: AsyncSession) -> dict[str, Any]:
    """The one dependency that cannot be absent — if this fails, nothing works."""
    try:
        await asyncio.wait_for(db.execute(text("SELECT 1")), timeout=_TIMEOUT)
        url = get_settings().DATABASE_URL
        kind = "sqlite" if url.startswith("sqlite") else "postgres" if "postgres" in url else "other"
        return {"status": UP, "detail": kind}
    except asyncio.TimeoutError:
        return {"status": DOWN, "detail": f"no response in {_TIMEOUT}s"}
    except Exception as exc:
        return {"status": DOWN, "detail": type(exc).__name__}


async def _probe_redis() -> dict[str, Any]:
    """Redis backs Celery and the broadcast fan-out; absent means local-only."""
    url = (get_settings().REDIS_URL or "").strip()
    if not url:
        return {"status": UNCONFIGURED, "detail": "REDIS_URL not set"}
    try:
        import redis.asyncio as aioredis
    except ImportError:
        return {"status": UNCONFIGURED, "detail": "redis client not installed"}
    client = None
    try:
        client = aioredis.from_url(url, socket_connect_timeout=_TIMEOUT)
        await asyncio.wait_for(client.ping(), timeout=_TIMEOUT)
        return {"status": UP, "detail": "ping ok"}
    except Exception as exc:
        return {"status": DOWN, "detail": type(exc).__name__}
    finally:
        if client is not None:
            try:
                await client.aclose()
            except Exception:
                pass


async def _probe_blockchain() -> dict[str, Any]:
    """
    An RPC that answers is not the same as a contract that exists. Both are
    reported, because "connected" while pointing at no contract is how the old
    dashboard implied anchoring was working when nothing was deployed.
    """
    s = get_settings()
    rpc = (s.POLYGON_RPC_URL or "").strip()
    if not rpc:
        return {"status": UNCONFIGURED, "detail": "POLYGON_RPC_URL not set"}
    try:
        import httpx

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(rpc, json={"jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1})
        if r.status_code >= 400:
            return {"status": DOWN, "detail": f"HTTP {r.status_code}"}
        block = int(r.json().get("result", "0x0"), 16)
    except Exception as exc:
        return {"status": DOWN, "detail": type(exc).__name__}

    contract = (s.CRYPTOEXAM_CONTRACT_ADDRESS or "").strip()
    if not contract or contract.startswith("<"):
        return {"status": DEGRADED, "detail": f"RPC ok (block {block}) but no contract deployed"}
    return {"status": UP, "detail": f"block {block}"}


async def _probe_ipfs() -> dict[str, Any]:
    """Content store for sealed bundles. Optional — bundles can be served by the API."""
    url = (getattr(get_settings(), "IPFS_API_URL", "") or "").strip()
    if not url:
        return {"status": UNCONFIGURED, "detail": "IPFS_API_URL not set"}
    try:
        import httpx

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(f"{url.rstrip('/')}/api/v0/version")
        if r.status_code >= 400:
            return {"status": DOWN, "detail": f"HTTP {r.status_code}"}
        return {"status": UP, "detail": f"kubo {r.json().get('Version', '?')}"}
    except Exception as exc:
        return {"status": DOWN, "detail": type(exc).__name__}


async def system_health(db: AsyncSession) -> dict[str, Any]:
    """
    Probe every dependency concurrently and summarise.

    `overall` is UP only when nothing is DOWN. An UNCONFIGURED optional service
    does not make the system unhealthy — it was never asked for — but a
    configured one that stopped answering does.
    """
    database, redis_s, chain, ipfs = await asyncio.gather(
        _probe_database(db), _probe_redis(), _probe_blockchain(), _probe_ipfs(),
    )
    parts = {"database": database, "redis": redis_s, "blockchain": chain, "ipfs": ipfs}

    # Only the database is load-bearing. Redis (Celery / broadcast fan-out),
    # the chain (anchoring) and IPFS (bundle hosting) are optional: this server
    # has served every request in this session with none of them running, so
    # reporting the whole system DOWN because an optional service is absent is
    # exactly as untrue as the four hardcoded "healthy" strings were.
    #
    # Note the defaults in config.py mean REDIS_URL and IPFS_API_URL are always
    # populated, so "configured" cannot distinguish wanted from merely
    # defaulted — which is why absence degrades rather than fails.
    OPTIONAL = ("redis", "blockchain", "ipfs")

    if parts["database"]["status"] != UP:
        overall = DOWN
    elif any(parts[k]["status"] in (DOWN, DEGRADED) for k in OPTIONAL):
        overall = DEGRADED
    else:
        overall = UP

    return {
        "overall": overall,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        # Named so the UI can explain a DEGRADED state instead of just colouring it.
        "optional_down": [k for k in OPTIONAL if parts[k]["status"] in (DOWN, DEGRADED)],
        **parts,
    }
