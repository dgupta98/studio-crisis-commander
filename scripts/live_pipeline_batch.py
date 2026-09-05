"""Batch-run the real 4-agent pipeline (Gemini + MCP) for featured films.

For each (featured_film × top-K region) combo, run detection → investigation
→ decision → report in-process and persist to the audit table. Live Gemini
calls — takes ~60-120s per run and costs ~$0.10-0.30 per run.

Unlike scripts/backfill_featured_investigations.py (which clones cached
scenario triples), this generates genuinely per-region distinct data:
each run's investigation.findings + hypothesis reflect that film × region's
actual telemetry.

Concurrency: default 3 in flight — higher risks Vertex 499 CANCELLED
cascades that fall back to templated triples anyway, defeating the point.

Run from repo root:
    ./backend/venv/bin/python scripts/live_pipeline_batch.py --top-k 7

Options:
    --top-k N         Regions per featured film (default 7)
    --concurrency N   Simultaneous pipelines (default 3)
    --dry-run         Print plan without invoking Gemini
    --films 1,2,3     Only run for these film ids (subset for smoke testing)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND_DIR / ".env")

from agents.decision.agent import invoke_decision  # noqa: E402
from agents.decision.audit import (  # noqa: E402
    audit_attach_report, audit_insert,
)
from agents.investigation.agent import invoke_investigation  # noqa: E402
from agents.report.agent import invoke_report  # noqa: E402
from api.detection_source import produce_detection  # noqa: E402
from data.ch_client import client  # noqa: E402
from data.crisis_injector import inject_now  # noqa: E402

EVAL_CACHE_DIR = REPO_ROOT / "data" / "eval_cache"


def _featured_film_ids() -> list[int]:
    ids: set[int] = set()
    for p in sorted(EVAL_CACHE_DIR.glob("*.json")):
        payload = json.loads(p.read_text())
        fid = int(payload.get("detection", {}).get("film_id", -1))
        if fid > 0:
            ids.add(fid)
    return sorted(ids)


MANDATORY_REGIONS = ("India",)


def _top_regions(film_ids: list[int], k: int) -> dict[int, list[str]]:
    """Top-K by 7d box-office volume per film, but guarantee that every
    MANDATORY_REGIONS entry is included — user asked for "data till India"
    on every featured film, and volume-ranking alone drops India for a
    handful of Asia-Pacific-heavy titles."""
    if not film_ids:
        return {}
    ids_list = ",".join(str(int(x)) for x in film_ids)
    sql = (
        f"SELECT film_id, region, sum(revenue_usd) AS vol "
        f"FROM box_office_revenue "
        f"WHERE film_id IN ({ids_list}) "
        f"AND date >= coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id IN ({ids_list})),"
        f"  today()) - INTERVAL 7 DAY "
        f"GROUP BY film_id, region "
        f"ORDER BY film_id, vol DESC"
    )
    with client() as c:
        rows = list(c.query(sql).result_rows)
    per: dict[int, list[str]] = {}
    for r in rows:
        per.setdefault(int(r[0]), []).append(str(r[1]))
    out: dict[int, list[str]] = {}
    for fid, regs in per.items():
        # Guarantee mandatory regions are included even if they didn't make
        # the volume cut. Take top-(K - len(missing_mandatory)) volume regions,
        # then append the mandatory ones. Preserves K total per film.
        missing = [r for r in MANDATORY_REGIONS if r not in regs[:k]]
        keep = [r for r in regs[: max(0, k - len(missing))]]
        out[fid] = keep + missing
    return out


async def _one_run(film_id: int, region: str, idx: int, total: int) -> tuple[str, str | None]:
    """Run one full pipeline. Returns (status, decision_id_or_error)."""
    t0 = time.perf_counter()
    tag = f"[{idx:>3}/{total}] film={film_id:>3} region={region:<10s}"
    try:
        crisis = inject_now(
            ctype=None, film_id=film_id, region=region, magnitude=None,
        )
        det, _src = await produce_detection(crisis, poll_seconds=2.0)
        inv = await invoke_investigation(det)
        dec = await invoke_decision(inv)
        report = await invoke_report(inv, dec)
        # Persist — audit_insert now stores the full inv (with findings +
        # hypothesis) via the investigation_json column.
        await asyncio.to_thread(audit_insert, dec, inv)
        await asyncio.to_thread(audit_attach_report, dec.decision_id, report)
        elapsed = time.perf_counter() - t0
        print(f"  {tag} OK in {elapsed:5.1f}s  decision={dec.decision_id[:8]}...")
        return "ok", dec.decision_id
    except Exception as e:  # noqa: BLE001
        elapsed = time.perf_counter() - t0
        print(f"  {tag} FAIL in {elapsed:5.1f}s: {type(e).__name__}: {e}",
              file=sys.stderr)
        return "fail", f"{type(e).__name__}: {e}"


async def _bounded(sem: asyncio.Semaphore, coro):
    async with sem:
        return await coro


async def main_async(args: argparse.Namespace) -> None:
    featured_ids = _featured_film_ids()
    if args.films:
        wanted = set(int(x) for x in args.films.split(","))
        featured_ids = [f for f in featured_ids if f in wanted]
    if not featured_ids:
        print("No featured films matched — nothing to do.", file=sys.stderr)
        sys.exit(1)

    top_by_film = _top_regions(featured_ids, args.top_k)
    plan: list[tuple[int, str]] = []
    for fid in featured_ids:
        for region in top_by_film.get(fid, []):
            plan.append((fid, region))

    total = len(plan)
    print(f"Featured films: {len(featured_ids)}")
    print(f"Top-{args.top_k} regions per film")
    print(f"Total live pipelines: {total}")
    print(f"Concurrency: {args.concurrency}")
    est_min = (total * 90) / max(args.concurrency, 1) / 60
    print(f"Rough estimate: ~{est_min:.0f} min sequential-equivalent walltime")

    if args.dry_run:
        for fid, region in plan[:10]:
            print(f"  DRY film={fid} region={region}")
        if len(plan) > 10:
            print(f"  ... +{len(plan) - 10} more")
        return

    sem = asyncio.Semaphore(args.concurrency)
    t0 = time.perf_counter()
    tasks = [
        _bounded(sem, _one_run(fid, region, i + 1, total))
        for i, (fid, region) in enumerate(plan)
    ]
    results = await asyncio.gather(*tasks)
    elapsed = time.perf_counter() - t0
    ok = sum(1 for s, _ in results if s == "ok")
    fail = total - ok
    print(f"\nDone: {ok}/{total} succeeded, {fail} failed in {elapsed / 60:.1f} min")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top-k", type=int, default=7)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--films", type=str, default="",
                    help="Comma-separated film_ids to filter (default: all)")
    args = ap.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
