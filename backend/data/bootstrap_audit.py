"""Apply audit_schema.sql to ClickHouse. Idempotent (CREATE ... IF NOT EXISTS).

Layer 1 pattern: uses clickhouse-connect directly for one-shot DDL. This
module is bootstrap-only — it is NOT called from agent runtime. The
boundary rule that forbids clickhouse-connect in agents/ does not apply
here (this is data/).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from data.ch_client import client

SCHEMA_PATH = Path(__file__).parent / "audit_schema.sql"
EXPECTED_TABLE = "decision_audit"


def _split_statements(sql: str) -> list[str]:
    stripped = re.sub(r"--[^\n]*", "", sql)
    return [s.strip() for s in stripped.split(";") if s.strip()]


def apply() -> None:
    sql = SCHEMA_PATH.read_text()
    with client() as c:
        for stmt in _split_statements(sql):
            c.command(stmt)
    verify()


def verify() -> None:
    with client() as c:
        rows = c.query("SHOW TABLES").result_rows
        present = {r[0] for r in rows}
    if EXPECTED_TABLE not in present:
        print(f"MISSING table: {EXPECTED_TABLE}", file=sys.stderr)
        sys.exit(1)
    with client() as c:
        cols = c.query(f"DESCRIBE {EXPECTED_TABLE}").result_rows
        col_names = {r[0] for r in cols}
    required = {
        "decision_id", "investigation_id", "detection_dedup_key",
        "film_id", "region", "actions_json", "status", "threshold_usd",
        "agent_run_json", "report_json", "approval_status", "approver",
        "approval_note", "approved_at", "created_at", "updated_at",
    }
    missing = required - col_names
    if missing:
        print(f"decision_audit missing columns: {sorted(missing)}", file=sys.stderr)
        sys.exit(1)
    print(f"Audit schema OK: decision_audit ({len(col_names)} columns).")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--verify", action="store_true", help="Only verify, no apply.")
    args = p.parse_args()
    if args.verify:
        verify()
        return
    apply()


if __name__ == "__main__":
    main()
