"""Regenerate InvestigationResult JSON fixtures for Layer 3b acceptance.

Runs Layer 3a live against three hand-picked crisis dedup_keys and writes
one fixture per archetype. Costs ~$0.15 in Gemini calls. Run on demand:
    ./venv/bin/python -m agents.decision.tests.fixtures.regenerate_fixtures

Fixture archetypes (map to seeded crisis_ground_truth kinds):
  sentiment_collapse    → regional_sentiment_collapse
  marketing_overspend   → marketing_overspend
  competitor_collision  → competitor_release
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from data.ch_client import client
from agents.investigation.agent import invoke_investigation
from agents.investigation.contracts import DetectionIn


ARCHETYPES = {
    "sentiment_collapse":   "regional_sentiment_collapse",
    "marketing_overspend":  "marketing_overspend_low_roi",
    "competitor_collision": "competitor_release_impact",
}

MATCH_HOURS = 6
FIXTURE_DIR = Path(__file__).parent


def _pick_detection_for(kind: str) -> DetectionIn | None:
    sql = f"""
    SELECT toString(det.metric_ts), det.metric, det.film_id, det.region,
           det.detector, det.baseline_value, det.actual_value, det.magnitude,
           det.business_impact, det.severity, det.dedup_key
    FROM detections det
    INNER JOIN (
      SELECT affected_film_id, affected_region, injection_timestamp
      FROM crisis_ground_truth FINAL
      WHERE is_live = 0 AND type = '{kind}'
      LIMIT 1
    ) crisis
      ON det.film_id = crisis.affected_film_id
     AND det.region = crisis.affected_region
     AND abs(dateDiff('hour', det.metric_ts, crisis.injection_timestamp)) <= {MATCH_HOURS}
    ORDER BY det.severity DESC
    LIMIT 1
    """
    with client() as c:
        rows = c.query(sql).result_rows
    if not rows:
        return None
    r = rows[0]
    return DetectionIn(
        metric_ts=r[0], metric=r[1], film_id=int(r[2]), region=r[3],
        detector=r[4], baseline_value=float(r[5]), actual_value=float(r[6]),
        magnitude=float(r[7]), business_impact=float(r[8]),
        severity=float(r[9]), dedup_key=r[10],
    )


_RETRY_DELAY = 60  # seconds to wait on 429 before retrying


async def _invoke_with_retry(det: DetectionIn, name: str) -> object:
    """Invoke investigation, retrying once on 429 RESOURCE_EXHAUSTED."""
    for attempt in range(2):
        try:
            return await invoke_investigation(det)
        except Exception as exc:
            if attempt == 0 and "429" in str(exc):
                print(
                    f"[{name}] 429 rate-limit, waiting {_RETRY_DELAY}s ...",
                    flush=True,
                )
                await asyncio.sleep(_RETRY_DELAY)
                continue
            raise


async def main() -> int:
    exit_code = 0
    for i, (name, kind) in enumerate(ARCHETYPES.items()):
        if i > 0:
            # Brief cooldown between investigations to avoid QPM burst.
            print(f"[cooldown] sleeping 30s before next archetype ...", flush=True)
            await asyncio.sleep(30)
        det = _pick_detection_for(kind)
        if det is None:
            print(f"SKIP {name}: no non-live crisis of kind={kind!r}", file=sys.stderr)
            exit_code = 1
            continue
        print(f"[{name}] running Layer 3a against {det.dedup_key} ...", flush=True)
        result = await _invoke_with_retry(det, name)
        out = FIXTURE_DIR / f"inv_{name}.json"
        out.write_text(result.model_dump_json(indent=2))
        print(f"[{name}] wrote {out.name} ({out.stat().st_size} bytes)")
    return exit_code


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
