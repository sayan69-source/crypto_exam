"""
Form assembly and beacon-driven selection (design doc §5.3, §6.1).

This is where "a question setter cannot leak the paper" stops being a promise
and becomes arithmetic.

Two separate times, deliberately:

  T−14d, at HQ    build N candidate forms under hard constraints. Slow, and it
                  does not matter — nobody is waiting.
  T₀, at the Edge `idx = HKDF(beacon) mod N`. One index. No solver, no floating
                  point, nothing that can drift between two independently built
                  images, so 3,000 centres cannot disagree about which paper
                  today's is.

The constraint that carries the anti-leak property is the author cap: no single
setter may contribute more than `MAX_AUTHOR_SHARE` of any form. A fully corrupt
setter who leaks everything they ever wrote compromises that fraction of the
paper and no more.

Honest limits, both recorded in the design doc:
  * HQ knows the paper is one of N (§6.1) — bounded above by the pool it already
    distributes, and removable via §6.1a once the pool is calibrated.
  * The unit of secrecy is the TEMPLATE, not the item (§5.1a-A): siblings share
    a formula, so no two siblings may sit on one form and exposure is tracked
    per family.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
from collections import Counter
from dataclasses import dataclass

# §5.3.3 — no setter may own more than this share of a single form.
MAX_AUTHOR_SHARE = 0.05


class AssemblyError(Exception):
    """Refuse rather than relax a constraint — silently relaxing is how a paper
    ends up over-weighted to one author without anyone noticing."""


@dataclass
class CandidateItem:
    item_id: str
    author_id: str | None
    template_pk: str
    subject: str


@dataclass
class Form:
    index: int
    item_ids: list[str]
    form_hash: str
    max_author_share: float


def _author_cap(paper_length: int) -> int:
    """
    ⌈0.05·k⌉ — a true ceiling, with a floor of 1 so tiny papers stay assemblable.

    `int(k * 0.05)` truncates before rounding and would give 4 for a 90-item
    paper where the design says 5.
    """
    return max(1, math.ceil(paper_length * MAX_AUTHOR_SHARE))


def minimum_authors(paper_length: int) -> int:
    """
    How many distinct setters a paper of this length REQUIRES.

    A direct consequence of the cap that is easy to miss until assembly fails:
    at a 5% share each, a paper needs at least 1/0.05 = 20 authors, and no pool
    depth compensates for having fewer. Surfaced as a function because "add more
    items" is the natural and wrong response to the failure it causes.
    """
    return -(-paper_length // _author_cap(paper_length))


def check_blueprint_feasible(
    pool: list[CandidateItem],
    blueprint: dict[str, int],
) -> None:
    """
    Verify a blueprint CAN be satisfied, before anything commits to it.

    The prototype found this the hard way: "no two siblings on one form" caps
    paper length at the number of distinct templates, so a blueprint can be
    quietly impossible. Discovering that at T₀ means every centre fails at the
    same instant with no recovery path — which is why feasibility is checked at
    commit time and this function exists separately.
    """
    paper_length = sum(blueprint.values())
    by_subject: Counter[str] = Counter(i.subject for i in pool)
    distinct_templates = len({i.template_pk for i in pool})

    problems: list[str] = []
    for subject, need in blueprint.items():
        have = by_subject.get(subject, 0)
        if have < need:
            problems.append(f"{subject}: blueprint needs {need}, pool holds {have}")

    if distinct_templates < paper_length:
        problems.append(
            f"only {distinct_templates} distinct templates for a {paper_length}-item paper; "
            "no two siblings may share a form, so paper length cannot exceed template count"
        )

    cap = _author_cap(paper_length)
    by_author = Counter(i.author_id for i in pool if i.author_id)
    if by_author:
        # If one author owns nearly everything, the cap is unsatisfiable.
        reachable = sum(min(n, cap) for n in by_author.values())
        if reachable < paper_length:
            problems.append(
                f"author cap of {cap} per setter admits at most {reachable} items, "
                f"short of the {paper_length} required. This paper needs at least "
                f"{minimum_authors(paper_length)} distinct setters (it has {len(by_author)}) — "
                "more items from the same authors will not help"
            )

    if problems:
        raise AssemblyError("blueprint is not satisfiable: " + "; ".join(problems))


def build_forms(
    pool: list[CandidateItem],
    blueprint: dict[str, int],
    *,
    count: int = 8,
    seed: bytes = b"cryptoexam:forms",
) -> list[Form]:
    """
    Build `count` distinct candidate forms under the blueprint and the caps.

    Deterministic given the same pool and seed, so a form set is reproducible
    from committed inputs — an auditor can rebuild it rather than trust it. A
    greedy draw is used rather than a MIP because the property that matters here
    is satisfying hard constraints, and this runs at HQ where an optimiser could
    be swapped in without changing anything downstream (§6.1).
    """
    check_blueprint_feasible(pool, blueprint)
    paper_length = sum(blueprint.values())
    cap = _author_cap(paper_length)

    forms: list[Form] = []
    seen: set[str] = set()

    for n in range(count):
        chosen: list[CandidateItem] = []
        used_templates: set[str] = set()
        per_author: Counter[str] = Counter()

        for subject, need in sorted(blueprint.items()):
            # Order this subject's items by a keyed hash: stable, unbiased, and
            # different for each form without needing a random source.
            candidates = sorted(
                (i for i in pool if i.subject == subject),
                key=lambda i: hmac.new(seed, f"{n}:{i.item_id}".encode(), hashlib.sha256).digest(),
            )
            taken = 0
            for item in candidates:
                if taken == need:
                    break
                if item.template_pk in used_templates:
                    continue                       # §5.1a-A: never two siblings
                if item.author_id and per_author[item.author_id] >= cap:
                    continue                       # §5.3.3: the anti-leak cap
                chosen.append(item)
                used_templates.add(item.template_pk)
                if item.author_id:
                    per_author[item.author_id] += 1
                taken += 1

            if taken < need:
                raise AssemblyError(
                    f"form {n}: could not fill {subject} — needed {need}, placed {taken}. "
                    "The sibling rule or the author cap exhausted the eligible items."
                )

        item_ids = [i.item_id for i in chosen]
        form_hash = hashlib.sha256(json.dumps(item_ids, sort_keys=True).encode()).hexdigest()
        if form_hash in seen:
            continue                                # skip duplicates rather than emit them
        seen.add(form_hash)

        worst = max(per_author.values()) / paper_length if per_author else 0.0
        forms.append(Form(index=len(forms), item_ids=item_ids, form_hash=form_hash, max_author_share=worst))

    if not forms:
        raise AssemblyError("no distinct form could be assembled from this pool")
    return forms


def form_set_root(forms: list[Form]) -> str:
    """
    The commitment published at T−7d. Anyone can later check that the form which
    ran was one of the committed set, and that the beacon chose it.
    """
    leaves = [bytes.fromhex(f.form_hash) for f in sorted(forms, key=lambda f: f.index)]
    if not leaves:
        raise AssemblyError("cannot commit an empty form set")
    level = leaves
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level), 2):
            if i + 1 >= len(level):
                nxt.append(level[i])          # promote the orphan, never duplicate
                continue
            nxt.append(hashlib.sha256(b"\x01" + level[i] + level[i + 1]).digest())
        level = nxt
    return level[0].hex()


def select_form_index(beacon_hex: str, exam_id: str, form_count: int) -> int:
    """
    The T₀ draw. Two lines, and that is the point.

    Deliberately NOT an optimisation: a MIP solution can differ between solver
    versions, and two centres sitting different papers is a worse incident than
    a leak. An index derived from a public beacon is identical everywhere and
    recomputable by anyone afterwards.
    """
    if form_count <= 0:
        raise AssemblyError("no forms to select from")
    material = hmac.new(
        bytes.fromhex(beacon_hex),
        f"cryptoexam:form:{exam_id}".encode(),
        hashlib.sha256,
    ).digest()
    return int.from_bytes(material, "big") % form_count
