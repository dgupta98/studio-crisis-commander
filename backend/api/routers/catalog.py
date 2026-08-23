"""HTTP surface for the catalog module."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from agents.decision.audit import AuditRow, list_recent_audit_for_film
from api.catalog import shelves as catalog_shelves

log = logging.getLogger(__name__)

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/shelves")
async def shelves(region: str | None = Query(default=None, max_length=64)):
    return await asyncio.to_thread(catalog_shelves.build_shelves, region)


@router.get("/films/{film_id}")
async def film_detail(film_id: int):
    result = await asyncio.to_thread(catalog_shelves.get_film, film_id)
    if result is None:
        raise HTTPException(status_code=404, detail="film not found")
    return result


@router.get("/search")
async def search(q: str = Query(default="", max_length=64)):
    return await asyncio.to_thread(catalog_shelves.search_films, q)


@router.get("/films/{film_id}/latest-investigation")
async def film_latest_investigation(film_id: int):
    """Most recent completed audit row for this film, in the cached-triple
    shape LatestInvestigation expects. Returns null when the film has no
    prior runs."""
    rows = await asyncio.to_thread(list_recent_audit_for_film, film_id, 1)
    if not rows:
        return None
    a = rows[0]
    dec = a.agent_run
    det_meta = await asyncio.to_thread(_detection_meta_map, [a.detection_dedup_key])
    meta = det_meta.get(a.detection_dedup_key, {})
    return {
        "scenario_id": a.decision_id,
        "detection": {
            "film_id": a.film_id,
            "region": a.region,
            "metric": meta.get("metric"),
            "severity": _fmt_severity(meta.get("severity")),
            "magnitude": _fmt_float(meta.get("magnitude")),
            "latency_ms": None,
        },
        "investigation": None,
        "decision": {
            "decision_id": a.decision_id,
            "status": a.approval_status,
            "recommended_actions": [
                {
                    "label": act.action_type,
                    "impact_est": (act.impact_usd or 0.0),
                }
                for act in a.actions
            ],
        },
        "report": _report_dict(a),
    }


@router.get("/films/{film_id}/runs")
async def film_runs(film_id: int, limit: int = Query(10, ge=1, le=50)):
    """List of past runs for the RunTimeline on the movie detail page."""
    rows = await asyncio.to_thread(list_recent_audit_for_film, film_id, limit)
    keys = [r.detection_dedup_key for r in rows if r.detection_dedup_key]
    det_meta = await asyncio.to_thread(_detection_meta_map, keys)
    out: list[dict[str, Any]] = []
    for r in rows:
        meta = det_meta.get(r.detection_dedup_key, {})
        out.append({
            "run_id": r.decision_id,
            "at": r.created_at.isoformat() if r.created_at else "",
            "ctype": meta.get("metric") or "detection",
            "magnitude": _fmt_float(meta.get("magnitude")) or 0.0,
            "severity": _fmt_severity(meta.get("severity")) or "—",
        })
    return out


# ---------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------

def _detection_meta_map(dedup_keys: list[str]) -> dict[str, dict[str, Any]]:
    """Batch-lookup dedup_key → {metric, magnitude, severity} from detections.

    The audit row only stores the dedup_key; the real magnitude/severity/metric
    live on the `detections` table (Layer 2). Without this join the Movie Detail
    past-runs list falls back to 0.0 for every row because AuditRow.actions[].
    params never carries magnitude — it's a decision-input, not a decision-output.

    BUILD-RISK-FALLBACK: uses clickhouse-connect directly. Same fallback that
    audit.py already established for detections' sibling table.
    """
    if not dedup_keys:
        return {}
    # Deduplicate + escape. dedup_keys are generated server-side so injection
    # risk is nil, but we still quote defensively.
    uniq = sorted({k for k in dedup_keys if k})
    if not uniq:
        return {}
    quoted = ",".join("'" + k.replace("\\", "\\\\").replace("'", "\\'") + "'" for k in uniq)
    sql = (
        "SELECT dedup_key, metric, magnitude, severity "
        "FROM detections FINAL "
        f"WHERE dedup_key IN ({quoted})"
    )
    try:
        from data.ch_client import client
        with client() as c:
            rows = list(c.query(sql).result_rows)
    except Exception:  # noqa: BLE001
        log.warning("detection meta lookup failed", exc_info=True)
        return {}
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        out[str(r[0])] = {
            "metric": r[1],
            "magnitude": float(r[2]) if r[2] is not None else None,
            "severity": float(r[3]) if r[3] is not None else None,
        }
    return out


def _fmt_float(v: Any) -> float | None:
    if isinstance(v, (int, float)):
        return float(v)
    return None


def _fmt_severity(v: Any) -> str | None:
    if isinstance(v, (int, float)):
        return f"{v:.1f}"
    if isinstance(v, str) and v:
        return v
    return None


def _report_dict(a: AuditRow) -> dict | None:
    r = a.report
    if r is None:
        return None
    try:
        return r.model_dump(mode="json")
    except AttributeError:
        return dict(r) if isinstance(r, dict) else None
