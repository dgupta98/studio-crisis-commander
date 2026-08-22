"""HTTP surface for the catalog module."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query

from agents.decision.audit import list_recent_audit_for_film
from api.catalog import shelves as catalog_shelves

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
    return {
        "scenario_id": a.decision_id,
        "detection": {
            "film_id": a.film_id,
            "region": a.region,
            "metric": _first_signal(dec),
            "severity": _severity_of(a),
            "magnitude": _magnitude_of(a),
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
    return [
        {
            "run_id": r.decision_id,
            "at": r.created_at.isoformat() if r.created_at else "",
            "ctype": _first_signal(r.agent_run) or "detection",
            "magnitude": _magnitude_of(r) or 0.0,
            "severity": _severity_of(r) or "—",
        }
        for r in rows
    ]


def _first_signal(dec) -> str | None:
    # DecisionResult carries the winning action; the underlying metric family
    # lives on the first action's rationale/params in practice.
    if dec and dec.actions:
        params = getattr(dec.actions[0], "params", None) or {}
        if isinstance(params, dict):
            for k in ("metric", "signal", "family"):
                v = params.get(k)
                if isinstance(v, str):
                    return v
    return None


def _severity_of(a) -> str | None:
    dec = a.agent_run
    if not dec or not dec.actions:
        return None
    params = getattr(dec.actions[0], "params", None) or {}
    if isinstance(params, dict):
        s = params.get("severity")
        if isinstance(s, (int, float)):
            return f"{s:.1f}"
        if isinstance(s, str):
            return s
    return None


def _magnitude_of(a) -> float | None:
    dec = a.agent_run
    if not dec or not dec.actions:
        return None
    params = getattr(dec.actions[0], "params", None) or {}
    if isinstance(params, dict):
        m = params.get("magnitude")
        if isinstance(m, (int, float)):
            return float(m)
    return None


def _report_dict(a) -> dict | None:
    r = a.report
    if r is None:
        return None
    try:
        return r.model_dump(mode="json")
    except AttributeError:
        return dict(r) if isinstance(r, dict) else None
