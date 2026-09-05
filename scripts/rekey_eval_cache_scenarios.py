"""Re-key eval_cache/*.json scenarios to the current films table.

TMDB refreshes reshuffle the popularity ranking, and seed_tmdb assigns film_id
sequentially by rank — so the film_id embedded in each scenario file (baked when
the scenario was recorded) can drift to point at a different movie. This script
rewrites each scenario in place so its detection.film_id matches whatever
film_id in the CURRENT films table has the same title as the scenario's
detection.film_title.

Scenarios whose original title is no longer in the top-250 are reassigned to a
popular film that isn't yet covered by another scenario. That keeps the
Featured shelf at ~30 films and gives every scenario a valid target.

Idempotent: safe to re-run after another refresh.

Run from repo root:
    ./backend/venv/bin/python scripts/rekey_eval_cache_scenarios.py
    ./backend/venv/bin/python scripts/rekey_eval_cache_scenarios.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND_DIR / ".env")

from data.ch_client import client  # noqa: E402

EVAL_CACHE_DIR = REPO_ROOT / "data" / "eval_cache"


def _load_films() -> tuple[dict[str, int], list[tuple[int, str]]]:
    """Return (title -> film_id) plus a popularity-sorted (film_id, title) list."""
    with client() as c:
        rows = list(c.query(
            "SELECT film_id, title, popularity FROM films ORDER BY popularity DESC",
        ).result_rows)
    title_to_id: dict[str, int] = {}
    pop_sorted: list[tuple[int, str]] = []
    for r in rows:
        title_to_id[str(r[1])] = int(r[0])
        pop_sorted.append((int(r[0]), str(r[1])))
    return title_to_id, pop_sorted


def _load_scenarios() -> list[tuple[Path, dict]]:
    return [
        (p, json.loads(p.read_text()))
        for p in sorted(EVAL_CACHE_DIR.glob("*.json"))
    ]


def _rewrite_scenario(payload: dict, new_film_id: int, new_title: str | None) -> None:
    """Rewrite film_id and (optionally) film_title in every embedded location."""
    det = payload.setdefault("detection", {})
    det["film_id"] = int(new_film_id)
    if new_title:
        det["film_title"] = new_title

    # investigation.detection is a nested copy — keep in sync
    inv = payload.get("investigation") or {}
    inv_det = inv.get("detection") or {}
    if inv_det:
        inv_det["film_id"] = int(new_film_id)
        if new_title:
            inv_det["film_title"] = new_title

    # decision.actions[].params commonly encode film_id — rewrite when present
    dec = payload.get("decision") or {}
    for a in dec.get("actions") or []:
        params = a.get("params") or {}
        if "film_id" in params:
            params["film_id"] = int(new_film_id)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    title_to_id, pop_sorted = _load_films()
    scenarios = _load_scenarios()

    # First pass: direct title matches.
    plan: list[tuple[Path, dict, int, str | None, str]] = []  # path, payload, new_id, new_title, reason
    claimed_ids: set[int] = set()
    unmatched: list[tuple[Path, dict]] = []

    for path, payload in scenarios:
        old_id = int(payload.get("detection", {}).get("film_id", -1))
        title = payload.get("detection", {}).get("film_title", "")
        new_id = title_to_id.get(title)
        if new_id is not None and new_id not in claimed_ids:
            claimed_ids.add(new_id)
            action = "KEEP" if new_id == old_id else "REKEY"
            plan.append((path, payload, new_id, None, f"{action} title-match {old_id}->{new_id}"))
        else:
            unmatched.append((path, payload))

    # Second pass: assign unmatched scenarios to popular films not yet claimed.
    fallback_pool = [fid for fid, _title in pop_sorted if fid not in claimed_ids]
    for path, payload in unmatched:
        if not fallback_pool:
            print(f"  {path.name}: NO fallback film available — skipping", file=sys.stderr)
            continue
        new_id = fallback_pool.pop(0)
        # New title so the scenario's embedded film_title matches the reassignment
        new_title = next((t for fid, t in pop_sorted if fid == new_id), None)
        claimed_ids.add(new_id)
        old_id = int(payload.get("detection", {}).get("film_id", -1))
        old_title = payload.get("detection", {}).get("film_title", "?")
        plan.append((path, payload, new_id, new_title,
                     f"REASSIGN {old_id}({old_title!r})->{new_id}({new_title!r})"))

    print(f"Plan: {len(plan)} scenarios")
    print()
    for path, _payload, new_id, new_title, reason in plan:
        print(f"  {path.name}: {reason}")

    if args.dry_run:
        print("\n--dry-run: no files written.")
        return

    rewrites = 0
    for path, payload, new_id, new_title, reason in plan:
        _rewrite_scenario(payload, new_id, new_title)
        path.write_text(json.dumps(payload, indent=2))
        rewrites += 1
    print(f"\nWrote {rewrites} files.")


if __name__ == "__main__":
    main()
