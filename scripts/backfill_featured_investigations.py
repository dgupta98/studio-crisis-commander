"""Backfill decision_audit rows for every featured film × top-5 regions.

For each film that has an eval_cache scenario (featured), compute its top 5
regions by 7d box-office volume and INSERT a cloned+re-attributed audit row
for any (film_id, region) combo that doesn't already have one. Mirrors the
`fallback: "force"` path in api/pipeline.py: same clone-and-remap logic, same
audit_insert + audit_attach_report calls, but done in a batch loop instead of
via HTTP kickoffs. No Gemini calls, no HTTP server needed.

Idempotent: existing (film_id, region) rows in decision_audit are skipped.

Run from repo root:
    ./backend/venv/bin/python scripts/backfill_featured_investigations.py

Options:
    --top-k N     Regions per featured film (default 5)
    --dry-run     Print the plan without inserting
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND_DIR / ".env")

from agents.decision.audit import audit_attach_report, audit_insert  # noqa: E402
from agents.decision.contracts import DecisionResult  # noqa: E402
from agents.investigation.contracts import (  # noqa: E402
    DetectionIn, InvestigationResult,
)
from agents.report.contracts import ExecutiveReport  # noqa: E402
from data.ch_client import client  # noqa: E402

EVAL_CACHE_DIR = REPO_ROOT / "data" / "eval_cache"


def _load_scenarios() -> dict[int, dict]:
    """film_id -> scenario payload (each scenario pins one film)."""
    out: dict[int, dict] = {}
    for p in sorted(EVAL_CACHE_DIR.glob("*.json")):
        payload = json.loads(p.read_text())
        fid = int(payload.get("detection", {}).get("film_id", -1))
        if fid > 0 and fid not in out:
            out[fid] = payload
    return out


def _existing_audit_pairs() -> set[tuple[int, str]]:
    """(film_id, region) pairs already present in decision_audit FINAL."""
    with client() as c:
        rows = list(c.query(
            "SELECT DISTINCT film_id, region FROM decision_audit FINAL",
        ).result_rows)
    return {(int(r[0]), str(r[1])) for r in rows}


def _top_regions_per_film(film_ids: list[int], k: int) -> dict[int, list[str]]:
    """film_id -> top-k regions by 7d box-office volume, anchored on max(date)
    so it works even when synthetic data ends before today."""
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
        fid = int(r[0])
        per.setdefault(fid, []).append(str(r[1]))
    return {fid: regs[:k] for fid, regs in per.items()}


def _clone_and_reattribute(
    payload: dict, film_id: int, region: str,
) -> tuple[InvestigationResult, DecisionResult, ExecutiveReport]:
    """Deep-copy the scenario triple, then rewrite film_id/region/IDs to
    match the target so the row lands on the right (film, region) row."""
    inv = InvestigationResult.model_validate(payload["investigation"])
    dec = DecisionResult.model_validate(payload["decision"])
    rep = ExecutiveReport.model_validate(payload["report"])

    # Rebuild IDs so ReplacingMergeTree treats this as a fresh row.
    inv.investigation_id = uuid4().hex
    dec.decision_id = uuid4().hex
    dec.investigation_id = inv.investigation_id

    # Remap detection identity so /latest-investigation?region=X finds it.
    d = inv.detection
    d.film_id = int(film_id)
    d.region = str(region)
    d.dedup_key = (
        f"{d.metric}|{d.film_id}|{d.region}|"
        f"{d.metric_ts.strftime('%Y-%m-%d %H:%M:%S')}|{d.detector}"
    )

    # Action params typically encode film_id/region — rewrite those too so the
    # visible copy in the panel matches the region the user selected.
    for a in dec.actions:
        if "film_id" in a.params:
            a.params["film_id"] = int(film_id)
        if "region" in a.params:
            a.params["region"] = str(region)

    # Report headline/tldr may name the original region — leave those alone;
    # the panel already labels the row by detection.region, and rewriting
    # freeform prose risks garbling references to specific numbers.
    rep.report_id = uuid4().hex
    rep.decision_id = dec.decision_id

    return inv, dec, rep


def _pick_source_scenario(
    target_film_id: int, target_region: str,
    scenarios: dict[int, dict], fallback_ids: list[int],
) -> dict:
    """Pick a source triple for (film, region). If the film's OWN scenario is
    pinned to this exact region, use it (identical narrative — best fidelity).
    Otherwise deterministic-hash across all scenarios so different regions of
    the same film get different template copy instead of all cloning the same
    one."""
    own = scenarios.get(target_film_id)
    if own is not None and own.get("detection", {}).get("region") == target_region:
        return own
    idx = (target_film_id * 31 + hash(target_region)) % len(fallback_ids)
    return scenarios[fallback_ids[idx]]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top-k", type=int, default=5)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    scenarios = _load_scenarios()
    if not scenarios:
        print("No eval_cache scenarios found — nothing to backfill.", file=sys.stderr)
        sys.exit(1)
    featured_ids = sorted(scenarios.keys())
    print(f"Loaded {len(scenarios)} scenarios covering film_ids {featured_ids[:5]}..{featured_ids[-1]}")

    top_by_film = _top_regions_per_film(featured_ids, args.top_k)
    have_pairs = _existing_audit_pairs()

    plan: list[tuple[int, str]] = []
    for fid in featured_ids:
        regs = top_by_film.get(fid, [])
        if not regs:
            print(f"  film {fid}: NO regions from box_office rollup — skipped")
            continue
        for region in regs:
            if (fid, region) in have_pairs:
                continue
            plan.append((fid, region))

    print(f"\nBackfill plan: {len(plan)} (film, region) inserts")
    print(f"  featured films: {len(featured_ids)}")
    print(f"  average target regions per film: "
          f"{sum(len(top_by_film.get(f, [])) for f in featured_ids) / len(featured_ids):.1f}")
    print(f"  already present in decision_audit: "
          f"{sum(1 for f in featured_ids for r in top_by_film.get(f, []) if (f, r) in have_pairs)}")

    if args.dry_run:
        print("\n--dry-run: exiting without inserts.")
        return

    if not plan:
        print("\nNothing to do — all (film, region) targets already have audit rows.")
        return

    print(f"\nInserting {len(plan)} audit rows ...")
    t0 = datetime.now(timezone.utc)
    ok = 0
    fail = 0
    for fid, region in plan:
        try:
            payload = _pick_source_scenario(fid, region, scenarios, featured_ids)
            inv, dec, rep = _clone_and_reattribute(payload, fid, region)
            audit_insert(dec, inv)
            audit_attach_report(dec.decision_id, rep)
            ok += 1
            if ok % 25 == 0:
                print(f"  inserted {ok}/{len(plan)}")
        except Exception as e:  # noqa: BLE001
            fail += 1
            print(f"  FAIL film={fid} region={region}: {type(e).__name__}: {e}",
                  file=sys.stderr)

    elapsed = (datetime.now(timezone.utc) - t0).total_seconds()
    print(f"\nDone: {ok} inserted, {fail} failed in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
