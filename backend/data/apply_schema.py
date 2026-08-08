"""Apply schema.sql to ClickHouse. Idempotent by default; --reset --yes to drop first."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from data.ch_client import client

SCHEMA_PATH = Path(__file__).parent / "schema.sql"

EXPECTED_TABLES = {
    "films",
    "box_office_revenue",
    "streaming_watch_minutes",
    "trailer_analytics",
    "marketing_spend",
    "audience_sentiment",
    "social_trends",
    "ticket_refunds",
    "review_scores",
    "campaign_performance",
    "competitor_releases",
    "reviews_text",
    "crisis_ground_truth",
}


def _split_statements(sql: str) -> list[str]:
    stripped = re.sub(r"--[^\n]*", "", sql)
    return [s.strip() for s in stripped.split(";") if s.strip()]


def apply(reset: bool) -> None:
    sql = SCHEMA_PATH.read_text()
    with client() as c:
        if reset:
            for table in EXPECTED_TABLES:
                c.command(f"DROP TABLE IF EXISTS {table}")
            print(f"Dropped {len(EXPECTED_TABLES)} tables.")
        for stmt in _split_statements(sql):
            c.command(stmt)
    verify()


def verify() -> None:
    with client() as c:
        rows = c.query("SHOW TABLES").result_rows
        present = {r[0] for r in rows}
    missing = EXPECTED_TABLES - present
    extra = present - EXPECTED_TABLES
    if missing:
        print(f"MISSING tables: {sorted(missing)}", file=sys.stderr)
        sys.exit(1)
    print(f"Schema OK: {len(EXPECTED_TABLES)} expected tables present.")
    if extra:
        print(f"(Also present, not managed by this schema: {sorted(extra)})")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--reset", action="store_true", help="Drop tables first")
    p.add_argument("--yes", action="store_true", help="Required with --reset")
    p.add_argument("--verify", action="store_true", help="Only verify, no apply")
    args = p.parse_args()

    if args.verify:
        verify()
        return
    if args.reset and not args.yes:
        print("--reset requires --yes to confirm dropping tables.", file=sys.stderr)
        sys.exit(2)
    apply(reset=args.reset)


if __name__ == "__main__":
    main()
