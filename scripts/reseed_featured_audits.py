#!/usr/bin/env python3
"""Reset decision_audit and reseed one fresh row per featured (film_id, region).

The Movie Detail page reads its "Latest investigation" and "Recommendations"
tiles from the ClickHouse `decision_audit` table via
`list_recent_audit_for_film` (backend/api/routers/catalog.py:37). Rows written
before recent SQL/prompt fixes are cached there and will not self-refresh, so
after any change to the Decision agent (action templates, thresholds, prompt,
NaN handling, region taxonomy) the demo movies still surface stale
recommendations.

This script:
  1. Truncates decision_audit (unless --no-truncate is passed).
  2. Enumerates featured (film_id, region) pairs from
     `data/eval_cache/*.json` — the same source `build_shelves` uses to
     populate the "Featured" shelf.
  3. For each pair, POSTs /inject-crisis to the target backend and polls
     decision_audit until a new row for that (film_id, region) appears.
     Runs are sequential — the pipeline is long-running (30-120s each) and
     parallel injects would race for ClickHouse and Gemini quota.

Usage:
    python scripts/reseed_featured_audits.py --dry-run          # preview only
    python scripts/reseed_featured_audits.py                    # reseed all featured
    python scripts/reseed_featured_audits.py --film-id 123      # only one film
    python scripts/reseed_featured_audits.py --no-truncate      # keep existing rows
    python scripts/reseed_featured_audits.py \\
        --api-url http://localhost:8000                          # target local backend
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

try:
    from dotenv import load_dotenv
    load_dotenv(REPO_ROOT / ".env")
except ImportError:
    pass

from data.ch_client import client  # noqa: E402


DEFAULT_API_URL = "https://scc-api-845114229642.us-east1.run.app"
CACHE_DIR = REPO_ROOT / "data" / "eval_cache"

POLL_INTERVAL_S = 3.0
POLL_TIMEOUT_S = 180.0

# The pre-recorded scenarios in data/eval_cache/*.json were captured when the
# seed used ISO-3166-ish region codes ("US", "Germany", "Canada"). The current
# generator emits a 15-region taxonomy (backend/data/region_split.py::REGIONS)
# and everything else — modal picker, decision SQL, telemetry queries — is
# aligned to that list. If we inject with the stale cache region, ClickHouse
# returns 0 rows and the pipeline falls back to replaying the cached triple
# (defeating the point of reseeding). Map each stale value to its closest
# canonical region so every featured film gets a genuine live pipeline run.
REGION_ALIASES: dict[str, str] = {
    "US": "NA",
    "Canada": "NA",
    "Mexico": "LATAM",
    "Germany": "EU-West",
    "France": "EU-West",
    "Spain": "EU-West",
    "Italy": "EU-West",
}


def _load_featured_pairs() -> list[tuple[int, str, str]]:
    """(film_id, region, scenario_id) for every cached triple, sorted by sid.

    Same source as backend/api/catalog/shelves.py::_cached_film_map — one
    entry per file so we never seed the same film twice from two scenarios.
    """
    if not CACHE_DIR.is_dir():
        raise SystemExit(f"eval_cache dir missing: {CACHE_DIR}")
    seen: set[int] = set()
    pairs: list[tuple[int, str, str]] = []
    for p in sorted(CACHE_DIR.glob("*.json")):
        try:
            payload = json.loads(p.read_text())
            det = payload.get("detection", {})
            fid = int(det.get("film_id", -1))
            region = str(det.get("region", "")).strip()
        except Exception as e:  # noqa: BLE001
            print(f"WARN: bad cache file {p.name}: {e}", file=sys.stderr)
            continue
        if fid <= 0 or not region or fid in seen:
            continue
        seen.add(fid)
        pairs.append((fid, REGION_ALIASES.get(region, region), p.stem))
    return pairs


def _post_inject(api_url: str, film_id: int, region: str) -> str:
    """POST /inject-crisis and return run_id. Raises on non-2xx."""
    body = json.dumps({
        "film_id": film_id,
        "region": region,
        # ctype/magnitude=null → injector picks a random crisis type +
        # baseline magnitude, matching what a UI-driven inject does.
    }).encode()
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/inject-crisis",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
        payload = json.loads(resp.read())
    return str(payload["run_id"])


def _wait_for_audit(
    film_id: int, region: str, started_utc: datetime,
) -> tuple[bool, str | None]:
    """Poll decision_audit for a row newer than started_utc for this pair.

    Returns (ok, status). ok=False means we timed out.
    """
    deadline = time.monotonic() + POLL_TIMEOUT_S
    ts_str = started_utc.strftime("%Y-%m-%d %H:%M:%S")
    sql = (
        "SELECT status FROM decision_audit FINAL "
        f"WHERE film_id = {int(film_id)} "
        f"AND region = '{region.replace(chr(39), chr(39) * 2)}' "
        f"AND created_at >= toDateTime('{ts_str}') "
        "ORDER BY created_at DESC LIMIT 1"
    )
    while time.monotonic() < deadline:
        with client() as c:
            rows = c.query(sql).result_rows
        if rows:
            return True, str(rows[0][0])
        time.sleep(POLL_INTERVAL_S)
    return False, None


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__.strip().splitlines()[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--api-url", default=DEFAULT_API_URL,
                   help=f"Backend base URL (default: {DEFAULT_API_URL})")
    p.add_argument("--film-id", type=int, default=None,
                   help="Reseed only this featured film (default: all)")
    p.add_argument("--no-truncate", action="store_true",
                   help="Skip TRUNCATE decision_audit (append fresh rows only)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print what would happen; touch nothing")
    args = p.parse_args()

    pairs = _load_featured_pairs()
    if args.film_id is not None:
        pairs = [x for x in pairs if x[0] == args.film_id]
        if not pairs:
            print(f"film_id {args.film_id} is not in eval_cache/", file=sys.stderr)
            return 1

    print(f"target API:      {args.api_url}")
    print(f"featured pairs:  {len(pairs)}")
    for fid, region, sid in pairs:
        print(f"  {sid:>8}  film_id={fid:<5}  region={region}")

    if args.dry_run:
        print("\ndry run — nothing changed.")
        return 0

    if not args.no_truncate:
        print("\nTRUNCATE TABLE decision_audit …")
        with client() as c:
            c.command("TRUNCATE TABLE decision_audit")
            n = c.query("SELECT count() FROM decision_audit").result_rows[0][0]
        print(f"  rows remaining: {n}")

    ok_count = 0
    fail_count = 0
    for i, (fid, region, sid) in enumerate(pairs, 1):
        started = datetime.now(timezone.utc)
        print(f"\n[{i}/{len(pairs)}] inject {sid} — film_id={fid} region={region}")
        try:
            run_id = _post_inject(args.api_url, fid, region)
        except urllib.error.HTTPError as e:
            print(f"  ERROR: HTTP {e.code} {e.reason}", file=sys.stderr)
            fail_count += 1
            continue
        except urllib.error.URLError as e:
            print(f"  ERROR: {e.reason}", file=sys.stderr)
            fail_count += 1
            continue
        print(f"  run_id={run_id} — polling decision_audit "
              f"(≤{int(POLL_TIMEOUT_S)}s)…")
        ok, status = _wait_for_audit(fid, region, started)
        if ok:
            print(f"  OK — status={status}")
            ok_count += 1
        else:
            print(f"  TIMEOUT — no audit row after {int(POLL_TIMEOUT_S)}s",
                  file=sys.stderr)
            fail_count += 1

    print(f"\ndone. ok={ok_count}  failed={fail_count}  total={len(pairs)}")
    return 0 if fail_count == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
