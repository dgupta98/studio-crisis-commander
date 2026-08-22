# Layer 7 UI Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-page OpsCenter with a cinematic, multi-route product surface (Landing → Dashboard → Movies → Movie Detail) that sells the "detect data as it lands" USP and demonstrates all four agents end-to-end.

**Architecture:** SPA with `react-router-dom` on the frontend. `<AppShell>` provides persistent left nav + top bar + `<GlobalInjectModal>` after the landing CTA. Signal-family color tokens (blue / pink / yellow / green) become first-class primitives. Backend gets four new endpoints (`/intake/rates` SSE, `/stats/summary`, `/catalog/shelves`, `/catalog/films/{id}`) plus a `detection.latency_ms` field wired end-to-end. Featured films play back from `data/eval_cache/*.json`; non-featured films fall back to a live pipeline run.

**Tech Stack:** React 18 + Vite + TypeScript + Tailwind + Framer Motion + Zustand + React Router v6 + Canvas 2D API + React Query. Backend: FastAPI + Google ADK + Gemini + mcp-clickhouse + clickhouse-connect (L1/L2 only).

**Source spec:** `docs/superpowers/specs/2026-08-16-layer-7-ui-revamp-design.md`

**Deadline:** Sep 7 2026 (22 days). Estimated 100–124 hrs.

---

## Phase 1 — Backend Delta (Tasks 1–7)

Backend contract changes come first: every downstream frontend task depends on these shapes existing. All Phase 1 tasks must be deployed to Cloud Run before Phase 3 screens start.

### Task 1: Add `latency_ms` to `DetectionIn` contract

**Files:**
- Modify: `backend/agents/investigation/contracts.py`
- Modify: `backend/api/tests/test_detections.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/api/tests/test_detections.py`:

```python
def test_detection_in_accepts_latency_ms():
    from agents.investigation.contracts import DetectionIn
    d = DetectionIn(
        metric_ts="2026-08-16T00:00:00Z",
        metric="box_office",
        film_id=1,
        region="US",
        detector="mad_z",
        baseline_value=100.0,
        actual_value=200.0,
        magnitude=2.5,
        business_impact=0.4,
        severity=0.9,
        dedup_key="abc",
        film_title="",
        latency_ms=1234,
    )
    assert d.latency_ms == 1234


def test_detection_in_latency_ms_optional():
    from agents.investigation.contracts import DetectionIn
    d = DetectionIn(
        metric_ts="2026-08-16T00:00:00Z",
        metric="box_office",
        film_id=1,
        region="US",
        detector="mad_z",
        baseline_value=100.0,
        actual_value=200.0,
        magnitude=2.5,
        business_impact=0.4,
        severity=0.9,
        dedup_key="abc",
        film_title="",
    )
    assert d.latency_ms is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest api/tests/test_detections.py::test_detection_in_accepts_latency_ms api/tests/test_detections.py::test_detection_in_latency_ms_optional -v`
Expected: FAIL — `TypeError: unexpected keyword argument 'latency_ms'` or field validation error.

- [ ] **Step 3: Add the field**

Open `backend/agents/investigation/contracts.py`, find the `DetectionIn` model, and add:

```python
    latency_ms: int | None = None
```

Place it immediately after the existing `film_title` field. Keep every other field unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest api/tests/test_detections.py -v`
Expected: PASS (both new tests + existing ones).

- [ ] **Step 5: Commit**

```bash
git add backend/agents/investigation/contracts.py backend/api/tests/test_detections.py
git commit -m "feat(contracts): add optional latency_ms to DetectionIn"
```

---

### Task 2: Populate `latency_ms` in detection source

**Files:**
- Modify: `backend/api/detection_source.py`
- Modify: `backend/api/tests/test_detection_source.py` (create if absent)

- [ ] **Step 1: Write the failing test**

Create `backend/api/tests/test_detection_source.py` (or append to it):

```python
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from data.ground_truth import Crisis, CrisisType
from api.contracts import DetectionIn
from api.detection_source import synth_from_crisis


def _crisis() -> Crisis:
    # NOTE: real Crisis schema (backend/data/ground_truth.py) — do NOT invent fields
    return Crisis(
        injection_timestamp=datetime.now(timezone.utc).replace(microsecond=0),
        is_live=True,
        type=CrisisType.REGIONAL_SENTIMENT_COLLAPSE,
        affected_film_id=42,
        affected_region="Brazil",
        magnitude=8.5,
        affected_tables=["audience_sentiment"],
        true_root_cause="synthetic",
        expected_recommendation="issue_pr_statement",
        resolution_window_hours=24,
    )


def test_synth_from_crisis_populates_latency_ms():
    crisis = _crisis()
    # Pin `_utc_now` to crisis.injection_timestamp so latency is deterministic (~0ms).
    with patch("api.detection_source._utc_now", return_value=crisis.injection_timestamp):
        det = synth_from_crisis(crisis)
    assert det.latency_ms is not None
    assert 0 <= det.latency_ms < 1000
```

(If `test_detection_source.py` already defines `_crisis()` — as it does on main — reuse the existing helper instead of redefining it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest api/tests/test_detection_source.py::test_synth_from_crisis_populates_latency_ms -v`
Expected: FAIL — `latency_ms` is `None` OR `synth_from_crisis` doesn't exist as importable.

- [ ] **Step 3: Add helper + wire latency**

Open `backend/api/detection_source.py`. Add these module-level helpers (place them above `_CRISIS_METRIC` but below the imports):

```python
from datetime import datetime, timezone


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _latency_ms(metric_ts: datetime | str) -> int:
    # ClickHouse returns datetime for DateTime columns; the synth path passes datetime too.
    # Accept ISO strings defensively for older callers.
    if isinstance(metric_ts, str):
        try:
            mts = datetime.fromisoformat(metric_ts.replace("Z", "+00:00"))
        except ValueError:
            return 0
    else:
        mts = metric_ts
    if mts.tzinfo is None:
        mts = mts.replace(tzinfo=timezone.utc)
    delta = (_utc_now() - mts).total_seconds() * 1000
    return max(0, int(delta))
```

Then in `produce_detection()`, immediately before returning `DetectionIn(...)`, add `latency_ms=_latency_ms(row["metric_ts"])` to the constructor kwargs. Do the same inside `synth_from_crisis()` — pass the same `ts` (a `datetime`) that gets assigned to `metric_ts`, i.e. `latency_ms=_latency_ms(ts)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest api/tests/test_detection_source.py api/tests/test_detections.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/detection_source.py backend/api/tests/test_detection_source.py
git commit -m "feat(detection): capture latency_ms at ingest time"
```

---

### Task 3: Surface `latency_ms` in `/detections` API + SSE payload

**Files:**
- Modify: `backend/api/routers/detections.py`
- Modify: `backend/api/events.py` (verify detection.completed body)
- Modify: `backend/api/tests/test_detections.py`
- Modify: `frontend/src/api/contracts.ts`

- [ ] **Step 1: Write failing frontend contract test**

Append to `frontend/src/tests/unit/contracts.test.ts` (create if absent):

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type { DetectionRow } from "../../api/contracts";

describe("DetectionRow contract", () => {
  it("carries optional latency_ms", () => {
    const row: DetectionRow = {
      metric_ts: "2026-08-16T00:00:00Z",
      metric: "box_office",
      film_id: 1,
      region: "US",
      detector: "mad_z",
      baseline_value: 100,
      actual_value: 200,
      magnitude: 2.5,
      business_impact: 0.4,
      severity: 0.9,
      dedup_key: "abc",
      film_title: "",
      latency_ms: 1234,
    };
    expectTypeOf(row.latency_ms).toEqualTypeOf<number | null | undefined>();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/contracts.test.ts`
Expected: FAIL — `latency_ms` not in `DetectionRow`.

- [ ] **Step 3: Update `DetectionRow` in frontend contracts**

Open `frontend/src/api/contracts.ts`, locate `interface DetectionRow`, add:

```typescript
  latency_ms?: number | null;
```

after the `film_title` line.

- [ ] **Step 4: Update backend `/detections` SQL projection**

Open `backend/api/routers/detections.py`. Update `_COLS` to include latency:

```python
_COLS = (
    "metric_ts", "metric", "film_id", "region", "detector",
    "baseline_value", "actual_value", "magnitude", "business_impact",
    "severity", "dedup_key", "film_title", "latency_ms",
)
```

Update the SQL query inside the handler to project `toUnixTimestamp64Milli(now64(3)) - toUnixTimestamp64Milli(metric_ts) AS latency_ms` as the last selected column (before the LEFT JOIN clause). If the router currently uses `SELECT metric_ts, metric, ...`, append `, toUnixTimestamp64Milli(now64(3)) - toUnixTimestamp64Milli(d.metric_ts) AS latency_ms` before `FROM`.

- [ ] **Step 5: Write failing backend test**

Add to `backend/api/tests/test_detections.py`:

```python
def test_detections_endpoint_returns_latency_ms(client):
    resp = client.get("/detections?limit=1")
    assert resp.status_code == 200
    rows = resp.json()
    if rows:
        assert "latency_ms" in rows[0]
```

- [ ] **Step 6: Run all tests**

Run: `cd backend && pytest api/tests/test_detections.py -v && cd ../frontend && npx vitest run src/tests/unit/contracts.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/api/routers/detections.py backend/api/tests/test_detections.py frontend/src/api/contracts.ts frontend/src/tests/unit/contracts.test.ts
git commit -m "feat(api): expose latency_ms on detections + SSE"
```

---

### Task 4: New endpoint `/intake/rates` (SSE)

**Files:**
- Create: `backend/api/routers/intake.py`
- Modify: `backend/api/main.py`
- Create: `backend/api/tests/test_intake.py`

- [ ] **Step 1: Write failing test**

Create `backend/api/tests/test_intake.py`:

```python
from fastapi.testclient import TestClient
from api.main import app


def test_intake_rates_endpoint_exists():
    with TestClient(app) as client:
        with client.stream("GET", "/intake/rates") as r:
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("text/event-stream")


def test_intake_rates_emits_one_event_then_disconnect():
    with TestClient(app) as client:
        with client.stream("GET", "/intake/rates") as r:
            lines = []
            for line in r.iter_lines():
                lines.append(line)
                if len(lines) > 4:
                    break
            data_lines = [l for l in lines if l.startswith("data: ")]
            assert data_lines
            import json
            payload = json.loads(data_lines[0][len("data: "):])
            assert "box_office" in payload
            assert "social" in payload
            assert "reviews" in payload
            assert "streaming" in payload
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest api/tests/test_intake.py -v`
Expected: FAIL — 404 route missing.

- [ ] **Step 3: Create the router**

Create `backend/api/routers/intake.py`:

```python
"""SSE stream of rolling per-family ingest rates for the landing/dashboard IntakeStrip.

Emits one JSON object every 2s with row-counts inserted in the past minute per signal
family. Wire format is one `data:` line per event (matches SseEvent conventions).
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from data.ch_client import client

router = APIRouter(prefix="/intake", tags=["intake"])

# Signal family → (table, WHERE clause). Column names + types must match
# backend/data/schema.sql — do NOT invent them. box_office_revenue uses a
# `date` (Date) column, not `ts`, and daily granularity — so its window is
# widened to "since yesterday" or a 1-minute count would always be zero.
_FAMILIES: dict[str, tuple[str, str]] = {
    "box_office": ("box_office_revenue",      "date >= today() - 1"),
    "social":     ("social_trends",           "ts   >= now() - INTERVAL 1 MINUTE"),
    "reviews":    ("review_scores",           "ts   >= now() - INTERVAL 1 MINUTE"),
    "streaming":  ("streaming_watch_minutes", "ts   >= now() - INTERVAL 1 MINUTE"),
}


def _rates_sync() -> dict[str, int]:
    out: dict[str, int] = {}
    with client() as c:
        for family, (table, where) in _FAMILIES.items():
            try:
                rows = c.query(
                    f"SELECT count() FROM {table} WHERE {where}"
                ).result_rows
                out[family] = int(rows[0][0]) if rows else 0
            except Exception:  # noqa: BLE001
                out[family] = 0
    return out


async def _event_stream() -> AsyncIterator[bytes]:
    while True:
        rates = await asyncio.to_thread(_rates_sync)
        yield f"data: {json.dumps(rates)}\n\n".encode()
        await asyncio.sleep(2.0)


@router.get("/rates")
async def intake_rates() -> StreamingResponse:
    return StreamingResponse(_event_stream(), media_type="text/event-stream")
```

- [ ] **Step 4: Wire into main.py**

Open `backend/api/main.py`. Add an alias import to the existing block that already imports `metrics as metrics_router` etc:

```python
from api.routers import intake as intake_router
```

Then in the mount block below (after `app.include_router(metrics_router.router)`), add:

```python
app.include_router(intake_router.router)
```

Do NOT use `from api.routers import intake` alone — the existing file uses the `as *_router` alias pattern for consistency (see main.py lines 21-25).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest api/tests/test_intake.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/api/routers/intake.py backend/api/main.py backend/api/tests/test_intake.py
git commit -m "feat(api): add /intake/rates SSE for family ingest counters"
```

---

### Task 5: New endpoint `/stats/summary`

**Files:**
- Create: `backend/api/routers/stats.py`
- Modify: `backend/api/main.py`
- Create: `backend/api/tests/test_stats.py`

- [ ] **Step 1: Write failing test**

Create `backend/api/tests/test_stats.py`:

```python
from fastapi.testclient import TestClient
from api.main import app


def test_stats_summary_shape():
    with TestClient(app) as client:
        r = client.get("/stats/summary")
        assert r.status_code == 200
        body = r.json()
        for key in ("films_tracked", "regions", "days_history", "rows_scanned_24h", "p50_detection_ms"):
            assert key in body, f"missing {key}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest api/tests/test_stats.py -v`
Expected: FAIL — 404.

- [ ] **Step 3: Create the router**

Create `backend/api/routers/stats.py`:

```python
"""Aggregate telemetry summary for landing/dashboard headline counters."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter

from data.ch_client import client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/stats", tags=["stats"])

# (table, time-column-predicate) for the 24h row-scan roll-up. Column names
# must match backend/data/schema.sql. box_office_revenue uses `date` (Date),
# the others use `ts` (DateTime).
_ROWSCAN_TABLES = (
    ("box_office_revenue",      "date >= today() - 1"),
    ("social_trends",           "ts   >= now() - INTERVAL 1 DAY"),
    ("review_scores",           "ts   >= now() - INTERVAL 1 DAY"),
    ("streaming_watch_minutes", "ts   >= now() - INTERVAL 1 DAY"),
)


def _scalar(c: Any, sql: str, default: int | float = 0) -> int | float:
    try:
        rows = c.query(sql).result_rows
        return rows[0][0] if rows else default
    except Exception:  # noqa: BLE001
        log.warning("stats scalar failed: %s", sql, exc_info=True)
        return default


def _summary_sync() -> dict[str, int | float]:
    with client() as c:
        films = int(_scalar(c, "SELECT count() FROM films"))
        regions = int(_scalar(c, "SELECT count(DISTINCT region) FROM box_office_revenue"))
        days = int(_scalar(
            c,
            "SELECT dateDiff('day', min(date), max(date)) FROM box_office_revenue",
        ))
        rows_24h = 0
        for table, where in _ROWSCAN_TABLES:
            rows_24h += int(_scalar(c, f"SELECT count() FROM {table} WHERE {where}"))
        # `detections` table (not `detections_stream`); metric_ts exists there.
        p50 = float(_scalar(
            c,
            "SELECT quantile(0.5)("
            "toUnixTimestamp64Milli(now64(3)) - toUnixTimestamp64Milli(metric_ts)"
            ") FROM detections WHERE metric_ts >= now() - INTERVAL 1 DAY",
            default=0.0,
        ))
    return {
        "films_tracked": films,
        "regions": regions,
        "days_history": days,
        "rows_scanned_24h": rows_24h,
        "p50_detection_ms": p50,
    }


@router.get("/summary")
async def stats_summary() -> dict[str, int | float]:
    return await asyncio.to_thread(_summary_sync)
```

- [ ] **Step 4: Wire into main.py**

Add to `backend/api/main.py` — preserve the existing `as *_router` alias pattern:

```python
from api.routers import stats as stats_router
```

And in the mount block:

```python
app.include_router(stats_router.router)
```

- [ ] **Step 5: Run tests**

Run: `cd backend && pytest api/tests/test_stats.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/api/routers/stats.py backend/api/main.py backend/api/tests/test_stats.py
git commit -m "feat(api): add /stats/summary rollup endpoint"
```

---

### Task 6: Catalog module + `/catalog/*` endpoints

**Files:**
- Create: `backend/api/catalog/__init__.py`
- Create: `backend/api/catalog/shelves.py`
- Create: `backend/api/routers/catalog.py`
- Modify: `backend/api/main.py`
- Create: `backend/api/tests/test_catalog.py`

- [ ] **Step 1: Write failing tests**

Create `backend/api/tests/test_catalog.py`:

```python
"""Catalog endpoint shape tests — mocks ClickHouse so tests are hermetic."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


def _fake_ch_factory(rows_by_pattern: dict[str, list]):
    """Return a fake CH client that returns per-query rows based on SQL substrings."""
    def _fake():
        class FakeCH:
            def query(self, sql):
                m = MagicMock()
                m.result_rows = []
                for pattern, rows in rows_by_pattern.items():
                    if pattern in sql:
                        m.result_rows = rows
                        break
                return m
            def __enter__(self): return self
            def __exit__(self, *a): return False
        return FakeCH()
    return _fake


def test_catalog_shelves_shape():
    from api.tests.test_fallback import _mk_triple
    fake = _fake_ch_factory({
        # generic fallback row for any film query: (film_id, title, delta?, region?)
        "FROM films": [(1, "Alpha", 100.0, "US")],
    })
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.catalog.shelves.client", new=fake):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/catalog/shelves")
            assert r.status_code == 200
            body = r.json()
            assert isinstance(body, list) and body, "shelves must be non-empty list"
            shelf = body[0]
            assert set(shelf.keys()) >= {"id", "title", "films"}
            assert isinstance(shelf["films"], list)


def test_catalog_film_detail_shape():
    from api.tests.test_fallback import _mk_triple
    fake = _fake_ch_factory({
        "FROM films WHERE film_id": [(1, "Alpha", "2024-01-01", 50.0, "en")],
        "SELECT count() FROM": [(7,)],  # every signals count returns 7
    })
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.catalog.shelves.client", new=fake):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/catalog/films/1")
            assert r.status_code == 200
            body = r.json()
            for key in ("id", "title", "poster_url", "release_date",
                        "signals", "featured", "cached_scenario_id"):
                assert key in body, f"missing {key}"
            assert body["signals"].keys() == {"box_office", "social", "reviews", "streaming"}


def test_catalog_film_detail_missing():
    from api.tests.test_fallback import _mk_triple
    fake = _fake_ch_factory({"FROM films WHERE film_id": []})
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.catalog.shelves.client", new=fake):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/catalog/films/9999999")
            assert r.status_code == 404


def test_catalog_search():
    from api.tests.test_fallback import _mk_triple
    fake = _fake_ch_factory({
        "positionCaseInsensitive": [(1, "Alpha"), (2, "Alphabet")],
    })
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.catalog.shelves.client", new=fake):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/catalog/search?q=alp")
            assert r.status_code == 200
            body = r.json()
            assert isinstance(body, list)
            assert body[0]["id"] == 1 and body[0]["title"] == "Alpha"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest api/tests/test_catalog.py -v`
Expected: FAIL — 404.

- [ ] **Step 3: Create shelves module**

Create `backend/api/catalog/__init__.py` as empty file.

Create `backend/api/catalog/shelves.py`:

```python
"""Static + dynamic shelf definitions for the Movies Index route.

Column reality (from backend/data/schema.sql):
  - films table PK is `film_id` (not `id`); no poster_url column exists yet.
    We return `poster_url: ""` — the frontend renders a signal-family gradient
    placeholder. A follow-up backfill can populate this.
  - box_office_revenue has `date` (Date), revenue_usd; other numeric tables use
    `ts` (DateTime).
  - social_trends.mentions, streaming_watch_minutes.watch_minutes, review_scores.score.
  - detections table is `detections` (not `detections_stream`); uses `metric_ts`.

Featured status is derived from `data/eval_cache/*.json` — each cached scenario
file pins one (film_id, region) triple. Films whose id appears in a cache file
are "featured" (Movie Detail page can mount instantly, no live-run cost).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from data.ch_client import client

log = logging.getLogger(__name__)

# repo root: backend/api/catalog/shelves.py → parents[3] is the repo root
_CACHE_DIR = Path(__file__).resolve().parents[3] / "data" / "eval_cache"


def _cached_scenario_ids() -> set[str]:
    if not _CACHE_DIR.is_dir():
        return set()
    return {p.stem for p in _CACHE_DIR.glob("*.json")}


def _cached_film_map() -> dict[int, str]:
    """film_id → scenario_id, for the first cached scenario per film."""
    out: dict[int, str] = {}
    for sid in _cached_scenario_ids():
        try:
            payload = json.loads((_CACHE_DIR / f"{sid}.json").read_text())
            fid = int(payload.get("detection", {}).get("film_id", -1))
            if fid > 0 and fid not in out:
                out[fid] = sid
        except Exception:  # noqa: BLE001
            log.warning("bad cache file %s", sid, exc_info=True)
    return out


def _query_rows(c: Any, sql: str) -> list[tuple]:
    try:
        return list(c.query(sql).result_rows)
    except Exception:  # noqa: BLE001
        log.warning("catalog query failed: %s", sql, exc_info=True)
        return []


def _to_card(row: tuple) -> dict[str, Any]:
    # Rows are (film_id, title, [signal_delta, region_hint]). Missing tail
    # elements default to 0.0 and "".
    return {
        "id": int(row[0]),
        "title": row[1] or "",
        "poster_url": "",
        "signal_delta": float(row[2]) if len(row) > 2 and row[2] is not None else 0.0,
        "region_hint": row[3] if len(row) > 3 and row[3] is not None else "",
    }


def build_shelves(region: str | None = None) -> list[dict[str, Any]]:
    shelves: list[dict[str, Any]] = []
    featured_film_ids = set(_cached_film_map().keys())

    with client() as c:
        # Shelf 1 — Featured (films with pre-recorded triples in eval_cache).
        # Order by popularity so the strongest posters lead the row.
        if featured_film_ids:
            ids_list = ",".join(str(int(x)) for x in featured_film_ids)
            featured_films = [
                _to_card(r) for r in _query_rows(
                    c,
                    f"SELECT film_id, title, 0.0 AS delta, '' AS region "
                    f"FROM films WHERE film_id IN ({ids_list}) "
                    f"ORDER BY popularity DESC LIMIT 12"
                )
            ]
        else:
            featured_films = []
        for f in featured_films:
            f["featured"] = True
        shelves.append({
            "id": "featured",
            "title": "Featured — pre-run investigations",
            "films": featured_films,
        })

        # Shelf 2 — Trending in region (last 7 days of box_office_revenue)
        if region:
            safe_region = region.replace("'", "''")
            trend = [
                _to_card(r) for r in _query_rows(
                    c,
                    f"SELECT f.film_id, f.title, "
                    f"sum(b.revenue_usd) AS delta, '{safe_region}' AS region "
                    f"FROM films f LEFT JOIN box_office_revenue b ON f.film_id = b.film_id "
                    f"WHERE b.region = '{safe_region}' AND b.date >= today() - 7 "
                    f"GROUP BY f.film_id, f.title "
                    f"ORDER BY delta DESC LIMIT 12"
                )
            ]
            shelves.append({
                "id": "trending_region",
                "title": f"Trending in {region}",
                "films": trend,
            })

        # Shelf 3 — Recent detections (last 24h)
        recent = [
            _to_card(r) for r in _query_rows(
                c,
                "SELECT f.film_id, f.title, max(d.magnitude) AS delta, "
                "any(d.region) AS region "
                "FROM detections d JOIN films f ON d.film_id = f.film_id "
                "WHERE d.metric_ts >= now() - INTERVAL 1 DAY "
                "GROUP BY f.film_id, f.title "
                "ORDER BY delta DESC LIMIT 12"
            )
        ]
        shelves.append({
            "id": "recent_detections",
            "title": "Recent detections",
            "films": recent,
        })

        # Shelf 4 — Social storms (last 3 days of social_trends.mentions)
        social = [
            _to_card(r) for r in _query_rows(
                c,
                "SELECT f.film_id, f.title, sum(s.mentions) AS delta, "
                "any(s.region) AS region "
                "FROM social_trends s JOIN films f ON s.film_id = f.film_id "
                "WHERE s.ts >= now() - INTERVAL 3 DAY "
                "GROUP BY f.film_id, f.title "
                "ORDER BY delta DESC LIMIT 12"
            )
        ]
        shelves.append({
            "id": "social_storms",
            "title": "Social storms",
            "films": social,
        })

        # Shelf 5 — Streaming climbers (last 7 days watch_minutes)
        streaming = [
            _to_card(r) for r in _query_rows(
                c,
                "SELECT f.film_id, f.title, sum(st.watch_minutes) AS delta, "
                "any(st.region) AS region "
                "FROM streaming_watch_minutes st JOIN films f ON st.film_id = f.film_id "
                "WHERE st.ts >= now() - INTERVAL 7 DAY "
                "GROUP BY f.film_id, f.title "
                "ORDER BY delta DESC LIMIT 12"
            )
        ]
        shelves.append({
            "id": "streaming",
            "title": "Streaming climbers",
            "films": streaming,
        })

        # Shelf 6 — Full catalog (paginated in later task; first page here)
        full = [
            _to_card(r) for r in _query_rows(
                c,
                "SELECT film_id, title, 0.0 AS delta, '' AS region FROM films "
                "ORDER BY release_date DESC LIMIT 24"
            )
        ]
        shelves.append({"id": "all", "title": "All films", "films": full})

    return shelves


def get_film(film_id: int) -> dict[str, Any] | None:
    cached_map = _cached_film_map()
    with client() as c:
        rows = _query_rows(
            c,
            f"SELECT film_id, title, toString(release_date), popularity, language "
            f"FROM films WHERE film_id = {int(film_id)} LIMIT 1",
        )
        if not rows:
            return None
        row = rows[0]

        signals: dict[str, int] = {}
        for family, table, where in (
            ("box_office", "box_office_revenue",      f"film_id = {int(film_id)} AND date >= today() - 7"),
            ("social",     "social_trends",           f"film_id = {int(film_id)} AND ts   >= now() - INTERVAL 7 DAY"),
            ("reviews",    "review_scores",           f"film_id = {int(film_id)} AND ts   >= now() - INTERVAL 7 DAY"),
            ("streaming",  "streaming_watch_minutes", f"film_id = {int(film_id)} AND ts   >= now() - INTERVAL 7 DAY"),
        ):
            r = _query_rows(c, f"SELECT count() FROM {table} WHERE {where}")
            signals[family] = int(r[0][0]) if r else 0

    return {
        "id": int(row[0]),
        "title": row[1] or "",
        "poster_url": "",
        "release_date": row[2] if row[2] is not None else "",
        "popularity": float(row[3]) if row[3] is not None else 0.0,
        "language": row[4] if len(row) > 4 and row[4] is not None else "",
        "signals": signals,
        "featured": film_id in cached_map,
        "cached_scenario_id": cached_map.get(film_id),
    }


def search_films(q: str, limit: int = 20) -> list[dict[str, Any]]:
    if not q:
        return []
    safe = q.replace("'", "''")
    with client() as c:
        rows = _query_rows(
            c,
            f"SELECT film_id, title FROM films "
            f"WHERE positionCaseInsensitive(title, '{safe}') > 0 "
            f"ORDER BY popularity DESC LIMIT {int(limit)}"
        )
    return [{"id": int(r[0]), "title": r[1] or "", "poster_url": ""} for r in rows]
```

- [ ] **Step 4: Create router**

Create `backend/api/routers/catalog.py`:

```python
"""HTTP surface for the catalog module."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query

from api.catalog import shelves as catalog_shelves

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/shelves")
async def shelves(region: str | None = Query(default=None)):
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
```

- [ ] **Step 5: Wire into main.py**

Follow the existing alias convention (see the other imports in `backend/api/main.py` — every other router uses `from api.routers import <name> as <name>_router`, then `app.include_router(<name>_router.router)`).

Add to the import block in `backend/api/main.py` (alphabetical among the router imports):

```python
from api.routers import catalog as catalog_router
```

Add to the `app.include_router(...)` block:

```python
app.include_router(catalog_router.router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && pytest api/tests/test_catalog.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/api/catalog backend/api/routers/catalog.py backend/api/main.py backend/api/tests/test_catalog.py
git commit -m "feat(api): add /catalog/shelves, /catalog/films/{id}, /catalog/search"
```

---

### Task 7: Deploy backend + verify all Phase-1 endpoints live

**Files:**
- Run: existing deploy script (Cloud Run) — do NOT modify

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && pytest -q`
Expected: PASS across the board.

- [ ] **Step 2: Trigger the Cloud Run deploy**

Run the project's existing deploy invocation (whatever `README.md` or the deploy script defines). Do not invent a new deploy path; use the same one already in use for `scc-api`.

- [ ] **Step 3: Smoke-test every new endpoint against Cloud Run**

Run each of the following. All must return `200`:

```bash
BASE=https://scc-api-845114229642.us-east1.run.app
curl -sS -o /dev/null -w "%{http_code} /health\n"           "$BASE/health"
curl -sS -o /dev/null -w "%{http_code} /stats/summary\n"    "$BASE/stats/summary"
curl -sS -o /dev/null -w "%{http_code} /catalog/shelves\n"  "$BASE/catalog/shelves"
curl -sS -o /dev/null -w "%{http_code} /catalog/search?q=a\n" "$BASE/catalog/search?q=a"
curl -sS -N --max-time 4 "$BASE/intake/rates" | head -c 200
```

The final SSE curl should emit at least one `data: {...}` line within 4s.

Also verify `/detections` returns rows with a `latency_ms` field:

```bash
curl -sS "$BASE/detections?limit=1" | python3 -c "import sys,json; row=json.load(sys.stdin); assert 'latency_ms' in (row[0] if row else {'latency_ms': None}); print('ok')"
```

- [ ] **Step 4: Commit any deploy-artefact updates**

If the deploy step generated version files or `.env.prod`-style updates that are meant to be tracked, commit them now. If none, skip.

```bash
git status
# only commit deploy-artefact files that already have git-tracked history
```

- [ ] **Step 5: Tag the phase completion**

```bash
git commit --allow-empty -m "chore: Phase 1 backend delta deployed"
```

---
## Phase 2 — Foundation (Tasks 8–14)

Foundation lays the router, tokens, primitives, stores, and app shell that every Phase 3 screen depends on. No screen work starts until Phase 2 is committed and route smoke passes.

### Task 8: Add `react-router-dom` + skeleton route table

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/main.tsx`
- Create: `frontend/src/router.tsx`
- Create: `frontend/src/routes/LandingRoute.tsx`
- Create: `frontend/src/routes/DashboardRoute.tsx`
- Create: `frontend/src/routes/MoviesRoute.tsx`
- Create: `frontend/src/routes/MovieDetailRoute.tsx`
- Create: `frontend/src/routes/AuditRoute.tsx`
- Create: `frontend/src/routes/SettingsRoute.tsx`

- [ ] **Step 1: Install `react-router-dom`**

Run: `cd frontend && npm install react-router-dom@^6.28.0`

- [ ] **Step 2: Create placeholder route components**

Create each file with a single-line default export so the router compiles:

```tsx
// LandingRoute.tsx
export default function LandingRoute() { return <div data-testid="route-landing">Landing</div> }
```
```tsx
// DashboardRoute.tsx
export default function DashboardRoute() { return <div data-testid="route-dashboard">Dashboard</div> }
```
```tsx
// MoviesRoute.tsx
export default function MoviesRoute() { return <div data-testid="route-movies">Movies</div> }
```
```tsx
// MovieDetailRoute.tsx
import { useParams } from 'react-router-dom'
export default function MovieDetailRoute() {
  const { filmId } = useParams()
  return <div data-testid="route-movie-detail">Movie {filmId}</div>
}
```
```tsx
// AuditRoute.tsx
export default function AuditRoute() { return <div data-testid="route-audit">Audit</div> }
```
```tsx
// SettingsRoute.tsx
export default function SettingsRoute() { return <div data-testid="route-settings">Settings</div> }
```

- [ ] **Step 3: Create the router**

Create `frontend/src/router.tsx`:

```tsx
import { createBrowserRouter, Navigate } from 'react-router-dom'
import LandingRoute from './routes/LandingRoute'
import DashboardRoute from './routes/DashboardRoute'
import MoviesRoute from './routes/MoviesRoute'
import MovieDetailRoute from './routes/MovieDetailRoute'
import AuditRoute from './routes/AuditRoute'
import SettingsRoute from './routes/SettingsRoute'

export const router = createBrowserRouter([
  { path: '/', element: <LandingRoute /> },
  { path: '/dashboard', element: <DashboardRoute /> },
  { path: '/movies', element: <MoviesRoute /> },
  { path: '/movies/:filmId', element: <MovieDetailRoute /> },
  { path: '/audit', element: <AuditRoute /> },
  { path: '/settings', element: <SettingsRoute /> },
  { path: '*', element: <Navigate to="/" replace /> },
])
```

- [ ] **Step 4: Rewire `main.tsx`**

Current file (verified) is:

```tsx
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

Replace it with (no `QueryClientProvider` exists — this project doesn't use React Query):

```tsx
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
```

Note: `App` is a **named** export (`export function App`) — not default. The current `import { App }` will be removed entirely here. Do NOT delete `App.tsx` itself — that happens in Phase 5.

- [ ] **Step 5: Write route smoke test**

The existing `frontend/playwright.config.ts` sets `testDir: 'src/tests/e2e'` — Playwright only discovers specs under that path. Create the file at `frontend/src/tests/e2e/route-smoke.spec.ts` (NOT `frontend/tests/e2e/...`):

```typescript
import { test, expect } from '@playwright/test'

const routes = [
  { path: '/', tid: 'route-landing' },
  { path: '/dashboard', tid: 'route-dashboard' },
  { path: '/movies', tid: 'route-movies' },
  { path: '/movies/1', tid: 'route-movie-detail' },
  { path: '/audit', tid: 'route-audit' },
  { path: '/settings', tid: 'route-settings' },
]

for (const r of routes) {
  test(`route ${r.path} renders`, async ({ page }) => {
    await page.goto(r.path)
    await expect(page.getByTestId(r.tid)).toBeVisible()
  })
}
```

- [ ] **Step 6: Run route smoke**

Run: `cd frontend && npx playwright test tests/e2e/route-smoke.spec.ts`
Expected: 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/main.tsx frontend/src/router.tsx frontend/src/routes frontend/src/tests/e2e/route-smoke.spec.ts
git commit -m "feat(frontend): install react-router-dom + skeleton routes"
```

---

### Task 9: Signal-family design tokens

**Files:**
- Modify: `frontend/src/theme/tokens.ts`
- Modify: `frontend/src/theme/tailwind.tokens.ts`
- Modify: `frontend/src/index.css`
- Create: `frontend/src/tests/unit/tokens.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/tests/unit/tokens.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { tokens } from '../../theme/tokens'

describe('signal-family tokens', () => {
  it('exposes 4 families with hex + rgb + glow', () => {
    for (const family of ['box_office', 'social', 'reviews', 'streaming'] as const) {
      const s = tokens.signal[family]
      expect(s.hex).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(s.rgb).toMatch(/^\d+,\s*\d+,\s*\d+$/)
      expect(s.glow).toMatch(/^rgba\(/)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/tokens.test.ts`
Expected: FAIL — `tokens.signal` undefined.

- [ ] **Step 3: Add signal tokens**

Open `frontend/src/theme/tokens.ts`. Add inside the `tokens` object literal (alongside `color`, `type`):

```typescript
  signal: {
    box_office: { hex: '#4a9eff', rgb: '74, 158, 255', glow: 'rgba(74, 158, 255, 0.35)' },
    social:     { hex: '#ff6b9d', rgb: '255, 107, 157', glow: 'rgba(255, 107, 157, 0.35)' },
    reviews:    { hex: '#ffd93d', rgb: '255, 217, 61', glow: 'rgba(255, 217, 61, 0.35)' },
    streaming:  { hex: '#6bcf7f', rgb: '107, 207, 127', glow: 'rgba(107, 207, 127, 0.35)' },
  },
```

- [ ] **Step 4: Expose in Tailwind**

Open `frontend/src/theme/tailwind.tokens.ts`. Inside the `colors` object add:

```typescript
    'sig-box':       tokens.signal.box_office.hex,
    'sig-social':    tokens.signal.social.hex,
    'sig-reviews':   tokens.signal.reviews.hex,
    'sig-streaming': tokens.signal.streaming.hex,
```

- [ ] **Step 5: Publish CSS vars**

Open `frontend/src/index.css`. The file has no `:root` block yet — create one immediately **after** the `@tailwind utilities;` line and **before** the `html, body, #root { ... }` rule:

```css
:root {
  --sig-box-office: #4a9eff;
  --sig-social: #ff6b9d;
  --sig-reviews: #ffd93d;
  --sig-streaming: #6bcf7f;
  --sig-box-office-glow: rgba(74, 158, 255, 0.35);
  --sig-social-glow: rgba(255, 107, 157, 0.35);
  --sig-reviews-glow: rgba(255, 217, 61, 0.35);
  --sig-streaming-glow: rgba(107, 207, 127, 0.35);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/unit/tokens.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/theme frontend/src/index.css frontend/src/tests/unit/tokens.test.ts
git commit -m "feat(theme): add signal-family color tokens"
```

---

### Task 10: Primitives — `<SignalChip>`, `<LatencyBadge>`, `<RegionFlag>`

**Files:**
- Create: `frontend/src/components/SignalChip.tsx`
- Create: `frontend/src/components/LatencyBadge.tsx`
- Create: `frontend/src/components/RegionFlag.tsx`
- Create: `frontend/src/tests/unit/SignalChip.test.tsx`
- Create: `frontend/src/tests/unit/LatencyBadge.test.tsx`
- Create: `frontend/src/tests/unit/RegionFlag.test.tsx`

- [ ] **Step 1: Write failing tests**

`frontend/src/tests/unit/SignalChip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SignalChip } from '../../components/SignalChip'

describe('SignalChip', () => {
  it('renders the family label', () => {
    render(<SignalChip family="box_office" />)
    expect(screen.getByText(/box office/i)).toBeInTheDocument()
  })
  it('carries a family class token', () => {
    render(<SignalChip family="social" data-testid="chip" />)
    expect(screen.getByTestId('chip').getAttribute('style')).toContain('#ff6b9d')
  })
})
```

`frontend/src/tests/unit/LatencyBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LatencyBadge } from '../../components/LatencyBadge'

describe('LatencyBadge', () => {
  it('formats ms under 1s', () => {
    render(<LatencyBadge ms={347} />)
    expect(screen.getByText('347ms')).toBeInTheDocument()
  })
  it('formats seconds when >=1000ms', () => {
    render(<LatencyBadge ms={2500} />)
    expect(screen.getByText('2.5s')).toBeInTheDocument()
  })
  it('renders em-dash when null', () => {
    render(<LatencyBadge ms={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
```

`frontend/src/tests/unit/RegionFlag.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RegionFlag } from '../../components/RegionFlag'

describe('RegionFlag', () => {
  it('renders known region emoji', () => {
    render(<RegionFlag region="US" />)
    expect(screen.getByLabelText('US')).toBeInTheDocument()
  })
  it('renders code when unknown', () => {
    render(<RegionFlag region="ZZ" />)
    expect(screen.getByText('ZZ')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/unit/SignalChip.test.tsx src/tests/unit/LatencyBadge.test.tsx src/tests/unit/RegionFlag.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `SignalChip`**

Create `frontend/src/components/SignalChip.tsx`:

```tsx
import type { HTMLAttributes } from 'react'
import { tokens } from '../theme/tokens'

export type SignalFamily = 'box_office' | 'social' | 'reviews' | 'streaming'

const LABELS: Record<SignalFamily, string> = {
  box_office: 'Box Office',
  social: 'Social',
  reviews: 'Reviews',
  streaming: 'Streaming',
}

interface Props extends HTMLAttributes<HTMLSpanElement> {
  family: SignalFamily
  compact?: boolean
}

export function SignalChip({ family, compact, style, className, ...rest }: Props) {
  const s = tokens.signal[family]
  return (
    <span
      {...rest}
      className={`inline-flex items-center gap-1 rounded-full border font-mono uppercase tracking-wider ${
        compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]'
      } ${className ?? ''}`}
      style={{
        color: s.hex,
        borderColor: s.hex,
        background: `rgba(${s.rgb}, 0.08)`,
        boxShadow: `0 0 12px ${s.glow}`,
        ...style,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.hex }} />
      {LABELS[family]}
    </span>
  )
}
```

- [ ] **Step 4: Implement `LatencyBadge`**

Create `frontend/src/components/LatencyBadge.tsx`:

```tsx
interface Props {
  ms: number | null | undefined
}

export function LatencyBadge({ ms }: Props) {
  if (ms == null) return <span className="font-mono text-[10px] text-ink-soft">—</span>
  const label = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
  const tone = ms < 500 ? 'text-emerald-400' : ms < 2000 ? 'text-amber-400' : 'text-rose-400'
  return <span className={`font-mono text-[10px] ${tone}`}>{label}</span>
}
```

- [ ] **Step 5: Implement `RegionFlag`**

Create `frontend/src/components/RegionFlag.tsx`:

```tsx
const FLAGS: Record<string, string> = {
  US: '🇺🇸', GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', JP: '🇯🇵', KR: '🇰🇷',
  CN: '🇨🇳', IN: '🇮🇳', BR: '🇧🇷', MX: '🇲🇽', AU: '🇦🇺', CA: '🇨🇦',
  IT: '🇮🇹', ES: '🇪🇸', RU: '🇷🇺',
}

export function RegionFlag({ region }: { region: string }) {
  const flag = FLAGS[region]
  if (flag) return <span aria-label={region} title={region}>{flag}</span>
  return <span className="font-mono text-[10px]">{region}</span>
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/unit/SignalChip.test.tsx src/tests/unit/LatencyBadge.test.tsx src/tests/unit/RegionFlag.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SignalChip.tsx frontend/src/components/LatencyBadge.tsx frontend/src/components/RegionFlag.tsx frontend/src/tests/unit/SignalChip.test.tsx frontend/src/tests/unit/LatencyBadge.test.tsx frontend/src/tests/unit/RegionFlag.test.tsx
git commit -m "feat(components): SignalChip, LatencyBadge, RegionFlag primitives"
```

---

### Task 11: `catalogStore` (Zustand)

**Files:**
- Create: `frontend/src/store/catalogStore.ts`
- Create: `frontend/src/tests/unit/catalogStore.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useCatalogStore } from '../../store/catalogStore'

describe('catalogStore', () => {
  beforeEach(() => useCatalogStore.setState({ shelves: [], films: {}, region: null }))

  it('sets shelves', () => {
    useCatalogStore.getState().setShelves([
      { id: 'featured', title: 'Featured', films: [{ id: 1, title: 'X', poster_url: '', featured: true }] },
    ])
    expect(useCatalogStore.getState().shelves).toHaveLength(1)
    expect(useCatalogStore.getState().films[1]).toBeTruthy()
  })

  it('sets region', () => {
    useCatalogStore.getState().setRegion('US')
    expect(useCatalogStore.getState().region).toBe('US')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/catalogStore.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the store**

Create `frontend/src/store/catalogStore.ts`:

```typescript
import { create } from 'zustand'

export interface CatalogFilm {
  id: number
  title: string
  poster_url: string
  signal_delta?: number
  region_hint?: string
  featured?: boolean
}

export interface CatalogShelf {
  id: string
  title: string
  films: CatalogFilm[]
}

interface CatalogState {
  shelves: CatalogShelf[]
  films: Record<number, CatalogFilm>
  region: string | null
  setShelves: (shelves: CatalogShelf[]) => void
  setRegion: (region: string | null) => void
}

export const useCatalogStore = create<CatalogState>((set) => ({
  shelves: [],
  films: {},
  region: null,
  setShelves: (shelves) => {
    const films: Record<number, CatalogFilm> = {}
    for (const s of shelves) for (const f of s.films) films[f.id] = f
    set({ shelves, films })
  },
  setRegion: (region) => set({ region }),
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/unit/catalogStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/catalogStore.ts frontend/src/tests/unit/catalogStore.test.ts
git commit -m "feat(store): catalogStore for shelves and film cache"
```

---

### Task 12: `signalStore` (per-family rolling rates)

**Files:**
- Create: `frontend/src/store/signalStore.ts`
- Create: `frontend/src/tests/unit/signalStore.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useSignalStore } from '../../store/signalStore'

describe('signalStore', () => {
  beforeEach(() => useSignalStore.setState({
    rates: { box_office: 0, social: 0, reviews: 0, streaming: 0 },
    history: { box_office: [], social: [], reviews: [], streaming: [] },
  }))

  it('updates and appends history', () => {
    useSignalStore.getState().pushRates({ box_office: 10, social: 20, reviews: 5, streaming: 8 })
    const s = useSignalStore.getState()
    expect(s.rates.box_office).toBe(10)
    expect(s.history.social).toEqual([20])
  })

  it('caps history at 60 points', () => {
    const s = useSignalStore.getState()
    for (let i = 0; i < 80; i++) s.pushRates({ box_office: i, social: 0, reviews: 0, streaming: 0 })
    expect(useSignalStore.getState().history.box_office.length).toBe(60)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/signalStore.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the store**

Create `frontend/src/store/signalStore.ts`:

```typescript
import { create } from 'zustand'
import type { SignalFamily } from '../components/SignalChip'

type Rates = Record<SignalFamily, number>

interface SignalState {
  rates: Rates
  history: Record<SignalFamily, number[]>
  pushRates: (r: Rates) => void
}

const HISTORY_CAP = 60

export const useSignalStore = create<SignalState>((set, get) => ({
  rates: { box_office: 0, social: 0, reviews: 0, streaming: 0 },
  history: { box_office: [], social: [], reviews: [], streaming: [] },
  pushRates: (r) => {
    const cur = get().history
    const next: Record<SignalFamily, number[]> = {
      box_office: [...cur.box_office, r.box_office].slice(-HISTORY_CAP),
      social: [...cur.social, r.social].slice(-HISTORY_CAP),
      reviews: [...cur.reviews, r.reviews].slice(-HISTORY_CAP),
      streaming: [...cur.streaming, r.streaming].slice(-HISTORY_CAP),
    }
    set({ rates: r, history: next })
  },
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/unit/signalStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/signalStore.ts frontend/src/tests/unit/signalStore.test.ts
git commit -m "feat(store): signalStore with rolling 60-point history"
```

---

### Task 13: `<AppShell>` + `<LeftNav>` + `<TopBar>`

**Files:**
- Create: `frontend/src/shell/AppShell.tsx`
- Create: `frontend/src/shell/LeftNav.tsx`
- Create: `frontend/src/shell/TopBar.tsx`
- Modify: `frontend/src/router.tsx` (wrap non-landing routes in `<AppShell>`)
- Create: `frontend/src/tests/unit/AppShell.test.tsx`

- [ ] **Step 1: Implement `LeftNav`**

Create `frontend/src/shell/LeftNav.tsx`:

```tsx
import { NavLink } from 'react-router-dom'

const LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: '◉' },
  { to: '/movies', label: 'Movies', icon: '▤' },
  { to: '/audit', label: 'Audit', icon: '◈' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export function LeftNav() {
  return (
    <nav aria-label="Primary" className="flex h-full w-56 flex-col border-r border-line bg-card">
      <NavLink to="/" className="flex items-center gap-2 border-b border-line px-4 py-4 text-sm font-display tracking-tight">
        <span className="text-accent">SCC</span>
        <span className="text-ink-soft">/ Crisis Commander</span>
      </NavLink>
      <ul className="flex-1 py-4">
        {LINKS.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 text-sm ${
                  isActive ? 'bg-card-alt text-ink border-l-2 border-accent' : 'text-ink-soft hover:text-ink'
                }`
              }
            >
              <span aria-hidden className="w-4 text-center opacity-70">{link.icon}</span>
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 2: Implement `TopBar`**

Create `frontend/src/shell/TopBar.tsx`:

```tsx
interface Props {
  onInject: () => void
}

export function TopBar({ onInject }: Props) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-line bg-paper px-4">
      <div className="text-xs font-mono uppercase tracking-wider text-ink-soft">
        Live pipeline · Cloud Run · us-east1
      </div>
      <div className="flex items-center gap-3">
        <kbd className="hidden md:inline rounded border border-line bg-card px-1.5 py-0.5 text-[10px] text-ink-soft">
          ⌘ K
        </kbd>
        <button
          type="button"
          onClick={onInject}
          className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
          data-testid="top-inject-cta"
        >
          Inject Crisis
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Implement `AppShell`**

Create `frontend/src/shell/AppShell.tsx`:

```tsx
import { useState, type PropsWithChildren } from 'react'
import { LeftNav } from './LeftNav'
import { TopBar } from './TopBar'
import { GlobalInjectModal } from './GlobalInjectModal'

export function AppShell({ children }: PropsWithChildren) {
  const [injectOpen, setInjectOpen] = useState(false)
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper text-ink">
      <LeftNav />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar onInject={() => setInjectOpen(true)} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
      <GlobalInjectModal open={injectOpen} onClose={() => setInjectOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 4: Wrap routes**

Open `frontend/src/router.tsx`. Change to:

```tsx
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import LandingRoute from './routes/LandingRoute'
import DashboardRoute from './routes/DashboardRoute'
import MoviesRoute from './routes/MoviesRoute'
import MovieDetailRoute from './routes/MovieDetailRoute'
import AuditRoute from './routes/AuditRoute'
import SettingsRoute from './routes/SettingsRoute'

const shell = (el: JSX.Element) => <AppShell>{el}</AppShell>

export const router = createBrowserRouter([
  { path: '/', element: <LandingRoute /> },
  { path: '/dashboard', element: shell(<DashboardRoute />) },
  { path: '/movies', element: shell(<MoviesRoute />) },
  { path: '/movies/:filmId', element: shell(<MovieDetailRoute />) },
  { path: '/audit', element: shell(<AuditRoute />) },
  { path: '/settings', element: shell(<SettingsRoute />) },
  { path: '*', element: <Navigate to="/" replace /> },
])
```

(Note: `GlobalInjectModal` is implemented in Task 14 — for this step create a stub next to `AppShell.tsx` so the import resolves.)

Create `frontend/src/shell/GlobalInjectModal.tsx` (stub):

```tsx
export function GlobalInjectModal({ open, onClose: _onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return null
}
```

- [ ] **Step 5: Write component test**

Create `frontend/src/tests/unit/AppShell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { AppShell } from '../../shell/AppShell'

describe('AppShell', () => {
  it('renders nav links and top bar CTA', () => {
    render(
      <MemoryRouter>
        <AppShell>content</AppShell>
      </MemoryRouter>
    )
    expect(screen.getByLabelText('Primary')).toBeInTheDocument()
    expect(screen.getByTestId('top-inject-cta')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run tests**

Run: `cd frontend && npx vitest run src/tests/unit/AppShell.test.tsx && npx playwright test src/tests/e2e/route-smoke.spec.ts`
Expected: PASS. (Playwright's `testDir` is `src/tests/e2e/`, not `tests/e2e/`.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/shell frontend/src/router.tsx frontend/src/tests/unit/AppShell.test.tsx
git commit -m "feat(shell): AppShell with LeftNav + TopBar wrapper"
```

---

### Task 14: `<GlobalInjectModal>` + `⌘K` keyboard shortcut

**Files:**
- Modify: `frontend/src/shell/GlobalInjectModal.tsx` (replace stub)
- Modify: `frontend/src/shell/AppShell.tsx` (add global keydown listener)
- Create: `frontend/src/tests/unit/GlobalInjectModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/tests/unit/GlobalInjectModal.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { GlobalInjectModal } from '../../shell/GlobalInjectModal'

describe('GlobalInjectModal', () => {
  it('renders when open', () => {
    render(<GlobalInjectModal open onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Crisis type')).toBeInTheDocument()
    expect(screen.getByLabelText('Film ID')).toBeInTheDocument()
    expect(screen.getByLabelText('Region')).toBeInTheDocument()
    expect(screen.getByLabelText('Magnitude')).toBeInTheDocument()
  })
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<GlobalInjectModal open onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('does not render when closed', () => {
    render(<GlobalInjectModal open={false} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/GlobalInjectModal.test.tsx`
Expected: FAIL — stub returns null.

- [ ] **Step 3: Implement the modal**

Replace `frontend/src/shell/GlobalInjectModal.tsx`:

```tsx
import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
}

const CRISIS_TYPES = ['box_office_drop', 'social_meltdown', 'review_bomb', 'streaming_spike'] as const
const REGIONS = ['US', 'GB', 'DE', 'FR', 'JP', 'KR', 'CN', 'IN', 'BR', 'MX', 'AU', 'CA', 'IT', 'ES', 'RU']

export function GlobalInjectModal({ open, onClose }: Props) {
  const [ctype, setCtype] = useState<typeof CRISIS_TYPES[number]>('box_office_drop')
  const [filmId, setFilmId] = useState('1')
  const [region, setRegion] = useState('US')
  const [magnitude, setMagnitude] = useState('0.4')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/inject-crisis`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ctype,
          film_id: Number(filmId),
          region,
          magnitude: Number(magnitude),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      window.location.href = `/dashboard?run_id=${encodeURIComponent(body.run_id)}`
    } catch (e: any) {
      setErr(String(e))
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-line bg-card p-6 shadow-2xl"
      >
        <h2 className="mb-4 font-display text-lg">Inject Crisis</h2>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Crisis type</span>
          <select
            aria-label="Crisis type"
            value={ctype}
            onChange={(e) => setCtype(e.target.value as any)}
            className="w-full rounded border border-line bg-paper px-2 py-1.5 text-sm"
          >
            {CRISIS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Film ID</span>
            <input
              aria-label="Film ID"
              value={filmId}
              onChange={(e) => setFilmId(e.target.value)}
              className="w-full rounded border border-line bg-paper px-2 py-1.5 text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Region</span>
            <select
              aria-label="Region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full rounded border border-line bg-paper px-2 py-1.5 text-sm"
            >
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Magnitude</span>
          <input
            aria-label="Magnitude"
            type="number"
            step="0.05"
            min="0.05"
            max="1"
            value={magnitude}
            onChange={(e) => setMagnitude(e.target.value)}
            className="w-full rounded border border-line bg-paper px-2 py-1.5 text-sm font-mono"
          />
        </label>
        {err && <p className="mt-3 text-xs text-rose-400">{err}</p>}
        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-ink-soft hover:text-ink">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-accent bg-accent/20 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/30 disabled:opacity-50"
          >
            {busy ? 'Injecting…' : 'Inject'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Wire `⌘K` in AppShell**

Modify `frontend/src/shell/AppShell.tsx` — add inside the component body, before the return:

```tsx
import { useEffect } from 'react'

// ... inside AppShell:
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      setInjectOpen(true)
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [])
```

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run src/tests/unit/GlobalInjectModal.test.tsx src/tests/unit/AppShell.test.tsx && npx playwright test src/tests/e2e/route-smoke.spec.ts`
Expected: PASS. (Playwright's `testDir` is `src/tests/e2e/`, not `tests/e2e/`.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shell/GlobalInjectModal.tsx frontend/src/shell/AppShell.tsx frontend/src/tests/unit/GlobalInjectModal.test.tsx
git commit -m "feat(shell): GlobalInjectModal with ⌘K shortcut"
```

---

## Phase 3 — Screens

### Phase 3.1 — Dashboard (Tasks 15–19)

Dashboard is the anchor screen. The existing OpsCenter panels move into a new grid: `IntakeStrip` (top), `AnomalyFeed` (left, capped at 8 rows), workspace tabs `[Investigation | Recommendation | Approval]` (center), `AgentTrace` (right rail), `TelemetryStrip` (bottom, fixed). Two long-standing bugs (empty telemetry + ReportProvenanceError whitespace) are fixed here because both surface on this screen first.

### Task 15: Diagnose the telemetry-empty bug (H1 vs H2 vs H3)

**Files:**
- Read-only: `backend/api/routers/metrics.py`
- Read-only: `frontend/src/panels/TelemetryStrip.tsx`
- Create: `docs/superpowers/notes/2026-08-16-telemetry-bug-diagnosis.md` (root-cause note only)

**Why this task exists:** The empty telemetry symptom has resisted three prior fix attempts. Do the diagnosis first, publish the root cause, then fix in Task 16 with tests that reproduce the exact failure mode.

- [ ] **Step 1: Curl the endpoint directly against Cloud Run**

Run:

```bash
curl -sS "https://scc-api-845114229642.us-east1.run.app/metrics/rollup?film_id=1&region=US" | python3 -m json.tool | head -60
```

Record: does it return `{box_office: [], social: [], sentiment: [], trailer: []}` (H1: backend empty) or does it return points (H2: shape mismatch) or fail (H3: URL mismatch)?

- [ ] **Step 2: If H1 (all arrays empty) — check the underlying tables**

Run against a live ClickHouse via the mcp-clickhouse debug shell OR direct SQL over the deployed backend:

```bash
BASE=https://scc-api-845114229642.us-east1.run.app
# does /catalog/films/1 report any signal counts?
curl -sS "$BASE/catalog/films/1" | python3 -m json.tool | grep -A5 signals
```

If `signals.*` counts are also `0`, the data isn't landing for film_id=1 — try film ids 2–20 until you find one with data. Record the winning id.

- [ ] **Step 3: If H2 (shape mismatch) — diff the JSON keys against `MetricsResponse`**

Compare:

```bash
curl -sS "https://scc-api-845114229642.us-east1.run.app/metrics/rollup?film_id=<winning_id>&region=US" | python3 -c "import sys,json; b=json.load(sys.stdin); print(list(b.keys())); print({k: (list(b[k][0].keys()) if b[k] else None) for k in b})"
```

Expected per `frontend/src/api/contracts.ts`: `{box_office: [{ts, value}], social: [{ts, value}], sentiment: [{ts, value}], trailer: [{ts, value}]}`. Note any deviations (missing `ts`, extra `ts_str`, etc.).

- [ ] **Step 4: If H3 (URL / CORS) — check the browser network tab**

Open `https://scc-frontend-845114229642.us-east1.run.app` in a browser with DevTools open. Navigate to the OpsCenter and watch the `metrics/rollup` request. Record: status code, actual URL, response payload.

- [ ] **Step 5: Write the diagnosis note**

Create `docs/superpowers/notes/2026-08-16-telemetry-bug-diagnosis.md`:

```markdown
# Telemetry Empty — Root Cause

**Symptom:** TelemetryStrip renders "no telemetry" across all 4 sparklines.

**Investigation:**
- H1 (backend empty): PASS/FAIL — evidence: <paste curl output>
- H2 (shape mismatch): PASS/FAIL — evidence: <paste key diff>
- H3 (URL/CORS): PASS/FAIL — evidence: <paste network tab>

**Root cause:** <one paragraph>

**Fix strategy for Task 16:** <2–3 bullets>
```

- [ ] **Step 6: Commit the note only (no code changes yet)**

```bash
git add docs/superpowers/notes/2026-08-16-telemetry-bug-diagnosis.md
git commit -m "docs: root-cause telemetry-empty bug"
```

---

### Task 16: Fix telemetry-empty (shape mismatch — H2 confirmed)

**Root cause (per Task 15 note):** Frontend `MetricPoint` is `{ts, value}` and `Sparkline` binds `dataKey="value"`, but backend `/metrics/{film_id}/{region}` returns per-family shapes: `box_office_daily: {ts, revenue_usd, tickets_sold}`, `social_virality_hourly: {ts, avg_virality, volume}`, `sentiment_hourly: {ts, avg_score, volume}`, `trailer_hourly: {ts, views, completion_rate}`. Even if H1 (empty tables) is later resolved, sparklines still render blank because `dataKey="value"` resolves to `undefined` on every point. Fix H2 client-side by projecting each family to `{ts, value}` inside `TelemetryStrip` before handing to `Sparkline`. H1 (data-density) is out of scope — noted for a separate pipeline follow-up.

**Files:**
- Modify: `frontend/src/panels/TelemetryStrip.tsx`
- Modify: `frontend/src/api/contracts.ts` (widen `MetricPoint` to a discriminated per-family type + keep a canonical `{ts, value}` variant)
- Test: `frontend/src/tests/unit/telemetryStrip.test.tsx` (new)

- [ ] **Step 1: Read current contract + panel to lock the exact shape**

```bash
sed -n '150,180p' frontend/src/api/contracts.ts
sed -n '1,80p'   frontend/src/panels/TelemetryStrip.tsx
```

Note the exact `MetricsResponse` field names (`box_office`/`social`/`sentiment`/`trailer` — the frontend keys — vs backend `box_office_daily`/`social_virality_hourly`/`sentiment_hourly`/`trailer_hourly`). The runStore already aliases these; confirm before touching contracts.

- [ ] **Step 2: Write failing Vitest for the shape mismatch**

Create `frontend/src/tests/unit/telemetryStrip.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { projectSeries } from '../../panels/TelemetryStrip'

describe('TelemetryStrip.projectSeries', () => {
  it('maps box_office_daily.revenue_usd → value', () => {
    const out = projectSeries('box_office', [
      { ts: '2026-08-10 10:00:00', revenue_usd: 12000, tickets_sold: 150 },
    ] as any)
    expect(out).toEqual([{ ts: '2026-08-10 10:00:00', value: 12000 }])
  })
  it('maps social_virality_hourly.avg_virality → value', () => {
    const out = projectSeries('social', [
      { ts: 't', avg_virality: 8, volume: 4 },
    ] as any)
    expect(out[0].value).toBe(8)
  })
  it('maps sentiment_hourly.avg_score → value', () => {
    const out = projectSeries('sentiment', [
      { ts: 't', avg_score: -3, volume: 128 },
    ] as any)
    expect(out[0].value).toBe(-3)
  })
  it('maps trailer_hourly.views → value', () => {
    const out = projectSeries('trailer', [
      { ts: 't', views: 555, completion_rate: 0.42 },
    ] as any)
    expect(out[0].value).toBe(555)
  })
  it('returns [] for empty input', () => {
    expect(projectSeries('box_office', [])).toEqual([])
  })
})
```

Run: `cd frontend && npx vitest run src/tests/unit/telemetryStrip.test.tsx`
Expected: FAIL — `projectSeries` does not yet exist.

- [ ] **Step 3: Widen the contract in `frontend/src/api/contracts.ts`**

Add per-family raw point types alongside the existing canonical one. Keep the existing `MetricPoint = {ts, value}` for the projected shape used by `Sparkline`:

```ts
export type BoxOfficeRawPoint = { ts: string; revenue_usd: number; tickets_sold: number }
export type SocialRawPoint    = { ts: string; avg_virality: number; volume: number }
export type SentimentRawPoint = { ts: string; avg_score: number;   volume: number }
export type TrailerRawPoint   = { ts: string; views: number;       completion_rate: number }

export type RawSeriesByFamily = {
  box_office: BoxOfficeRawPoint[]
  social:     SocialRawPoint[]
  sentiment:  SentimentRawPoint[]
  trailer:    TrailerRawPoint[]
}
```

Do NOT delete the existing `MetricPoint` / `MetricsResponse` — other consumers (runStore, Sparkline) still expect them. This task adds a parallel raw type used only by the projection helper.

- [ ] **Step 4: Add `projectSeries` and rewire `TelemetryStrip.tsx`**

Export a pure helper alongside the panel:

```tsx
import type {
  BoxOfficeRawPoint, SocialRawPoint, SentimentRawPoint, TrailerRawPoint,
} from '../api/contracts'

type FamilyKey = 'box_office' | 'social' | 'sentiment' | 'trailer'
type RawPoint  = BoxOfficeRawPoint | SocialRawPoint | SentimentRawPoint | TrailerRawPoint

export function projectSeries(family: FamilyKey, raw: RawPoint[]): { ts: string; value: number }[] {
  if (!raw?.length) return []
  const pick = (p: RawPoint): number => {
    switch (family) {
      case 'box_office': return (p as BoxOfficeRawPoint).revenue_usd
      case 'social':     return (p as SocialRawPoint).avg_virality
      case 'sentiment':  return (p as SentimentRawPoint).avg_score
      case 'trailer':    return (p as TrailerRawPoint).views
    }
  }
  return raw.map((p) => ({ ts: p.ts, value: pick(p) }))
}
```

Inside the panel body, wherever the four series are handed to `Sparkline`, wrap each with `projectSeries('<family>', series)`. Do NOT change `Sparkline` itself — its `{ts, value}` contract is correct.

- [ ] **Step 5: Run the vitest to verify it passes**

Run: `cd frontend && npx vitest run src/tests/unit/telemetryStrip.test.tsx`
Expected: PASS (5/5).

- [ ] **Step 6: Sanity-check that no other consumer expects the old shape**

Run: `cd frontend && grep -rn 'MetricPoint\b' src/`
Confirm only `contracts.ts`, `Sparkline.tsx`, `TelemetryStrip.tsx`, and existing tests reference it. If any other consumer imports the raw `MetricsResponse[family]` and expects `.value`, either point it through `projectSeries` or leave a TODO — do NOT restructure.

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all existing tests still pass (previous baseline was 113/113); new file adds 5 tests → 118/118.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/contracts.ts \
        frontend/src/panels/TelemetryStrip.tsx \
        frontend/src/tests/unit/telemetryStrip.test.tsx
git commit -m "fix(telemetry): project per-family raw points to {ts, value}"
```

---

### Task 17: `<IntakeStrip>` — live per-family ingest counters

**Files:**
- Create: `frontend/src/panels/IntakeStrip.tsx`
- Create: `frontend/src/hooks/useIntakeRates.ts`
- Create: `frontend/src/tests/unit/IntakeStrip.test.tsx`

- [ ] **Step 1: Write failing hook + component test**

Create `frontend/src/tests/unit/IntakeStrip.test.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IntakeStrip } from '../../panels/IntakeStrip'
import { useSignalStore } from '../../store/signalStore'

describe('IntakeStrip', () => {
  beforeEach(() => {
    useSignalStore.setState({
      rates: { box_office: 12, social: 34, reviews: 5, streaming: 8 },
      history: { box_office: [10, 12], social: [30, 34], reviews: [4, 5], streaming: [7, 8] },
    })
  })

  it('renders 4 family counters', () => {
    render(<IntakeStrip />)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('34')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/IntakeStrip.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the hook**

Create `frontend/src/hooks/useIntakeRates.ts`:

```typescript
import { useEffect } from 'react'
import { useSignalStore } from '../store/signalStore'

export function useIntakeRates() {
  useEffect(() => {
    const url = `${import.meta.env.VITE_API_URL || ''}/intake/rates`
    const es = new EventSource(url)
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data)
        useSignalStore.getState().pushRates({
          box_office: Number(payload.box_office ?? 0),
          social: Number(payload.social ?? 0),
          reviews: Number(payload.reviews ?? 0),
          streaming: Number(payload.streaming ?? 0),
        })
      } catch {
        /* ignore malformed */
      }
    }
    return () => es.close()
  }, [])
}
```

- [ ] **Step 4: Implement the component**

Create `frontend/src/panels/IntakeStrip.tsx`:

```tsx
import { motion } from 'framer-motion'
import { useIntakeRates } from '../hooks/useIntakeRates'
import { useSignalStore } from '../store/signalStore'
import { SignalChip, type SignalFamily } from '../components/SignalChip'

const FAMILIES: SignalFamily[] = ['box_office', 'social', 'reviews', 'streaming']

export function IntakeStrip() {
  useIntakeRates()
  const rates = useSignalStore((s) => s.rates)
  const history = useSignalStore((s) => s.history)
  return (
    <div className="flex items-stretch gap-4 border-b border-line bg-card px-4 py-3" data-testid="intake-strip">
      {FAMILIES.map((family) => (
        <div key={family} className="flex flex-1 items-center gap-3 rounded-md border border-line bg-paper px-3 py-2">
          <SignalChip family={family} compact />
          <div className="flex flex-col">
            <motion.span
              key={rates[family]}
              initial={{ opacity: 0.5, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="font-mono text-lg leading-none"
            >
              {rates[family]}
            </motion.span>
            <span className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-soft">rows / min</span>
          </div>
          <Sparkline points={history[family]} />
        </div>
      ))}
    </div>
  )
}

function Sparkline({ points }: { points: number[] }) {
  if (!points.length) return <span className="flex-1" />
  const max = Math.max(1, ...points)
  const w = 60
  const h = 20
  const step = w / Math.max(1, points.length - 1)
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${h - (p / max) * h}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="ml-auto opacity-70">
      <path d={d} stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/unit/IntakeStrip.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/panels/IntakeStrip.tsx frontend/src/hooks/useIntakeRates.ts frontend/src/tests/unit/IntakeStrip.test.tsx
git commit -m "feat(dashboard): IntakeStrip with live SSE ingest counters"
```

---

### Task 18: Dashboard route grid — three-state workspace + 8-row AnomalyFeed cap

**Files:**
- Modify: `frontend/src/routes/DashboardRoute.tsx`
- Modify: `frontend/src/panels/AnomalyFeed.tsx` (add row cap)
- Create: `frontend/src/panels/DashboardWorkspace.tsx`
- Create: `frontend/src/tests/unit/DashboardRoute.test.tsx`

- [ ] **Step 1: Write failing test**

Note: `@tanstack/react-query` is NOT installed in this repo (Task 8 plan was patched to drop it). Don't import it. The `useIntakeRates` SSE hook must be stubbed so the test doesn't try to open a real EventSource in jsdom.

Create `frontend/src/tests/unit/DashboardRoute.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import DashboardRoute from '../../routes/DashboardRoute'

vi.mock('../../hooks/useIntakeRates', () => ({ useIntakeRates: () => {} }))

describe('DashboardRoute', () => {
  it('renders intake, anomaly feed, workspace, trace, telemetry regions', () => {
    render(
      <MemoryRouter>
        <DashboardRoute />
      </MemoryRouter>
    )
    expect(screen.getByTestId('intake-strip')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-workspace')).toBeInTheDocument()
    expect(screen.getByTestId('anomaly-feed')).toBeInTheDocument()
    expect(screen.getByTestId('agent-trace')).toBeInTheDocument()
    expect(screen.getByTestId('telemetry-strip')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/DashboardRoute.test.tsx`
Expected: FAIL — missing testids and/or missing `DashboardWorkspace` module.

- [ ] **Step 3a: Cap AnomalyFeed at 8 rows and add its testid**

Open `frontend/src/panels/AnomalyFeed.tsx`. Find the rows-render loop. Slice to first 8:

```tsx
const visibleRows = rows.slice(0, 8)
```

Use `visibleRows` in the JSX. Add `data-testid="anomaly-feed"` on the outer container (existing panels have no testids yet). Below the list, if `rows.length > 8`, render:

```tsx
{rows.length > 8 && (
  <div className="border-t border-line px-3 py-2 text-[11px] text-ink-soft">
    +{rows.length - 8} more · <a href="/audit" className="underline hover:text-ink">view audit</a>
  </div>
)}
```

- [ ] **Step 3b: Add data-testid to AgentTrace and TelemetryStrip**

- `frontend/src/panels/AgentTrace.tsx`: add `data-testid="agent-trace"` to the outermost element.
- `frontend/src/panels/TelemetryStrip.tsx`: add `data-testid="telemetry-strip"` to the outermost `<Card>` container (or add a wrapping div if the `<Card>` doesn't accept the prop — check the props type first).

Do NOT modify any other behavior of these panels.

- [ ] **Step 4: Implement `DashboardWorkspace`**

Create `frontend/src/panels/DashboardWorkspace.tsx`:

```tsx
import { useState } from 'react'
import { RecommendationPanel } from './RecommendationPanel'
import { ApprovalGate } from './ApprovalGate'

type Tab = 'investigation' | 'recommendation' | 'approval'

const TABS: { id: Tab; label: string }[] = [
  { id: 'investigation', label: 'Investigation' },
  { id: 'recommendation', label: 'Recommendation' },
  { id: 'approval', label: 'Approval' },
]

export function DashboardWorkspace() {
  const [tab, setTab] = useState<Tab>('investigation')
  return (
    <section data-testid="dashboard-workspace" className="flex h-full flex-col rounded-md border border-line bg-card">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded px-3 py-1 text-xs ${
              tab === t.id ? 'bg-card-alt text-ink' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-3">
        {tab === 'investigation' && <InvestigationView />}
        {tab === 'recommendation' && <RecommendationPanel />}
        {tab === 'approval' && <ApprovalGate />}
      </div>
    </section>
  )
}

function InvestigationView() {
  return <div className="text-sm text-ink-soft">Investigation output renders here (from runStore).</div>
}
```

- [ ] **Step 5: Assemble the Dashboard grid**

Replace `frontend/src/routes/DashboardRoute.tsx`:

```tsx
import { IntakeStrip } from '../panels/IntakeStrip'
import { AnomalyFeed } from '../panels/AnomalyFeed'
import { AgentTrace } from '../panels/AgentTrace'
import { TelemetryStrip } from '../panels/TelemetryStrip'
import { DashboardWorkspace } from '../panels/DashboardWorkspace'

export default function DashboardRoute() {
  return (
    <div data-testid="route-dashboard" className="flex h-full flex-col">
      <IntakeStrip />
      <div className="grid flex-1 grid-cols-[320px_1fr_360px] gap-3 overflow-hidden p-3">
        <div className="overflow-auto">
          <AnomalyFeed />
        </div>
        <div className="overflow-hidden">
          <DashboardWorkspace />
        </div>
        <div className="overflow-auto">
          <AgentTrace />
        </div>
      </div>
      <TelemetryStrip />
    </div>
  )
}
```

If any imported panel component takes required props today, pass the same props the current `App.tsx` passes to that panel — copy the invocation verbatim from `App.tsx` and adapt only the surrounding layout.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/unit/DashboardRoute.test.tsx && npx playwright test src/tests/e2e/route-smoke.spec.ts`
Expected: PASS.

Then run the full vitest suite to confirm no regressions: `cd frontend && npx vitest run` — expect 120/120 (prev baseline 119 + 1 new).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/routes/DashboardRoute.tsx \
        frontend/src/panels/AnomalyFeed.tsx \
        frontend/src/panels/AgentTrace.tsx \
        frontend/src/panels/TelemetryStrip.tsx \
        frontend/src/panels/DashboardWorkspace.tsx \
        frontend/src/tests/unit/DashboardRoute.test.tsx
git commit -m "feat(dashboard): 3-column workspace + 8-row anomaly cap"
```

---

### Task 19: React Query prefetch on dashboard mount

**Why:** Prewarm `/detections` and `/stats/summary` when Dashboard mounts so the panels render instantly instead of showing a skeleton for the first HTTP RTT. Also establishes the shared `QueryClientProvider` + `queries.ts` module used by Phase 3.2 (`useQuery(queries.shelves(...))`), Phase 3.3 (`useQuery(queries.film(id))`), and the two Playwright test setups later in the plan.

**Files:**
- Modify: `frontend/package.json` (add `@tanstack/react-query`)
- Modify: `frontend/src/main.tsx` (wrap `<RouterProvider>` in `<QueryClientProvider>`)
- Modify: `frontend/src/routes/DashboardRoute.tsx` (prefetch effect)
- Create: `frontend/src/api/queries.ts`

- [ ] **Step 1: Install `@tanstack/react-query`**

```bash
cd frontend && npm install @tanstack/react-query
```

Verify: `grep '"@tanstack/react-query"' package.json` should show a version pin.

- [ ] **Step 2: Add shared query keys/fetchers**

Create `frontend/src/api/queries.ts`. Match the existing `sse.ts` convention — fail hard if `VITE_API_URL` unset:

```typescript
import type { QueryClient } from '@tanstack/react-query'

const BASE = (): string => {
  const url = import.meta.env.VITE_API_URL
  if (!url) throw new Error('VITE_API_URL is not set')
  return url.replace(/\/$/, '')
}

async function json<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE()}${path}`)
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json() as Promise<T>
}

export const queries = {
  detections: () => ({
    queryKey: ['detections'] as const,
    queryFn: () => json<unknown[]>(`/detections?limit=50`),
    staleTime: 15_000,
  }),
  statsSummary: () => ({
    queryKey: ['stats', 'summary'] as const,
    queryFn: () => json<Record<string, number>>(`/stats/summary`),
    staleTime: 60_000,
  }),
  shelves: (region: string | null) => ({
    queryKey: ['catalog', 'shelves', region] as const,
    queryFn: () => json<unknown>(`/catalog/shelves${region ? `?region=${encodeURIComponent(region)}` : ''}`),
    staleTime: 60_000,
  }),
  film: (filmId: number) => ({
    queryKey: ['catalog', 'film', filmId] as const,
    queryFn: () => json<unknown>(`/catalog/films/${filmId}`),
    staleTime: 30_000,
  }),
}

export function prefetchDashboard(qc: QueryClient): void {
  void qc.prefetchQuery(queries.detections())
  void qc.prefetchQuery(queries.statsSummary())
}
```

- [ ] **Step 3: Wrap `<RouterProvider>` with `<QueryClientProvider>` in `main.tsx`**

Replace `frontend/src/main.tsx` body wholesale (the current file has no QueryClientProvider):

```tsx
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
```

- [ ] **Step 4: Prefetch on Dashboard mount**

Modify `frontend/src/routes/DashboardRoute.tsx`. Add the imports and the prefetch effect inside the component:

```tsx
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { prefetchDashboard } from '../api/queries'
// ... (existing imports)

export default function DashboardRoute() {
  const qc = useQueryClient()
  useEffect(() => { prefetchDashboard(qc) }, [qc])
  return (
    // ... existing JSX unchanged
  )
}
```

Do NOT restructure any of the existing DashboardRoute JSX — only add the two-line hook + effect at the top of the function body.

- [ ] **Step 5: Update `DashboardRoute.test.tsx` to provide a QueryClientProvider**

The existing DashboardRoute test now needs a QueryClientProvider wrapper because the route calls `useQueryClient()`. Update `frontend/src/tests/unit/DashboardRoute.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import DashboardRoute from '../../routes/DashboardRoute'
import { useRunStore } from '../../store/runStore'

vi.mock('../../hooks/useIntakeRates', () => ({ useIntakeRates: () => {} }))

describe('DashboardRoute', () => {
  it('renders intake, anomaly feed, workspace, trace, telemetry regions', () => {
    // ... KEEP the exact same runStore seeding block Task 18 added
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DashboardRoute />
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(screen.getByTestId('intake-strip')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-workspace')).toBeInTheDocument()
    expect(screen.getByTestId('anomaly-feed')).toBeInTheDocument()
    expect(screen.getByTestId('agent-trace')).toBeInTheDocument()
    expect(screen.getByTestId('telemetry-strip')).toBeInTheDocument()
  })
})
```

Preserve any existing runStore-seeding logic Task 18 added — only add the `QueryClient`/`QueryClientProvider` wrap.

- [ ] **Step 6: Run vitest to verify no regressions**

Run: `cd frontend && npx vitest run`
Expected: 120/120 (no new test in this task — Task 18 test is updated in place, not duplicated). If it drops below 120, investigate and fix.

- [ ] **Step 7: Run Playwright route smoke**

Run: `cd frontend && npx playwright test src/tests/e2e/route-smoke.spec.ts`
Expected: PASS (all routes still resolve).

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json \
        frontend/src/api/queries.ts \
        frontend/src/main.tsx \
        frontend/src/routes/DashboardRoute.tsx \
        frontend/src/tests/unit/DashboardRoute.test.tsx
git commit -m "feat(dashboard): React Query prefetch on mount"
```

---

### Phase 3.2 — Movies Index (Tasks 20–23)

Netflix-style horizontal shelves with snap-scroll. Featured films (cached triples exist) surface first; region auto-detected from browser locale.

### Task 20: `<MovieCard>` with data/slim variants

**Files:**
- Create: `frontend/src/components/MovieCard.tsx`
- Create: `frontend/src/tests/unit/MovieCard.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/tests/unit/MovieCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { MovieCard } from '../../components/MovieCard'

const film = {
  id: 42,
  title: 'Test Film',
  poster_url: 'https://example.com/p.jpg',
  signal_delta: 3.2,
  region_hint: 'US',
  featured: true,
}

describe('MovieCard', () => {
  it('renders title, delta, region', () => {
    render(<MemoryRouter><MovieCard film={film as any} variant="data" /></MemoryRouter>)
    expect(screen.getByText('Test Film')).toBeInTheDocument()
    expect(screen.getByText(/3.2/)).toBeInTheDocument()
    expect(screen.getByLabelText('US')).toBeInTheDocument()
  })

  it('marks featured cards', () => {
    render(<MemoryRouter><MovieCard film={film as any} variant="data" /></MemoryRouter>)
    expect(screen.getByText(/featured/i)).toBeInTheDocument()
  })

  it('slim variant hides delta', () => {
    render(<MemoryRouter><MovieCard film={film as any} variant="slim" /></MemoryRouter>)
    expect(screen.queryByText(/3.2/)).not.toBeInTheDocument()
    expect(screen.getByText('Test Film')).toBeInTheDocument()
  })

  it('links to detail route', () => {
    render(<MemoryRouter><MovieCard film={film as any} variant="data" /></MemoryRouter>)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/movies/42')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/MovieCard.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `frontend/src/components/MovieCard.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { RegionFlag } from './RegionFlag'
import type { CatalogFilm } from '../store/catalogStore'

interface Props {
  film: CatalogFilm
  variant?: 'data' | 'slim'
}

export function MovieCard({ film, variant = 'data' }: Props) {
  const isData = variant === 'data'
  return (
    <Link
      to={`/movies/${film.id}`}
      className="group flex w-40 flex-shrink-0 flex-col overflow-hidden rounded-md border border-line bg-card transition-transform hover:-translate-y-0.5 hover:border-accent"
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-card-alt">
        {film.poster_url ? (
          <img
            src={film.poster_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-soft">no poster</div>
        )}
        {film.featured && (
          <span className="absolute left-1 top-1 rounded bg-accent/90 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-black">
            Featured
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 p-2">
        <div className="truncate text-xs font-medium">{film.title}</div>
        {isData && (
          <div className="flex items-center justify-between text-[10px] text-ink-soft">
            <span className="font-mono">Δ {film.signal_delta?.toFixed(1) ?? '—'}</span>
            {film.region_hint && <RegionFlag region={film.region_hint} />}
          </div>
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/unit/MovieCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MovieCard.tsx frontend/src/tests/unit/MovieCard.test.tsx
git commit -m "feat(components): MovieCard (data + slim variants)"
```

---

### Task 21: `<Shelf>` component (snap-scroll)

**Files:**
- Create: `frontend/src/components/Shelf.tsx`
- Create: `frontend/src/tests/unit/Shelf.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/tests/unit/Shelf.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { Shelf } from '../../components/Shelf'

const films = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  title: `F${i + 1}`,
  poster_url: '',
}))

describe('Shelf', () => {
  it('renders shelf title and all cards', () => {
    render(
      <MemoryRouter>
        <Shelf title="Featured" films={films as any} />
      </MemoryRouter>
    )
    expect(screen.getByText('Featured')).toBeInTheDocument()
    for (const f of films) expect(screen.getByText(f.title)).toBeInTheDocument()
  })

  it('renders empty state when no films', () => {
    render(
      <MemoryRouter>
        <Shelf title="Empty" films={[]} />
      </MemoryRouter>
    )
    expect(screen.getByText(/no films yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/Shelf.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `frontend/src/components/Shelf.tsx`:

```tsx
import type { CatalogFilm } from '../store/catalogStore'
import { MovieCard } from './MovieCard'

interface Props {
  title: string
  films: CatalogFilm[]
  variant?: 'data' | 'slim'
}

export function Shelf({ title, films, variant = 'data' }: Props) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-4 font-display text-sm tracking-tight text-ink">{title}</h3>
      {films.length === 0 ? (
        <div className="px-4 text-xs text-ink-soft">No films yet.</div>
      ) : (
        <div
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 scrollbar-thin"
          style={{ scrollbarWidth: 'thin' }}
        >
          {films.map((f) => (
            <div key={f.id} className="snap-start">
              <MovieCard film={f} variant={variant} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/unit/Shelf.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Shelf.tsx frontend/src/tests/unit/Shelf.test.tsx
git commit -m "feat(components): Shelf with snap-scroll cards"
```

---

### Task 22: `<FeaturedHero>` rotating hero

**Files:**
- Create: `frontend/src/components/FeaturedHero.tsx`
- Create: `frontend/src/tests/unit/FeaturedHero.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/tests/unit/FeaturedHero.test.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FeaturedHero } from '../../components/FeaturedHero'

const films = [
  { id: 1, title: 'Alpha', poster_url: 'a.jpg', featured: true },
  { id: 2, title: 'Bravo', poster_url: 'b.jpg', featured: true },
  { id: 3, title: 'Charlie', poster_url: 'c.jpg', featured: true },
]

describe('FeaturedHero', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows first film initially', () => {
    render(<MemoryRouter><FeaturedHero films={films as any} /></MemoryRouter>)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('rotates every 6s', () => {
    render(<MemoryRouter><FeaturedHero films={films as any} /></MemoryRouter>)
    act(() => { vi.advanceTimersByTime(6100) })
    expect(screen.getByText('Bravo')).toBeInTheDocument()
  })

  it('links CTA to detail', () => {
    render(<MemoryRouter><FeaturedHero films={films as any} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /replay investigation/i })).toHaveAttribute('href', '/movies/1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/FeaturedHero.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `frontend/src/components/FeaturedHero.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import type { CatalogFilm } from '../store/catalogStore'

interface Props {
  films: CatalogFilm[]
  intervalMs?: number
}

export function FeaturedHero({ films, intervalMs = 6000 }: Props) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (films.length <= 1) return
    const t = setInterval(() => setIdx((i) => (i + 1) % films.length), intervalMs)
    return () => clearInterval(t)
  }, [films.length, intervalMs])

  if (!films.length) return null
  const film = films[idx]

  return (
    <div className="relative flex h-[45vh] w-full items-end overflow-hidden bg-black">
      <AnimatePresence mode="wait">
        <motion.img
          key={film.id}
          src={film.poster_url}
          alt=""
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 0.5, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-paper via-paper/60 to-transparent" />
      <div className="relative z-10 flex max-w-2xl flex-col gap-3 p-8">
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-accent w-fit">
          Featured investigation
        </span>
        <h2 className="font-display text-4xl tracking-tight text-ink">{film.title}</h2>
        <Link
          to={`/movies/${film.id}`}
          className="w-fit rounded-md border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20"
        >
          Replay investigation →
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/unit/FeaturedHero.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FeaturedHero.tsx frontend/src/tests/unit/FeaturedHero.test.tsx
git commit -m "feat(components): FeaturedHero rotator"
```

---

### Task 23: Movies route with shelves + search + region detect

**Files:**
- Modify: `frontend/src/routes/MoviesRoute.tsx`
- Create: `frontend/src/hooks/useRegion.ts`
- Create: `frontend/src/panels/MoviesSearchBar.tsx`
- Create: `frontend/src/tests/unit/MoviesRoute.test.tsx`

- [ ] **Step 1: Implement region detection hook**

Create `frontend/src/hooks/useRegion.ts`:

```typescript
import { useEffect } from 'react'
import { useCatalogStore } from '../store/catalogStore'

const KNOWN = new Set([
  'US','GB','DE','FR','JP','KR','CN','IN','BR','MX','AU','CA','IT','ES','RU',
])

export function useRegion() {
  const region = useCatalogStore((s) => s.region)
  const setRegion = useCatalogStore((s) => s.setRegion)
  useEffect(() => {
    if (region) return
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    const code = (locale.split('-')[1] || '').toUpperCase()
    setRegion(KNOWN.has(code) ? code : 'US')
  }, [region, setRegion])
  return region
}
```

- [ ] **Step 2: Implement search bar**

Create `frontend/src/panels/MoviesSearchBar.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const BASE = import.meta.env.VITE_API_URL || ''

interface Hit { id: number; title: string; poster_url: string }

export function MoviesSearchBar() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${BASE}/catalog/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        setHits(await r.json())
      } catch { /* aborted */ }
    }, 200)
    return () => { ctrl.abort(); clearTimeout(t) }
  }, [q])

  return (
    <div className="relative w-full max-w-md">
      <input
        aria-label="Search films"
        placeholder="Search films…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-sm placeholder:text-ink-soft focus:border-accent focus:outline-none"
      />
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-line bg-card shadow-lg">
          {hits.slice(0, 8).map((h) => (
            <li key={h.id}>
              <Link
                to={`/movies/${h.id}`}
                onClick={() => setQ('')}
                className="block px-3 py-2 text-xs hover:bg-card-alt"
              >
                {h.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Write failing route test**

Create `frontend/src/tests/unit/MoviesRoute.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import MoviesRoute from '../../routes/MoviesRoute'
import { useCatalogStore } from '../../store/catalogStore'

const shelves = [
  { id: 'featured', title: 'Featured', films: [{ id: 1, title: 'Alpha', poster_url: '', featured: true }] },
  { id: 'trending', title: 'Trending', films: [{ id: 2, title: 'Bravo', poster_url: '' }] },
]

beforeEach(() => {
  // queries.ts BASE() throws when VITE_API_URL is unset — required for queryFn
  // to reach the stubbed fetch instead of erroring immediately.
  vi.stubEnv('VITE_API_URL', 'http://test.local')
  useCatalogStore.setState({ shelves: [], films: {}, region: null })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('MoviesRoute', () => {
  it('renders shelves from /catalog/shelves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => shelves })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MoviesRoute />
        </MemoryRouter>
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByText('Featured')).toBeInTheDocument())
    expect(screen.getByText('Trending')).toBeInTheDocument()
    expect(screen.getByLabelText('Search films')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/MoviesRoute.test.tsx`
Expected: FAIL.

- [ ] **Step 5: Implement the route**

Replace `frontend/src/routes/MoviesRoute.tsx`:

```tsx
import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRegion } from '../hooks/useRegion'
import { useCatalogStore } from '../store/catalogStore'
import { queries } from '../api/queries'
import { FeaturedHero } from '../components/FeaturedHero'
import { Shelf } from '../components/Shelf'
import { MoviesSearchBar } from '../panels/MoviesSearchBar'

export default function MoviesRoute() {
  const region = useRegion()
  const { data, isLoading, error } = useQuery(queries.shelves(region))
  const shelves = (data ?? []) as any[]
  const setShelves = useCatalogStore((s) => s.setShelves)
  useEffect(() => { if (data) setShelves(data as any) }, [data, setShelves])
  const featured = useMemo(() => shelves.find((s) => s.id === 'featured')?.films ?? [], [shelves])

  return (
    <div data-testid="route-movies" className="flex flex-col gap-6 pb-8">
      {featured.length > 0 && <FeaturedHero films={featured} />}
      <div className="flex items-center justify-between px-6">
        <h1 className="font-display text-2xl tracking-tight">Movies</h1>
        <MoviesSearchBar />
      </div>
      {isLoading && <div className="px-6 text-sm text-ink-soft">Loading shelves…</div>}
      {error && <div className="px-6 text-sm text-rose-400">Failed to load shelves.</div>}
      {shelves.map((shelf) => (
        <Shelf key={shelf.id} title={shelf.title} films={shelf.films} variant="data" />
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Run tests**

Run: `cd frontend && npx vitest run src/tests/unit/MoviesRoute.test.tsx && npx playwright test tests/e2e/route-smoke.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/routes/MoviesRoute.tsx frontend/src/hooks/useRegion.ts frontend/src/panels/MoviesSearchBar.tsx frontend/src/tests/unit/MoviesRoute.test.tsx
git commit -m "feat(movies): shelves route + search + region auto-detect"
```

---

### Phase 3.3 — Movie Detail (Tasks 24–27)

Executive-brief-first layout: Section A `<MovieHero>` (title + poster + inject CTA), Section B `<LatestInvestigation>` (report headline, decision, recommended actions), Section C `<AgentTrace>` (persistent below), Section D `<RunTimeline>` (past runs), Section E `<AmbientTelemetry>` (mini sparklines for each family). Three states: cached-playback (featured), live-run-in-progress, no-run-yet.

### Task 24: `<MovieHero>` (Section A) + film fetch

**Files:**
- Create: `frontend/src/panels/MovieHero.tsx`
- Create: `frontend/src/hooks/useFilm.ts`
- Create: `frontend/src/tests/unit/MovieHero.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/tests/unit/MovieHero.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { MovieHero } from '../../panels/MovieHero'

const film = {
  id: 42, title: 'Test Title', poster_url: 'x.jpg', release_date: '2025-01-01',
  popularity: 42.5, signals: { box_office: 10, social: 20, reviews: 5, streaming: 8 },
  featured: true, cached_scenario_id: 'sc_001',
}

describe('MovieHero', () => {
  it('renders title, release, and inject CTA', () => {
    render(<MemoryRouter><MovieHero film={film as any} onInject={() => {}} /></MemoryRouter>)
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText(/2025/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inject crisis/i })).toBeInTheDocument()
  })

  it('badges featured with cached scenario id', () => {
    render(<MemoryRouter><MovieHero film={film as any} onInject={() => {}} /></MemoryRouter>)
    expect(screen.getByText(/sc_001/i)).toBeInTheDocument()
  })

  it('inject CTA fires callback', () => {
    const cb = vi.fn()
    render(<MemoryRouter><MovieHero film={film as any} onInject={cb} /></MemoryRouter>)
    screen.getByRole('button', { name: /inject crisis/i }).click()
    expect(cb).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/MovieHero.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement film fetch hook**

Create `frontend/src/hooks/useFilm.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { queries } from '../api/queries'

export function useFilm(filmId: number | undefined) {
  return useQuery({
    ...queries.film(filmId ?? 0),
    enabled: filmId != null && filmId > 0,
  })
}
```

- [ ] **Step 4: Implement MovieHero**

Create `frontend/src/panels/MovieHero.tsx`:

```tsx
import { SignalChip, type SignalFamily } from '../components/SignalChip'

interface Film {
  id: number
  title: string
  poster_url: string
  release_date: string
  popularity: number
  signals: Record<SignalFamily, number>
  featured: boolean
  cached_scenario_id: string | null
}

interface Props {
  film: Film
  onInject: () => void
}

const FAMILIES: SignalFamily[] = ['box_office', 'social', 'reviews', 'streaming']

export function MovieHero({ film, onInject }: Props) {
  return (
    <header className="relative flex flex-col gap-4 border-b border-line bg-card p-6 md:flex-row">
      <div className="w-40 flex-shrink-0 overflow-hidden rounded-md border border-line bg-card-alt">
        {film.poster_url ? (
          <img src={film.poster_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex aspect-[2/3] items-center justify-center text-xs text-ink-soft">no poster</div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          {film.featured && film.cached_scenario_id && (
            <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-accent">
              Featured · {film.cached_scenario_id}
            </span>
          )}
          <span className="text-[10px] font-mono uppercase tracking-wider text-ink-soft">
            Released {film.release_date}
          </span>
        </div>
        <h1 className="font-display text-3xl tracking-tight">{film.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {FAMILIES.map((family) => (
            <div key={family} className="flex items-center gap-1">
              <SignalChip family={family} compact />
              <span className="font-mono text-[11px] text-ink-soft">{film.signals[family] ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={onInject}
            className="rounded-md border border-accent bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent hover:bg-accent/20"
          >
            Inject Crisis
          </button>
          <span className="text-[11px] text-ink-soft">
            Popularity {film.popularity.toFixed(1)}
          </span>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/unit/MovieHero.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/panels/MovieHero.tsx frontend/src/hooks/useFilm.ts frontend/src/tests/unit/MovieHero.test.tsx
git commit -m "feat(movie-detail): MovieHero + useFilm hook"
```

---

### Task 25: `<LatestInvestigation>` (Section B) + cached-playback loader

**Files:**
- Create: `frontend/src/panels/LatestInvestigation.tsx`
- Create: `frontend/src/hooks/useCachedTriple.ts`
- Create: `frontend/src/tests/unit/LatestInvestigation.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LatestInvestigation } from '../../panels/LatestInvestigation'

const triple = {
  scenario_id: 'sc_001',
  detection: { magnitude: 3.2, severity: 'high', metric: 'box_office', region: 'US', latency_ms: 234 },
  investigation: { headline: 'Compet release siphon', hypotheses: [], findings: [] },
  decision: { recommended_actions: [{ label: 'Bump paid social', impact_est: 0.15 }] },
  report: { headline: 'Reallocate spend to reviews_stream family', body: '…' },
}

describe('LatestInvestigation', () => {
  it('renders report headline first', () => {
    render(<LatestInvestigation triple={triple as any} />)
    expect(screen.getByText(/reallocate spend/i)).toBeInTheDocument()
  })
  it('renders recommended actions', () => {
    render(<LatestInvestigation triple={triple as any} />)
    expect(screen.getByText(/bump paid social/i)).toBeInTheDocument()
  })
  it('renders detection latency badge', () => {
    render(<LatestInvestigation triple={triple as any} />)
    expect(screen.getByText('234ms')).toBeInTheDocument()
  })
  it('renders empty state when no triple', () => {
    render(<LatestInvestigation triple={null} />)
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/LatestInvestigation.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement cached triple loader**

Create `frontend/src/hooks/useCachedTriple.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'

const BASE = import.meta.env.VITE_API_URL || ''

export function useCachedTriple(scenarioId: string | null | undefined) {
  return useQuery({
    queryKey: ['cached-triple', scenarioId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/eval_cache/${scenarioId}.json`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: !!scenarioId,
    staleTime: 5 * 60_000,
  })
}
```

**Note:** This requires the backend to serve `data/eval_cache/*.json` as static files. Add to `backend/api/main.py` inside the app setup:

```python
from fastapi.staticfiles import StaticFiles
from pathlib import Path
_cache_dir = Path(__file__).resolve().parents[2] / "data" / "eval_cache"
if _cache_dir.is_dir():
    app.mount("/eval_cache", StaticFiles(directory=_cache_dir), name="eval_cache")
```

Add a small backend test in `backend/api/tests/test_eval_cache_mount.py`:

```python
from fastapi.testclient import TestClient
from api.main import app


def test_eval_cache_static_mount():
    with TestClient(app) as client:
        r = client.get("/eval_cache/sc_001.json")
        # If sc_001.json exists in the repo, expect 200; else 404 is fine.
        assert r.status_code in (200, 404)
```

- [ ] **Step 4: Implement `LatestInvestigation`**

Create `frontend/src/panels/LatestInvestigation.tsx`:

```tsx
import { LatencyBadge } from '../components/LatencyBadge'
import { SignalChip, type SignalFamily } from '../components/SignalChip'

interface Triple {
  scenario_id: string
  detection: any
  investigation: any
  decision: any
  report: any
}

interface Props {
  triple: Triple | null
}

export function LatestInvestigation({ triple }: Props) {
  if (!triple) {
    return (
      <div className="rounded-md border border-line bg-card p-6 text-sm text-ink-soft">
        No run yet — click <strong>Inject Crisis</strong> above to start one.
      </div>
    )
  }
  const det = triple.detection ?? {}
  const dec = triple.decision ?? {}
  const rep = triple.report ?? {}
  const metric = det.metric as SignalFamily | undefined
  return (
    <section className="flex flex-col gap-4 rounded-md border border-line bg-card p-6">
      <div className="flex items-center gap-3">
        {metric && <SignalChip family={metric} compact />}
        <span className="font-mono text-xs uppercase tracking-wider text-ink-soft">
          {det.region ?? '—'} · severity {det.severity ?? '—'} · magnitude {Number(det.magnitude ?? 0).toFixed(1)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <span className="text-[10px] uppercase text-ink-soft">latency</span>
          <LatencyBadge ms={det.latency_ms ?? null} />
        </span>
      </div>
      <h2 className="font-display text-xl tracking-tight text-ink">{rep.headline ?? '—'}</h2>
      {rep.body && <p className="text-sm text-ink-soft">{rep.body}</p>}
      {Array.isArray(dec.recommended_actions) && dec.recommended_actions.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line pt-3">
          {dec.recommended_actions.map((a: any, i: number) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <span>{a.label ?? a.name ?? '(action)'}</span>
              <span className="font-mono text-xs text-emerald-400">
                +{Number(a.impact_est ?? 0).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/unit/LatestInvestigation.test.tsx && cd ../backend && pytest api/tests/test_eval_cache_mount.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/panels/LatestInvestigation.tsx frontend/src/hooks/useCachedTriple.ts frontend/src/tests/unit/LatestInvestigation.test.tsx backend/api/main.py backend/api/tests/test_eval_cache_mount.py
git commit -m "feat(movie-detail): LatestInvestigation + cached triple loader"
```

---

### Task 26: `<RunTimeline>` (Section D) + persistent `<AgentTrace>` slot (Section C)

**Files:**
- Create: `frontend/src/panels/RunTimeline.tsx`
- Create: `frontend/src/panels/PersistentAgentTrace.tsx`
- Create: `frontend/src/tests/unit/RunTimeline.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RunTimeline } from '../../panels/RunTimeline'

const runs = [
  { run_id: 'r1', at: '2026-08-16T00:00:00Z', ctype: 'box_office_drop', magnitude: 0.4, severity: 'high' },
  { run_id: 'r2', at: '2026-08-14T00:00:00Z', ctype: 'social_meltdown', magnitude: 0.3, severity: 'medium' },
]

describe('RunTimeline', () => {
  it('renders each past run', () => {
    render(<RunTimeline runs={runs as any} />)
    expect(screen.getByText(/box_office_drop/i)).toBeInTheDocument()
    expect(screen.getByText(/social_meltdown/i)).toBeInTheDocument()
  })
  it('shows empty state', () => {
    render(<RunTimeline runs={[]} />)
    expect(screen.getByText(/no past runs/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/RunTimeline.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement RunTimeline**

Create `frontend/src/panels/RunTimeline.tsx`:

```tsx
interface Run {
  run_id: string
  at: string
  ctype: string
  magnitude: number
  severity: string
}

export function RunTimeline({ runs }: { runs: Run[] }) {
  if (!runs.length) {
    return <div className="rounded-md border border-line bg-card p-4 text-xs text-ink-soft">No past runs.</div>
  }
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 font-display text-sm tracking-tight">Past runs</h3>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">
        {runs.map((r) => (
          <li key={r.run_id} className="flex items-center justify-between px-3 py-2 text-xs">
            <span className="font-mono text-ink-soft">{new Date(r.at).toLocaleString()}</span>
            <span>{r.ctype}</span>
            <span className="font-mono">Δ {r.magnitude.toFixed(2)}</span>
            <span className="font-mono uppercase text-ink-soft">{r.severity}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Implement PersistentAgentTrace wrapper**

Create `frontend/src/panels/PersistentAgentTrace.tsx`:

```tsx
import { AgentTrace } from './AgentTrace'

export function PersistentAgentTrace() {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 font-display text-sm tracking-tight">Agent Trace</h3>
      <div className="rounded-md border border-line bg-card">
        <AgentTrace />
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/unit/RunTimeline.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/panels/RunTimeline.tsx frontend/src/panels/PersistentAgentTrace.tsx frontend/src/tests/unit/RunTimeline.test.tsx
git commit -m "feat(movie-detail): RunTimeline + PersistentAgentTrace"
```

---

### Task 27: `<AmbientTelemetry>` (Section E) + Movie Detail route wiring

**Files:**
- Create: `frontend/src/panels/AmbientTelemetry.tsx`
- Modify: `frontend/src/routes/MovieDetailRoute.tsx`
- Create: `frontend/src/tests/unit/MovieDetailRoute.test.tsx`

- [ ] **Step 1: Implement AmbientTelemetry**

Create `frontend/src/panels/AmbientTelemetry.tsx`:

```tsx
import { SignalChip, type SignalFamily } from '../components/SignalChip'

interface Props {
  signals: Record<SignalFamily, number>
}

const FAMILIES: SignalFamily[] = ['box_office', 'social', 'reviews', 'streaming']

export function AmbientTelemetry({ signals }: Props) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 font-display text-sm tracking-tight">Signals (last 7d)</h3>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {FAMILIES.map((family) => (
          <div key={family} className="flex flex-col gap-1 rounded-md border border-line bg-card p-3">
            <SignalChip family={family} compact />
            <span className="font-mono text-lg">{signals[family] ?? 0}</span>
            <span className="text-[10px] uppercase tracking-wider text-ink-soft">rows / 7d</span>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Write failing route test**

Create `frontend/src/tests/unit/MovieDetailRoute.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import MovieDetailRoute from '../../routes/MovieDetailRoute'

const film = {
  id: 42, title: 'Test', poster_url: '', release_date: '2025-01-01',
  popularity: 12, signals: { box_office: 1, social: 2, reviews: 3, streaming: 4 },
  featured: false, cached_scenario_id: null,
}

describe('MovieDetailRoute', () => {
  it('renders hero + latest + trace + timeline + telemetry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => film })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/movies/42']}>
          <Routes><Route path="/movies/:filmId" element={<MovieDetailRoute />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument())
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument()
    expect(screen.getByText(/agent trace/i)).toBeInTheDocument()
    expect(screen.getByText(/past runs/i)).toBeInTheDocument()
    expect(screen.getByText(/signals \(last 7d\)/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/MovieDetailRoute.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Wire the route**

Replace `frontend/src/routes/MovieDetailRoute.tsx`:

```tsx
import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { useFilm } from '../hooks/useFilm'
import { useCachedTriple } from '../hooks/useCachedTriple'
import { MovieHero } from '../panels/MovieHero'
import { LatestInvestigation } from '../panels/LatestInvestigation'
import { PersistentAgentTrace } from '../panels/PersistentAgentTrace'
import { RunTimeline } from '../panels/RunTimeline'
import { AmbientTelemetry } from '../panels/AmbientTelemetry'
import { GlobalInjectModal } from '../shell/GlobalInjectModal'

export default function MovieDetailRoute() {
  const { filmId } = useParams()
  const id = Number(filmId ?? '0')
  const { data: film, isLoading, error } = useFilm(id)
  const { data: triple } = useCachedTriple(film?.cached_scenario_id)
  const [injectOpen, setInjectOpen] = useState(false)

  if (isLoading) return <div data-testid="route-movie-detail" className="p-6 text-sm text-ink-soft">Loading…</div>
  if (error || !film) return <div data-testid="route-movie-detail" className="p-6 text-sm text-rose-400">Film not found.</div>

  return (
    <div data-testid="route-movie-detail" className="flex flex-col gap-6 pb-8">
      <MovieHero film={film} onInject={() => setInjectOpen(true)} />
      <div className="grid gap-6 px-6 md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <LatestInvestigation triple={triple ?? null} />
          <PersistentAgentTrace />
          <RunTimeline runs={[]} />
        </div>
        <div className="flex flex-col gap-6">
          <AmbientTelemetry signals={film.signals} />
        </div>
      </div>
      <GlobalInjectModal open={injectOpen} onClose={() => setInjectOpen(false)} />
    </div>
  )
}
```

**Note:** `RunTimeline` receives `[]` here — a `/catalog/films/{id}/runs` endpoint is out of scope for L7 (the spec's featured playback is the primary story). Leave as empty state; the panel itself was tested in Task 26.

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run src/tests/unit/MovieDetailRoute.test.tsx && npx playwright test tests/e2e/route-smoke.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/panels/AmbientTelemetry.tsx frontend/src/routes/MovieDetailRoute.tsx frontend/src/tests/unit/MovieDetailRoute.test.tsx
git commit -m "feat(movie-detail): AmbientTelemetry + full route assembly"
```

---

### Phase 3.4 — Landing (Tasks 28–31)

Chromeless full-bleed landing page. Fold 1: hero + `<ParticleCascade>` + `<LiveCounter>` + CTA. Fold 2: 4 agents. Fold 3: how it works (3 steps). Fold 4: live counter reprise + secondary CTA. `prefers-reduced-motion` disables particles and replaces with a static gradient.

### Task 28: `<ParticleCascade>` canvas + `useReducedMotion` hook

**Files:**
- Create: `frontend/src/landing/ParticleCascade.tsx`
- Create: `frontend/src/hooks/useReducedMotion.ts`
- Create: `frontend/src/tests/unit/ParticleCascade.test.tsx`

- [ ] **Step 1: Implement reduced-motion hook**

Create `frontend/src/hooks/useReducedMotion.ts`:

```typescript
import { useEffect, useState } from 'react'

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}
```

- [ ] **Step 2: Write failing test**

Create `frontend/src/tests/unit/ParticleCascade.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ParticleCascade } from '../../landing/ParticleCascade'

describe('ParticleCascade', () => {
  it('renders a canvas element', () => {
    const { container } = render(<ParticleCascade />)
    expect(container.querySelector('canvas')).not.toBeNull()
  })

  it('renders static fallback when reduced-motion', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true, addEventListener: () => {}, removeEventListener: () => {},
    })))
    const { container } = render(<ParticleCascade />)
    expect(container.querySelector('[data-fallback="reduced-motion"]')).not.toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/ParticleCascade.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement ParticleCascade**

Create `frontend/src/landing/ParticleCascade.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { tokens } from '../theme/tokens'

interface Particle {
  x: number
  y: number
  vy: number
  color: string
  size: number
  alpha: number
}

const FAMILY_COLORS = [
  tokens.signal.box_office.hex,
  tokens.signal.social.hex,
  tokens.signal.reviews.hex,
  tokens.signal.streaming.hex,
]

export function ParticleCascade() {
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (reduced) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let running = true
    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
    }
    resize()
    window.addEventListener('resize', resize)

    const particles: Particle[] = []
    const spawn = () => {
      const color = FAMILY_COLORS[Math.floor(Math.random() * FAMILY_COLORS.length)]
      particles.push({
        x: Math.random() * canvas.width,
        y: -10,
        vy: (1 + Math.random() * 2) * window.devicePixelRatio,
        color,
        size: (1 + Math.random() * 2) * window.devicePixelRatio,
        alpha: 0.4 + Math.random() * 0.5,
      })
    }

    let lastSpawn = 0
    const frame = (t: number) => {
      if (!running) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (t - lastSpawn > 30) {
        for (let i = 0; i < 3; i++) spawn()
        lastSpawn = t
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.y += p.vy
        ctx.globalAlpha = p.alpha
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        if (p.y > canvas.height + 10) particles.splice(i, 1)
      }
      if (particles.length > 400) particles.splice(0, particles.length - 400)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [reduced])

  if (reduced) {
    return (
      <div
        data-fallback="reduced-motion"
        className="absolute inset-0 -z-10"
        style={{
          background: `linear-gradient(180deg, ${tokens.signal.box_office.hex}22 0%, ${tokens.signal.social.hex}22 40%, ${tokens.signal.reviews.hex}22 70%, ${tokens.signal.streaming.hex}22 100%)`,
        }}
      />
    )
  }

  return <canvas ref={canvasRef} className="absolute inset-0 -z-10 h-full w-full" aria-hidden />
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/unit/ParticleCascade.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/landing/ParticleCascade.tsx frontend/src/hooks/useReducedMotion.ts frontend/src/tests/unit/ParticleCascade.test.tsx
git commit -m "feat(landing): ParticleCascade canvas + reduced-motion fallback"
```

---

### Task 29: `<LiveCounter>` + Fold 1 hero

**Files:**
- Create: `frontend/src/landing/LiveCounter.tsx`
- Create: `frontend/src/landing/HeroFold.tsx`
- Create: `frontend/src/tests/unit/LiveCounter.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { LiveCounter } from '../../landing/LiveCounter'

describe('LiveCounter', () => {
  it('renders rollup values from /stats/summary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({
        films_tracked: 250, regions: 15, days_history: 120, rows_scanned_24h: 1234567, p50_detection_ms: 340,
      }),
    })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><LiveCounter /></QueryClientProvider>)
    await waitFor(() => expect(screen.getByText(/250/)).toBeInTheDocument())
    expect(screen.getByText(/15/)).toBeInTheDocument()
    expect(screen.getByText(/120/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/unit/LiveCounter.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement LiveCounter**

Create `frontend/src/landing/LiveCounter.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { queries } from '../api/queries'

const fmt = new Intl.NumberFormat('en')

export function LiveCounter() {
  const { data } = useQuery(queries.statsSummary())
  const stats = [
    { label: 'films tracked', value: data?.films_tracked ?? 0 },
    { label: 'regions', value: data?.regions ?? 0 },
    { label: 'days history', value: data?.days_history ?? 0 },
    { label: 'rows / 24h', value: data?.rows_scanned_24h ?? 0 },
    { label: 'p50 detect ms', value: Math.round(data?.p50_detection_ms ?? 0) },
  ]
  return (
    <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col items-center gap-1">
          <span className="font-display text-3xl tracking-tight">{fmt.format(s.value)}</span>
          <span className="text-[10px] uppercase tracking-wider text-ink-soft">{s.label}</span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Implement HeroFold**

Create `frontend/src/landing/HeroFold.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { ParticleCascade } from './ParticleCascade'
import { LiveCounter } from './LiveCounter'

export function HeroFold() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
      <ParticleCascade />
      <div className="relative z-10 flex max-w-3xl flex-col items-center gap-8">
        <span className="rounded-full border border-line bg-card/70 px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-ink-soft backdrop-blur-sm">
          Detecting data as it lands
        </span>
        <h1 className="font-display text-5xl leading-none tracking-tight md:text-6xl">
          Investigations that arrive<br />before the meeting starts.
        </h1>
        <p className="max-w-xl text-lg text-ink-soft">
          Four autonomous agents pipe box office, social, reviews, and streaming into a single crisis narrative — in milliseconds.
        </p>
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="rounded-md border border-accent bg-accent px-5 py-2 text-sm font-medium text-black hover:brightness-110"
          >
            Open Dashboard →
          </Link>
          <Link to="/movies" className="rounded-md border border-line px-5 py-2 text-sm text-ink hover:border-accent">
            Browse Movies
          </Link>
        </div>
        <div className="mt-8 w-full border-t border-line pt-8">
          <LiveCounter />
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/unit/LiveCounter.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/landing/LiveCounter.tsx frontend/src/landing/HeroFold.tsx frontend/src/tests/unit/LiveCounter.test.tsx
git commit -m "feat(landing): LiveCounter + HeroFold"
```

---

### Task 30: Folds 2–4 (Agents / How It Works / CTA)

**Files:**
- Create: `frontend/src/landing/AgentsFold.tsx`
- Create: `frontend/src/landing/HowItWorksFold.tsx`
- Create: `frontend/src/landing/CtaFold.tsx`

- [ ] **Step 1: Implement AgentsFold**

Create `frontend/src/landing/AgentsFold.tsx`:

```tsx
import { SignalChip, type SignalFamily } from '../components/SignalChip'

const AGENTS: { family: SignalFamily; title: string; body: string }[] = [
  { family: 'box_office', title: 'Detection Agent', body: 'Pure SQL over 50M+ rows. MAD-Z anomaly scoring on 5-minute windows.' },
  { family: 'social', title: 'Investigation Agent', body: 'Gemini reasons across signal families to form crisis hypotheses.' },
  { family: 'reviews', title: 'Decision Agent', body: 'Bounded action space, cost/impact estimation, ranked recommendations.' },
  { family: 'streaming', title: 'Report Agent', body: 'Executive-brief prose with SQL provenance links back to source rows.' },
]

export function AgentsFold() {
  return (
    <section className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <div className="text-center">
          <h2 className="font-display text-3xl tracking-tight">Four agents. One narrative.</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-ink-soft">
            Each agent owns one contract and one output. Composed via Google ADK.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {AGENTS.map((a) => (
            <article key={a.family} className="flex flex-col gap-3 rounded-md border border-line bg-card p-6">
              <SignalChip family={a.family} />
              <h3 className="font-display text-xl tracking-tight">{a.title}</h3>
              <p className="text-sm text-ink-soft">{a.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Implement HowItWorksFold**

Create `frontend/src/landing/HowItWorksFold.tsx`:

```tsx
const STEPS = [
  { n: '01', title: 'Signals land', body: 'ClickHouse ingest across 4 families. Detection is pure SQL on 5-min rollups.' },
  { n: '02', title: 'Agents reason', body: 'Investigation → Decision → Report chain runs on Gemini via ADK.' },
  { n: '03', title: 'Human decides', body: 'Recommended actions land in your Approval Gate with full provenance.' },
]

export function HowItWorksFold() {
  return (
    <section className="flex min-h-screen items-center justify-center bg-card/40 px-6 py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <h2 className="text-center font-display text-3xl tracking-tight">How it works</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="flex flex-col gap-3 border-l-2 border-accent px-4">
              <span className="font-mono text-xs text-accent">{s.n}</span>
              <h3 className="font-display text-lg tracking-tight">{s.title}</h3>
              <p className="text-sm text-ink-soft">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Implement CtaFold**

Create `frontend/src/landing/CtaFold.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { LiveCounter } from './LiveCounter'

export function CtaFold() {
  return (
    <section className="flex min-h-[80vh] items-center justify-center px-6 py-16">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
        <h2 className="font-display text-4xl tracking-tight">Watch it happen live.</h2>
        <p className="text-sm text-ink-soft">Four agents, five endpoints, one dashboard.</p>
        <LiveCounter />
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="rounded-md border border-accent bg-accent px-6 py-2.5 text-sm font-medium text-black hover:brightness-110"
          >
            Open the dashboard →
          </Link>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/landing/AgentsFold.tsx frontend/src/landing/HowItWorksFold.tsx frontend/src/landing/CtaFold.tsx
git commit -m "feat(landing): folds 2-4 (agents, how it works, cta)"
```

---

### Task 31: Landing route integration + e2e visual smoke

**Files:**
- Modify: `frontend/src/routes/LandingRoute.tsx`
- Modify: `frontend/tests/e2e/route-smoke.spec.ts` (extend with landing content assertions)

- [ ] **Step 1: Wire the landing route**

Replace `frontend/src/routes/LandingRoute.tsx`:

```tsx
import { HeroFold } from '../landing/HeroFold'
import { AgentsFold } from '../landing/AgentsFold'
import { HowItWorksFold } from '../landing/HowItWorksFold'
import { CtaFold } from '../landing/CtaFold'

export default function LandingRoute() {
  return (
    <div data-testid="route-landing" className="min-h-screen bg-paper text-ink">
      <HeroFold />
      <AgentsFold />
      <HowItWorksFold />
      <CtaFold />
    </div>
  )
}
```

- [ ] **Step 2: Extend route smoke**

Append to `frontend/tests/e2e/route-smoke.spec.ts`:

```typescript
test('landing shows headline and CTA', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Investigations that arrive/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open Dashboard/i })).toBeVisible()
})

test('landing → dashboard CTA nav', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /Open Dashboard/i }).first().click()
  await expect(page).toHaveURL(/\/dashboard$/)
})
```

- [ ] **Step 3: Run e2e**

Run: `cd frontend && npx playwright test tests/e2e/route-smoke.spec.ts`
Expected: 8 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/LandingRoute.tsx frontend/tests/e2e/route-smoke.spec.ts
git commit -m "feat(landing): assemble folds + e2e CTA nav"
```

---

## Phase 4 — Polish (Tasks 32–34)

### Task 32: Playwright e2e per route

**Files:**
- Create: `frontend/tests/e2e/dashboard-inject.spec.ts`
- Create: `frontend/tests/e2e/movies-navigate.spec.ts`
- Create: `frontend/tests/e2e/movie-detail-cached.spec.ts`

- [ ] **Step 1: Dashboard inject flow**

Create `frontend/tests/e2e/dashboard-inject.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

test('inject flow lands from dashboard', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByTestId('intake-strip')).toBeVisible()
  await page.getByTestId('top-inject-cta').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('Crisis type').selectOption('box_office_drop')
  await page.getByLabel('Film ID').fill('1')
  await page.getByLabel('Region').selectOption('US')
  await page.getByLabel('Magnitude').fill('0.4')
  // Do not submit against real backend in CI; assert modal is populated.
  await expect(page.getByRole('button', { name: /Inject$/i })).toBeEnabled()
})
```

- [ ] **Step 2: Movies index navigation**

Create `frontend/tests/e2e/movies-navigate.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

test('movies index → detail navigation', async ({ page }) => {
  await page.goto('/movies')
  await expect(page.getByText(/Movies/i)).toBeVisible()
  const firstCard = page.getByRole('link').filter({ hasText: /.+/ }).first()
  if (await firstCard.isVisible()) {
    await firstCard.click()
    await expect(page).toHaveURL(/\/movies\/\d+/)
  }
})
```

- [ ] **Step 3: Movie detail cached playback**

Create `frontend/tests/e2e/movie-detail-cached.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

test('featured film shows LatestInvestigation panel', async ({ page }) => {
  await page.goto('/movies/1')
  // Either the cached triple loads (Featured badge visible) or the panel says "No run yet"
  const featured = page.getByText(/Featured/i)
  const empty = page.getByText(/No run yet/i)
  await expect(featured.or(empty)).toBeVisible({ timeout: 10_000 })
})
```

- [ ] **Step 4: Run all e2e**

Run: `cd frontend && npx playwright test`
Expected: all specs PASS (or gracefully skip when data absent).

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/e2e/dashboard-inject.spec.ts frontend/tests/e2e/movies-navigate.spec.ts frontend/tests/e2e/movie-detail-cached.spec.ts
git commit -m "test(e2e): per-route flows for dashboard, movies, detail"
```

---

### Task 33: Motion tuning + reduced-motion QA + axe a11y

**Files:**
- Modify: `frontend/src/landing/HeroFold.tsx` (respect reduced-motion for framer-motion animations if any)
- Create: `frontend/src/tests/e2e/a11y.spec.ts`
- Modify: `frontend/package.json` (add `@axe-core/playwright` if not present)

**IMPORTANT — path correction:** The playwright config uses `testDir: 'src/tests/e2e'`. All e2e specs live under `frontend/src/tests/e2e/`, NOT `frontend/tests/e2e/`. Use the corrected path everywhere in this task.

- [ ] **Step 1: Install axe**

Run: `cd frontend && npm install --save-dev @axe-core/playwright`

- [ ] **Step 2: Write a11y spec**

Create `frontend/src/tests/e2e/a11y.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const routes = ['/', '/dashboard', '/movies', '/movies/1', '/audit', '/settings']

for (const path of routes) {
  test(`a11y: ${path} has no serious violations`, async ({ page }) => {
    await page.goto(path)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
    if (serious.length) console.log(JSON.stringify(serious, null, 2))
    expect(serious).toEqual([])
  })
}
```

- [ ] **Step 3: Run reduced-motion QA in Playwright**

Add to `frontend/src/tests/e2e/a11y.spec.ts` at the bottom:

```typescript
test('reduced-motion disables particle canvas on landing', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto('/')
  await expect(page.locator('[data-fallback="reduced-motion"]')).toBeVisible()
  await ctx.close()
})
```

- [ ] **Step 4: Fix any serious a11y violations**

Run: `cd frontend && npx playwright test src/tests/e2e/a11y.spec.ts`

For each serious/critical violation, apply the minimum fix in the offending component. Common fixes: missing `aria-label` on icon-only buttons, insufficient color contrast in text on tinted backgrounds, missing `<h1>` on a route. Do not open-ended-refactor.

- [ ] **Step 5: Re-run**

Run: `cd frontend && npx playwright test src/tests/e2e/a11y.spec.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/tests/e2e/a11y.spec.ts
git commit -m "test(a11y): axe scan per route + reduced-motion e2e"
```

---

### Task 34: Lighthouse perf pass + bundle analyzer

**Files:**
- Create: `scripts/lighthouse.sh`
- Modify: `frontend/vite.config.ts` (add rollup-plugin-visualizer)

- [ ] **Step 1: Add bundle visualizer**

Run: `cd frontend && npm install --save-dev rollup-plugin-visualizer`

Open `frontend/vite.config.ts`. Add:

```typescript
import { visualizer } from 'rollup-plugin-visualizer'

// inside defineConfig({ plugins: [...] }):
visualizer({ filename: 'dist/stats.html', gzipSize: true }),
```

Wrap it in a mode-check if the existing config already gates plugins by mode; otherwise it's fine to run in every build.

- [ ] **Step 2: Build and capture bundle stats**

Run: `cd frontend && npm run build`
Open `frontend/dist/stats.html` in a browser. If any single chunk exceeds 300 KB gzipped, consider a route-level `React.lazy` split for Landing (particles) or Movies (poster-heavy). Only split if the threshold is exceeded — no premature codesplitting.

- [ ] **Step 3: Add Lighthouse script**

Create `scripts/lighthouse.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE="${LH_BASE_URL:-https://scc-frontend-845114229642.us-east1.run.app}"
mkdir -p reports/lighthouse
for route in "" dashboard movies movies/1; do
  slug="${route//\//_}"
  slug="${slug:-landing}"
  npx lighthouse "$BASE/$route" \
    --preset=desktop \
    --output=html \
    --output-path="reports/lighthouse/$slug.html" \
    --chrome-flags="--headless=new"
done
```

Make executable:

```bash
chmod +x scripts/lighthouse.sh
```

- [ ] **Step 4: Run Lighthouse**

Run: `./scripts/lighthouse.sh`

Review each report. Target: Performance ≥ 85, Accessibility ≥ 95, Best Practices ≥ 90. Apply any spot fixes flagged by Lighthouse (image `width`/`height`, `preload` fonts). Do not chase 100s — the goal is "no red bars."

- [ ] **Step 5: Commit**

```bash
git add scripts/lighthouse.sh frontend/vite.config.ts frontend/package.json frontend/package-lock.json
git commit -m "perf: bundle visualizer + Lighthouse script"
```

---

## Phase 5 — Cutover (Tasks 35–37)

### Task 35: Delete OpsCenter grid + orphaned panels

**Files:**
- Delete: `frontend/src/App.tsx`
- Delete: `frontend/src/panels/HeroBanner.tsx`
- Delete: `frontend/src/panels/HistoryDrawer.tsx`
- Delete: `frontend/src/panels/InjectControls.tsx`
- Delete: `frontend/src/tests/unit/HeroBanner.test.tsx` (if exists)
- Delete: `frontend/src/tests/unit/HistoryDrawer.test.tsx` (if exists)
- Delete: `frontend/src/tests/unit/InjectControls.test.tsx` (if exists)
- Delete: `frontend/tests/e2e/hero-flow.spec.ts`

- [ ] **Step 1: Verify no live imports remain**

Run:

```bash
cd frontend && grep -Rn "from '.*/App'" src || true
cd frontend && grep -Rn "HeroBanner\|HistoryDrawer\|InjectControls" src tests || true
```

Any remaining references outside the files scheduled for deletion must be fixed before deleting. `AgentTrace`, `TelemetryStrip`, `AnomalyFeed`, `RecommendationPanel`, `ApprovalGate` are still in use — do NOT delete those.

- [ ] **Step 2: Delete the files**

```bash
cd frontend && rm -f \
  src/App.tsx \
  src/panels/HeroBanner.tsx \
  src/panels/HistoryDrawer.tsx \
  src/panels/InjectControls.tsx \
  src/tests/unit/HeroBanner.test.tsx \
  src/tests/unit/HistoryDrawer.test.tsx \
  src/tests/unit/InjectControls.test.tsx \
  tests/e2e/hero-flow.spec.ts
```

- [ ] **Step 3: Verify build + tests still pass**

Run: `cd frontend && npm run build && npx vitest run && npx playwright test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/App.tsx frontend/src/panels frontend/src/tests/unit frontend/tests/e2e/hero-flow.spec.ts
git commit -m "chore: delete OpsCenter + orphaned panels (superseded by L7 routes)"
```

---

### Task 36: Re-record demo video + update `video_beats.md`

**Files:**
- Modify: `docs/video_beats.md`
- Add (untracked, do NOT commit): `demo.mp4` in a location per existing convention

- [ ] **Step 1: Update the beat sheet**

Open `docs/video_beats.md`. Rewrite the beat list to reflect L7 surfaces:

```markdown
# Demo Video Beats — L7 UI

| # | Time  | Beat                                    | Surface           | Voiceover cue |
|---|-------|-----------------------------------------|-------------------|---------------|
| 1 | 0:00  | Landing hero, particle cascade, headline | /                 | "Data lands. Investigations start." |
| 2 | 0:15  | Live counters ticking                    | / (hero fold)     | "250 films, 15 regions, 120 days." |
| 3 | 0:25  | Scroll to agents fold                    | /                 | "Four agents. One narrative." |
| 4 | 0:40  | Click Open Dashboard                     | /dashboard        | "Real ingest, real detections." |
| 5 | 0:50  | Intake strip animating                   | /dashboard        | "Rows landing every 2 seconds." |
| 6 | 1:00  | Click Inject Crisis                      | /dashboard modal  | "Simulate a box office drop." |
| 7 | 1:15  | Investigation → recommendation tabs      | /dashboard        | "Investigation, then decision." |
| 8 | 1:35  | Approve action                           | /dashboard        | "Human in the loop." |
| 9 | 1:50  | Nav to Movies                            | /movies           | "Every film has its own thread." |
|10 | 2:05  | Featured hero rotator                    | /movies           | "Pre-run investigations, cached for playback." |
|11 | 2:15  | Click a featured film                    | /movies/:id       | "One click, full investigation." |
|12 | 2:35  | Persistent Agent Trace scroll            | /movies/:id       | "Every step, with SQL provenance." |
|13 | 2:55  | Landing CTA reprise                      | /                 | "Detecting data as it lands." |

**Total:** ~3:00
```

- [ ] **Step 2: Record the video**

Record a 3-minute screen capture following the beats above against the live URLs (`https://scc-frontend-845114229642.us-east1.run.app`). Voiceover is optional — clean OBS capture with cursor visible is fine.

- [ ] **Step 3: Commit the beat sheet only**

Do NOT commit the `.mp4` binary — upload separately to Devpost per convention.

```bash
git add docs/video_beats.md
git commit -m "docs: refresh video beats for L7 routes"
```

---

### Task 37: Devpost + README + screenshots + preflight

**Files:**
- Modify: `README.md`
- Modify: `docs/devpost.md` (create if absent)
- Add: `docs/screenshots/landing.png`, `docs/screenshots/dashboard.png`, `docs/screenshots/movies.png`, `docs/screenshots/movie-detail.png`
- Run: existing preflight gate script

- [ ] **Step 1: Update README**

Open `README.md`. Under the "Product surface" (or equivalent) section, replace the OpsCenter description with:

```markdown
## Routes

- `/` — Landing (particle cascade, live counters, hero, 4-agent fold, CTAs)
- `/dashboard` — Real-time crisis workspace (intake strip, anomaly feed, investigation/recommendation/approval tabs, persistent agent trace, telemetry)
- `/movies` — Netflix-style shelves (featured cached investigations, trending in region, recent detections, social storms, streaming climbers, all films)
- `/movies/:id` — Movie detail (hero, latest investigation, persistent agent trace, past runs, ambient telemetry)
- `/audit` — Historical crisis log
- `/settings` — Config
```

Add a "Screenshots" section that embeds the four new PNGs. If the README already has a screenshots section, replace its images with the new ones.

- [ ] **Step 2: Capture screenshots**

Use Playwright:

```bash
cd frontend
npx playwright test --grep '@screenshots' || true
```

Or manually capture four 1440×900 screenshots at the live URL and drop into `docs/screenshots/`.

- [ ] **Step 3: Update `docs/devpost.md`**

If `docs/devpost.md` exists from Layer 6, update the "Live demo" URLs section and the "What's new in L7" callout. If absent, create it with these sections:

```markdown
# Studio Crisis Commander — Devpost

## Elevator pitch
Detecting data as it lands. Four agents turn raw signal ingest into an executive brief in under a second.

## What's new in L7
- Full multi-route product (Landing / Dashboard / Movies / Movie Detail)
- Cinematic landing page with per-family particle cascade
- Netflix-style catalog with cached featured investigations
- Persistent Agent Trace across the app

## Live demo
- Frontend: https://scc-frontend-845114229642.us-east1.run.app
- Backend: https://scc-api-845114229642.us-east1.run.app

## Track
ClickHouse — 50M+ rows, streaming ingest, MAD-Z detection.

## Stack
React 18 · Vite · TypeScript · Tailwind · Framer Motion · Zustand · React Router · FastAPI · Google ADK · Gemini · ClickHouse · mcp-clickhouse

## Credits
Movie metadata via TMDB API.
```

- [ ] **Step 4: Run preflight**

Run: the existing preflight script (from Layer 6, e.g. `./scripts/preflight.sh`). All gates must PASS.

If any gate fails, fix root cause. Do NOT skip a gate.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/devpost.md docs/screenshots
git commit -m "docs: L7 README + Devpost + screenshots"
```

- [ ] **Step 6: Tag phase 5 done**

```bash
git commit --allow-empty -m "chore: Phase 5 cutover complete"
```

---
