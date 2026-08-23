#!/usr/bin/env python3
"""One-shot backfill for films with 0 rows in review_scores.

The original _generate_review_scores only emitted rows for days strictly
AFTER a film's release_date, so films whose synthetic release_date sits
past the tail of the generated window (common for near-future titles)
ended up with 0 reviews — the Movie Detail Signals tile then showed 0.

The generator itself was fixed to emit a pre-release trickle in a later
commit, but the deployed data was already produced by the old code and
won't backfill on its own. This script:

  1. Enumerates films with count(*) = 0 in review_scores.
  2. Reuses the updated _generate_review_scores against those films
     using the same (center, window) the driver would pick, so the
     rows are consistent with what a full regeneration would emit.
  3. INSERTs the new rows.

Idempotent-ish: safe to re-run — films that already have review rows
are skipped, so a second run inserts nothing for the same targets.

Usage:
    python scripts/backfill_reviews.py            # dry run count
    python scripts/backfill_reviews.py --write    # actually insert
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

# Load .env so DBs/creds match how deploy scripts run.
try:
    from dotenv import load_dotenv
    load_dotenv(REPO_ROOT / ".env")
except ImportError:
    pass

from datetime import timedelta                     # noqa: E402

from data.ch_client import client, insert_batches  # noqa: E402
from data.generate_numeric import (                # noqa: E402
    _generate_review_scores, _load_films,
)


REVIEW_COLS = ["film_id", "source", "ts", "score", "review_count"]

# Per-film day window centered on release_date. _generate_review_scores
# emits rows only when dsr is in [-14, ...] pre-release OR > 0 post-release,
# so we anchor around each film's own release_date instead of the catalog
# median. Same window semantics as the driver but shifted per-film so late-
# releasing titles (which caused the original 0-row problem) still emit.
PRE_DAYS = 14
POST_DAYS = 60


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--write", action="store_true",
                   help="Actually INSERT rows. Without this flag, script "
                        "reports the row count it would insert.")
    args = p.parse_args()

    all_films = _load_films()
    if not all_films:
        print("No films seeded. Run seed_tmdb first.", file=sys.stderr)
        return 1

    with client() as c:
        rows = c.query(
            "SELECT film_id, count() AS n FROM review_scores GROUP BY film_id"
        ).result_rows
    have = {int(r[0]) for r in rows if int(r[1]) > 0}
    missing_ids = [f.film_id for f in all_films if f.film_id not in have]
    missing_films = [f for f in all_films if f.film_id in set(missing_ids)]

    print(f"films with reviews:    {len(have):>6}")
    print(f"films missing reviews: {len(missing_films):>6}")
    if not missing_films:
        print("nothing to backfill.")
        return 0

    # Build per-film windows and feed each film through the generator with
    # ITS OWN day range. A single shared window fails when release_dates
    # span > 120 days (tail films end up outside every day's [-14, +∞) mask).
    new_rows: list[list] = []
    for f in missing_films:
        days = [
            f.release_date + timedelta(days=i)
            for i in range(-PRE_DAYS, POST_DAYS + 1)
        ]
        new_rows.extend(_generate_review_scores([f], days))
    print(f"rows to insert:        {len(new_rows):>6,}")
    if not new_rows:
        print("generator produced 0 rows — check window vs. release_date.",
              file=sys.stderr)
        return 2

    if not args.write:
        print("dry run — pass --write to actually insert.")
        return 0

    n = insert_batches("review_scores", new_rows, REVIEW_COLS, batch_size=100_000)
    print(f"inserted {n:,} rows into review_scores")

    with client() as c:
        rows = c.query(
            "SELECT film_id, count() AS n FROM review_scores GROUP BY film_id"
        ).result_rows
    now_have = {int(r[0]) for r in rows if int(r[1]) > 0}
    still_missing = [f.film_id for f in all_films if f.film_id not in now_have]
    if still_missing:
        print(f"WARN: {len(still_missing)} films still have 0 review rows: "
              f"{still_missing[:10]}{'…' if len(still_missing) > 10 else ''}",
              file=sys.stderr)
    else:
        print("OK — every film now has at least one review row.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
