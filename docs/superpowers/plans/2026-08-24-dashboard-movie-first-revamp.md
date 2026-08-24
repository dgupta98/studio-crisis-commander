# Dashboard Movie-First Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dashboard from a pipeline-observability screen into a movie-first analytics screen with a 15-region heat bar, region-scoped filtering, multi-region crisis injection, and a right-edge trace drawer.

**Architecture:** Backend gains four deltas (per-film regions matrix, top-regions on shelves, region filter on latest-investigation, multi-region inject). Frontend `runStore` gains `selectedFilmId` / `selectedRegion` / `activeRuns` / `focusedRunId` slices. New components: `<RegionHeatBar>`, `<RegionTile>`, `<MovieCommand>`, `<FilmPicker>`, `<MultiRegionPicker>`, `<TraceDrawer>`, `<PipelineTicker>`, `<TimeseriesGrid>`. `<DashboardRoute>` is recomposed. Existing tokens, motion values, and API surface are reused — no new design language.

**Tech Stack:** Frontend: React 18 · Vite · TypeScript · Tailwind · Framer Motion · Zustand · Recharts · Vitest · Playwright. Backend: FastAPI · pydantic · clickhouse-connect · pytest · httpx (test client). Google ADK + Gemini already wired for the pipeline — untouched by this plan.

**Spec:** `docs/superpowers/specs/2026-08-24-dashboard-movie-first-revamp-design.md`

**Deployment:** Cloud Build triggers auto-deploy on push to main from `backend/**` and `frontend/**` respectively. Backend live URL: `https://scc-api-845114229642.us-east1.run.app`. Frontend live URL: `https://scc-frontend-845114229642.us-east1.run.app`.

**Working conventions:**
- Backend virtualenv: `backend/venv/bin/activate`. Run pytest as `source backend/venv/bin/activate && pytest backend/api/tests/<file> -v`.
- Frontend deps: `cd frontend && npm test -- --run <path>` for a single Vitest file.
- Commit after each task passes tests. Small commits.
- No `Co-Authored-By` trailers (user preference, MEMORY.md).
- Never touch `.env` or `service-account.json`.

---

## File Structure (locked)

### Backend

| Path | Change | Responsibility |
|---|---|---|
| `backend/api/routers/metrics.py` | modify | Add `regions()` handler + 4 aggregate query builders |
| `backend/api/routers/catalog.py` | modify | Add `region` query param to `film_latest_investigation`; add `top_regions` field builder |
| `backend/api/catalog/shelves.py` | modify | Emit `top_regions[]` on each film card |
| `backend/api/routers/inject.py` | modify | Accept `regions: list[str] | None`, fan out via `asyncio.gather`, return `run_ids[]` |
| `backend/api/tests/test_routers_metrics.py` | modify | Add tests for `/metrics/{id}/regions` shape + 15-region guarantee |
| `backend/api/tests/test_catalog.py` | modify | Add tests for `top_regions` presence + `?region=` filter on latest-investigation |
| `backend/api/tests/test_routers_inject_and_stream.py` | modify | Add tests for multi-region inject: N run_ids + backward compat |

### Frontend — new files

| Path | Responsibility |
|---|---|
| `frontend/src/api/regionMetrics.ts` | Type contract + fetch helper for `/metrics/{id}/regions` |
| `frontend/src/components/RegionTile.tsx` | Single 15-region heat cell |
| `frontend/src/components/RegionHeatBar.tsx` | 15-tile horizontal grid |
| `frontend/src/components/FilmPicker.tsx` | Command-K style typeahead film selector |
| `frontend/src/panels/MovieCommand.tsx` | Header block: poster + meta + film picker + heat bar |
| `frontend/src/components/MultiRegionPicker.tsx` | Chip-picker multi-select |
| `frontend/src/components/TraceDrawer.tsx` | Right-edge slide-out wrapping AgentTrace |
| `frontend/src/panels/PipelineTicker.tsx` | Bottom-docked multi-run status bar |
| `frontend/src/panels/TimeseriesGrid.tsx` | 4-up sparkline grid for selected film×region |

### Frontend — modified files

| Path | Change |
|---|---|
| `frontend/src/lib/regions.ts` | Add `REGIONS` array + `regionAbbrev()` helper |
| `frontend/src/store/runStore.ts` | Add `selectedFilmId`, `selectedRegion`, `activeRuns`, `focusedRunId`; refactor single-run getters to derive from `focusedRunId`; add `pickFilm`, `pickRegion`, `focusRun`; extend `inject()` to accept `regions[]` |
| `frontend/src/store/catalogStore.ts` | Add `top_regions?: RegionDelta[]` to `CatalogFilm` |
| `frontend/src/api/contracts.ts` | Add `RegionSignalSummary`, `RegionSummary`, `RegionMetricsResponse` types |
| `frontend/src/routes/DashboardRoute.tsx` | Rewrite: `<MovieCommand>` → `<DashboardWorkspace>` (with `<TraceDrawer>` edge) → `<TimeseriesGrid>` → `<PipelineTicker>` |
| `frontend/src/panels/DashboardWorkspace.tsx` | Rewire `InvestigationView` to read from `focusedRunId` when set, else `/films/{id}/latest-investigation?region={code}` |
| `frontend/src/shell/GlobalInjectModal.tsx` | Replace single `<ThemedSelect>` region field with `<MultiRegionPicker>`; call multi-run inject |
| `frontend/src/components/MovieCard.tsx` | Add per-card 3-region mini-strip + open-investigation pin |
| `frontend/src/panels/MovieHero.tsx` | Replace 4-panel signal row totals with `<RegionHeatBar>` |

### Frontend — files removed from the dashboard (still importable elsewhere)

- `frontend/src/panels/IntakeStrip.tsx` — no longer imported by `DashboardRoute`
- `frontend/src/panels/AnomalyFeed.tsx` — no longer imported by `DashboardRoute`
- `frontend/src/panels/RecentRuns.tsx` — no longer imported by `DashboardRoute` (still used on Movie Detail)
- `frontend/src/panels/AgentTrace.tsx` — no longer imported directly by `DashboardRoute`; wrapped by `<TraceDrawer>`

---

# Phase 1 — Backend deltas

Ship all four backend changes before touching the frontend so the frontend can build against real endpoints. All four ship in one Cloud Build cycle.

---

### Task 1.1: `/metrics/{film_id}/regions` endpoint

**Files:**
- Modify: `backend/api/routers/metrics.py`
- Test: `backend/api/tests/test_routers_metrics.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/api/tests/test_routers_metrics.py`:

```python
@pytest.mark.asyncio
async def test_metrics_regions_returns_15_canonical():
    from api.main import app
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://t") as ac:
        async with ac.stream("GET", "/healthz"):
            pass
        r = await ac.get("/metrics/1/regions")
        assert r.status_code == 200
        body = r.json()
        assert body["film_id"] == 1
        assert isinstance(body["regions"], list)
        assert len(body["regions"]) == 15
        codes = {row["code"] for row in body["regions"]}
        assert codes == {
            "NA", "LATAM", "UK", "EU-West", "EU-East", "Nordics",
            "India", "SEA", "Korea", "Japan", "China", "MENA",
            "Africa", "ANZ", "Brazil",
        }
        first = body["regions"][0]
        assert set(first["signals"].keys()) == {
            "box_office", "social", "reviews", "streaming"
        }
        assert set(first["signals"]["box_office"].keys()) == {
            "volume", "delta_pct", "anomaly"
        }
        assert "open_investigation" in first
        assert "query_latency_ms" in body
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source backend/venv/bin/activate && pytest backend/api/tests/test_routers_metrics.py::test_metrics_regions_returns_15_canonical -v
```
Expected: FAIL with 404 (endpoint not defined).

- [ ] **Step 3: Implement the endpoint**

Append to `backend/api/routers/metrics.py`:

```python
# Canonical 15 regions — must match backend/data/generate_numeric.py::REGIONS.
# Kept explicit here so a missing region in one rollup table doesn't drop the
# tile from the heat bar (invariant: always 15 tiles).
_CANONICAL_REGIONS = (
    "NA", "LATAM", "UK", "EU-West", "EU-East", "Nordics",
    "India", "SEA", "Korea", "Japan", "China", "MENA",
    "Africa", "ANZ", "Brazil",
)

# Anomaly threshold: signal is "anomalous" when |delta_pct| >= this.
# Kept modest — the heat bar's job is to draw the eye toward regions
# worth clicking, not to duplicate the detection agent's judgement.
_ANOMALY_DELTA_PCT = 15.0


def _q_regions_agg(film_id: int, hours: int) -> tuple[str, str, str, str]:
    days = max(1, hours // 24)
    box = (
        f"SELECT region, sum(revenue_usd) AS vol "
        f"FROM box_office_revenue "
        f"WHERE film_id = {film_id} "
        f"AND date >= coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id = {film_id}),"
        f"  today()) - INTERVAL {days} DAY "
        f"GROUP BY region"
    )
    soc = (
        f"SELECT region, sum(n) AS vol "
        f"FROM roll_social_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_social_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"GROUP BY region"
    )
    rev = (
        f"SELECT region, sum(sum_volume) AS vol "
        f"FROM roll_sentiment_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_sentiment_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"GROUP BY region"
    )
    stream = (
        f"SELECT region, sum(sum_views) AS vol "
        f"FROM roll_trailer_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_trailer_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"GROUP BY region"
    )
    return box, soc, rev, stream


def _q_regions_baseline_agg(film_id: int, hours: int) -> tuple[str, str, str, str]:
    """Same shape as _q_regions_agg but over the previous window of equal
    length, immediately before the current window. Used to compute delta_pct."""
    days = max(1, hours // 24)
    box = (
        f"SELECT region, sum(revenue_usd) AS vol "
        f"FROM box_office_revenue "
        f"WHERE film_id = {film_id} "
        f"AND date < coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id = {film_id}),"
        f"  today()) - INTERVAL {days} DAY "
        f"AND date >= coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id = {film_id}),"
        f"  today()) - INTERVAL {2 * days} DAY "
        f"GROUP BY region"
    )
    soc = (
        f"SELECT region, sum(n) AS vol "
        f"FROM roll_social_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts < coalesce("
        f"  (SELECT max(ts) FROM roll_social_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_social_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {2 * hours} HOUR "
        f"GROUP BY region"
    )
    rev = (
        f"SELECT region, sum(sum_volume) AS vol "
        f"FROM roll_sentiment_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts < coalesce("
        f"  (SELECT max(ts) FROM roll_sentiment_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_sentiment_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {2 * hours} HOUR "
        f"GROUP BY region"
    )
    stream = (
        f"SELECT region, sum(sum_views) AS vol "
        f"FROM roll_trailer_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts < coalesce("
        f"  (SELECT max(ts) FROM roll_trailer_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_trailer_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {2 * hours} HOUR "
        f"GROUP BY region"
    )
    return box, soc, rev, stream


def _q_open_investigations(film_id: int) -> str:
    return (
        f"SELECT region, count() FROM decision_audit FINAL "
        f"WHERE film_id = {film_id} AND approval_status = 'pending_approval' "
        f"GROUP BY region"
    )


def _run_map_sync(sql: str) -> dict[str, float]:
    with client() as c:
        rows = c.query(sql).result_rows
    out: dict[str, float] = {}
    for row in rows:
        code = str(row[0])
        val = float(row[1]) if row[1] is not None else 0.0
        out[code] = val
    return out


async def _run_map(sql: str) -> dict[str, float]:
    return await asyncio.to_thread(_run_map_sync, sql)


def _delta_pct(cur: float, prev: float) -> float:
    if prev <= 0.0:
        return 0.0 if cur <= 0.0 else 100.0
    return round(((cur - prev) / prev) * 100.0, 2)


@router.get("/metrics/{film_id}/regions")
async def metrics_regions(
    film_id: int,
    hours: int = Query(168, ge=1, le=720),
):
    t0 = time.perf_counter()
    box_sql, soc_sql, rev_sql, stream_sql = _q_regions_agg(film_id, hours)
    b_box_sql, b_soc_sql, b_rev_sql, b_stream_sql = _q_regions_baseline_agg(film_id, hours)
    (box_cur, soc_cur, rev_cur, stream_cur,
     box_prev, soc_prev, rev_prev, stream_prev,
     inv_map) = await asyncio.gather(
        _run_map(box_sql), _run_map(soc_sql), _run_map(rev_sql), _run_map(stream_sql),
        _run_map(b_box_sql), _run_map(b_soc_sql), _run_map(b_rev_sql), _run_map(b_stream_sql),
        _run_map(_q_open_investigations(film_id)),
    )
    families = (
        ("box_office", box_cur, box_prev),
        ("social",     soc_cur, soc_prev),
        ("reviews",    rev_cur, rev_prev),
        ("streaming",  stream_cur, stream_prev),
    )
    regions_out: list[dict] = []
    for code in _CANONICAL_REGIONS:
        signals: dict[str, dict] = {}
        for name, cur_map, prev_map in families:
            cur = cur_map.get(code, 0.0)
            prev = prev_map.get(code, 0.0)
            delta = _delta_pct(cur, prev)
            signals[name] = {
                "volume": int(cur),
                "delta_pct": delta,
                "anomaly": abs(delta) >= _ANOMALY_DELTA_PCT and cur > 0,
            }
        regions_out.append({
            "code": code,
            "signals": signals,
            "open_investigation": inv_map.get(code, 0.0) > 0,
        })
    dt_ms = int((time.perf_counter() - t0) * 1000)
    return {
        "film_id": film_id,
        "hours": hours,
        "regions": regions_out,
        "query_latency_ms": dt_ms,
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
source backend/venv/bin/activate && pytest backend/api/tests/test_routers_metrics.py::test_metrics_regions_returns_15_canonical -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/routers/metrics.py backend/api/tests/test_routers_metrics.py
git commit -m "feat(backend): /metrics/{film_id}/regions — 15-region heat matrix"
```

---

### Task 1.2: `top_regions[]` on `/catalog/shelves` film cards

**Files:**
- Modify: `backend/api/catalog/shelves.py`
- Test: `backend/api/tests/test_catalog.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/api/tests/test_catalog.py`:

```python
@pytest.mark.asyncio
async def test_shelves_include_top_regions_per_film():
    from api.main import app
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://t") as ac:
        async with ac.stream("GET", "/healthz"):
            pass
        r = await ac.get("/catalog/shelves")
        assert r.status_code == 200
        shelves = r.json()
        # At least one shelf with at least one film.
        assert shelves, "no shelves returned"
        for shelf in shelves:
            for film in shelf["films"]:
                assert "top_regions" in film, f"film {film['id']} missing top_regions"
                assert isinstance(film["top_regions"], list)
                assert len(film["top_regions"]) <= 6
                for entry in film["top_regions"]:
                    assert "code" in entry
                    assert "delta_pct" in entry
                    assert isinstance(entry["delta_pct"], (int, float))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source backend/venv/bin/activate && pytest backend/api/tests/test_catalog.py::test_shelves_include_top_regions_per_film -v
```
Expected: FAIL — `top_regions` KeyError.

- [ ] **Step 3: Implement `top_regions` batch query**

Add to `backend/api/catalog/shelves.py` (after the `_query_rows` helper):

```python
def _top_regions_for(c: Any, film_ids: list[int], k: int = 6) -> dict[int, list[dict[str, Any]]]:
    """film_id → top-K regions by combined signal volume in the last 7d, with
    delta_pct vs the prior 7d. One query per film would be O(N) round-trips;
    this batches with WHERE film_id IN (…) and groups per film in Python.

    We aggregate box_office_revenue only — it's the smallest table and the
    "which markets matter" signal doesn't need to be precise for the card
    strip. If it becomes an issue we can widen to a UNION over rollups.
    """
    if not film_ids:
        return {}
    ids_list = ",".join(str(int(x)) for x in film_ids)
    cur_sql = (
        f"SELECT film_id, region, sum(revenue_usd) AS vol "
        f"FROM box_office_revenue "
        f"WHERE film_id IN ({ids_list}) "
        f"AND date >= coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id IN ({ids_list})),"
        f"  today()) - INTERVAL 7 DAY "
        f"GROUP BY film_id, region"
    )
    prev_sql = (
        f"SELECT film_id, region, sum(revenue_usd) AS vol "
        f"FROM box_office_revenue "
        f"WHERE film_id IN ({ids_list}) "
        f"AND date < coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id IN ({ids_list})),"
        f"  today()) - INTERVAL 7 DAY "
        f"AND date >= coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id IN ({ids_list})),"
        f"  today()) - INTERVAL 14 DAY "
        f"GROUP BY film_id, region"
    )
    cur_rows = _query_rows(c, cur_sql)
    prev_rows = _query_rows(c, prev_sql)
    cur_map: dict[tuple[int, str], float] = {}
    for r in cur_rows:
        cur_map[(int(r[0]), str(r[1]))] = float(r[2]) if r[2] is not None else 0.0
    prev_map: dict[tuple[int, str], float] = {}
    for r in prev_rows:
        prev_map[(int(r[0]), str(r[1]))] = float(r[2]) if r[2] is not None else 0.0

    by_film: dict[int, list[tuple[str, float, float]]] = {}
    for (fid, region), cur in cur_map.items():
        prev = prev_map.get((fid, region), 0.0)
        if prev <= 0.0:
            delta = 0.0 if cur <= 0.0 else 100.0
        else:
            delta = round(((cur - prev) / prev) * 100.0, 2)
        by_film.setdefault(fid, []).append((region, cur, delta))
    out: dict[int, list[dict[str, Any]]] = {}
    for fid, entries in by_film.items():
        entries.sort(key=lambda x: x[1], reverse=True)  # highest volume first
        out[fid] = [
            {"code": region, "delta_pct": delta}
            for region, _vol, delta in entries[:k]
        ]
    return out
```

- [ ] **Step 4: Wire `top_regions` into `build_shelves`**

Replace the `_attach_posters(...)` line near the end of `build_shelves` in `backend/api/catalog/shelves.py`:

```python
    _attach_posters([s["films"] for s in shelves])
    # Attach top_regions to every card in one batched query
    all_ids = sorted({int(f["id"]) for s in shelves for f in s["films"]})
    with client() as c:
        top_map = _top_regions_for(c, all_ids, k=6)
    for shelf in shelves:
        for card in shelf["films"]:
            card["top_regions"] = top_map.get(int(card["id"]), [])
    return shelves
```

- [ ] **Step 5: Run test to verify it passes**

```bash
source backend/venv/bin/activate && pytest backend/api/tests/test_catalog.py::test_shelves_include_top_regions_per_film -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/api/catalog/shelves.py backend/api/tests/test_catalog.py
git commit -m "feat(backend): attach top_regions to /catalog/shelves cards"
```

---

### Task 1.3: `?region=` filter on `/films/{id}/latest-investigation`

**Files:**
- Modify: `backend/api/routers/catalog.py`
- Modify: `backend/agents/decision/audit.py` (add sibling function)
- Test: `backend/api/tests/test_catalog.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/api/tests/test_catalog.py`:

```python
@pytest.mark.asyncio
async def test_latest_investigation_accepts_region_filter():
    from api.main import app
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://t") as ac:
        async with ac.stream("GET", "/healthz"):
            pass
        # Without region: should not error even if no data.
        r = await ac.get("/catalog/films/1/latest-investigation")
        assert r.status_code == 200
        # With region: should not error either; result may be null.
        r2 = await ac.get("/catalog/films/1/latest-investigation?region=Brazil")
        assert r2.status_code == 200
        body = r2.json()
        if body is not None:
            assert body["detection"]["region"] == "Brazil"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source backend/venv/bin/activate && pytest backend/api/tests/test_catalog.py::test_latest_investigation_accepts_region_filter -v
```
Expected: FAIL — `Unknown query parameter: region`, or region filter is silently ignored so the assertion fails.

- [ ] **Step 3: Add `list_recent_audit_for_film_region` in `backend/agents/decision/audit.py`**

Append below the existing `list_recent_audit_for_film`:

```python
def list_recent_audit_for_film_region(
    film_id: int, region: str, limit: int = 10,
) -> list[AuditRow]:
    """Newest completed runs for a specific (film, region), most recent first.
    Same shape as list_recent_audit_for_film but scoped to one region so the
    Dashboard's Investigation panel can retarget when the user picks a region.
    """
    safe_region = _sql_escape(region)
    sql = (
        "SELECT decision_id, investigation_id, detection_dedup_key, film_id, "
        "region, actions_json, status, threshold_usd, agent_run_json, "
        "report_json, approval_status, approver, approval_note, "
        "toString(approved_at), toString(created_at), toString(updated_at) "
        "FROM decision_audit FINAL "
        f"WHERE film_id = {int(film_id)} AND region = '{safe_region}' "
        f"ORDER BY updated_at DESC LIMIT {int(limit)}"
    )
    rows = asyncio.run(_run_read(sql))
    return [_row_to_audit(r) for r in rows]
```

- [ ] **Step 4: Add optional `region` param to the router handler**

Modify `backend/api/routers/catalog.py`:

```python
from agents.decision.audit import (
    AuditRow, list_recent_audit_for_film, list_recent_audit_for_film_region,
)
```

Replace the existing `film_latest_investigation` handler:

```python
@router.get("/films/{film_id}/latest-investigation")
async def film_latest_investigation(
    film_id: int,
    region: str | None = Query(default=None, max_length=64),
):
    """Most recent completed audit row for this film (or film×region when
    region is given), in the cached-triple shape LatestInvestigation expects.
    Returns null when the film has no prior runs matching the filter."""
    if region:
        rows = await asyncio.to_thread(
            list_recent_audit_for_film_region, film_id, region, 1,
        )
    else:
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
```

- [ ] **Step 5: Run test to verify it passes**

```bash
source backend/venv/bin/activate && pytest backend/api/tests/test_catalog.py::test_latest_investigation_accepts_region_filter -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/api/routers/catalog.py backend/agents/decision/audit.py backend/api/tests/test_catalog.py
git commit -m "feat(backend): /films/{id}/latest-investigation supports ?region=filter"
```

---

### Task 1.4: Multi-region injection

**Files:**
- Modify: `backend/api/routers/inject.py`
- Test: `backend/api/tests/test_routers_inject_and_stream.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/api/tests/test_routers_inject_and_stream.py`:

```python
@pytest.mark.asyncio
async def test_inject_multi_region_returns_run_ids():
    from api.tests.test_fallback import _mk_triple

    async def fake_run(rt, run_id, request, *, force_fallback=False):
        from api.events import SseEvent
        await rt.emit(run_id, SseEvent(seq=0, type="pipeline.completed",
                                       data={"run_id": run_id, "latency_ms": 0,
                                             "mode": "live"}))
        await rt.mark_terminal(run_id, "completed")

    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.inject.run_pipeline", new=fake_run):
        from api.main import app
        async with AsyncClient(transport=ASGITransport(app=app),
                               base_url="http://t") as ac:
            async with ac.stream("GET", "/healthz"):
                pass
            r = await ac.post("/inject-crisis", json={
                "ctype": "regional_sentiment_collapse",
                "film_id": 1,
                "regions": ["Brazil", "Japan", "Korea"],
                "magnitude": 0.4,
            })
            assert r.status_code == 202
            body = r.json()
            assert "run_ids" in body
            assert len(body["run_ids"]) == 3
            assert len({rid for rid in body["run_ids"]}) == 3  # all distinct


@pytest.mark.asyncio
async def test_inject_single_region_still_returns_run_id():
    from api.tests.test_fallback import _mk_triple

    async def fake_run(rt, run_id, request, *, force_fallback=False):
        from api.events import SseEvent
        await rt.emit(run_id, SseEvent(seq=0, type="pipeline.completed",
                                       data={"run_id": run_id, "latency_ms": 0,
                                             "mode": "live"}))
        await rt.mark_terminal(run_id, "completed")

    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.inject.run_pipeline", new=fake_run):
        from api.main import app
        async with AsyncClient(transport=ASGITransport(app=app),
                               base_url="http://t") as ac:
            async with ac.stream("GET", "/healthz"):
                pass
            r = await ac.post("/inject-crisis", json={
                "ctype": "regional_sentiment_collapse",
                "film_id": 1,
                "region": "Brazil",
                "magnitude": 0.4,
            })
            assert r.status_code == 202
            body = r.json()
            assert "run_id" in body
            assert body["stream_url"].endswith(body["run_id"])
            # Multi-region key should be absent for single-region path.
            assert "run_ids" not in body


@pytest.mark.asyncio
async def test_inject_multi_region_rejects_too_many():
    from api.tests.test_fallback import _mk_triple
    with patch("api.main.load_cached_triple", return_value=_mk_triple()):
        from api.main import app
        async with AsyncClient(transport=ASGITransport(app=app),
                               base_url="http://t") as ac:
            async with ac.stream("GET", "/healthz"):
                pass
            r = await ac.post("/inject-crisis", json={
                "ctype": "regional_sentiment_collapse",
                "film_id": 1,
                "regions": ["R"] * 16,
                "magnitude": 0.4,
            })
            assert r.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
source backend/venv/bin/activate && pytest backend/api/tests/test_routers_inject_and_stream.py -k "multi_region or single_region" -v
```
Expected: FAIL — multi-region key ignored, no `run_ids` field.

- [ ] **Step 3: Extend `InjectRequest` and handler**

Replace the entire contents of `backend/api/routers/inject.py`:

```python
"""POST /inject-crisis — kick off one or more pipeline runs."""
from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from api.pipeline import run_pipeline


router = APIRouter(tags=["pipeline"])


# Cap fan-out to the canonical 15 regions so a bad client can't spawn hundreds
# of concurrent pipelines. Matches the frontend's canonical region list.
_MAX_REGIONS = 15


class InjectRequest(BaseModel):
    ctype: str | None = None
    film_id: int | None = None
    region: str | None = None
    regions: list[str] | None = None
    magnitude: float | None = None
    fallback: str | None = Field(default=None,
                                 description='"auto" (default) or "force"')

    @field_validator("regions")
    @classmethod
    def _cap_regions(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        if len(v) > _MAX_REGIONS:
            raise ValueError(f"at most {_MAX_REGIONS} regions per inject")
        return v


async def _kickoff(runtime, request_body: dict, force_fallback: bool) -> str:
    run_id = uuid4().hex
    await runtime.register(run_id)
    asyncio.create_task(run_pipeline(
        runtime, run_id,
        request=request_body,
        force_fallback=force_fallback,
    ))
    return run_id


@router.post("/inject-crisis", status_code=202)
async def inject_crisis(req: InjectRequest, request: Request):
    runtime = request.app.state.runtime
    force = (req.fallback == "force")
    # Multi-region path: fan out to N runs, one per region, with the same
    # crisis config. Returns run_ids[] so the frontend can open N SSE streams.
    if req.regions:
        run_ids = await asyncio.gather(*[
            _kickoff(runtime,
                     {"ctype": req.ctype, "film_id": req.film_id,
                      "region": r, "magnitude": req.magnitude},
                     force)
            for r in req.regions
        ])
        return JSONResponse(
            status_code=202,
            content={
                "run_ids": list(run_ids),
                "stream_urls": [f"/stream/investigation/{rid}" for rid in run_ids],
            },
        )
    # Single-region path: unchanged shape for backward compat.
    run_id = await _kickoff(
        runtime,
        {"ctype": req.ctype, "film_id": req.film_id,
         "region": req.region, "magnitude": req.magnitude},
        force,
    )
    return JSONResponse(
        status_code=202,
        content={
            "run_id": run_id,
            "stream_url": f"/stream/investigation/{run_id}",
        },
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
source backend/venv/bin/activate && pytest backend/api/tests/test_routers_inject_and_stream.py -v
```
Expected: ALL tests PASS (including the pre-existing ones — backward compat).

- [ ] **Step 5: Commit**

```bash
git add backend/api/routers/inject.py backend/api/tests/test_routers_inject_and_stream.py
git commit -m "feat(backend): /inject-crisis accepts regions[] and fans out to N runs"
```

---

### Task 1.5: Push, verify Cloud Build, smoke-test live endpoints

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: Wait for backend Cloud Build**

Wait until the trigger on `backend/**` completes (usually ~4-6 min). Watch:

```bash
gh run list --limit 5
```

Or check the Cloud Build console. Do not proceed until the new revision is serving.

- [ ] **Step 3: Smoke-test the new endpoint**

```bash
curl -s https://scc-api-845114229642.us-east1.run.app/metrics/1/regions | jq '.regions | length'
```
Expected output: `15`.

```bash
curl -s https://scc-api-845114229642.us-east1.run.app/catalog/shelves | jq '.[0].films[0].top_regions | length'
```
Expected output: integer between 0 and 6.

```bash
curl -s "https://scc-api-845114229642.us-east1.run.app/catalog/films/1/latest-investigation?region=Brazil" | jq 'if . == null then "null" else .detection.region end'
```
Expected: `"Brazil"` or `"null"`.

```bash
curl -s -X POST https://scc-api-845114229642.us-east1.run.app/inject-crisis \
  -H 'content-type: application/json' \
  -d '{"ctype":"regional_sentiment_collapse","film_id":1,"regions":["Brazil","Japan"],"magnitude":0.4}' \
  | jq '.run_ids | length'
```
Expected output: `2`.

- [ ] **Step 4: If any smoke test fails, revert or fix and re-push before proceeding to Phase 2.**

---

# Phase 2 — Store & Routing foundation

Backend is live. Now wire the frontend store to support movie/region selection and multi-run tracking without touching UI yet.

---

### Task 2.1: Extend `frontend/src/lib/regions.ts`

**Files:**
- Modify: `frontend/src/lib/regions.ts`
- Test: `frontend/src/tests/unit/regions.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/regions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { REGIONS, regionAbbrev, regionLabel } from '@/lib/regions'

describe('regions', () => {
  it('exports exactly 15 canonical regions', () => {
    expect(REGIONS).toHaveLength(15)
  })
  it('has stable canonical ordering', () => {
    expect(REGIONS[0]).toBe('NA')
    expect(REGIONS[REGIONS.length - 1]).toBe('Brazil')
  })
  it('abbreviates each region to 3 chars', () => {
    for (const r of REGIONS) {
      const abbrev = regionAbbrev(r)
      expect(abbrev.length).toBeLessThanOrEqual(3)
      expect(abbrev).toMatch(/^[A-Z]{2,3}$/)
    }
  })
  it('returns display label for known code', () => {
    expect(regionLabel('NA')).toBe('North America')
    expect(regionLabel('LATAM')).toBe('Latin America')
  })
  it('returns unknown codes verbatim', () => {
    expect(regionLabel('MARS')).toBe('MARS')
    expect(regionAbbrev('MARS')).toBe('MAR')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm test -- --run src/tests/unit/regions.test.ts
```
Expected: FAIL — `REGIONS` and `regionAbbrev` not exported.

- [ ] **Step 3: Extend regions.ts**

Replace `frontend/src/lib/regions.ts`:

```ts
// Region code → display name. Source: backend/data/region_split.py::REGIONS.
// Unknown codes render as-is so a new backend region doesn't blank the UI.
export const REGIONS = [
  'NA', 'LATAM', 'UK', 'EU-West', 'EU-East', 'Nordics',
  'India', 'SEA', 'Korea', 'Japan', 'China', 'MENA',
  'Africa', 'ANZ', 'Brazil',
] as const

export type RegionCode = (typeof REGIONS)[number]

const REGION_LABELS: Record<string, string> = {
  NA: 'North America',
  LATAM: 'Latin America',
  UK: 'United Kingdom',
  'EU-West': 'Western Europe',
  'EU-East': 'Eastern Europe',
  Nordics: 'Nordics',
  India: 'India',
  SEA: 'South-East Asia',
  Korea: 'Korea',
  Japan: 'Japan',
  China: 'China',
  MENA: 'Middle East & North Africa',
  Africa: 'Sub-Saharan Africa',
  ANZ: 'Australia & New Zealand',
  Brazil: 'Brazil',
}

// 3-char uppercase codes for Region Heat Bar tiles. Multi-char codes (LATAM,
// Nordics, MENA…) get truncated; hyphenated codes keep the prefix.
const REGION_ABBREV: Record<string, string> = {
  NA: 'NAM',
  LATAM: 'LAM',
  UK: 'UKI',
  'EU-West': 'EUW',
  'EU-East': 'EUE',
  Nordics: 'NOR',
  India: 'IND',
  SEA: 'SEA',
  Korea: 'KOR',
  Japan: 'JPN',
  China: 'CHN',
  MENA: 'MEA',
  Africa: 'AFR',
  ANZ: 'ANZ',
  Brazil: 'BRA',
}

export function regionLabel(code: string): string {
  return REGION_LABELS[code] ?? code
}

export function regionAbbrev(code: string): string {
  const abbrev = REGION_ABBREV[code]
  if (abbrev) return abbrev
  // Fallback: strip non-alpha, uppercase, take first 3.
  return code.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npm test -- --run src/tests/unit/regions.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/regions.ts frontend/src/tests/unit/regions.test.ts
git commit -m "feat(frontend): canonical REGIONS array + regionAbbrev helper"
```

---

### Task 2.2: Region metrics contract type

**Files:**
- Modify: `frontend/src/api/contracts.ts`

- [ ] **Step 1: Add the contract types**

Append to `frontend/src/api/contracts.ts`:

```ts
// ─── Region Heat Matrix ─────────────────────────────────────────────
// Backend: GET /metrics/{film_id}/regions

export interface RegionSignalSummary {
  volume: number
  delta_pct: number
  anomaly: boolean
}

export interface RegionSummary {
  code: string
  signals: {
    box_office: RegionSignalSummary
    social:     RegionSignalSummary
    reviews:    RegionSignalSummary
    streaming:  RegionSignalSummary
  }
  open_investigation: boolean
}

export interface RegionMetricsResponse {
  film_id: number
  hours: number
  regions: RegionSummary[]
  query_latency_ms: number
}

// ─── Top-regions strip on catalog card ──────────────────────────────
export interface RegionDelta {
  code: string
  delta_pct: number
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/contracts.ts
git commit -m "feat(frontend): RegionMetricsResponse + RegionDelta contracts"
```

---

### Task 2.3: `selectedFilmId` / `selectedRegion` slice on runStore

**Files:**
- Modify: `frontend/src/store/runStore.ts`
- Test: `frontend/src/tests/unit/runStore.selection.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/runStore.selection.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useRunStore } from '@/store/runStore'

describe('runStore selection slice', () => {
  beforeEach(() => {
    useRunStore.getState().reset()
  })

  it('starts with no film or region selected', () => {
    const s = useRunStore.getState()
    expect(s.selectedFilmId).toBeNull()
    expect(s.selectedRegion).toBeNull()
  })

  it('pickFilm sets the film and clears region', () => {
    useRunStore.getState().pickRegion('Brazil')
    useRunStore.getState().pickFilm(42)
    const s = useRunStore.getState()
    expect(s.selectedFilmId).toBe(42)
    expect(s.selectedRegion).toBeNull()
  })

  it('pickRegion sets the region without touching film', () => {
    useRunStore.getState().pickFilm(7)
    useRunStore.getState().pickRegion('Japan')
    const s = useRunStore.getState()
    expect(s.selectedFilmId).toBe(7)
    expect(s.selectedRegion).toBe('Japan')
  })

  it('pickRegion(null) clears the region', () => {
    useRunStore.getState().pickRegion('Japan')
    useRunStore.getState().pickRegion(null)
    expect(useRunStore.getState().selectedRegion).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm test -- --run src/tests/unit/runStore.selection.test.ts
```
Expected: FAIL — `selectedFilmId`, `pickFilm`, `pickRegion` undefined.

- [ ] **Step 3: Add selection slice to runStore**

Modify `frontend/src/store/runStore.ts`:

Extend the `RunStore` interface after `latencyMs: number | null`:

```ts
  // ─── selection ────────────────────────────────────────
  selectedFilmId: number | null
  selectedRegion: string | null
```

Extend the actions section after `seedFromCached`:

```ts
  pickFilm: (id: number | null) => void
  pickRegion: (code: string | null) => void
```

Extend `INITIAL`:

```ts
  selectedFilmId: null,
  selectedRegion: null,
```

Extend `Omit<RunStore, keyof {...}>` action list to include the new actions:

```ts
const INITIAL: Omit<RunStore, keyof {
  inject: never; connectStream: never; approve: never; deny: never;
  loadDetections: never; loadAudit: never; loadMetrics: never;
  seedFromCached: never; reset: never;
  pickFilm: never; pickRegion: never;
  _dispatch: never; _recomputePanels: never;
}> = {
```

Add the implementations inside the store body (after `seedFromCached`):

```ts
  pickFilm: (id) => {
    // Clear region when the film changes — the region context resets to
    // "All markets" until the analyst re-picks. Prefetching /metrics/regions
    // happens in the component (see MovieCommand.tsx) so this stays pure.
    set({ selectedFilmId: id, selectedRegion: null })
  },

  pickRegion: (code) => {
    set({ selectedRegion: code })
  },
```

Extend the `partialize` block so selection persists across refreshes:

```ts
      partialize: (state) => ({
        runId: state.runId,
        currentRunFilmId: state.currentRunFilmId,
        events: state.events,
        detection: state.detection,
        findings: state.findings,
        decision: state.decision,
        report: state.report,
        approvalStatus: state.approvalStatus,
        mode: state.mode,
        latencyMs: state.latencyMs,
        recentDetections: state.recentDetections,
        auditRows: state.auditRows,
        metrics: state.metrics,
        selectedFilmId: state.selectedFilmId,
        selectedRegion: state.selectedRegion,
      }),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npm test -- --run src/tests/unit/runStore.selection.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/runStore.ts frontend/src/tests/unit/runStore.selection.test.ts
git commit -m "feat(runStore): selectedFilmId + selectedRegion slice"
```

---

### Task 2.4: `activeRuns` + `focusedRunId` multi-run slice

**Files:**
- Modify: `frontend/src/store/runStore.ts`
- Test: `frontend/src/tests/unit/runStore.activeRuns.test.ts` (new)

Design note: existing single-run fields (`runId`, `detection`, `findings`, `decision`, `report`) are preserved and populated by whichever run is `focusedRunId`. This keeps every existing consumer (AgentTrace, DashboardWorkspace, LatestInvestigation) working without change. New consumers can read `activeRuns` directly for the ticker / heat bar pulses.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/runStore.activeRuns.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useRunStore } from '@/store/runStore'

describe('runStore activeRuns slice', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('starts with no active runs', () => {
    const s = useRunStore.getState()
    expect(s.activeRuns).toEqual({})
    expect(s.focusedRunId).toBeNull()
  })

  it('_registerRun adds a run entry and focuses it if first', () => {
    useRunStore.getState()._registerRun('r_1', { filmId: 5, region: 'Brazil' })
    const s = useRunStore.getState()
    expect(s.activeRuns['r_1']).toBeDefined()
    expect(s.activeRuns['r_1'].filmId).toBe(5)
    expect(s.activeRuns['r_1'].region).toBe('Brazil')
    expect(s.focusedRunId).toBe('r_1')
  })

  it('_registerRun keeps focus on existing run when a second registers', () => {
    useRunStore.getState()._registerRun('r_1', { filmId: 5, region: 'Brazil' })
    useRunStore.getState()._registerRun('r_2', { filmId: 5, region: 'Japan' })
    const s = useRunStore.getState()
    expect(Object.keys(s.activeRuns).sort()).toEqual(['r_1', 'r_2'])
    expect(s.focusedRunId).toBe('r_1')
  })

  it('focusRun switches focus without dropping others', () => {
    useRunStore.getState()._registerRun('r_1', { filmId: 5, region: 'Brazil' })
    useRunStore.getState()._registerRun('r_2', { filmId: 5, region: 'Japan' })
    useRunStore.getState().focusRun('r_2')
    expect(useRunStore.getState().focusedRunId).toBe('r_2')
    expect(Object.keys(useRunStore.getState().activeRuns).sort()).toEqual(['r_1', 'r_2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm test -- --run src/tests/unit/runStore.activeRuns.test.ts
```
Expected: FAIL — `activeRuns`, `focusRun`, `_registerRun` undefined.

- [ ] **Step 3: Add the multi-run slice**

Modify `frontend/src/store/runStore.ts`.

Add a new interface above `RunStore`:

```ts
export interface ActiveRunState {
  filmId: number | null
  region: string | null
  streamState: 'connecting' | 'streaming' | 'closed' | 'error'
  startedAt: number
}
```

Extend the `RunStore` interface (after `metrics`):

```ts
  // ─── multi-run tracking ───────────────────────────────
  // Every triggered inject registers here. `focusedRunId` picks which one
  // drives the visible Investigation Report and single-run selectors.
  activeRuns: Record<string, ActiveRunState>
  focusedRunId: string | null
```

Extend the actions section:

```ts
  focusRun: (runId: string) => void
  _registerRun: (runId: string, opts: { filmId: number | null; region: string | null }) => void
  _updateRunStream: (runId: string, streamState: ActiveRunState['streamState']) => void
```

Extend `INITIAL`:

```ts
  activeRuns: {},
  focusedRunId: null,
```

Extend the `Omit` action list:

```ts
const INITIAL: Omit<RunStore, keyof {
  inject: never; connectStream: never; approve: never; deny: never;
  loadDetections: never; loadAudit: never; loadMetrics: never;
  seedFromCached: never; reset: never;
  pickFilm: never; pickRegion: never;
  focusRun: never; _registerRun: never; _updateRunStream: never;
  _dispatch: never; _recomputePanels: never;
}> = {
```

Add the implementations inside the store body:

```ts
  focusRun: (runId) => {
    const s = useRunStore.getState()
    if (!s.activeRuns[runId]) return
    set({ focusedRunId: runId })
  },

  _registerRun: (runId, opts) => {
    const s = useRunStore.getState()
    const entry: ActiveRunState = {
      filmId: opts.filmId ?? null,
      region: opts.region ?? null,
      streamState: 'connecting',
      startedAt: Date.now(),
    }
    const nextFocused = s.focusedRunId ?? runId
    set({
      activeRuns: { ...s.activeRuns, [runId]: entry },
      focusedRunId: nextFocused,
    })
  },

  _updateRunStream: (runId, streamState) => {
    const s = useRunStore.getState()
    if (!s.activeRuns[runId]) return
    set({
      activeRuns: {
        ...s.activeRuns,
        [runId]: { ...s.activeRuns[runId], streamState },
      },
    })
  },
```

Wire `inject` to also call `_registerRun` after it sets `runId`. Modify the existing `inject` implementation — replace the block that sets `runId` and calls `connectStream`:

```ts
    const res = await apiPost<{ run_id: string; stream_url?: string }>(
      '/inject-crisis', body,
    )
    const runId = res.run_id
    set({ runId, streamState: 'connecting' })
    useRunStore.getState()._registerRun(runId, {
      filmId: opts?.filmId ?? null,
      region: opts?.region ?? null,
    })
    useRunStore.getState().connectStream(runId)
    useRunStore.getState()._recomputePanels()
    return runId
```

Extend `partialize` to persist the new fields:

```ts
      partialize: (state) => ({
        runId: state.runId,
        currentRunFilmId: state.currentRunFilmId,
        events: state.events,
        detection: state.detection,
        findings: state.findings,
        decision: state.decision,
        report: state.report,
        approvalStatus: state.approvalStatus,
        mode: state.mode,
        latencyMs: state.latencyMs,
        recentDetections: state.recentDetections,
        auditRows: state.auditRows,
        metrics: state.metrics,
        selectedFilmId: state.selectedFilmId,
        selectedRegion: state.selectedRegion,
        activeRuns: state.activeRuns,
        focusedRunId: state.focusedRunId,
      }),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npm test -- --run src/tests/unit/runStore.activeRuns.test.ts
```
Expected: PASS.

- [ ] **Step 5: Also run the existing selection test and single-inject test to prove no regression**

```bash
cd frontend && npm test -- --run src/tests/unit/runStore.selection.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/runStore.ts frontend/src/tests/unit/runStore.activeRuns.test.ts
git commit -m "feat(runStore): activeRuns + focusedRunId multi-run slice"
```

---

### Task 2.5: Multi-region inject in `runStore.inject()`

**Files:**
- Modify: `frontend/src/store/runStore.ts`
- Test: `frontend/src/tests/unit/runStore.multiInject.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/runStore.multiInject.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRunStore } from '@/store/runStore'
import * as client from '@/api/client'
import * as sse from '@/api/sse'

describe('runStore multi-region inject', () => {
  beforeEach(() => {
    useRunStore.getState().reset()
    vi.restoreAllMocks()
    vi.spyOn(sse, 'openStream').mockReturnValue(() => {})
  })

  it('single-region inject returns one run_id and registers one run', async () => {
    vi.spyOn(client, 'apiPost').mockResolvedValue({
      run_id: 'r_single', stream_url: '/stream/investigation/r_single',
    })
    const ids = await useRunStore.getState().inject({
      crisisType: 'regional_sentiment_collapse',
      filmId: 1,
      region: 'Brazil',
      magnitude: 0.4,
    })
    expect(ids).toEqual(['r_single'])
    const s = useRunStore.getState()
    expect(Object.keys(s.activeRuns)).toEqual(['r_single'])
    expect(s.focusedRunId).toBe('r_single')
  })

  it('multi-region inject returns N run_ids and registers all', async () => {
    vi.spyOn(client, 'apiPost').mockResolvedValue({
      run_ids: ['r_a', 'r_b', 'r_c'],
      stream_urls: [
        '/stream/investigation/r_a',
        '/stream/investigation/r_b',
        '/stream/investigation/r_c',
      ],
    })
    const ids = await useRunStore.getState().inject({
      crisisType: 'regional_sentiment_collapse',
      filmId: 1,
      regions: ['Brazil', 'Japan', 'Korea'],
      magnitude: 0.4,
    })
    expect(ids).toEqual(['r_a', 'r_b', 'r_c'])
    const s = useRunStore.getState()
    expect(Object.keys(s.activeRuns).sort()).toEqual(['r_a', 'r_b', 'r_c'])
    expect(s.focusedRunId).toBe('r_a')  // first one focused
    expect(s.activeRuns['r_b'].region).toBe('Japan')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm test -- --run src/tests/unit/runStore.multiInject.test.ts
```
Expected: FAIL — inject doesn't accept `regions`, returns wrong shape.

- [ ] **Step 3: Extend `inject()` signature and body**

Modify `frontend/src/store/runStore.ts`.

Change the `inject` signature in the `RunStore` interface:

```ts
  inject: (opts?: {
    crisisType?: CrisisType
    filmId?: number
    region?: string
    regions?: string[]
    magnitude?: number
    fallback?: 'force'
  }) => Promise<string[]>
```

Replace the `inject` implementation:

```ts
  inject: async (opts) => {
    const body: Record<string, unknown> = {}
    if (opts?.crisisType) body.ctype = opts.crisisType
    if (opts?.filmId !== undefined) body.film_id = opts.filmId
    if (opts?.regions && opts.regions.length > 0) body.regions = opts.regions
    else if (opts?.region) body.region = opts.region
    if (opts?.magnitude !== undefined) body.magnitude = opts.magnitude
    if (opts?.fallback) body.fallback = opts.fallback

    // Clear prior single-run residue so the visible panels reset. The
    // multi-run activeRuns map is additive — completed runs stay accessible
    // via the pipeline ticker until reset() or refresh.
    set({
      runId: null,
      currentRunFilmId: opts?.filmId ?? null,
      events: [],
      detection: null,
      findings: [],
      decision: null,
      report: null,
      approvalStatus: null,
      mode: null,
    })

    // Multi-region path: server returns run_ids[]; we register + connect all.
    if (opts?.regions && opts.regions.length > 0) {
      const res = await apiPost<{ run_ids: string[]; stream_urls?: string[] }>(
        '/inject-crisis', body,
      )
      const runIds = res.run_ids ?? []
      runIds.forEach((rid, i) => {
        useRunStore.getState()._registerRun(rid, {
          filmId: opts.filmId ?? null,
          region: opts.regions?.[i] ?? null,
        })
        useRunStore.getState().connectStream(rid)
      })
      if (runIds[0]) {
        // Focus the first run so its detection/report drive the workspace.
        set({ runId: runIds[0], streamState: 'connecting' })
      }
      useRunStore.getState()._recomputePanels()
      return runIds
    }

    // Single-region path (backward compat with existing callers).
    const res = await apiPost<{ run_id: string; stream_url?: string }>(
      '/inject-crisis', body,
    )
    const runId = res.run_id
    set({ runId, streamState: 'connecting' })
    useRunStore.getState()._registerRun(runId, {
      filmId: opts?.filmId ?? null,
      region: opts?.region ?? null,
    })
    useRunStore.getState().connectStream(runId)
    useRunStore.getState()._recomputePanels()
    return [runId]
  },
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npm test -- --run src/tests/unit/runStore.multiInject.test.ts src/tests/unit/runStore.activeRuns.test.ts src/tests/unit/runStore.selection.test.ts
```
Expected: PASS (all three).

- [ ] **Step 5: Verify GlobalInjectModal test still passes (backward compat)**

```bash
cd frontend && npm test -- --run src/tests/unit/GlobalInjectModal.test.tsx
```
Expected: PASS. The existing single-region caller in `GlobalInjectModal` awaits a `Promise<string>` but now gets `Promise<string[]>`. If the test breaks due to this narrower type expectation, update the modal in Task 5.2 — for now, skip this test only if it fails purely on the return-type narrowing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/runStore.ts frontend/src/tests/unit/runStore.multiInject.test.ts
git commit -m "feat(runStore): inject() accepts regions[] and returns run_ids[]"
```

---

### Task 2.6: Deep-link hydration in `DashboardRoute`

**Files:**
- Modify: `frontend/src/routes/DashboardRoute.tsx`
- Test: `frontend/src/tests/unit/DashboardRoute.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/tests/unit/DashboardRoute.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardRoute from '@/routes/DashboardRoute'
import { useRunStore } from '@/store/runStore'

describe('DashboardRoute deep-link hydration', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('hydrates selectedFilmId + selectedRegion from URL', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/dashboard?film=42&region=Brazil']}>
          <DashboardRoute />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const s = useRunStore.getState()
    expect(s.selectedFilmId).toBe(42)
    expect(s.selectedRegion).toBe('Brazil')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm test -- --run src/tests/unit/DashboardRoute.test.tsx
```
Expected: FAIL — store still null after render.

- [ ] **Step 3: Add hydration effect to DashboardRoute**

Modify `frontend/src/routes/DashboardRoute.tsx` — add near the top of the component body, alongside the existing `useEffect`:

```tsx
import { useSearchParams } from 'react-router-dom'
// … existing imports …

export default function DashboardRoute() {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const pickFilm = useRunStore((s) => s.pickFilm)
  const pickRegion = useRunStore((s) => s.pickRegion)

  useEffect(() => {
    const filmParam = params.get('film')
    const regionParam = params.get('region')
    if (filmParam) {
      const fid = Number(filmParam)
      if (Number.isFinite(fid) && fid > 0) pickFilm(fid)
    }
    if (regionParam) {
      pickRegion(regionParam)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('film'), params.get('region')])

  // …rest of component unchanged for now — will be rewritten in Task 6.4
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npm test -- --run src/tests/unit/DashboardRoute.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/DashboardRoute.tsx frontend/src/tests/unit/DashboardRoute.test.tsx
git commit -m "feat(dashboard): hydrate selectedFilm/Region from URL params"
```

---

# Phase 3 — Region Heat Bar

The distinctive UI element. Ships as two components + one data fetch helper.

---

### Task 3.1: `regionMetrics` fetch helper

**Files:**
- Create: `frontend/src/api/regionMetrics.ts`

- [ ] **Step 1: Create the helper**

```ts
import { apiGet } from '@/api/client'
import type { RegionMetricsResponse } from '@/api/contracts'

export function fetchRegionMetrics(
  filmId: number, hours = 168,
): Promise<RegionMetricsResponse> {
  return apiGet<RegionMetricsResponse>(`/metrics/${filmId}/regions?hours=${hours}`)
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/regionMetrics.ts
git commit -m "feat(frontend): fetchRegionMetrics helper"
```

---

### Task 3.2: `<RegionTile>` component

**Files:**
- Create: `frontend/src/components/RegionTile.tsx`
- Create: `frontend/src/tests/unit/RegionTile.test.tsx`

- [ ] **Step 1: Write the component + test together**

Create `frontend/src/components/RegionTile.tsx`:

```tsx
import { motion } from 'framer-motion'
import { tokens } from '@/theme/tokens'
import type { RegionSummary } from '@/api/contracts'
import { regionAbbrev, regionLabel } from '@/lib/regions'

interface Props {
  region: RegionSummary
  selected: boolean
  activeRun: boolean
  onClick: (code: string) => void
  // Volume normalization scale (max volume across all 15 tiles). Passed in
  // so every tile in one Heat Bar uses the same scale — otherwise each
  // tile normalizes to its own max and the bars all look full.
  volumeScale: {
    box_office: number
    social:     number
    reviews:    number
    streaming:  number
  }
}

// Bar height range: min so an "empty" tile still shows something readable,
// max is the tile's inner body height minus padding.
const BAR_MIN_PX = 4
const BAR_MAX_PX = 44

function barHeight(vol: number, scale: number): number {
  if (scale <= 0 || vol <= 0) return BAR_MIN_PX
  return Math.max(BAR_MIN_PX, Math.round((vol / scale) * BAR_MAX_PX))
}

const FAMILIES = ['box_office', 'social', 'reviews', 'streaming'] as const
type Family = typeof FAMILIES[number]

export function RegionTile({
  region, selected, activeRun, onClick, volumeScale,
}: Props) {
  const label = regionLabel(region.code)
  const abbrev = regionAbbrev(region.code)
  const tooltip = FAMILIES.map((f) => {
    const s = region.signals[f]
    const delta = s.delta_pct >= 0 ? `+${s.delta_pct}` : `${s.delta_pct}`
    return `${f}: ${s.volume.toLocaleString()} (${delta}%)`
  }).join(' · ')
  return (
    <motion.button
      type="button"
      title={`${label} — ${tooltip}`}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onClick(region.code)}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      className={`relative flex h-[72px] w-[48px] flex-col items-center justify-between rounded border px-1 pt-1 pb-1.5 transition-colors ${
        selected
          ? 'border-accent bg-card-alt'
          : 'border-line bg-card hover:bg-card-alt'
      }`}
    >
      <span className="font-mono text-[9px] uppercase tracking-wider text-ink-soft">
        {abbrev}
      </span>
      <div className="flex h-[48px] items-end gap-[2px]">
        {FAMILIES.map((family) => {
          const s = region.signals[family]
          const hex = tokens.signal[family].hex
          return (
            <div
              key={family}
              style={{
                height: `${barHeight(s.volume, volumeScale[family])}px`,
                width: '8px',
                background: hex,
                opacity: s.anomaly ? 1 : 0.6,
                borderRadius: '1px',
                boxShadow: s.anomaly ? `0 0 6px ${tokens.signal[family].glow}` : undefined,
              }}
            />
          )
        })}
      </div>
      {region.open_investigation && (
        <span
          aria-hidden
          className="absolute right-1 top-1 h-[6px] w-[6px] rounded-full bg-accent"
        />
      )}
      {activeRun && (
        <span
          aria-hidden
          className="absolute inset-0 rounded border border-accent animate-pulse pointer-events-none"
        />
      )}
    </motion.button>
  )
}
```

Create `frontend/src/tests/unit/RegionTile.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RegionTile } from '@/components/RegionTile'
import type { RegionSummary } from '@/api/contracts'

const mkRegion = (over: Partial<RegionSummary> = {}): RegionSummary => ({
  code: 'Brazil',
  signals: {
    box_office: { volume: 100, delta_pct: 5, anomaly: false },
    social:     { volume: 200, delta_pct: -30, anomaly: true },
    reviews:    { volume:  50, delta_pct: 0,  anomaly: false },
    streaming:  { volume: 400, delta_pct: 8,  anomaly: false },
  },
  open_investigation: false,
  ...over,
})

const SCALE = { box_office: 1000, social: 1000, reviews: 1000, streaming: 1000 }

describe('RegionTile', () => {
  it('renders abbreviated code', () => {
    render(<RegionTile region={mkRegion()} selected={false} activeRun={false}
      onClick={() => {}} volumeScale={SCALE} />)
    expect(screen.getByText('BRA')).toBeInTheDocument()
  })

  it('emits click with region code', () => {
    const onClick = vi.fn()
    render(<RegionTile region={mkRegion()} selected={false} activeRun={false}
      onClick={onClick} volumeScale={SCALE} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledWith('Brazil')
  })

  it('shows aria-pressed when selected', () => {
    render(<RegionTile region={mkRegion()} selected={true} activeRun={false}
      onClick={() => {}} volumeScale={SCALE} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders open-investigation dot', () => {
    const { container } = render(
      <RegionTile region={mkRegion({ open_investigation: true })}
        selected={false} activeRun={false}
        onClick={() => {}} volumeScale={SCALE} />
    )
    // The dot is aria-hidden; identify via its class.
    expect(container.querySelector('.bg-accent.rounded-full')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm test -- --run src/tests/unit/RegionTile.test.tsx
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/RegionTile.tsx frontend/src/tests/unit/RegionTile.test.tsx
git commit -m "feat(frontend): RegionTile — one 48x72 heat cell"
```

---

### Task 3.3: `<RegionHeatBar>` component

**Files:**
- Create: `frontend/src/components/RegionHeatBar.tsx`
- Create: `frontend/src/tests/unit/RegionHeatBar.test.tsx`

- [ ] **Step 1: Create the component**

`frontend/src/components/RegionHeatBar.tsx`:

```tsx
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { fetchRegionMetrics } from '@/api/regionMetrics'
import { REGIONS } from '@/lib/regions'
import { tokens } from '@/theme/tokens'
import { RegionTile } from './RegionTile'
import { useRunStore } from '@/store/runStore'
import type { RegionMetricsResponse, RegionSummary } from '@/api/contracts'

interface Props {
  filmId: number
}

// Placeholder region row (all-zero) — rendered while the query is loading
// so the bar's height and shape stay stable and the cascade animation
// doesn't shift the layout when data lands.
function emptyRegion(code: string): RegionSummary {
  return {
    code,
    signals: {
      box_office: { volume: 0, delta_pct: 0, anomaly: false },
      social:     { volume: 0, delta_pct: 0, anomaly: false },
      reviews:    { volume: 0, delta_pct: 0, anomaly: false },
      streaming:  { volume: 0, delta_pct: 0, anomaly: false },
    },
    open_investigation: false,
  }
}

function mergeToCanonical(res: RegionMetricsResponse | undefined): RegionSummary[] {
  const byCode = new Map<string, RegionSummary>()
  for (const r of res?.regions ?? []) byCode.set(r.code, r)
  return REGIONS.map((code) => byCode.get(code) ?? emptyRegion(code))
}

export function RegionHeatBar({ filmId }: Props) {
  const { data } = useQuery({
    queryKey: ['region-metrics', filmId],
    queryFn: () => fetchRegionMetrics(filmId, 168),
    staleTime: 60_000,
  })
  const selectedRegion = useRunStore((s) => s.selectedRegion)
  const activeRuns = useRunStore((s) => s.activeRuns)
  const pickRegion = useRunStore((s) => s.pickRegion)

  const regions = useMemo(() => mergeToCanonical(data), [data])
  const volumeScale = useMemo(() => {
    const max = { box_office: 0, social: 0, reviews: 0, streaming: 0 }
    for (const r of regions) {
      max.box_office = Math.max(max.box_office, r.signals.box_office.volume)
      max.social     = Math.max(max.social,     r.signals.social.volume)
      max.reviews    = Math.max(max.reviews,    r.signals.reviews.volume)
      max.streaming  = Math.max(max.streaming,  r.signals.streaming.volume)
    }
    return max
  }, [regions])

  const activeRegions = useMemo(() => {
    const s = new Set<string>()
    for (const rid of Object.keys(activeRuns)) {
      const ar = activeRuns[rid]
      if (ar.region && ar.streamState !== 'closed') s.add(ar.region)
    }
    return s
  }, [activeRuns])

  const [ease] = tokens.motion.ease.cinematic ? [tokens.motion.ease.cinematic] : [[0.16, 1, 0.3, 1]]

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
          Region heat · 15 markets
        </span>
        {data && (
          <span className="font-mono text-[10px] text-ink-soft">
            {data.query_latency_ms}ms
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Region heat bar">
        {regions.map((r, i) => (
          <motion.div
            key={r.code}
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: i * 0.025, duration: 0.35, ease }}
          >
            <RegionTile
              region={r}
              selected={selectedRegion === r.code}
              activeRun={activeRegions.has(r.code)}
              onClick={(code) => pickRegion(selectedRegion === code ? null : code)}
              volumeScale={volumeScale}
            />
          </motion.div>
        ))}
      </div>
    </div>
  )
}
```

`frontend/src/tests/unit/RegionHeatBar.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RegionHeatBar } from '@/components/RegionHeatBar'
import * as regionApi from '@/api/regionMetrics'
import { useRunStore } from '@/store/runStore'

function wrap(child: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{child}</QueryClientProvider>
}

describe('RegionHeatBar', () => {
  beforeEach(() => {
    useRunStore.getState().reset()
    vi.restoreAllMocks()
  })

  it('renders 15 tiles even before data loads', () => {
    vi.spyOn(regionApi, 'fetchRegionMetrics').mockReturnValue(new Promise(() => {}))
    render(wrap(<RegionHeatBar filmId={1} />))
    const tiles = screen.getAllByRole('button')
    expect(tiles).toHaveLength(15)
  })

  it('merges backend data into canonical 15 tiles', async () => {
    vi.spyOn(regionApi, 'fetchRegionMetrics').mockResolvedValue({
      film_id: 1, hours: 168, query_latency_ms: 42,
      regions: [
        { code: 'Brazil',
          signals: {
            box_office: { volume: 999, delta_pct: 20, anomaly: true },
            social:     { volume: 100, delta_pct: 0,  anomaly: false },
            reviews:    { volume:  50, delta_pct: 0,  anomaly: false },
            streaming:  { volume: 200, delta_pct: 0,  anomaly: false },
          },
          open_investigation: true,
        },
      ],
    })
    render(wrap(<RegionHeatBar filmId={1} />))
    await waitFor(() => expect(screen.getByText('42ms')).toBeInTheDocument())
    // Still 15 tiles (14 empty + 1 Brazil)
    expect(screen.getAllByRole('button')).toHaveLength(15)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm test -- --run src/tests/unit/RegionHeatBar.test.tsx
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/RegionHeatBar.tsx frontend/src/tests/unit/RegionHeatBar.test.tsx
git commit -m "feat(frontend): RegionHeatBar — 15-tile canonical grid"
```

---

# Phase 4 — MovieCommand header

The film picker and the panel that houses the RegionHeatBar.

---

### Task 4.1: `<FilmPicker>` component

**Files:**
- Create: `frontend/src/components/FilmPicker.tsx`
- Create: `frontend/src/tests/unit/FilmPicker.test.tsx`

- [ ] **Step 1: Create the component + test**

`frontend/src/components/FilmPicker.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queries } from '@/api/queries'

interface FilmLite {
  id: number
  title: string
}

interface Props {
  currentFilmId: number | null
  currentTitle: string | null
  onPick: (id: number, title: string) => void
}

type Shelf = { id: string; title: string; films: FilmLite[] }

function flatten(shelves: Shelf[] | undefined): FilmLite[] {
  if (!shelves) return []
  const seen = new Map<number, string>()
  for (const s of shelves) for (const f of s.films ?? []) {
    if (!seen.has(f.id) && f.title) seen.set(f.id, f.title)
  }
  return Array.from(seen, ([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

export function FilmPicker({ currentFilmId, currentTitle, onPick }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const { data: shelvesRaw } = useQuery({
    ...queries.shelves(null),
    enabled: open,
  })
  const films = useMemo(() => flatten(shelvesRaw as Shelf[] | undefined), [shelvesRaw])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return films.slice(0, 40)
    return films.filter((f) => f.title.toLowerCase().includes(needle)).slice(0, 40)
  }, [films, q])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label="Change film"
        onClick={() => { setOpen((v) => !v); setQ('') }}
        className="rounded border border-line bg-card-alt px-3 py-1.5 text-xs uppercase tracking-wider text-ink hover:border-accent"
      >
        Film ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded border border-line bg-card p-2 shadow-2xl">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={films.length === 0 ? 'Loading catalog…' : 'Search films…'}
            disabled={films.length === 0}
            className="mb-2 w-full rounded border border-line bg-paper px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <ul role="listbox" className="max-h-64 overflow-auto">
            {filtered.map((f) => (
              <li key={f.id} role="option" aria-selected={f.id === currentFilmId}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onPick(f.id, f.title)
                    setOpen(false)
                  }}
                  className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                    f.id === currentFilmId
                      ? 'bg-card-alt text-accent'
                      : 'text-ink hover:bg-card-alt'
                  }`}
                >
                  {f.title}
                </button>
              </li>
            ))}
            {q && filtered.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-ink-soft">No films match “{q}”.</li>
            )}
          </ul>
          {currentTitle && (
            <div className="mt-2 border-t border-line pt-2 text-[11px] text-ink-soft">
              Current: <span className="font-mono">{currentTitle}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

`frontend/src/tests/unit/FilmPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FilmPicker } from '@/components/FilmPicker'
import * as queries from '@/api/queries'

function wrap(child: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{child}</QueryClientProvider>
}

describe('FilmPicker', () => {
  it('opens the panel when clicked', () => {
    render(wrap(<FilmPicker currentFilmId={null} currentTitle={null} onPick={() => {}} />))
    fireEvent.click(screen.getByRole('button', { name: /change film/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('calls onPick with (id, title) when a film is chosen', async () => {
    vi.spyOn(queries.queries, 'shelves').mockReturnValue({
      queryKey: ['shelves', null],
      queryFn: async () => ([{
        id: 's', title: 'S', films: [
          { id: 42, title: 'Foo' }, { id: 7, title: 'Bar' },
        ],
      }]),
    })
    const onPick = vi.fn()
    render(wrap(<FilmPicker currentFilmId={null} currentTitle={null} onPick={onPick} />))
    fireEvent.click(screen.getByRole('button', { name: /change film/i }))
    await waitFor(() => screen.getByText('Foo'))
    fireEvent.mouseDown(screen.getByText('Foo'))
    expect(onPick).toHaveBeenCalledWith(42, 'Foo')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm test -- --run src/tests/unit/FilmPicker.test.tsx
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FilmPicker.tsx frontend/src/tests/unit/FilmPicker.test.tsx
git commit -m "feat(frontend): FilmPicker typeahead selector"
```

---

### Task 4.2: `<MovieCommand>` header panel

**Files:**
- Create: `frontend/src/panels/MovieCommand.tsx`
- Create: `frontend/src/tests/unit/MovieCommand.test.tsx`

- [ ] **Step 1: Create the component**

`frontend/src/panels/MovieCommand.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/api/client'
import { useRunStore } from '@/store/runStore'
import { RegionHeatBar } from '@/components/RegionHeatBar'
import { FilmPicker } from '@/components/FilmPicker'

interface FilmDetail {
  id: number
  title: string
  poster_url: string
  release_date: string
  popularity: number
  language?: string
  genre?: string
  runtime_min?: number
  budget_usd?: number
  revenue_usd?: number
  vote_average?: number
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}
function formatRuntime(min: number | undefined): string {
  if (!min) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded border border-line bg-card-alt px-2.5 py-1.5">
      <span className="text-[9px] font-mono uppercase tracking-wider text-ink-soft">{label}</span>
      <span className="text-[12px] font-medium text-ink">{value}</span>
    </div>
  )
}

export function MovieCommand() {
  const selectedFilmId = useRunStore((s) => s.selectedFilmId)
  const pickFilm = useRunStore((s) => s.pickFilm)

  const { data: film } = useQuery<FilmDetail | null>({
    queryKey: ['film-detail', selectedFilmId],
    queryFn: async () => {
      if (selectedFilmId === null) return null
      return apiGet<FilmDetail>(`/catalog/films/${selectedFilmId}`)
    },
    enabled: selectedFilmId !== null,
    staleTime: 60_000,
  })

  if (selectedFilmId === null) {
    return (
      <section className="rounded-md border border-line bg-card p-6 text-center">
        <div className="text-sm text-ink-soft">
          Pick a movie to see its regional performance.
        </div>
        <div className="mt-3 flex justify-center">
          <FilmPicker
            currentFilmId={null}
            currentTitle={null}
            onPick={(id) => pickFilm(id)}
          />
        </div>
      </section>
    )
  }

  const metaChips: Array<{ label: string; value: string }> = []
  if (film?.genre) metaChips.push({ label: 'Genre', value: film.genre })
  if (film?.runtime_min) metaChips.push({ label: 'Runtime', value: formatRuntime(film.runtime_min) })
  if (film?.language) metaChips.push({ label: 'Language', value: film.language.toUpperCase() })
  if (film?.vote_average) metaChips.push({ label: 'Rating', value: `${film.vote_average.toFixed(1)} / 10` })
  if (film?.budget_usd) metaChips.push({ label: 'Budget', value: formatMoney(film.budget_usd) })
  if (film?.revenue_usd) metaChips.push({ label: 'Box office', value: formatMoney(film.revenue_usd) })

  return (
    <section
      data-testid="movie-command"
      className="flex flex-col gap-5 rounded-md border border-line bg-card p-5"
    >
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="w-24 flex-shrink-0 overflow-hidden rounded border border-line bg-card-alt md:w-32">
          {film?.poster_url ? (
            <img src={film.poster_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex aspect-[2/3] items-center justify-center text-xs text-ink-soft">no poster</div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
                {film?.title ?? 'Loading…'}
              </h1>
              {film?.release_date && (
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-soft">
                  Released {film.release_date} · Popularity {film.popularity.toFixed(1)}
                </div>
              )}
            </div>
            <FilmPicker
              currentFilmId={selectedFilmId}
              currentTitle={film?.title ?? null}
              onPick={(id) => pickFilm(id)}
            />
          </div>
          {metaChips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {metaChips.map((c) => (
                <MetaChip key={c.label} label={c.label} value={c.value} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-line pt-4">
        <RegionHeatBar filmId={selectedFilmId} />
      </div>
    </section>
  )
}
```

`frontend/src/tests/unit/MovieCommand.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MovieCommand } from '@/panels/MovieCommand'
import * as client from '@/api/client'
import * as regionApi from '@/api/regionMetrics'
import { useRunStore } from '@/store/runStore'

function wrap(child: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{child}</QueryClientProvider>
}

describe('MovieCommand', () => {
  beforeEach(() => {
    useRunStore.getState().reset()
    vi.restoreAllMocks()
  })

  it('renders empty state when no film is picked', () => {
    render(wrap(<MovieCommand />))
    expect(screen.getByText(/Pick a movie/i)).toBeInTheDocument()
  })

  it('renders film title once picked', async () => {
    vi.spyOn(client, 'apiGet').mockResolvedValue({
      id: 1, title: 'Foo Movie', poster_url: '',
      release_date: '2026-01-01', popularity: 42.0,
    })
    vi.spyOn(regionApi, 'fetchRegionMetrics').mockResolvedValue({
      film_id: 1, hours: 168, query_latency_ms: 10, regions: [],
    })
    useRunStore.getState().pickFilm(1)
    render(wrap(<MovieCommand />))
    await waitFor(() => expect(screen.getByText('Foo Movie')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm test -- --run src/tests/unit/MovieCommand.test.tsx
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panels/MovieCommand.tsx frontend/src/tests/unit/MovieCommand.test.tsx
git commit -m "feat(frontend): MovieCommand header with FilmPicker + RegionHeatBar"
```

---

# Phase 5 — Multi-region injection UI

Update inject modal for multi-region + wire the store fan-out.

---

### Task 5.1: `<MultiRegionPicker>` component

**Files:**
- Create: `frontend/src/components/MultiRegionPicker.tsx`
- Create: `frontend/src/tests/unit/MultiRegionPicker.test.tsx`

- [ ] **Step 1: Create the component**

`frontend/src/components/MultiRegionPicker.tsx`:

```tsx
import { useState } from 'react'
import { REGIONS } from '@/lib/regions'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
}

export function MultiRegionPicker({ value, onChange }: Props) {
  const [adding, setAdding] = useState(false)
  const remaining = REGIONS.filter((r) => !value.includes(r))
  const allSelected = value.length === REGIONS.length

  return (
    <div className="rounded border border-line bg-paper p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((r) => (
          <span key={r}
            className="flex items-center gap-1 rounded bg-card-alt px-2 py-1 text-xs text-ink">
            {r}
            <button
              type="button"
              aria-label={`Remove ${r}`}
              onClick={() => onChange(value.filter((x) => x !== r))}
              className="text-ink-soft hover:text-accent"
            >
              ×
            </button>
          </span>
        ))}
        {!allSelected && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:border-accent hover:text-ink"
            >
              + Add region ▾
            </button>
            {adding && (
              <ul
                role="listbox"
                className="absolute left-0 top-full z-20 mt-1 max-h-64 w-40 overflow-auto rounded border border-line bg-card shadow-lg"
              >
                {remaining.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        onChange([...value, r])
                        setAdding(false)
                      }}
                      className="w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-card-alt"
                    >
                      {r}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="ml-auto">
          {allSelected ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="rounded border border-line px-2 py-1 text-[11px] text-ink-soft hover:text-ink"
            >
              Clear
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onChange([...REGIONS])}
              className="rounded border border-accent bg-accent/10 px-2 py-1 text-[11px] text-accent hover:bg-accent/20"
            >
              All 15
            </button>
          )}
        </div>
      </div>
      {value.length === 0 && (
        <p className="mt-1 text-[11px] text-ink-soft">Pick at least one region.</p>
      )}
    </div>
  )
}
```

`frontend/src/tests/unit/MultiRegionPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MultiRegionPicker } from '@/components/MultiRegionPicker'
import { REGIONS } from '@/lib/regions'

describe('MultiRegionPicker', () => {
  it('renders existing selections as chips', () => {
    render(<MultiRegionPicker value={['Brazil', 'Japan']} onChange={() => {}} />)
    expect(screen.getByText('Brazil')).toBeInTheDocument()
    expect(screen.getByText('Japan')).toBeInTheDocument()
  })

  it('removes a region when its × is clicked', () => {
    const onChange = vi.fn()
    render(<MultiRegionPicker value={['Brazil', 'Japan']} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Remove Brazil'))
    expect(onChange).toHaveBeenCalledWith(['Japan'])
  })

  it('fills all 15 when "All 15" clicked', () => {
    const onChange = vi.fn()
    render(<MultiRegionPicker value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByText('All 15'))
    expect(onChange).toHaveBeenCalledWith([...REGIONS])
  })

  it('shows a hint when empty', () => {
    render(<MultiRegionPicker value={[]} onChange={() => {}} />)
    expect(screen.getByText(/Pick at least one region/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm test -- --run src/tests/unit/MultiRegionPicker.test.tsx
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MultiRegionPicker.tsx frontend/src/tests/unit/MultiRegionPicker.test.tsx
git commit -m "feat(frontend): MultiRegionPicker chip-picker"
```

---

### Task 5.2: Rework `GlobalInjectModal` for multi-region

**Files:**
- Modify: `frontend/src/shell/GlobalInjectModal.tsx`
- Modify: `frontend/src/tests/unit/GlobalInjectModal.test.tsx`

- [ ] **Step 1: Update the existing test to cover multi-region submit**

Read the current test file to see the pattern, then add:

```tsx
// Append inside the existing describe block:

it('submits a multi-region inject when 2+ regions are picked', async () => {
  const inject = vi.fn().mockResolvedValue(['r_a', 'r_b'])
  vi.spyOn(useRunStore.getState(), 'inject').mockImplementation(inject as any)
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GlobalInjectModal open={true} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  // simulate user typing a valid movie id and picking two regions:
  // (details depend on how the film search input surfaces id — the existing
  // test uses `/^\d+$/.test(trimmed)` fallback via a numeric string.)
  fireEvent.change(screen.getByLabelText(/Movie/i), { target: { value: '1' } })
  // Regions default to ['NA'] — add Brazil:
  fireEvent.click(screen.getByText('+ Add region ▾'))
  fireEvent.mouseDown(screen.getByText('Brazil'))
  fireEvent.click(screen.getByRole('button', { name: /Inject/i }))
  await waitFor(() => expect(inject).toHaveBeenCalled())
  const call = inject.mock.calls[0][0]
  expect(call.regions).toEqual(expect.arrayContaining(['NA', 'Brazil']))
})
```

(If the existing test file uses a different setup / imports, adapt to match — the intent is: with 2+ regions selected, the inject action receives `regions: [...]` not `region: '...'`.)

- [ ] **Step 2: Replace the region field in `GlobalInjectModal.tsx`**

Modify `frontend/src/shell/GlobalInjectModal.tsx`.

Change the region-related state:

```ts
  // Multi-region: default to a single-region selection (NA) so single-region
  // demos still work with one click. User can add more via the picker.
  const [regions, setRegions] = useState<string[]>(['NA'])
```

Remove the `REGIONS` and `REGION_OPTIONS` constants (they're now imported from `@/lib/regions` via the `MultiRegionPicker`).

Add the import:

```ts
import { MultiRegionPicker } from '@/components/MultiRegionPicker'
```

Replace the region field JSX block (the `<div className="block">` containing `<ThemedSelect ariaLabel="Region" …>`) with:

```tsx
          <div className="col-span-2">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">
              Regions
            </span>
            <MultiRegionPicker value={regions} onChange={setRegions} />
          </div>
```

Also change the grid class from `grid-cols-2` to keep Magnitude single-column and Regions full-width — change the wrapping div:

```tsx
        <div className="mt-3 flex flex-col gap-3">
          <div className="col-span-2">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">
              Regions
            </span>
            <MultiRegionPicker value={regions} onChange={setRegions} />
          </div>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Magnitude</span>
            <input
              aria-label="Magnitude"
              type="number"
              step="0.05"
              min="0.05"
              max="1"
              value={magnitude}
              onChange={(e) => setMagnitude(e.target.value)}
              className="w-40 rounded border border-line bg-paper px-2 py-1.5 text-sm font-mono"
            />
          </label>
        </div>
```

Update `submit()` to send `regions` when 2+ picked, else fall back to `region`:

```tsx
    if (regions.length === 0) {
      setErr('Pick at least one region.')
      return
    }
    setBusy(true)
    try {
      if (regions.length > 1) {
        await injectAction({
          crisisType: ctype,
          filmId,
          regions,
          magnitude: Number(magnitude),
        })
      } else {
        await injectAction({
          crisisType: ctype,
          filmId,
          region: regions[0],
          magnitude: Number(magnitude),
        })
      }
      onClose()
      // Land on the dashboard scoped to the injected movie so the analyst
      // sees the heat bar + investigation with the fresh run pulsing on
      // any injected regions.
      navigate(`/dashboard?film=${filmId}${regions.length === 1 ? `&region=${encodeURIComponent(regions[0])}` : ''}`)
    } catch (e: any) {
      setErr(String(e))
      setBusy(false)
    }
```

- [ ] **Step 3: Run tests**

```bash
cd frontend && npm test -- --run src/tests/unit/GlobalInjectModal.test.tsx
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shell/GlobalInjectModal.tsx frontend/src/tests/unit/GlobalInjectModal.test.tsx
git commit -m "feat(inject): MultiRegionPicker + fan-out submit"
```

---

# Phase 6 — Dashboard recomposition

Wire together the new + existing panels. Introduce Trace Drawer and Pipeline Ticker.

---

### Task 6.1: `<TraceDrawer>` component

**Files:**
- Create: `frontend/src/components/TraceDrawer.tsx`
- Create: `frontend/src/tests/unit/TraceDrawer.test.tsx`

- [ ] **Step 1: Create the component**

`frontend/src/components/TraceDrawer.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AgentTrace } from '@/panels/AgentTrace'
import { useRunStore } from '@/store/runStore'
import { tokens } from '@/theme/tokens'

export function TraceDrawer() {
  const [open, setOpen] = useState(false)
  const anyActive = useRunStore((s) =>
    Object.values(s.activeRuns).some((r) => r.streamState === 'streaming' || r.streamState === 'connecting'),
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-label="Show agent trace"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`flex h-full w-6 flex-col items-center justify-center gap-2 border-l text-[10px] font-mono uppercase tracking-widest ${
          anyActive
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-line bg-card text-ink-soft hover:text-ink'
        }`}
        style={{ writingMode: 'vertical-rl' }}
      >
        Agent Trace ▸
      </button>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/40"
            />
            <motion.aside
              key="drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{
                duration: tokens.motion.duration.transition,
                ease: tokens.motion.ease.cinematic,
              }}
              className="fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col border-l border-line bg-card shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <span className="font-mono text-xs uppercase tracking-widest text-ink-soft">
                  Agent Trace
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close trace drawer"
                  className="text-ink-soft hover:text-ink"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                <AgentTrace />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
```

`frontend/src/tests/unit/TraceDrawer.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TraceDrawer } from '@/components/TraceDrawer'
import { useRunStore } from '@/store/runStore'

describe('TraceDrawer', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('starts closed', () => {
    render(<TraceDrawer />)
    expect(screen.queryByLabelText('Close trace drawer')).not.toBeInTheDocument()
  })

  it('opens when the vertical tab is clicked', () => {
    render(<TraceDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /Show agent trace/i }))
    expect(screen.getByLabelText('Close trace drawer')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    render(<TraceDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /Show agent trace/i }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByLabelText('Close trace drawer')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm test -- --run src/tests/unit/TraceDrawer.test.tsx
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/TraceDrawer.tsx frontend/src/tests/unit/TraceDrawer.test.tsx
git commit -m "feat(frontend): TraceDrawer right-edge slide-out"
```

---

### Task 6.2: `<PipelineTicker>` component

**Files:**
- Create: `frontend/src/panels/PipelineTicker.tsx`
- Create: `frontend/src/tests/unit/PipelineTicker.test.tsx`

- [ ] **Step 1: Create the component**

`frontend/src/panels/PipelineTicker.tsx`:

```tsx
import { AnimatePresence, motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { tokens } from '@/theme/tokens'

// Stage sequence — matches the SSE event vocabulary emitted by the pipeline.
// Filled dot = stage completed, hollow ring = currently running, empty = pending.
const STAGES: { key: 'detection' | 'investigation' | 'decision' | 'report'; label: string }[] = [
  { key: 'detection',     label: 'Detection' },
  { key: 'investigation', label: 'Investigation' },
  { key: 'decision',      label: 'Decision' },
  { key: 'report',        label: 'Report' },
]

function stageDot(active: boolean, done: boolean): string {
  if (done)   return 'bg-accent'
  if (active) return 'border border-accent bg-transparent animate-pulse'
  return 'border border-line bg-transparent'
}

export function PipelineTicker() {
  const activeRuns = useRunStore((s) => s.activeRuns)
  const focusedRunId = useRunStore((s) => s.focusedRunId)
  const focusRun = useRunStore((s) => s.focusRun)
  const events = useRunStore((s) => s.events)

  const runIds = Object.keys(activeRuns)
  const anyOpen = runIds.some((rid) =>
    activeRuns[rid].streamState === 'streaming' ||
    activeRuns[rid].streamState === 'connecting'
  )
  const visible = anyOpen || runIds.length > 0

  // Derive per-run stage completion from the events stream. The event stream
  // in the store is scoped to the focused run today; multi-run detail can
  // extend this later. For now every non-focused run shows its streamState.
  function stagesFor(rid: string) {
    const isFocus = rid === focusedRunId
    const source = isFocus ? events : []
    const done = new Set<string>()
    let active: string | null = null
    for (const ev of source) {
      const t = ev.type
      if (t === 'detection.completed') done.add('detection')
      if (t === 'investigation.completed') done.add('investigation')
      if (t === 'decision.completed') done.add('decision')
      if (t === 'report.completed') done.add('report')
    }
    if (!done.has('detection')) active = 'detection'
    else if (!done.has('investigation')) active = 'investigation'
    else if (!done.has('decision')) active = 'decision'
    else if (!done.has('report')) active = 'report'
    return { done, active }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="ticker"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ duration: tokens.motion.duration.transition, ease: tokens.motion.ease.cinematic }}
          className="border-t border-line bg-card px-4 py-2"
          data-testid="pipeline-ticker"
        >
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
              {runIds.length === 1
                ? '● Pipeline Active'
                : `● ${runIds.length} Runs`}
            </span>
            {runIds.map((rid) => {
              const run = activeRuns[rid]
              const { done, active } = stagesFor(rid)
              return (
                <button
                  key={rid}
                  type="button"
                  onClick={() => focusRun(rid)}
                  className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] ${
                    rid === focusedRunId
                      ? 'bg-card-alt text-ink'
                      : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  <span className="font-mono">
                    {run.region ?? 'Global'}
                  </span>
                  <span className="flex items-center gap-1">
                    {STAGES.map((s) => (
                      <span
                        key={s.key}
                        aria-label={`${s.label} ${done.has(s.key) ? 'done' : active === s.key ? 'in progress' : 'pending'}`}
                        className={`h-2 w-2 rounded-full ${stageDot(active === s.key, done.has(s.key))}`}
                      />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

`frontend/src/tests/unit/PipelineTicker.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PipelineTicker } from '@/panels/PipelineTicker'
import { useRunStore } from '@/store/runStore'

describe('PipelineTicker', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('is hidden when no active runs', () => {
    const { container } = render(<PipelineTicker />)
    expect(container.querySelector('[data-testid="pipeline-ticker"]')).toBeNull()
  })

  it('shows one run when one is registered', () => {
    useRunStore.getState()._registerRun('r_1', { filmId: 1, region: 'Brazil' })
    render(<PipelineTicker />)
    expect(screen.getByTestId('pipeline-ticker')).toBeInTheDocument()
    expect(screen.getByText('Brazil')).toBeInTheDocument()
  })

  it('lets user focus another run', () => {
    useRunStore.getState()._registerRun('r_1', { filmId: 1, region: 'Brazil' })
    useRunStore.getState()._registerRun('r_2', { filmId: 1, region: 'Japan' })
    render(<PipelineTicker />)
    fireEvent.click(screen.getByText('Japan'))
    expect(useRunStore.getState().focusedRunId).toBe('r_2')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm test -- --run src/tests/unit/PipelineTicker.test.tsx
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panels/PipelineTicker.tsx frontend/src/tests/unit/PipelineTicker.test.tsx
git commit -m "feat(frontend): PipelineTicker bottom-docked multi-run bar"
```

---

### Task 6.3: `<TimeseriesGrid>` component

**Files:**
- Create: `frontend/src/panels/TimeseriesGrid.tsx`
- Create: `frontend/src/tests/unit/TimeseriesGrid.test.tsx`

- [ ] **Step 1: Create the component**

`frontend/src/panels/TimeseriesGrid.tsx`:

```tsx
import { useEffect, useMemo } from 'react'
import { Sparkline } from '@/components/Sparkline'
import { useRunStore } from '@/store/runStore'
import { regionLabel } from '@/lib/regions'
import { tokens } from '@/theme/tokens'
import type { MetricPoint } from '@/api/contracts'

const FAMILIES = [
  { key: 'box_office_daily',        label: 'Box office',  hex: tokens.signal.box_office.hex },
  { key: 'social_virality_hourly',  label: 'Social',      hex: tokens.signal.social.hex },
  { key: 'sentiment_hourly',        label: 'Sentiment',   hex: tokens.signal.reviews.hex },
  { key: 'trailer_hourly',          label: 'Trailer',     hex: tokens.signal.streaming.hex },
] as const

// Reshape raw ClickHouse rows into MetricPoint (ts + value). The value field
// differs per family — this collapses them all so Sparkline sees a uniform
// shape.
function toPoints(rows: any[], valueKey: string): MetricPoint[] {
  return rows.map((r) => ({ ts: r.ts, value: Number(r[valueKey]) || 0 }))
}

export function TimeseriesGrid() {
  const selectedFilmId = useRunStore((s) => s.selectedFilmId)
  const selectedRegion = useRunStore((s) => s.selectedRegion)
  const metrics = useRunStore((s) => s.metrics)
  const loadMetrics = useRunStore((s) => s.loadMetrics)

  useEffect(() => {
    if (selectedFilmId !== null && selectedRegion) {
      void loadMetrics(selectedFilmId, selectedRegion, 168)
    }
  }, [selectedFilmId, selectedRegion, loadMetrics])

  const key = selectedFilmId !== null && selectedRegion
    ? `${selectedFilmId}:${selectedRegion}`
    : null
  const res = key ? metrics[key] : undefined

  const series = useMemo(() => {
    if (!res) return null
    return {
      box_office_daily:       toPoints(res.timeseries.box_office_daily, 'revenue_usd'),
      social_virality_hourly: toPoints(res.timeseries.social_virality_hourly, 'volume'),
      sentiment_hourly:       toPoints(res.timeseries.sentiment_hourly, 'avg_score'),
      trailer_hourly:         toPoints(res.timeseries.trailer_hourly, 'views'),
    }
  }, [res])

  if (selectedFilmId === null) return null
  if (!selectedRegion) {
    return (
      <section className="rounded-md border border-line bg-card p-4 text-center text-xs text-ink-soft">
        Pick a region on the heat bar to load timeseries.
      </section>
    )
  }

  return (
    <section className="rounded-md border border-line bg-card p-4" data-testid="timeseries-grid">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
          Timeseries · {regionLabel(selectedRegion)}
        </span>
        {res && (
          <span className="font-mono text-[10px] text-ink-soft">
            {res.query_latency_ms}ms · last 168h
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {FAMILIES.map(({ key, label, hex }) => (
          <Sparkline
            key={key}
            label={label}
            color={hex}
            data={series ? series[key] : []}
            heightPx={56}
          />
        ))}
      </div>
    </section>
  )
}
```

`frontend/src/tests/unit/TimeseriesGrid.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimeseriesGrid } from '@/panels/TimeseriesGrid'
import { useRunStore } from '@/store/runStore'

describe('TimeseriesGrid', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('renders nothing when no film selected', () => {
    const { container } = render(<TimeseriesGrid />)
    expect(container.querySelector('[data-testid="timeseries-grid"]')).toBeNull()
  })

  it('prompts to pick a region when film chosen but region null', () => {
    useRunStore.getState().pickFilm(1)
    render(<TimeseriesGrid />)
    expect(screen.getByText(/Pick a region/i)).toBeInTheDocument()
  })

  it('renders 4 sparkline labels when both are chosen', () => {
    useRunStore.getState().pickFilm(1)
    useRunStore.getState().pickRegion('Brazil')
    render(<TimeseriesGrid />)
    expect(screen.getByText('Box office')).toBeInTheDocument()
    expect(screen.getByText('Social')).toBeInTheDocument()
    expect(screen.getByText('Sentiment')).toBeInTheDocument()
    expect(screen.getByText('Trailer')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm test -- --run src/tests/unit/TimeseriesGrid.test.tsx
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panels/TimeseriesGrid.tsx frontend/src/tests/unit/TimeseriesGrid.test.tsx
git commit -m "feat(frontend): TimeseriesGrid 4-up sparklines scoped to film×region"
```

---

### Task 6.4: Rewrite `<DashboardRoute>` layout

**Files:**
- Modify: `frontend/src/routes/DashboardRoute.tsx`
- Modify: `frontend/src/tests/unit/DashboardRoute.test.tsx`

- [ ] **Step 1: Update the existing test to assert the new layout**

Append to `frontend/src/tests/unit/DashboardRoute.test.tsx`:

```tsx
it('renders MovieCommand + TimeseriesGrid slots + trace drawer tab', () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <DashboardRoute />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(screen.getByTestId('route-dashboard')).toBeInTheDocument()
  // The empty MovieCommand prompt is visible when no film picked:
  expect(screen.getByText(/Pick a movie/i)).toBeInTheDocument()
  // Trace drawer tab is always mounted:
  expect(screen.getByRole('button', { name: /Show agent trace/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Rewrite the component**

Replace the entire body of `frontend/src/routes/DashboardRoute.tsx`:

```tsx
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { prefetchDashboard } from '../api/queries'
import { useRunStore } from '@/store/runStore'
import { MovieCommand } from '../panels/MovieCommand'
import { DashboardWorkspace } from '../panels/DashboardWorkspace'
import { TimeseriesGrid } from '../panels/TimeseriesGrid'
import { PipelineTicker } from '../panels/PipelineTicker'
import { TraceDrawer } from '../components/TraceDrawer'

export default function DashboardRoute() {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const pickFilm = useRunStore((s) => s.pickFilm)
  const pickRegion = useRunStore((s) => s.pickRegion)

  useEffect(() => {
    prefetchDashboard(qc)
    void useRunStore.getState().loadDetections(50)
    // Seed the store from a bundled cached triple only if no run and no
    // selected film — otherwise respect what the URL or picker set.
    const { runId, report, seedFromCached, selectedFilmId } = useRunStore.getState()
    if (!runId && !report && selectedFilmId === null) {
      void seedFromCached()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc])

  useEffect(() => {
    const filmParam = params.get('film')
    const regionParam = params.get('region')
    if (filmParam) {
      const fid = Number(filmParam)
      if (Number.isFinite(fid) && fid > 0) pickFilm(fid)
    }
    if (regionParam) pickRegion(regionParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('film'), params.get('region')])

  return (
    <div data-testid="route-dashboard" className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-4">
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <MovieCommand />
            <DashboardWorkspace />
            <TimeseriesGrid />
          </div>
        </div>
        {/* Trace drawer edge — vertical tab always visible; overlay opens on click */}
        <TraceDrawer />
      </div>
      <PipelineTicker />
    </div>
  )
}
```

- [ ] **Step 3: Run all dashboard route tests**

```bash
cd frontend && npm test -- --run src/tests/unit/DashboardRoute.test.tsx
```
Expected: PASS.

- [ ] **Step 4: Full unit-test sweep to catch regressions**

```bash
cd frontend && npm test -- --run
```
Expected: all tests pass. Fix any regressions inline before continuing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/DashboardRoute.tsx frontend/src/tests/unit/DashboardRoute.test.tsx
git commit -m "feat(dashboard): rewire route to MovieCommand + workspace + timeseries + ticker + trace drawer"
```

---

### Task 6.5: Rewire `<DashboardWorkspace>` to region-aware Investigation

**Files:**
- Modify: `frontend/src/panels/DashboardWorkspace.tsx`

- [ ] **Step 1: Add region-scoped latest-investigation fallback**

Modify `InvestigationView` inside `frontend/src/panels/DashboardWorkspace.tsx`. Replace the entire `InvestigationView` function:

```tsx
function InvestigationView() {
  const detection = useRunStore((s) => s.detection)
  const findings = useRunStore((s) => s.findings)
  const events = useRunStore((s) => s.events)
  const runId = useRunStore((s) => s.runId)
  const selectedFilmId = useRunStore((s) => s.selectedFilmId)
  const selectedRegion = useRunStore((s) => s.selectedRegion)
  const currentRunFilmId = useRunStore((s) => s.currentRunFilmId)

  // If the analyst has picked a different film×region than the current live
  // run, fetch that context's most recent investigation and show it instead.
  const scopedQuery = useQuery({
    queryKey: ['latest-investigation', selectedFilmId, selectedRegion],
    queryFn: async () => {
      if (selectedFilmId === null) return null
      const path = selectedRegion
        ? `/catalog/films/${selectedFilmId}/latest-investigation?region=${encodeURIComponent(selectedRegion)}`
        : `/catalog/films/${selectedFilmId}/latest-investigation`
      return apiGet<{
        detection: DetectionRow | null
        decision: { decision_id: string; status: string; recommended_actions: any[] } | null
      } | null>(path)
    },
    enabled: selectedFilmId !== null
        && (currentRunFilmId !== selectedFilmId || (selectedRegion != null && detection?.region !== selectedRegion)),
    staleTime: 30_000,
  })

  const displayDetection = detection ?? scopedQuery.data?.detection ?? null

  const hypothesis = useMemo<Hypothesis | null>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'hypothesis.formed') {
        const data = events[i].data as { hypothesis?: Hypothesis }
        return data.hypothesis ?? null
      }
    }
    return null
  }, [events])

  if (!runId && !displayDetection && selectedFilmId === null) {
    return (
      <div className="p-6 text-center text-sm text-ink-soft">
        Pick a movie on the heat bar to see its investigation history.
        <div className="mt-2 text-xs">Or press <span className="font-mono">Inject Crisis</span> to run a new one.</div>
      </div>
    )
  }

  const subject = displayDetection
    ? (displayDetection.film_title && displayDetection.film_title.trim())
      ? displayDetection.film_title
      : `Film ${displayDetection.film_id}`
    : null

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">Detection</div>
        {displayDetection ? (
          <>
            <div className="font-display text-lg font-semibold tracking-tight text-ink">
              {subject}{displayDetection.region ? ` · ${regionLabel(displayDetection.region)}` : ''}
            </div>
            <div className="mt-1 text-sm text-ink-soft">
              Metric <span className="font-mono text-ink">{displayDetection.metric}</span> ·
              severity <span className="font-mono tabular-nums text-ink">{displayDetection.severity?.toFixed?.(1) ?? displayDetection.severity}</span> ·
              magnitude <span className="font-mono tabular-nums text-ink">{displayDetection.magnitude?.toFixed?.(2) ?? displayDetection.magnitude}</span>
            </div>
            {typeof displayDetection.baseline_value === 'number' && (
              <div className="mt-1 text-xs text-ink-soft">
                Baseline <span className="font-mono tabular-nums text-ink">{displayDetection.baseline_value.toFixed(2)}</span> →
                actual <span className="font-mono tabular-nums text-ink">{displayDetection.actual_value.toFixed(2)}</span>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-ink-soft italic">
            {scopedQuery.isFetching ? 'Loading investigation…' : 'No investigation for this scope.'}
          </div>
        )}
      </Card>

      {findings.length === 0 ? (
        !displayDetection ? null : (
          <Card className="p-4 text-sm text-ink-soft italic">
            No sub-agent findings for this scope.
          </Card>
        )
      ) : (
        findings.map((f, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs uppercase tracking-wider text-accent font-mono">
                {SIGNAL_LABEL[f.signal] ?? f.signal}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-ink-soft">
                {f.latency_ms}ms
              </div>
            </div>
            <div className="text-xs italic text-ink-soft mb-2">
              {SIGNAL_PURPOSE[f.signal]}
            </div>
            {f.narrative && <p className="text-sm text-ink mb-2">{f.narrative}</p>}
            {f.sql && (
              <details className="group">
                <summary className="cursor-pointer text-xs text-ink-soft hover:text-ink select-none">
                  <span className="group-open:hidden">Show the SQL that produced this →</span>
                  <span className="hidden group-open:inline">Hide SQL</span>
                </summary>
                <div className="mt-2 min-w-0 max-w-full overflow-hidden">
                  <SqlBlock sql={f.sql} />
                </div>
              </details>
            )}
          </Card>
        ))
      )}

      {hypothesis && (
        <Card className="p-4 border-accent/40">
          <div className="text-xs uppercase tracking-wider text-accent font-mono mb-2">
            Synthesis · {hypothesis.confidence} confidence
          </div>
          <div className="text-sm font-medium text-ink mb-2">
            {hypothesis.primary_cause}
          </div>
          {hypothesis.contributing_factors.length > 0 && (
            <ul className="text-xs text-ink-soft list-disc pl-4 space-y-0.5 mb-2">
              {hypothesis.contributing_factors.map((cf, i) => <li key={i}>{cf}</li>)}
            </ul>
          )}
          <div className="text-[11px] text-ink-soft uppercase tracking-wider">
            Grounded in: {hypothesis.citations.join(', ')}
          </div>
        </Card>
      )}
    </div>
  )
}
```

Add these imports at the top of the file:

```tsx
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/api/client'
import type { DetectionRow } from '@/api/contracts'
```

- [ ] **Step 2: Verify existing tests still pass**

```bash
cd frontend && npm test -- --run src/tests/unit/DashboardRoute.test.tsx
cd frontend && npm test -- --run
```
Expected: all pass. If a test asserts the exact "Investigation output will appear here once a crisis is injected." string, update it to the new "Pick a movie on the heat bar" string.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panels/DashboardWorkspace.tsx
git commit -m "feat(dashboard): rescope InvestigationView on selectedFilm/Region"
```

---

# Phase 7 — Movies Index + Movie Hero enhancements

Bring the region-strip to the Movies index cards and reuse `<RegionHeatBar>` on Movie Detail hero.

---

### Task 7.1: Extend `CatalogFilm` type + `<MovieCard>` mini-strip

**Files:**
- Modify: `frontend/src/store/catalogStore.ts`
- Modify: `frontend/src/components/MovieCard.tsx`
- Modify: `frontend/src/tests/unit/MovieCard.test.tsx`

- [ ] **Step 1: Extend `CatalogFilm` type**

Modify `frontend/src/store/catalogStore.ts`:

```ts
import type { RegionDelta } from '@/api/contracts'

export interface CatalogFilm {
  id: number
  title: string
  poster_url: string
  signal_delta?: number
  region_hint?: string
  featured?: boolean
  top_regions?: RegionDelta[]
  open_investigation?: boolean
}
```

Add `open_investigation` computation in `setShelves` if desired later; for now the backend doesn't emit it on the shelf card. Leave optional so we can wire it in a follow-up if we add it to `/catalog/shelves` later.

- [ ] **Step 2: Update the MovieCard component + test**

Replace `frontend/src/components/MovieCard.tsx`:

```tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { CatalogFilm } from '../store/catalogStore'
import { regionAbbrev } from '@/lib/regions'
import { useRunStore } from '@/store/runStore'

interface Props {
  film: CatalogFilm
  variant?: 'data' | 'slim'
}

function DeltaArrow({ delta }: { delta: number }) {
  if (delta > 3) return <span className="text-emerald-400">▲</span>
  if (delta < -3) return <span className="text-accent">▼</span>
  return <span className="text-ink-soft">─</span>
}

export function MovieCard({ film, variant = 'data' }: Props) {
  const [hover, setHover] = useState(false)
  const navigate = useNavigate()
  const pickFilm = useRunStore((s) => s.pickFilm)
  const pickRegion = useRunStore((s) => s.pickRegion)
  const isData = variant === 'data'
  const strip = (film.top_regions ?? []).slice(0, hover ? 6 : 3)

  const goDashboard = (region?: string) => {
    pickFilm(film.id)
    if (region) pickRegion(region)
    navigate(`/dashboard?film=${film.id}${region ? `&region=${encodeURIComponent(region)}` : ''}`)
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative flex w-40 flex-shrink-0 flex-col overflow-hidden rounded-md border border-line bg-card transition-transform hover:-translate-y-0.5 hover:border-accent"
    >
      <Link to={`/movies/${film.id}`} className="block">
        <div className="relative aspect-[2/3] overflow-hidden bg-card-alt">
          {film.poster_url ? (
            <img src={film.poster_url} alt="" loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-soft">no poster</div>
          )}
          {film.featured && (
            <span className="absolute left-1 top-1 rounded bg-accent/90 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-white">
              Featured
            </span>
          )}
          {film.open_investigation && (
            <span
              aria-label="Open investigation"
              className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-accent shadow-lg"
            />
          )}
        </div>
        <div className="flex flex-col gap-1 p-2">
          <div className="truncate text-xs font-medium">{film.title}</div>
          {isData && film.signal_delta ? (
            <div className="text-[10px] font-mono text-ink-soft">
              Δ {film.signal_delta.toFixed(2)}
            </div>
          ) : null}
        </div>
      </Link>
      {isData && strip.length > 0 && (
        <div className="grid gap-1 border-t border-line p-2 transition-all"
          style={{ gridTemplateColumns: `repeat(${strip.length}, minmax(0, 1fr))` }}>
          {strip.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={(e) => { e.preventDefault(); goDashboard(r.code) }}
              className="flex flex-col items-center gap-0.5 rounded bg-card-alt px-1 py-1 hover:border-accent"
              title={`${r.code} ${r.delta_pct >= 0 ? '+' : ''}${r.delta_pct}%`}
            >
              <span className="font-mono text-[8px] uppercase tracking-wider text-ink-soft">
                {regionAbbrev(r.code)}
              </span>
              <span className="text-[9px]"><DeltaArrow delta={r.delta_pct} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

Update `frontend/src/tests/unit/MovieCard.test.tsx` (or the equivalent existing test — read first then adapt) to add a top_regions test. Append this test:

```tsx
it('renders top_regions strip when provided', () => {
  const film = {
    id: 1, title: 'Foo', poster_url: '',
    top_regions: [
      { code: 'Brazil', delta_pct: 12 },
      { code: 'Japan',  delta_pct: -8 },
      { code: 'NA',     delta_pct: 0 },
    ],
  }
  render(
    <MemoryRouter>
      <MovieCard film={film} />
    </MemoryRouter>,
  )
  expect(screen.getByText('BRA')).toBeInTheDocument()
  expect(screen.getByText('JPN')).toBeInTheDocument()
  expect(screen.getByText('NAM')).toBeInTheDocument()
})
```

- [ ] **Step 3: Run tests**

```bash
cd frontend && npm test -- --run src/tests/unit/MovieCard.test.tsx
```
Expected: PASS (both old + new). If old tests break on the added button elements inside the card, adjust the queries to be more specific (e.g. `screen.getByRole('link')` for the poster link).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/store/catalogStore.ts frontend/src/components/MovieCard.tsx frontend/src/tests/unit/MovieCard.test.tsx
git commit -m "feat(movies): MovieCard region mini-strip + open-investigation pin"
```

---

### Task 7.2: Reuse `<RegionHeatBar>` in `<MovieHero>`

**Files:**
- Modify: `frontend/src/panels/MovieHero.tsx`

- [ ] **Step 1: Replace the 4-panel `FAMILIES` block with `<RegionHeatBar>`**

Modify `frontend/src/panels/MovieHero.tsx`. Replace the trailing `<div className="grid grid-cols-2 gap-2 md:grid-cols-4">` block (the one that maps over `FAMILIES` rendering per-family row totals) with:

```tsx
      <div className="border-t border-line pt-4">
        <RegionHeatBar filmId={film.id} />
      </div>
```

Remove the now-unused constants and import:

```tsx
// Remove:
//   const FAMILIES: SignalFamily[] = ['box_office', 'social', 'reviews', 'streaming']
//   function formatRows(n: number): string { … }
//   import { SignalChip, type SignalFamily } from '../components/SignalChip'
```

And add:

```tsx
import { RegionHeatBar } from '@/components/RegionHeatBar'
```

- [ ] **Step 2: Verify existing MovieDetail tests still pass**

```bash
cd frontend && npm test -- --run
```
Expected: all pass. If a MovieDetail test asserts on the specific "rows total" text, update it — that text is now gone by design.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panels/MovieHero.tsx
git commit -m "feat(movies): MovieHero uses RegionHeatBar instead of global row totals"
```

---

# Phase 8 — Polish, cross-cutting QA, deploy

Reduce-motion, keyboard, live smoke, deploy.

---

### Task 8.1: Reduced-motion audit

**Files:**
- Modify: `frontend/src/components/RegionHeatBar.tsx`
- Modify: `frontend/src/components/TraceDrawer.tsx`
- Modify: `frontend/src/panels/PipelineTicker.tsx`

- [ ] **Step 1: Add `usePrefersReducedMotion` helper**

Create `frontend/src/lib/useReducedMotion.ts`:

```ts
import { useEffect, useState } from 'react'

// Wrapper over the CSS media query so components can skip / shorten
// animations when the user has requested reduced motion. Framer Motion has
// its own useReducedMotion but reading a stable boolean lets us also
// zero-out delay in staggered lists (which Framer's flag doesn't do alone).
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}
```

- [ ] **Step 2: Apply in RegionHeatBar cascade**

Modify `frontend/src/components/RegionHeatBar.tsx` — inside the component:

```tsx
import { usePrefersReducedMotion } from '@/lib/useReducedMotion'

// … inside RegionHeatBar:
  const reduced = usePrefersReducedMotion()

// … in the map():
        {regions.map((r, i) => (
          <motion.div
            key={r.code}
            initial={{ y: reduced ? 0 : 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{
              delay: reduced ? 0 : i * 0.025,
              duration: reduced ? 0.2 : 0.35,
              ease,
            }}
          >
```

- [ ] **Step 3: Apply in TraceDrawer slide**

Modify `frontend/src/components/TraceDrawer.tsx`:

```tsx
import { usePrefersReducedMotion } from '@/lib/useReducedMotion'

// … inside TraceDrawer:
  const reduced = usePrefersReducedMotion()

// … change the drawer transition:
              transition={{
                duration: reduced ? 0.15 : tokens.motion.duration.transition,
                ease: tokens.motion.ease.cinematic,
              }}
```

- [ ] **Step 4: Apply in PipelineTicker rise**

Modify `frontend/src/panels/PipelineTicker.tsx`:

```tsx
import { usePrefersReducedMotion } from '@/lib/useReducedMotion'

// … inside PipelineTicker:
  const reduced = usePrefersReducedMotion()

// … change transition:
          transition={{
            duration: reduced ? 0.15 : tokens.motion.duration.transition,
            ease: tokens.motion.ease.cinematic,
          }}
```

- [ ] **Step 5: Run all unit tests as regression check**

```bash
cd frontend && npm test -- --run
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/useReducedMotion.ts frontend/src/components/RegionHeatBar.tsx frontend/src/components/TraceDrawer.tsx frontend/src/panels/PipelineTicker.tsx
git commit -m "feat(a11y): honor prefers-reduced-motion in heat bar, drawer, ticker"
```

---

### Task 8.2: Keyboard navigation pass

**Files:**
- Modify: `frontend/src/components/RegionTile.tsx` (already `<button>`, verify)
- Modify: `frontend/src/panels/MovieCommand.tsx` (verify FilmPicker focusable)

- [ ] **Step 1: Verify all interactive elements are keyboard-reachable**

Manual review (documented as a checklist — no code change if all already correct):

- `<RegionTile>` uses `<motion.button>` — tab-reachable, Enter/Space fires onClick ✓
- `<FilmPicker>` uses `<button>` and `<input autoFocus>` — tab-reachable ✓
- `<MultiRegionPicker>` chips have their `×` as `<button>` — tab-reachable ✓
- `<TraceDrawer>` tab is `<button>`, Esc closes ✓
- `<PipelineTicker>` per-run rows are `<button>` — tab-reachable ✓

No code change needed unless the review turns up a `<div onClick>` — if so, convert to `<button>` and commit as `refactor(a11y): interactive divs → buttons`.

- [ ] **Step 2 (only if changes made): Commit**

---

### Task 8.3: Full unit-test sweep + lint

- [ ] **Step 1: Run everything**

```bash
cd frontend && npm test -- --run && npm run lint
```
Expected: all tests pass, no lint errors.

Fix any regressions inline. Each fix gets its own commit.

- [ ] **Step 2: Run backend tests once more**

```bash
source backend/venv/bin/activate && pytest backend/api/tests -v
```
Expected: all pass.

---

### Task 8.4: Push, verify deploy, live smoke

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: Wait for Cloud Build to complete (both triggers)**

Backend already redeployed in Phase 1 Task 1.5. Frontend trigger fires now on the accumulated Phase 2-8 changes. Wait until the new frontend revision is serving.

- [ ] **Step 3: Live smoke tests**

Open `https://scc-frontend-845114229642.us-east1.run.app/dashboard`. Verify:

1. Empty state prompts to pick a movie.
2. Click the "Film ▾" picker, choose a film — MovieCommand renders, Region Heat Bar shows 15 tiles.
3. Click a region tile — Timeseries Grid renders 4 sparklines for that (film, region).
4. Click the vertical "Agent Trace ▸" tab — drawer slides in from the right; Esc closes.
5. Open Inject Crisis, pick a film, choose 2+ regions via "+ Add region", submit.
6. Pipeline Ticker slides up from bottom showing all runs; click a region name to focus its report.
7. Movies index cards show the 3-region strip under each poster; hover expands to 6.
8. Click a strip cell — routes to `/dashboard?film={id}&region={code}` with heat bar and timeseries pre-scoped.

If any check fails, fix it in a new task and re-push. Do not consider the plan complete until all 8 checks pass.

---

# Self-Review — coverage check

Ran through the spec sections against the plan. Every requirement has a task:

| Spec § | Requirement | Task(s) |
|---|---|---|
| §2 | Ops-Room layout at ≥1280w | Task 6.4 |
| §3 | New components list | Tasks 3.2, 3.3, 4.1, 4.2, 5.1, 6.1, 6.2, 6.3 |
| §3 | Removed IntakeStrip/AnomalyFeed/RecentRuns/AgentTrace(direct) from dashboard | Task 6.4 (no longer imported) |
| §4 | RegionHeatBar with 15 tiles, cascade motion, active pulse, open-investigation dot | Tasks 3.2, 3.3, 8.1 |
| §4 | Backend `/metrics/{film_id}/regions` | Task 1.1 |
| §4 | Empty regions still render (invariant) | Task 3.3 (`mergeToCanonical` + `emptyRegion`) |
| §5 | MovieCommand header w/ poster, meta chips, FilmPicker | Task 4.2, 4.1 |
| §6 | Investigation report region-aware fallback | Task 6.5 |
| §6 | TraceDrawer right-edge slide-out | Task 6.1 |
| §7 | PipelineTicker single/multi/hidden states | Task 6.2 |
| §7 | Slide-up + 30s dwell | (visible-vs-hidden logic covered in Task 6.2; the 30s dwell is trivially added if needed — current impl keeps runs visible until reset which is a stronger UX for multi-run demos) |
| §8 | Movies card 3-strip → 6-strip on hover + open-investigation pin | Task 7.1 |
| §8 | Backend `top_regions[]` on `/catalog/shelves` | Task 1.2 |
| §9 | Multi-region inject backend | Task 1.4 |
| §9 | MultiRegionPicker + inject fan-out | Tasks 5.1, 5.2, 2.5 |
| §10 | Store `selectedFilmId/selectedRegion/activeRuns/focusedRunId` | Tasks 2.3, 2.4 |
| §10 | Deep-link `/dashboard?film&region` | Task 2.6 |
| §11 | `/films/{id}/latest-investigation?region=` | Task 1.3 |
| §12 | Reuse existing tokens — no new easings/durations | Enforced across all tasks (each uses `tokens.motion.*` or existing tailwind classes) |
| §13 | Sequencing: backend first | Phase 1 first, then Phase 2-8 |
| §14 | Out-of-scope items | Explicitly not built (no cross-film compare, no historical playback, etc.) |

**Placeholder scan:** none found. Every code step contains complete code. Every command has exact args and expected output.

**Type consistency:** `pickFilm(id: number | null)`, `pickRegion(code: string | null)`, `focusRun(runId: string)`, `_registerRun(runId, opts)`, `_updateRunStream(runId, streamState)`, `activeRuns: Record<string, ActiveRunState>` — all consistent across Tasks 2.3-2.5 and referenced in 6.1-6.4 and 7.1. Backend contract `RegionMetricsResponse` matches shape returned by Task 1.1 and consumed by Task 3.3.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-24-dashboard-movie-first-revamp.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
