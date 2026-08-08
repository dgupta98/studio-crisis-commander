"""Apply Layer 2 DDL and populate film_region_weight.

Idempotent. `--reset --yes` drops the 8 layer-2 objects first.
`--verify` prints the row counts required by acceptance criterion 1.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from data.ch_client import client
from data.region_split import REGIONS, weights_for

DDL_PATH = Path(__file__).parent / "ddl.sql"

ROLLUP_TABLES = [
    "roll_sentiment_hourly",
    "roll_social_hourly",
    "roll_trailer_hourly",
    "roll_streaming_hourly",
    "roll_marketing_daily",
    "roll_campaign_daily",
]

MV_NAMES = [
    "mv_sentiment_hourly",
    "mv_social_hourly",
    "mv_trailer_hourly",
    "mv_streaming_hourly",
    "mv_marketing_daily",
    "mv_campaign_daily",
]

OTHER_TABLES = ["film_region_weight", "detections"]


def _split_statements(sql: str) -> list[str]:
    stripped = re.sub(r"--[^\n]*", "", sql)
    return [s.strip() for s in stripped.split(";") if s.strip()]


def apply(reset: bool) -> None:
    sql = DDL_PATH.read_text()
    with client() as c:
        if reset:
            for mv in MV_NAMES:
                c.command(f"DROP VIEW IF EXISTS {mv}")
            for t in ROLLUP_TABLES + OTHER_TABLES:
                c.command(f"DROP TABLE IF EXISTS {t}")
            print(f"Dropped {len(MV_NAMES)} MVs + {len(ROLLUP_TABLES) + len(OTHER_TABLES)} tables.")
        for stmt in _split_statements(sql):
            c.command(stmt)
    populate_film_region_weight()
    verify()


def populate_film_region_weight() -> None:
    """Compute (film_id, region, weight) rows from films × REGIONS × genre affinity."""
    with client() as c:
        films = [(int(r[0]), str(r[1])) for r in
                 c.query("SELECT film_id, genre FROM films").result_rows]
        rows = []
        for fid, genre in films:
            w = weights_for(genre)
            for region in REGIONS:
                rows.append([fid, region, float(w[region])])
        c.command("TRUNCATE TABLE film_region_weight")
        c.insert("film_region_weight", rows,
                 column_names=["film_id", "region", "weight"])
    print(f"film_region_weight: {len(rows):,} rows written.")


def verify() -> None:
    expected_tables = set(ROLLUP_TABLES + OTHER_TABLES)
    with client() as c:
        present_tables = {r[0] for r in c.query("SHOW TABLES").result_rows}
        # MVs show up in SHOW TABLES too; check separately for clarity
        missing_tables = expected_tables - present_tables
        missing_mvs = [mv for mv in MV_NAMES if mv not in present_tables]
        weight_n = c.query("SELECT count() FROM film_region_weight").result_rows[0][0]
    if missing_tables:
        print(f"MISSING tables: {sorted(missing_tables)}", file=sys.stderr)
        sys.exit(1)
    print(f"Layer 2 DDL OK: {len(expected_tables)} tables present, "
          f"{len(MV_NAMES) - len(missing_mvs)}/{len(MV_NAMES)} MVs present, "
          f"film_region_weight={weight_n:,} rows.")
    if missing_mvs:
        print(f"(MVs not yet created: {missing_mvs} — expected until Task 4 lands.)")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--reset", action="store_true")
    p.add_argument("--yes", action="store_true")
    p.add_argument("--verify", action="store_true")
    args = p.parse_args()
    if args.verify:
        verify()
        return
    if args.reset and not args.yes:
        print("--reset requires --yes", file=sys.stderr)
        sys.exit(2)
    apply(reset=args.reset)


if __name__ == "__main__":
    main()
