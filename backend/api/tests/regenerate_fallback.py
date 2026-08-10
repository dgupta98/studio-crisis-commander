"""Regenerate api/cached/fallback_triple.json from a real pipeline run.

Runs the FULL live pipeline once on a canonical crisis (sentiment_collapse
on film_id=1, region='Brazil'), captures the four artifacts, writes JSON.

Cost: ~$0.10 (one Layer 3a + one Layer 3b run).
Rerun only when the DetectionIn / InvestigationResult / DecisionResult /
ExecutiveReport contracts change.

Usage:
    PYTHONPATH=. ./venv/bin/python -m api.tests.regenerate_fallback
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from agents.decision.agent import invoke_decision
from agents.investigation.agent import invoke_investigation
from agents.report.agent import invoke_report
from api.detection_source import produce_detection
from api.fallback import CACHED_TRIPLE_PATH
from data.crisis_injector import inject_now
from data.ground_truth import CrisisType


CANONICAL = {
    "ctype": CrisisType.REGIONAL_SENTIMENT_COLLAPSE,
    "film_id": 1,
    "region": "Brazil",
    "magnitude": 8.0,
}


async def main() -> None:
    crisis = inject_now(
        ctype=CANONICAL["ctype"],
        film_id=CANONICAL["film_id"],
        region=CANONICAL["region"],
        magnitude=CANONICAL["magnitude"],
    )
    det, src = await produce_detection(crisis, poll_seconds=2.0)
    print(f"detection ready (source={src}); running investigation...", file=sys.stderr)
    inv = await invoke_investigation(det)
    print(f"investigation done; running decision...", file=sys.stderr)
    dec = await invoke_decision(inv)
    print(f"decision done ({len(dec.actions)} actions); running report...",
          file=sys.stderr)
    report = await invoke_report(inv, dec)
    print(f"report done ({len(report.key_figures)} key_figures); writing...",
          file=sys.stderr)

    payload = {
        "detection": det.model_dump(mode="json"),
        "investigation": inv.model_dump(mode="json"),
        "decision": dec.model_dump(mode="json"),
        "report": report.model_dump(mode="json"),
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "source_run_id": "regenerate_fallback",
    }
    Path(CACHED_TRIPLE_PATH).write_text(json.dumps(payload, indent=2, default=str))
    print(f"wrote {CACHED_TRIPLE_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
