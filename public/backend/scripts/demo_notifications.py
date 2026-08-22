"""
Drive the cross-feature notification flow end to end, over real HTTP.

  python scripts/demo_notifications.py [--base http://127.0.0.1:8000/api/v1]

WHAT IT DEMONSTRATES
--------------------
One event, raised in the centre uplink by a caller with NO user session, read
back from the notifications feed by a caller with a SYSTEM_ADMIN token and no
centre credential. The two halves share nothing but the notification row, which
is the whole point of the feature.

It performs, in order:
  1. mints a centre + its uplink credential (directly, so the script needs no
     pre-seeded database);
  2. POSTs a genuinely signed sealed bundle as the centre's Admin Station would;
  3. POSTs the SAME bundle again — a courier retry, which must NOT raise a
     second notification;
  4. POSTs a TAMPERED bundle, which must be refused AND recorded;
  5. reads the tier-0 feed and prints what an operator would see.

It prints a SYSTEM_ADMIN bearer token at the end so the console can be opened
in a browser against the same data.

This is a demo/verification tool, not part of the application. It writes to
whatever database the API it is pointed at is using, so point it at a local
instance, never at production.
"""

import argparse
import asyncio
import hashlib
import json
import sys
import uuid
from pathlib import Path

import httpx

# A Windows console defaults to cp1252, which cannot encode the arrows and
# bullets below — the script would die mid-demo with a UnicodeEncodeError after
# having already performed its side effects, which is the worst possible moment
# to fail. Reconfiguring is enough; `errors="replace"` keeps a terminal that
# still cannot cope from turning a display problem into a crash.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):  # not a real TTY, or already redirected
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


NODE = Ed25519PrivateKey.from_private_bytes(bytes(range(32)))


def build_bundle(centre_id: str, exam_id: str, count: int, salt: str) -> dict:
    """A bundle whose chain and envelopes genuinely verify — the same
    construction the Edge uses, so the API is not accepting an invention."""
    s = salt.encode()
    prev = bytes(32)
    records = []
    for i in range(count):
        ct = hashlib.sha256(s + b"ct" + bytes([i])).digest() * 2
        iv = hashlib.sha256(s + b"iv" + bytes([i])).digest()[:12]
        tag = hashlib.sha256(s + b"tag" + bytes([i])).digest()[:16]
        dk = hashlib.sha256(s + b"dk" + bytes([i])).digest() * 8
        leaf = hashlib.sha256(ct + iv + tag + dk).digest()
        root = hashlib.sha256(prev + leaf).digest()
        records.append({
            "examId": exam_id, "seatNo": f"{salt}-{i:02d}", "leafIndex": i,
            "leaf": leaf.hex(), "prevRoot": prev.hex(), "chainRoot": root.hex(),
            "nodeRootSig": NODE.sign(root).hex(),
            "ciphertext": ct.hex(), "iv": iv.hex(), "authTag": tag.hex(),
            "wrappedDk": dk.hex(),
        })
        prev = root

    manifest = {"centreId": centre_id, "count": count, "records": records,
                "exportedAt": 1_700_000_000_000}
    mh = hashlib.sha256(_canonical(manifest)).digest()
    return {"manifest": manifest, "manifestHash": mh.hex(),
            "nodeSig": NODE.sign(mh).hex(),
            "nodePubkey": NODE.public_key().public_bytes_raw().hex()}


async def seed_centre(name: str) -> tuple[str, str]:
    """Create a centre with an uplink credential, straight into the database.

    Done directly rather than through the API because minting a credential is a
    tier-0 action and this script's whole point is to show the UNAUTHENTICATED
    courier half working.
    """
    from app.api.v1.centre_sync import hash_sync_key
    from app.database import Base, engine, async_session
    from app.models import Center

    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)

    centre_id, key = str(uuid.uuid4()), uuid.uuid4().hex * 2
    async with async_session() as s:
        s.add(Center(id=centre_id, name=name, state="WB", sync_key_hash=hash_sync_key(key)))
        await s.commit()
    return centre_id, key


def mint_admin_token() -> str:
    from app.models import UserRole
    from app.services.auth import create_access_token

    token, _expires = create_access_token(
        user_id=uuid.uuid4(),
        role=UserRole.SYSTEM_ADMIN,
        email="tier0@demo.local",
    )
    return token


def show(step: str, detail: str = "") -> None:
    print(f"\n\033[1m{step}\033[0m{(' — ' + detail) if detail else ''}")


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000/api/v1")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    exam_id = str(uuid.uuid4())

    # A leaf is sha256 over its envelope and nothing else — not the exam, not
    # the centre — so a fixed salt would rebuild byte-identical leaves on every
    # run and the FIRST delivery would deduplicate against the previous run's,
    # reporting stored=0. The demo would then appear to show the retry rule
    # rejecting a genuinely new delivery. A per-run salt keeps each run's
    # records distinct in a database that persists between them.
    run = uuid.uuid4().hex[:8]

    centre_id, centre_key = await seed_centre("Kolkata Centre 7")
    courier = {"x-centre-id": centre_id, "x-centre-key": centre_key}
    token = mint_admin_token()
    tier0 = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(timeout=30) as http:
        show("0. baseline", "what tier-0 sees before anything happens")
        r = await http.get(f"{base}/notifications/summary", headers=tier0)
        r.raise_for_status()
        print(f"   unread = {r.json()['unread']}")

        show("1. a centre delivers", "no user, no session — just a centre credential")
        r = await http.post(f"{base}/centre-sync/ledger", headers=courier,
                            json=build_bundle(centre_id, exam_id, 3, f"{run}A"))
        print(f"   HTTP {r.status_code} → {r.json()}")

        show("2. the courier retries the same bundle", "must NOT raise a second notification")
        r = await http.post(f"{base}/centre-sync/ledger", headers=courier,
                            json=build_bundle(centre_id, exam_id, 3, f"{run}A"))
        print(f"   HTTP {r.status_code} → {r.json()}")

        show("3. a TAMPERED bundle arrives", "must be refused AND recorded")
        bad = build_bundle(centre_id, exam_id, 3, f"{run}B")
        bad["manifest"]["records"][1]["ciphertext"] = "ff" * 64
        mh = hashlib.sha256(_canonical(bad["manifest"])).digest()
        bad["manifestHash"] = mh.hex()
        bad["nodeSig"] = NODE.sign(mh).hex()
        r = await http.post(f"{base}/centre-sync/ledger", headers=courier, json=bad)
        print(f"   HTTP {r.status_code} → {r.json()}")

        show("4. a second, genuinely new delivery")
        r = await http.post(f"{base}/centre-sync/ledger", headers=courier,
                            json=build_bundle(centre_id, exam_id, 2, f"{run}C"))
        print(f"   HTTP {r.status_code} → {r.json()}")

        show("5. what tier-0 now sees", "a different caller, a different credential")
        r = await http.get(f"{base}/notifications", headers=tier0)
        r.raise_for_status()
        feed = r.json()
        print(f"   unread = {feed['unread']}, events = {feed['count']}\n")
        for n in feed["notifications"]:
            mark = " " if n["read"] else "●"
            print(f"   {mark} [{n['severity']:<8}] {n['title']}")
            print(f"       {n['kind']}  via {n['sourceFeature']}  {n['createdAt']}")
            print(f"       {json.dumps(n['payload'])}")

        show("6. acknowledging clears the badge, keeps the history")
        r = await http.post(f"{base}/notifications/read-all", headers=tier0)
        print(f"   acknowledged {r.json()['acknowledged']} → unread now {r.json()['unread']}")
        r = await http.get(f"{base}/notifications", headers=tier0)
        print(f"   history still holds {r.json()['count']} event(s)")

    print("\n" + "=" * 72)
    print("Open the console against this data:")
    print(f"  centre id   {centre_id}")
    print(f"  exam id     {exam_id}")
    print("\nSYSTEM_ADMIN bearer token (paste into sessionStorage as cryptoexam_session.token):")
    print(f"  {token}")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
