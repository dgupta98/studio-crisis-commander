"""Layer 2 acceptance sweep — verifies all 7 spec acceptance criteria.

Exit code 0 if all pass, 1 otherwise. Prints one line per criterion.
"""

from __future__ import annotations

import subprocess
import sys
import time

from data.ch_client import client
from data.mv.apply import MV_NAMES, OTHER_TABLES, ROLLUP_TABLES
from data.mv.refresh import refresh_detections

MATCH_WINDOW_HOURS = 6
CRISIS_HIT_TARGET = 10   # ≥10 of 12


def _fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def check_1_ddl() -> None:
    with client() as c:
        present = {r[0] for r in c.query("SHOW TABLES").result_rows}
        weight_n = c.query("SELECT count() FROM film_region_weight").result_rows[0][0]
    missing_tables = set(ROLLUP_TABLES + OTHER_TABLES) - present
    missing_mvs = [mv for mv in MV_NAMES if mv not in present]
    if missing_tables or missing_mvs:
        _fail(f"missing tables={missing_tables} mvs={missing_mvs}")
    if weight_n != 3750:
        _fail(f"film_region_weight has {weight_n} rows, expected 3,750")
    print(f"PASS §1: 6 rollups + 6 MVs + 2 tables present, film_region_weight={weight_n:,}")


def check_2_rollups_nonempty() -> None:
    with client() as c:
        for name in ROLLUP_TABLES:
            n = c.query(f"SELECT count() FROM {name}").result_rows[0][0]
            if n == 0:
                _fail(f"{name} is empty — run data.mv.backfill")
    print("PASS §2: all 6 rollups non-empty")


def check_3_refresh_speed() -> None:
    t0 = time.perf_counter()
    refresh_detections(since_hours=168)
    dt = time.perf_counter() - t0
    if dt > 5.0:
        _fail(f"refresh took {dt:.2f}s, spec target < 5.0s")
    print(f"PASS §3: refresh_detections() wall time {dt:.2f}s")


def check_4_detection_rows() -> None:
    with client() as c:
        n = c.query("SELECT count() FROM detections").result_rows[0][0]
    if n < 20:
        _fail(f"detections has only {n} rows, spec target >= 20")
    print(f"PASS §4: detections has {n:,} rows")


def check_5_crisis_recall() -> int:
    """Count how many seeded crises have a matching detection within ±6h."""
    with client() as c:
        crises = c.query("""
            SELECT affected_film_id, affected_region, injection_timestamp
            FROM crisis_ground_truth FINAL
            WHERE is_live = 0
        """).result_rows
        hits = 0
        for fid, region, ts in crises:
            q = f"""
            SELECT count() FROM detections
            WHERE film_id = {int(fid)}
              AND region = '{region}'
              AND abs(dateDiff('hour', metric_ts, toDateTime('{ts}'))) <= {MATCH_WINDOW_HOURS}
            """
            n = c.query(q).result_rows[0][0]
            if n > 0:
                hits += 1
    print(f"§5 crisis recall: {hits}/{len(crises)} crises matched within ±{MATCH_WINDOW_HOURS}h")
    return hits


def check_6_determinism() -> None:
    with client() as c:
        before = c.query(
            "SELECT count(DISTINCT dedup_key) FROM detections"
        ).result_rows[0][0]
    refresh_detections(since_hours=168)
    with client() as c:
        after = c.query(
            "SELECT count(DISTINCT dedup_key) FROM detections"
        ).result_rows[0][0]
    if before != after:
        _fail(f"non-deterministic: before={before} after={after}")
    print(f"PASS §6: two consecutive refreshes → {after:,} unique dedup keys (equal)")


def check_7_boundary_grep() -> None:
    """Any file importing ch_client or clickhouse_connect outside backend/data/ is a violation."""
    r = subprocess.run(
        ["grep", "-rEln", r"(from data\.ch_client|import clickhouse_connect)",
         "backend/", "--include=*.py",
         "--exclude-dir=venv", "--exclude-dir=__pycache__"],
        capture_output=True, text=True, check=False,
    )
    bad = [p for p in r.stdout.strip().split("\n")
           if p and not p.startswith("backend/data/")]
    if bad:
        _fail(f"boundary violation — ch_client imported outside data/: {bad}")
    print("PASS §7: ch_client/clickhouse_connect imported only from backend/data/")


def main() -> None:
    check_1_ddl()
    check_2_rollups_nonempty()
    check_3_refresh_speed()
    check_4_detection_rows()
    hits = check_5_crisis_recall()
    if hits < CRISIS_HIT_TARGET:
        _fail(f"crisis recall {hits}/12 below target {CRISIS_HIT_TARGET}/12 — "
              "lower thresholds in detectors.py or investigate missed crises")
    print(f"PASS §5: crisis recall {hits}/12 >= {CRISIS_HIT_TARGET}/12")
    check_6_determinism()
    check_7_boundary_grep()
    print("\nAll Layer 2 acceptance checks PASSED.")


if __name__ == "__main__":
    main()
