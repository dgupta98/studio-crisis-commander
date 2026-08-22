#!/usr/bin/env python3
"""Backfill TMDB poster_path for every film in ClickHouse.

Writes `backend/data/seed/poster_paths.json` — a `{tmdb_id: poster_path}`
map that `backend/api/catalog/shelves.py` reads at import to build image
URLs of the form `https://image.tmdb.org/t/p/w342{poster_path}`.

Usage:
    export TMDB_API_KEY=…   # or have it in .env
    ./scripts/backfill_posters.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

# Load .env so the script works standalone the same way the seed script does.
try:
    from dotenv import load_dotenv
    load_dotenv(REPO_ROOT / ".env")
except ImportError:
    pass

from data.ch_client import client  # noqa: E402

TMDB_BASE = "https://api.themoviedb.org/3"
OUT_PATH = REPO_ROOT / "backend" / "data" / "seed" / "poster_paths.json"


def main() -> int:
    key = os.getenv("TMDB_API_KEY")
    if not key:
        print("ERROR: TMDB_API_KEY not set (check .env)", file=sys.stderr)
        return 1

    with client() as c:
        rows = list(c.query("SELECT film_id, tmdb_id FROM films ORDER BY film_id").result_rows)
    print(f"Backfilling posters for {len(rows)} films…")

    existing: dict[str, str] = {}
    if OUT_PATH.exists():
        existing = json.loads(OUT_PATH.read_text())
        print(f"  resuming from {len(existing)} existing entries")

    out: dict[str, str] = dict(existing)
    ok = 0
    fail = 0
    for i, (_film_id, tmdb_id) in enumerate(rows, 1):
        key_str = str(int(tmdb_id))
        if key_str in out and out[key_str]:
            ok += 1
            continue
        try:
            r = requests.get(
                f"{TMDB_BASE}/movie/{int(tmdb_id)}",
                params={"api_key": key},
                timeout=10,
            )
            if r.status_code == 200:
                poster = (r.json().get("poster_path") or "").strip()
                out[key_str] = poster
                if poster:
                    ok += 1
                else:
                    fail += 1
            else:
                out[key_str] = ""
                fail += 1
        except Exception as e:  # noqa: BLE001
            print(f"  tmdb_id={tmdb_id} failed: {e}", file=sys.stderr)
            out[key_str] = ""
            fail += 1
        if i % 25 == 0:
            print(f"  {i}/{len(rows)} (ok={ok}, missing={fail})")
            OUT_PATH.write_text(json.dumps(out, indent=2, sort_keys=True))
        time.sleep(0.05)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2, sort_keys=True))
    print(f"Wrote {OUT_PATH} ({ok} with poster, {fail} missing)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
