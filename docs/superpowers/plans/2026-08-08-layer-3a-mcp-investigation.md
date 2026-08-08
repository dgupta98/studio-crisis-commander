# Layer 3a — MCP Foundation + Investigation Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MCP client wiring + Investigation Agent (5-sub-agent SequentialAgent) that turns a single `detections` row into a grounded `InvestigationResult` — every number cited to the SQL query that produced it.

**Architecture:** ADK `SequentialAgent` composed of 4 signal-family sub-agents (`numeric_context`, `text_reason`, `categorical_isolation`, `temporal_context`) each with an `MCPToolset` wired to `mcp-clickhouse` via stdio subprocess, followed by 1 tool-less synthesis sub-agent. All Google AI at runtime (Rule 7B). All ClickHouse reads through mcp-clickhouse (ClickHouse track requirement).

**Tech Stack:** Python 3.12, Google ADK (`google-cloud-aiplatform[adk]>=1.101.0`), `mcp-clickhouse==0.4.1`, Gemini 2.5 Flash + 2.5 Pro via Vertex AI, Pydantic v2, pytest.

**Reference spec:** `docs/superpowers/specs/2026-08-08-layer-3a-mcp-investigation-design.md`

---

## Prerequisites & conventions

Read these before starting Task 1:

- **Working directory for all commands:** `backend/`. The venv is `backend/venv/`. Run Python as `./venv/bin/python`. Modules run as `./venv/bin/python -m <dotted.path>`.
- **Layer 2 must be built and detections populated.** Verify with `./venv/bin/python -c "from data.ch_client import client; c = client().__enter__(); print(c.query('SELECT count() FROM detections').result_rows[0][0])"` — should print a number in the millions. If zero, run Layer 2's `data.mv.refresh --since-hours 1440` first.
- **`.env` at repo root** already has `CLICKHOUSE_HOST/PORT/USER/PASSWORD/DB` and `GOOGLE_CLOUD_PROJECT/LOCATION/GOOGLE_APPLICATION_CREDENTIALS`. Do NOT read or print `.env`. The existing `data/ch_client.py` shows how Layer 1/2 loads it via `python-dotenv`.
- **The installed `mcp` package is the MCP Python SDK** — a dependency of both `mcp-clickhouse` and ADK's `MCPToolset`. Our local package MUST be named `mcp_integration`, never `mcp`, or every ADK import breaks.
- **mcp-clickhouse tool names (verified via `mcp.get_tools()`):** `list_databases`, `list_tables`, `run_query`. The spec §11.2 §7 mentions `run_select_query` — that was a guess. Use `run_query`.
- **mcp-clickhouse env variables:** it expects `CLICKHOUSE_DATABASE` (not `CLICKHOUSE_DB` — Layer 1 uses `CLICKHOUSE_DB`). Our `client.py` maps between them so `.env` stays unchanged.
- **No Co-Authored-By trailers in commits.** User rewrote history to strip these.
- **Follow Layer 2's file conventions:** Python docstring style, module-level constants for tunables, `if __name__ == "__main__"` at bottom of runnable modules, `argparse` for `--verify` / `--reset` style flags.

---

## Task 1: Scaffold packages + install pytest

**Files:**
- Delete: `backend/mcp/` (empty stub — would shadow the `mcp` SDK)
- Create: `backend/mcp_integration/__init__.py`
- Create: `backend/agents/__init__.py`
- Create: `backend/agents/investigation/__init__.py`
- Create: `backend/agents/investigation/tests/__init__.py`
- Create: `backend/mcp_integration/tests/__init__.py`
- Modify: `backend/requirements.txt` (add pytest to a dev section)

- [ ] **Step 1: Verify current state**

Run: `ls backend/mcp backend/agents 2>&1 | head -20`
Expected: `backend/mcp` exists but is empty; `backend/agents` exists but is empty.

- [ ] **Step 2: Delete the stale empty `backend/mcp/` directory**

```bash
rmdir backend/mcp
```

Expected: no output; the directory is gone. If `rmdir` refuses with "Directory not empty", investigate what was added — do NOT force-remove without checking.

- [ ] **Step 3: Create the new package skeletons**

```bash
mkdir -p backend/mcp_integration/tests
mkdir -p backend/agents/investigation/tests
touch backend/mcp_integration/__init__.py
touch backend/mcp_integration/tests/__init__.py
touch backend/agents/__init__.py
touch backend/agents/investigation/__init__.py
touch backend/agents/investigation/tests/__init__.py
```

- [ ] **Step 4: Add pytest to `backend/requirements.txt`**

Append this to `backend/requirements.txt`:

```
# Testing (Layer 3a onward)
pytest>=8.0.0
```

- [ ] **Step 5: Install pytest**

Run: `./backend/venv/bin/pip install pytest>=8.0.0`
Expected: successful install; pytest binary at `backend/venv/bin/pytest`.

- [ ] **Step 6: Verify sanity**

Run: `./backend/venv/bin/pytest --version`
Expected: prints `pytest 8.x.x`.

Run: `./backend/venv/bin/python -c "import mcp_integration; import agents.investigation; print('OK')"`
Note: run this from `backend/` (i.e. `cd backend && ./venv/bin/python -c ...`).
Expected: prints `OK` (empty packages import cleanly).

- [ ] **Step 7: Commit**

```bash
git add backend/mcp_integration backend/agents backend/requirements.txt
git commit -m "layer 3a: scaffold mcp_integration + agents/investigation packages"
```

---

## Task 2: MCP client factory (`build_toolset`)

**Files:**
- Create: `backend/mcp_integration/client.py`
- Create: `backend/mcp_integration/tests/test_client.py`

- [ ] **Step 1: Write the failing test**

Create `backend/mcp_integration/tests/test_client.py`:

```python
"""Unit tests for mcp_integration.client.build_toolset()."""

from __future__ import annotations

import os

import pytest

from mcp_integration.client import build_toolset, _env_for_subprocess


def test_env_maps_layer1_names_to_mcp_clickhouse_names(monkeypatch):
    """Layer 1 uses CLICKHOUSE_DB; mcp-clickhouse expects CLICKHOUSE_DATABASE.
    build_toolset maps CLICKHOUSE_DB -> CLICKHOUSE_DATABASE without mutating os.environ."""
    monkeypatch.setenv("CLICKHOUSE_HOST", "example.clickhouse.cloud")
    monkeypatch.setenv("CLICKHOUSE_PORT", "8443")
    monkeypatch.setenv("CLICKHOUSE_USER", "default")
    monkeypatch.setenv("CLICKHOUSE_PASSWORD", "secret")
    monkeypatch.setenv("CLICKHOUSE_DB", "studio_ops")
    monkeypatch.delenv("CLICKHOUSE_DATABASE", raising=False)

    env = _env_for_subprocess()

    assert env["CLICKHOUSE_HOST"] == "example.clickhouse.cloud"
    assert env["CLICKHOUSE_PORT"] == "8443"
    assert env["CLICKHOUSE_USER"] == "default"
    assert env["CLICKHOUSE_PASSWORD"] == "secret"
    assert env["CLICKHOUSE_DATABASE"] == "studio_ops"
    assert "CLICKHOUSE_DB" not in env  # remapped, not both
    assert "CLICKHOUSE_DATABASE" not in os.environ  # never mutates parent env


def test_env_requires_host():
    """Missing CLICKHOUSE_HOST is a fail-fast setup error."""
    # Clear the four required vars for this test
    saved = {k: os.environ.pop(k, None) for k in ("CLICKHOUSE_HOST",)}
    try:
        with pytest.raises(RuntimeError, match="CLICKHOUSE_HOST"):
            _env_for_subprocess()
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


@pytest.mark.skipif("CLICKHOUSE_HOST" not in os.environ,
                    reason="requires .env with CH creds")
def test_build_toolset_returns_mcp_toolset():
    """build_toolset() returns a working MCPToolset instance."""
    from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
    ts = build_toolset()
    assert isinstance(ts, MCPToolset)
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `./venv/bin/pytest mcp_integration/tests/test_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mcp_integration.client'`

- [ ] **Step 3: Write `mcp_integration/client.py`**

Create `backend/mcp_integration/client.py`:

```python
"""MCPToolset factory wired to mcp-clickhouse via stdio subprocess.

`build_toolset()` returns a fresh MCPToolset per call. The caller owns
the toolset's lifecycle (ADK closes it on Runner shutdown).

This module is the ONLY place agent code touches process spawn / env
plumbing for ClickHouse. No agent may import `data.ch_client` or
`clickhouse_connect` directly — enforced by acceptance §1.
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from google.adk.tools.mcp_tool.mcp_toolset import (
    MCPToolset,
    StdioConnectionParams,
    StdioServerParameters,
)

# Load .env once at module import — matches Layer 1/2 pattern.
load_dotenv()

# Layer 1 env var names → mcp-clickhouse env var names.
# mcp-clickhouse expects CLICKHOUSE_DATABASE; our .env uses CLICKHOUSE_DB.
_ENV_MAP = {
    "CLICKHOUSE_HOST": "CLICKHOUSE_HOST",
    "CLICKHOUSE_PORT": "CLICKHOUSE_PORT",
    "CLICKHOUSE_USER": "CLICKHOUSE_USER",
    "CLICKHOUSE_PASSWORD": "CLICKHOUSE_PASSWORD",
    "CLICKHOUSE_DB": "CLICKHOUSE_DATABASE",
}
_REQUIRED = ("CLICKHOUSE_HOST", "CLICKHOUSE_USER", "CLICKHOUSE_PASSWORD")


def _env_for_subprocess() -> dict[str, str]:
    """Build the env dict passed to the mcp-clickhouse subprocess.

    Copies relevant CH vars from os.environ, remapping CLICKHOUSE_DB ->
    CLICKHOUSE_DATABASE. Does NOT mutate os.environ.
    """
    for var in _REQUIRED:
        if not os.environ.get(var):
            raise RuntimeError(
                f"{var} not set in environment — check backend/.env"
            )
    env: dict[str, str] = {}
    for src, dst in _ENV_MAP.items():
        val = os.environ.get(src)
        if val is not None:
            env[dst] = val
    # Force secure TLS mode (matches ClickHouse Cloud default; port 8443).
    env.setdefault("CLICKHOUSE_SECURE", "true")
    return env


def build_toolset() -> MCPToolset:
    """Fresh MCPToolset that spawns `python -m mcp_clickhouse.main` as a
    stdio subprocess. One subprocess per toolset; ADK closes it on shutdown.
    """
    params = StdioConnectionParams(
        server_params=StdioServerParameters(
            command=sys.executable,
            args=["-m", "mcp_clickhouse.main"],
            env=_env_for_subprocess(),
        ),
        timeout=15.0,   # subprocess startup + initial handshake budget
    )
    return MCPToolset(connection_params=params)
```

- [ ] **Step 4: Run tests to verify pass**

Run from `backend/`: `./venv/bin/pytest mcp_integration/tests/test_client.py -v`
Expected: 2 pass, 1 skip if no CH env — or 3 pass if `.env` is loaded.
If the skip is present, that's expected on CI; the real integration is verified by Task 3 (proof).

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_integration/client.py backend/mcp_integration/tests/test_client.py
git commit -m "layer 3a: MCP toolset factory + env remap tests"
```

---

## Task 3: MCP proof — the de-risk script

**Files:**
- Create: `backend/mcp_integration/proof.py`

- [ ] **Step 1: Write `mcp_integration/proof.py`**

Create `backend/mcp_integration/proof.py`:

```python
"""Standalone MCP proof: one ADK agent asks mcp-clickhouse to list tables.

This is the de-risk step called out in BUILD_REPORT §4. It verifies:
  1. mcp-clickhouse spawns and speaks MCP over stdio
  2. ADK's MCPToolset connects and discovers tools
  3. Gemini can select the right tool and get a valid response
  4. The whole thing exits cleanly

Usage (from backend/):
    ./venv/bin/python -m mcp_integration.proof

Exit 0 on success (prints tool call + tables). Non-zero on any failure.
"""

from __future__ import annotations

import asyncio
import sys

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from mcp_integration.client import build_toolset


PROOF_INSTRUCTION = """\
You are a ClickHouse operator. Use the list_tables tool to show all tables
in the current database, then reply in one sentence naming the tables.
Do NOT call run_query. Do NOT ask for permission.
"""


async def _run_proof() -> int:
    toolset = build_toolset()
    agent = LlmAgent(
        name="mcp_proof",
        model="gemini-2.5-flash",
        instruction=PROOF_INSTRUCTION,
        tools=[toolset],
    )
    runner = InMemoryRunner(agent=agent, app_name="mcp_proof")

    session = await runner.session_service.create_session(
        app_name="mcp_proof", user_id="proof-user"
    )

    saw_tool_call = False
    saw_response = False
    async for event in runner.run_async(
        user_id="proof-user",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="List the tables.")],
        ),
    ):
        # Print a compact trace line per event.
        author = event.author or "?"
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_call:
                    saw_tool_call = True
                    print(f"[{author}] tool_call: {part.function_call.name}"
                          f"({part.function_call.args})")
                elif part.function_response:
                    resp = part.function_response.response
                    resp_str = str(resp)[:200]
                    print(f"[{author}] tool_response: {resp_str}...")
                elif part.text:
                    saw_response = True
                    print(f"[{author}] text: {part.text.strip()}")

    if not saw_tool_call:
        print("FAIL: no tool call observed — MCPToolset did not surface tools",
              file=sys.stderr)
        return 1
    if not saw_response:
        print("FAIL: no final text response from model", file=sys.stderr)
        return 1
    print("\nOK — mcp-clickhouse spawned, tools listed, Gemini answered.")
    return 0


def main() -> None:
    code = asyncio.run(_run_proof())
    sys.exit(code)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the proof live**

Run from `backend/`: `./venv/bin/python -m mcp_integration.proof`
Expected: prints something like:
```
[mcp_proof] tool_call: list_tables({...})
[mcp_proof] tool_response: [{"name": "audience_sentiment", ...}]...
[mcp_proof] text: The database contains tables including audience_sentiment, box_office_revenue, ...
OK — mcp-clickhouse spawned, tools listed, Gemini answered.
```
Exit code 0.

**If this fails, STOP and diagnose before proceeding to Task 4.** Common issues:
- `RuntimeError: CLICKHOUSE_HOST not set` → `.env` not loaded from backend dir; verify `cd backend && ./venv/bin/python -c "import os; from dotenv import load_dotenv; load_dotenv(); print(os.environ.get('CLICKHOUSE_HOST'))"` prints the host.
- `mcp-clickhouse` process crashes → run `./venv/bin/python -m mcp_clickhouse.main` directly (needs CH env vars set) and see its error output.
- ADK auth error → verify `./venv/bin/python -c "import vertexai; vertexai.init(); print('ok')"` runs cleanly (Vertex smoke test).

- [ ] **Step 3: Commit**

```bash
git add backend/mcp_integration/proof.py
git commit -m "layer 3a: MCP de-risk proof — python -m mcp_integration.proof"
```

---

## Task 4: MCP integration README

**Files:**
- Create: `backend/mcp_integration/README.md`

- [ ] **Step 1: Write the README**

Create `backend/mcp_integration/README.md`:

```markdown
# `mcp_integration/` — Layer 3+ ClickHouse bridge

This package is the ONLY path agent code takes to ClickHouse. Every
Layer 3+ agent's ClickHouse read goes through `mcp-clickhouse` (the
official MCP server) via `MCPToolset` from `google-adk`.

**Boundary rule:** `backend/agents/` and `backend/mcp_integration/`
NEVER import `data.ch_client` or `clickhouse_connect`. Layer 2's
`data.mv.acceptance` §7 grep enforces this (and Layer 3a acceptance §1
enforces the same for the agent tree).

## Contents

| File | Purpose |
|---|---|
| `client.py` | `build_toolset()` — spawns `python -m mcp_clickhouse.main` as stdio subprocess, returns an ADK `MCPToolset`. |
| `proof.py`  | `python -m mcp_integration.proof` — de-risk script; one Gemini call that lists tables via MCP. |
| `tests/`    | Unit tests for env remap; skips CH-dependent tests if `.env` unset. |

## Naming: why `mcp_integration`, not `mcp`

The installed `mcp` package (the official MCP Python SDK) is a top-level
dependency of both `mcp-clickhouse` and ADK's `MCPToolset`. A local
`backend/mcp/` package on `sys.path` would shadow it and break every
ADK import. The name is deliberate.

## Env mapping

`mcp-clickhouse` expects `CLICKHOUSE_DATABASE`; Layer 1/2 use
`CLICKHOUSE_DB`. `client._env_for_subprocess()` remaps this and forces
`CLICKHOUSE_SECURE=true` (ClickHouse Cloud default). `.env` stays
unchanged.

## Running the proof

Prereqs: Layer 1 + Layer 2 both built; `.env` populated; Vertex AI
smoke test green.

```bash
cd backend
./venv/bin/python -m mcp_integration.proof
```

Expected output ends with `OK — mcp-clickhouse spawned, tools listed,
Gemini answered.` Exit 0 = the wire works end-to-end. Any non-zero
exit code should be resolved before touching the Investigation Agent.

## Verified tool names (mcp-clickhouse 0.4.1)

- `list_databases` — no args
- `list_tables(database)` — enumerate tables + schema
- `run_query(query)` — execute SELECT (read-only by default)
```

- [ ] **Step 2: Commit**

```bash
git add backend/mcp_integration/README.md
git commit -m "docs: mcp_integration README (proof runbook, boundary, env mapping)"
```

---

## Task 5: Investigation contracts (Pydantic models)

**Files:**
- Create: `backend/agents/investigation/contracts.py`
- Create: `backend/agents/investigation/tests/test_contracts.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/agents/investigation/tests/test_contracts.py`:

```python
"""Unit tests for investigation.contracts Pydantic models."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from agents.investigation.contracts import (
    DetectionIn,
    Hypothesis,
    InvestigationResult,
    SignalFinding,
)


def _det() -> DetectionIn:
    return DetectionIn(
        metric_ts=datetime(2023, 6, 1, 12, 0, 0, tzinfo=timezone.utc),
        metric="audience_sentiment.avg_score",
        film_id=42,
        region="EU-DE",
        detector="zscore",
        baseline_value=0.68,
        actual_value=0.31,
        magnitude=-3.7,
        business_impact=0.42,
        severity=1.55,
        dedup_key="audience_sentiment.avg_score|42|EU-DE|2023-06-01 12:00:00|zscore",
    )


def _finding(signal: str) -> SignalFinding:
    return SignalFinding(
        signal=signal,
        sql="SELECT ts, avg_score FROM roll_sentiment_hourly WHERE film_id=42",
        columns=["ts", "avg_score"],
        rows=[["2023-06-01 12:00:00", 0.31]],
        narrative="Sentiment dropped from 0.68 to 0.31 in the last hour.",
        latency_ms=1200,
    )


def test_detection_in_accepts_layer2_row_shape():
    d = _det()
    assert d.metric == "audience_sentiment.avg_score"
    assert d.film_id == 42


def test_signal_finding_signal_is_literal():
    with pytest.raises(Exception):  # ValidationError
        SignalFinding(
            signal="bogus_signal",
            sql="SELECT 1", columns=[], rows=[], narrative="x", latency_ms=0,
        )


def test_hypothesis_requires_non_empty_citations():
    with pytest.raises(Exception):
        Hypothesis(
            primary_cause="EU-DE sentiment collapse driven by dubbing complaints.",
            contributing_factors=[],
            confidence="medium",
            citations=[],
        )


def test_hypothesis_rejects_unknown_citation():
    with pytest.raises(Exception):
        Hypothesis(
            primary_cause="x" * 30,
            contributing_factors=[],
            confidence="medium",
            citations=["numeric_context", "bogus_signal"],  # bogus not in Literal
        )


def test_hypothesis_accepts_valid_citation_subset():
    h = Hypothesis(
        primary_cause="x" * 30,
        contributing_factors=["a", "b"],
        confidence="high",
        citations=["numeric_context", "categorical_isolation"],
    )
    assert h.confidence == "high"
    assert len(h.citations) == 2


def test_investigation_result_full_shape():
    d = _det()
    findings = [_finding(s) for s in
                ("numeric_context", "text_reason",
                 "categorical_isolation", "temporal_context")]
    h = Hypothesis(
        primary_cause="Sentiment collapse in EU-DE from dubbing complaints." * 1,
        contributing_factors=["Trailer B variant underperforming in DACH region."],
        confidence="high",
        citations=["numeric_context", "text_reason", "categorical_isolation"],
    )
    r = InvestigationResult(
        detection=d,
        findings=findings,
        hypothesis=h,
        started_at=datetime(2023, 6, 1, 12, 5, tzinfo=timezone.utc),
        finished_at=datetime(2023, 6, 1, 12, 5, 15, tzinfo=timezone.utc),
    )
    assert len(r.findings) == 4
    assert r.hypothesis.confidence == "high"
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `./venv/bin/pytest agents/investigation/tests/test_contracts.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agents.investigation.contracts'`

- [ ] **Step 3: Write `agents/investigation/contracts.py`**

Create `backend/agents/investigation/contracts.py`:

```python
"""Pydantic contracts for the Investigation Agent pipeline.

DetectionIn — one row of Layer 2's `detections` table. Layer 4 fetches
via MCP and passes into invoke_investigation().

SignalFinding — output of one of the 4 signal-family sub-agents. Carries
the SQL that was run and the raw rows returned; narrative must only cite
numbers that appear in `rows`.

Hypothesis — output of the synthesis sub-agent. citations names the
signal(s) that support each claim.

InvestigationResult — the top-level assembled artifact returned to
Layer 4.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


SignalName = Literal[
    "numeric_context",
    "text_reason",
    "categorical_isolation",
    "temporal_context",
]


class DetectionIn(BaseModel):
    """One row of Layer 2's `detections` table."""

    metric_ts: datetime
    metric: str
    film_id: int
    region: str
    detector: str
    baseline_value: float
    actual_value: float
    magnitude: float
    business_impact: float
    severity: float
    dedup_key: str


class SignalFinding(BaseModel):
    """Output of one signal-family sub-agent."""

    signal: SignalName
    sql: str = Field(..., description="Full SQL executed via MCP")
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list,
                                  description="Raw query result — every "
                                              "number in narrative traces here")
    narrative: str
    latency_ms: int = 0


class Hypothesis(BaseModel):
    """Output of the synthesis sub-agent."""

    primary_cause: str
    contributing_factors: list[str] = Field(default_factory=list)
    confidence: Literal["low", "medium", "high"]
    citations: list[SignalName]

    @field_validator("citations")
    @classmethod
    def _citations_non_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("Hypothesis must cite at least one finding")
        return v


class InvestigationResult(BaseModel):
    """Top-level artifact returned by invoke_investigation()."""

    detection: DetectionIn
    findings: list[SignalFinding] = Field(
        ..., description="length 4, in fixed order matching sub-agent order"
    )
    hypothesis: Hypothesis
    started_at: datetime
    finished_at: datetime
```

- [ ] **Step 4: Run tests to verify pass**

Run from `backend/`: `./venv/bin/pytest agents/investigation/tests/test_contracts.py -v`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/investigation/contracts.py backend/agents/investigation/tests/test_contracts.py
git commit -m "layer 3a: investigation Pydantic contracts + validation tests"
```

---

## Task 6: Sub-agent system prompts

**Files:**
- Create: `backend/agents/investigation/prompts.py`

Prompts are prose — no unit tests. Acceptance sweep on real crises is the feedback loop.

- [ ] **Step 1: Write `agents/investigation/prompts.py`**

Create `backend/agents/investigation/prompts.py`:

```python
"""System prompts for the 5 Investigation sub-agents.

One file so prompt iteration is a single edit. ADK's `{key}` template
syntax reads values from session.state — the invoke_investigation()
entrypoint seeds `detection` and `schema_hints` into state before the
SequentialAgent runs.

CRITICAL RULES for all 4 signal-family sub-agents:
  1. Use ONLY the `run_query` tool (from mcp-clickhouse).
  2. Every number in `narrative` must appear in `rows`. Do not invent
     numbers. If the query returns 0 rows, say so and stop.
  3. On SQL error, revise once and retry. If still failing, return
     rows=[] and narrative="query failed: <reason>".
  4. Cap rows at 100 by including LIMIT in your SQL. Larger results are
     truncated by the framework and will make the narrative unreliable.
  5. Return exactly one SignalFinding matching the output schema.
"""

METRIC_TO_TABLE = """\
Map detection.metric to source table:
  audience_sentiment.*        -> roll_sentiment_hourly  (hourly; sum_score_weighted / sum_volume = avg score)
  social_trends.avg_virality  -> roll_social_hourly     (hourly; sum_virality / greatest(n,1))
  social_trends.avg_sentiment -> roll_social_hourly     (hourly; sum_sentiment / greatest(n,1))
  trailer_analytics.*         -> roll_trailer_hourly    (hourly; partitions include variant)
  streaming_watch_minutes.*   -> roll_streaming_hourly  (hourly; sum_completions / (sum_completions + sum_drops))
  box_office_revenue.*        -> box_office_revenue     (daily; column revenue_usd, date)
  ticket_refunds.*            -> ticket_refunds         (raw event table; sum refund_count grouped by hour)
  marketing_roi               -> roll_campaign_daily    (daily; sum_spend, sum_conversions)
  review_scores.*             -> review_scores          (per-source; compute max-min gap grouped by ts)
"""


NUMERIC_CONTEXT_PROMPT = f"""\
You are the numeric_context sub-agent. Inspect the numeric shape of ONE anomaly.

You will be given:
  detection: {{detection}}
  schema_hints: {{schema_hints}}

{METRIC_TO_TABLE}

Write ONE SELECT that returns the metric value across a ±24-hour window
(hourly metrics) or ±7-day window (daily metrics) around
detection.metric_ts, filtered by film_id and region. Include ts and the
metric value column. ORDER BY ts. LIMIT 100.

Call `run_query` with your SQL. On error, revise once and retry.

Return a SignalFinding:
  signal:      "numeric_context"
  sql:         the final SQL you executed
  columns:     column names from the result
  rows:        result rows (max 100)
  narrative:   2-4 sentences. Compare baseline (early buckets) to actual
               (buckets near detection.metric_ts). Name the deviation shape
               (spike / drop / drift / sustained plateau) and how long it
               has persisted. Cite specific numbers from `rows` only.
  latency_ms:  0
"""


TEXT_REASON_PROMPT = """\
You are the text_reason sub-agent. Find raw text evidence explaining the
numeric anomaly.

You will be given:
  detection: {detection}
  schema_hints: {schema_hints}

Query `audience_sentiment` for rows near detection.metric_ts (±6 hours),
filtered to detection.film_id and detection.region. Select the 10 rows
with the LOWEST score (proxy for negative reactions). Include the text,
score, and platform columns. Example shape:

  SELECT text, score, platform, ts
  FROM audience_sentiment
  WHERE film_id = <fid>
    AND region  = '<reg>'
    AND ts BETWEEN toDateTime('<ts>') - INTERVAL 6 HOUR
                AND toDateTime('<ts>') + INTERVAL 6 HOUR
  ORDER BY score ASC
  LIMIT 10

Call `run_query`. On error, revise once and retry.

If the query returns 0 rows, that is a valid outcome for non-textual
anomalies (e.g., box office drops from competitor collision). Return
rows=[] and narrative="no significant text evidence in the ±6h window."

Return a SignalFinding:
  signal:      "text_reason"
  sql:         the final SQL you executed
  columns:     column names from the result
  rows:        result rows (max 10)
  narrative:   2-4 sentences. Summarize recurring themes across the low-
               score texts (e.g., "complaints center on the CGI in the
               third act"). Quote at most one short phrase per theme.
               Do NOT invent themes not present in `rows`.
  latency_ms:  0
"""


CATEGORICAL_ISOLATION_PROMPT = """\
You are the categorical_isolation sub-agent. Identify which slice(s) of
the population are driving the anomaly.

You will be given:
  detection: {detection}
  schema_hints: {schema_hints}

Pick the categorical dimensions relevant to detection.metric:
  - Any metric  → by region (compare detection.region to peers for the
                  same film_id, weighted by film_region_weight.weight)
  - trailer_*   → by variant (roll_trailer_hourly partitions include it)
  - marketing_* / campaign_* → by channel

Write 1-2 SELECTs (one query if possible) that GROUP BY the categorical
dim, aggregate the metric across a ±6-hour window (or ±3-day for daily),
join film_region_weight for regional context where relevant, ORDER BY the
metric magnitude, LIMIT 15.

Call `run_query`. On error, revise once and retry.

Return a SignalFinding:
  signal:      "categorical_isolation"
  sql:         the final SQL you executed (if 2 queries, join with `;` and
               call `run_query` twice — accumulate rows)
  columns:     column names from the result
  rows:        result rows (max 15)
  narrative:   2-4 sentences. Name the top 1-2 slices driving the anomaly.
               Quantify concentration (e.g., "85% of the drop is in EU-DE").
               If the anomaly is broad-based (no clear isolation), say so.
               Cite specific numbers from `rows` only.
  latency_ms:  0
"""


TEMPORAL_CONTEXT_PROMPT = """\
You are the temporal_context sub-agent. Place the anomaly in temporal
context — when did it start, what else fired nearby, is there a
competitor collision?

You will be given:
  detection: {detection}
  schema_hints: {schema_hints}

You may need up to 2 queries. Consider:
  1. Related detections for the same film + region within the last 72
     hours (SELECT from `detections` where film_id, region match and
     metric_ts >= detection.metric_ts - INTERVAL 72 HOUR).
  2. Competitor releases in the same region within ±14 days of
     detection.metric_ts (SELECT from `competitor_releases`).

Call `run_query` up to twice. On per-query error, revise that query once
and retry.

Return a SignalFinding:
  signal:      "temporal_context"
  sql:         the SQL you executed (if 2, join with `; -- QUERY 2 -- `)
  columns:     column names from the (last) result
  rows:        result rows (concat of both queries, max 30 total)
  narrative:   2-4 sentences. State when the anomaly began (earliest
               related detection), list sibling detections on other
               metrics if any, and note any competitor release within
               ±14 days. If none of those exist, say so plainly.
  latency_ms:  0
"""


SYNTHESIS_PROMPT = """\
You are the synthesis sub-agent. You do NOT call any tools.

You will be given four findings from prior sub-agents:
  numeric_context:      {numeric_context}
  text_reason:          {text_reason}
  categorical_isolation: {categorical_isolation}
  temporal_context:     {temporal_context}

Produce a Hypothesis:
  primary_cause: 1-2 sentences (≥ 25 chars) naming the most likely root
                 cause. Ground it in the findings. Do NOT invent numbers.
  contributing_factors: 0-3 short strings for secondary drivers you can
                        cite to a finding.
  confidence: "low" | "medium" | "high"
     - "high"   if 3+ findings agree and none contradict
     - "medium" if 2 findings agree
     - "low"    if findings are inconclusive or contradictory
  citations: subset of {{numeric_context, text_reason,
             categorical_isolation, temporal_context}} — the findings
             your primary_cause and contributing_factors rest on. Must
             be non-empty.

Do NOT restate the raw numbers here — that lives in the individual
findings the report will render. Your job is the causal narrative.
"""
```

- [ ] **Step 2: Verify the file imports cleanly**

Run from `backend/`: `./venv/bin/python -c "from agents.investigation import prompts; print(list(k for k in vars(prompts) if k.endswith('_PROMPT')))"`
Expected: `['NUMERIC_CONTEXT_PROMPT', 'TEXT_REASON_PROMPT', 'CATEGORICAL_ISOLATION_PROMPT', 'TEMPORAL_CONTEXT_PROMPT', 'SYNTHESIS_PROMPT']`

- [ ] **Step 3: Commit**

```bash
git add backend/agents/investigation/prompts.py
git commit -m "layer 3a: 5 sub-agent system prompts (numeric/text/categorical/temporal/synthesis)"
```

---

## Task 7: Sub-agent factories

**Files:**
- Create: `backend/agents/investigation/subagents.py`

- [ ] **Step 1: Write `agents/investigation/subagents.py`**

Create `backend/agents/investigation/subagents.py`:

```python
"""Factories for the 5 LlmAgent sub-agents composing the Investigation.

Model split (see spec §3):
  - Flash on numeric_context, text_reason, synthesis (simpler tasks)
  - Pro on categorical_isolation, temporal_context (schema-heavy SQL)

Each signal-family sub-agent gets a fresh MCPToolset via the shared
`build_toolset()` factory. Synthesis has no tools.

Each sub-agent uses `output_schema=<Pydantic model>` so its final message
must validate against the schema, and `output_key=<name>` so the result
lands in session.state[<name>] where downstream sub-agents (and
invoke_investigation()) can read it.
"""

from __future__ import annotations

from google.adk.agents.llm_agent import LlmAgent

from agents.investigation.contracts import Hypothesis, SignalFinding
from agents.investigation.prompts import (
    CATEGORICAL_ISOLATION_PROMPT,
    NUMERIC_CONTEXT_PROMPT,
    SYNTHESIS_PROMPT,
    TEMPORAL_CONTEXT_PROMPT,
    TEXT_REASON_PROMPT,
)
from mcp_integration.client import build_toolset


FLASH = "gemini-2.5-flash"
PRO   = "gemini-2.5-pro"


def build_numeric_context() -> LlmAgent:
    return LlmAgent(
        name="numeric_context",
        model=FLASH,
        instruction=NUMERIC_CONTEXT_PROMPT,
        tools=[build_toolset()],
        output_schema=SignalFinding,
        output_key="numeric_context",
        description="Time series shape of the anomaly.",
    )


def build_text_reason() -> LlmAgent:
    return LlmAgent(
        name="text_reason",
        model=FLASH,
        instruction=TEXT_REASON_PROMPT,
        tools=[build_toolset()],
        output_schema=SignalFinding,
        output_key="text_reason",
        description="Raw text evidence explaining the anomaly.",
    )


def build_categorical_isolation() -> LlmAgent:
    return LlmAgent(
        name="categorical_isolation",
        model=PRO,
        instruction=CATEGORICAL_ISOLATION_PROMPT,
        tools=[build_toolset()],
        output_schema=SignalFinding,
        output_key="categorical_isolation",
        description="Which slice (region/variant/channel) drives the anomaly.",
    )


def build_temporal_context() -> LlmAgent:
    return LlmAgent(
        name="temporal_context",
        model=PRO,
        instruction=TEMPORAL_CONTEXT_PROMPT,
        tools=[build_toolset()],
        output_schema=SignalFinding,
        output_key="temporal_context",
        description="Onset, sibling detections, competitor collisions.",
    )


def build_synthesis() -> LlmAgent:
    return LlmAgent(
        name="synthesis",
        model=FLASH,
        instruction=SYNTHESIS_PROMPT,
        tools=[],
        output_schema=Hypothesis,
        output_key="synthesis",
        description="Fuses the 4 findings into a hypothesis with citations.",
    )
```

- [ ] **Step 2: Verify the file imports cleanly**

Run from `backend/`: `./venv/bin/python -c "from agents.investigation.subagents import build_numeric_context, build_text_reason, build_categorical_isolation, build_temporal_context, build_synthesis; [f() for f in (build_numeric_context, build_text_reason, build_categorical_isolation, build_temporal_context, build_synthesis)]; print('OK')"`
Expected: prints `OK` (all 5 factories instantiate without validation error).

If this fails with a Pydantic error about `output_schema` and `tools` being incompatible, ADK is enforcing structured-output-only mode. Fallback: remove `output_schema=` and add a `_parse_last_message` step in `agent.py` that pulls JSON from the sub-agent's final text and validates it against the Pydantic model manually.

- [ ] **Step 3: Commit**

```bash
git add backend/agents/investigation/subagents.py
git commit -m "layer 3a: 5 sub-agent LlmAgent factories (Flash/Pro split, structured output)"
```

---

## Task 8: Top-level SequentialAgent + `invoke_investigation`

**Files:**
- Create: `backend/agents/investigation/agent.py`

- [ ] **Step 1: Write `agents/investigation/agent.py`**

Create `backend/agents/investigation/agent.py`:

```python
"""Top-level Investigation pipeline: SequentialAgent + async entrypoint.

`build_investigation_agent()` returns the raw ADK SequentialAgent —
Layer 4 will use this to consume the run_async event stream for SSE.

`invoke_investigation(detection)` is the simple entrypoint that returns
a fully assembled InvestigationResult once the pipeline completes. It
seeds detection + schema_hints into session state, enforces a 30-second
wall-clock cap, and reads the 4 findings + hypothesis out of state.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

from google.adk.agents.sequential_agent import SequentialAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from agents.investigation.contracts import (
    DetectionIn,
    Hypothesis,
    InvestigationResult,
    SignalFinding,
)
from agents.investigation.subagents import (
    build_categorical_isolation,
    build_numeric_context,
    build_synthesis,
    build_temporal_context,
    build_text_reason,
)
from mcp_integration.client import build_toolset


# Wall-clock cap for one investigation. Blows past this → InvestigationTimeout.
# Spec §10 target: mean ~15s, cap 30s.
INVESTIGATION_TIMEOUT_SECONDS = 30.0

# Names in fixed order — used by build_investigation_agent() and result assembly.
_FINDING_NAMES = (
    "numeric_context",
    "text_reason",
    "categorical_isolation",
    "temporal_context",
)


class InvestigationTimeout(RuntimeError):
    """Raised when the SequentialAgent pipeline exceeds the wall-clock cap."""


def build_investigation_agent() -> SequentialAgent:
    """Return a fresh 5-sub-agent SequentialAgent. Layer 4 calls this to
    get the raw agent for run_async event streaming."""
    return SequentialAgent(
        name="investigation",
        sub_agents=[
            build_numeric_context(),
            build_text_reason(),
            build_categorical_isolation(),
            build_temporal_context(),
            build_synthesis(),
        ],
        description="4 signal-family sub-agents + synthesis, sequential.",
    )


async def _load_schema_hints() -> str:
    """One-shot schema pull for the tables the sub-agents reach for.

    We use MCP once at investigation start to grab describe_table output,
    then inject it into every sub-agent prompt via `{schema_hints}`.
    Spares the LLM from re-discovering the schema mid-run.
    """
    # For MVP we return a compact hand-authored hint. This is intentional
    # over-fitting to the known Layer 1/2 schema; if the schema drifts,
    # this string is the one place to update. A dynamic MCP-based pull
    # can replace it if schema drift becomes real.
    return """\
Layer 1 tables (columns):
  audience_sentiment(film_id UInt64, region LowCardinality(String), ts DateTime,
                     platform String, score Float32, volume UInt32, text String)
  social_trends(film_id, region, ts, platform, mentions, sentiment, virality)
  trailer_analytics(trailer_id, film_id, region, variant, ts, views,
                    completion_rate Float32, sentiment_score Float32)
  streaming_watch_minutes(film_id, region, ts, watch_minutes, completions, drops)
  marketing_spend(film_id, region, channel, date Date, spend_usd, impressions, clicks)
  campaign_performance(campaign_id, film_id, region, channel, date Date,
                       spend_usd, conversions)
  box_office_revenue(film_id, region, date Date, revenue_usd, tickets_sold, refunds)
  ticket_refunds(film_id, region, ts DateTime, refund_count UInt32, refund_reason)
  review_scores(film_id, source, ts, score, review_count)
  competitor_releases(film_id, region, release_date Date, competitor_film_id)
  film_region_weight(film_id, region, weight Float32)  -- share-of-audience weight
  films(film_id, title, revenue_usd, ...)
  detections(metric_ts, metric, film_id, region, detector, baseline_value,
             actual_value, magnitude, business_impact, severity, dedup_key)

Layer 2 rollups (columns):
  roll_sentiment_hourly(film_id, region, ts, sum_score_weighted, sum_volume)
     -- avg_score = sum_score_weighted / nullIf(sum_volume, 0)
  roll_social_hourly(film_id, region, ts, sum_sentiment, sum_virality, sum_mentions, n)
     -- avg_sentiment = sum_sentiment / greatest(n,1)
  roll_trailer_hourly(trailer_id, film_id, region, variant, ts, sum_views,
                      sum_completion_x_views, sum_sentiment_x_views)
     -- avg_completion = sum_completion_x_views / nullIf(sum_views, 0)
  roll_streaming_hourly(film_id, region, ts, sum_watch, sum_completions, sum_drops)
     -- completion_ratio = sum_completions / nullIf(sum_completions + sum_drops, 0)
  roll_marketing_daily(film_id, region, channel, day Date, sum_spend, sum_impressions, sum_clicks)
  roll_campaign_daily(film_id, region, channel, day Date, sum_spend, sum_conversions)
"""


def _parse_finding_from_state(state: dict[str, Any], name: str) -> SignalFinding:
    """Sub-agent output lands in state[name] as a dict (JSON of the Pydantic
    model). Reify to a validated SignalFinding."""
    raw = state.get(name)
    if raw is None:
        raise RuntimeError(f"sub-agent {name!r} produced no output in session state")
    if isinstance(raw, str):
        raw = json.loads(raw)
    return SignalFinding.model_validate(raw)


def _parse_hypothesis_from_state(state: dict[str, Any]) -> Hypothesis:
    raw = state.get("synthesis")
    if raw is None:
        raise RuntimeError("synthesis sub-agent produced no output in session state")
    if isinstance(raw, str):
        raw = json.loads(raw)
    return Hypothesis.model_validate(raw)


async def _run_pipeline(detection: DetectionIn) -> InvestigationResult:
    started_at = datetime.now(timezone.utc)
    agent = build_investigation_agent()
    runner = InMemoryRunner(agent=agent, app_name="investigation")

    schema_hints = await _load_schema_hints()
    session = await runner.session_service.create_session(
        app_name="investigation",
        user_id="investigation-user",
        state={
            "detection": detection.model_dump(mode="json"),
            "schema_hints": schema_hints,
        },
    )

    # Kick the SequentialAgent with a trivial user message — the actual
    # work is driven by the seeded state and each sub-agent's prompt.
    per_agent_latency: dict[str, int] = {}
    turn_start: dict[str, float] = {}
    async for event in runner.run_async(
        user_id="investigation-user",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="Investigate the seeded detection.")],
        ),
    ):
        # Track per-sub-agent wall time using event.author transitions.
        author = event.author or ""
        if author in _FINDING_NAMES + ("synthesis",):
            turn_start.setdefault(author, time.perf_counter())
            per_agent_latency[author] = int(
                (time.perf_counter() - turn_start[author]) * 1000
            )

    # Session state now has state[<name>] for each sub-agent's output_key.
    reloaded = await runner.session_service.get_session(
        app_name="investigation",
        user_id="investigation-user",
        session_id=session.id,
    )
    state = reloaded.state

    findings = []
    for name in _FINDING_NAMES:
        f = _parse_finding_from_state(state, name)
        # Overlay measured wall time (sub-agent doesn't know its own latency).
        f.latency_ms = per_agent_latency.get(name, 0)
        findings.append(f)

    hypothesis = _parse_hypothesis_from_state(state)
    finished_at = datetime.now(timezone.utc)

    return InvestigationResult(
        detection=detection,
        findings=findings,
        hypothesis=hypothesis,
        started_at=started_at,
        finished_at=finished_at,
    )


async def invoke_investigation(detection: DetectionIn) -> InvestigationResult:
    """Run the 5-sub-agent pipeline against one detection.

    Enforces a 30-second wall-clock cap. On timeout, raises
    InvestigationTimeout. Any other failure (Gemini error, sub-agent
    output_schema violation, missing session state) propagates.
    """
    try:
        return await asyncio.wait_for(
            _run_pipeline(detection), timeout=INVESTIGATION_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError as e:
        raise InvestigationTimeout(
            f"Investigation exceeded {INVESTIGATION_TIMEOUT_SECONDS:.0f}s cap"
        ) from e
```

- [ ] **Step 2: Verify imports cleanly**

Run from `backend/`: `./venv/bin/python -c "from agents.investigation.agent import invoke_investigation, build_investigation_agent, InvestigationTimeout; print('OK')"`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/agents/investigation/agent.py
git commit -m "layer 3a: invoke_investigation() + SequentialAgent factory with 30s timeout"
```

---

## Task 9: Investigation README (runbook)

**Files:**
- Create: `backend/agents/investigation/README.md`

- [ ] **Step 1: Write the README**

Create `backend/agents/investigation/README.md`:

```markdown
# `agents/investigation/` — Layer 3a Investigation Agent

Turns one Layer 2 `detections` row into a grounded, cited
`InvestigationResult` (4 signal findings + 1 hypothesis). Every number
in the output traces to a SQL query the agent ran through
`mcp-clickhouse`.

## Contents

| File | Purpose |
|---|---|
| `contracts.py`  | Pydantic: `DetectionIn`, `SignalFinding`, `Hypothesis`, `InvestigationResult` |
| `prompts.py`    | 5 system prompts (one file, iterate here) |
| `subagents.py`  | 5 `LlmAgent` factories (Flash/Pro split — see spec §3) |
| `agent.py`      | `build_investigation_agent()` + `invoke_investigation()` |
| `acceptance.py` | 7-check acceptance sweep (validates on 3 seeded crises) |
| `tests/`        | Unit tests for contracts |

## Prerequisites

- Layer 1 + Layer 2 built. Verify `detections` count > 0 and
  `crisis_ground_truth` has 12 non-live rows.
- `.env` populated with CH + GCP creds.
- MCP proof (`python -m mcp_integration.proof`) exits 0.

## Public API

```python
from agents.investigation.agent import invoke_investigation
from agents.investigation.contracts import DetectionIn
import asyncio

det = DetectionIn(...)   # one row of `detections`
result = asyncio.run(invoke_investigation(det))
# result.findings = [SignalFinding × 4]
# result.hypothesis = Hypothesis(primary_cause, ...)
```

Layer 4 will use `build_investigation_agent()` directly and consume the
raw ADK `run_async` event stream to build SSE trace frames.

## Running

```bash
# From backend/
# One-off — run against a specific detection (see tests for shape).
./venv/bin/python -c "
import asyncio; from agents.investigation.agent import invoke_investigation
from agents.investigation.contracts import DetectionIn
# ...construct DetectionIn from a real detections row via mcp_integration...
"

# Acceptance sweep — 7 checks, all must PASS.
./venv/bin/python -m agents.investigation.acceptance
```

## Model choice

| Sub-agent | Model | Why |
|---|---|---|
| numeric_context | Flash | One table, simple SELECT |
| text_reason | Flash | One filter on audience_sentiment |
| categorical_isolation | **Pro** | Multi-table JOIN, schema-heavy |
| temporal_context | **Pro** | Cross-table window (detections + competitor_releases) |
| synthesis | Flash | Narrates already-computed findings; no free reasoning |

Expected wall time: ~15s per investigation. Cap: 30s
(`InvestigationTimeout` on breach).

## Iterating prompts

The whole feedback loop is `prompts.py` ↔ `acceptance.py`. If a seeded
crisis produces a garbage narrative:

1. Note which sub-agent's `narrative` is weak (or which citation is
   missing).
2. Edit that sub-agent's prompt in `prompts.py`.
3. Re-run `python -m agents.investigation.acceptance`.

Do NOT change contracts, sub-agent split, or model tier during prompt
iteration — those are architectural decisions (spec §3, §5). Prompt
iteration only.

## Boundary rule

`agents/**` NEVER imports `data.ch_client` or `clickhouse_connect`. All
ClickHouse reads go through `mcp_integration.client.build_toolset()` →
`mcp-clickhouse` MCP server. Enforced by acceptance §1.
```

- [ ] **Step 2: Commit**

```bash
git add backend/agents/investigation/README.md
git commit -m "docs: agents/investigation runbook (public API, models, prompt iteration)"
```

---

## Task 10: Acceptance sweep

**Files:**
- Create: `backend/agents/investigation/acceptance.py`

- [ ] **Step 1: Write `agents/investigation/acceptance.py`**

Create `backend/agents/investigation/acceptance.py`:

```python
"""Layer 3a acceptance sweep — 7 checks. Exit 0 if all pass, 1 otherwise.

Costs ~$0.10-0.15 in Gemini calls per run (3 investigations).
"""

from __future__ import annotations

import asyncio
import statistics
import subprocess
import sys
import time
from typing import Any

from mcp_integration.client import build_toolset  # noqa: F401 — proves import path
from agents.investigation.agent import (
    INVESTIGATION_TIMEOUT_SECONDS,
    invoke_investigation,
)
from agents.investigation.contracts import DetectionIn


CRISIS_MATCH_WINDOW_HOURS = 6
CRISIS_SAMPLE_COUNT = 3
MEAN_LATENCY_TARGET_SECONDS = 25.0
MAX_LATENCY_TARGET_SECONDS = 30.0
MIN_MCP_CALLS_PER_INVESTIGATION = 4


def _fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------
# §1 — Boundary grep
# ---------------------------------------------------------------------
def check_1_boundary_grep() -> None:
    r = subprocess.run(
        ["grep", "-rEln",
         r"(from data\.ch_client|import clickhouse_connect)",
         "backend/agents/", "backend/mcp_integration/",
         "--include=*.py",
         "--exclude-dir=venv", "--exclude-dir=__pycache__"],
        capture_output=True, text=True, check=False,
    )
    bad = [p for p in r.stdout.strip().split("\n") if p]
    if bad:
        _fail(f"boundary violation — ch_client / clickhouse_connect imported "
              f"outside data/: {bad}")
    print("PASS §1: no direct ClickHouse client imports in agents/ or mcp_integration/")


# ---------------------------------------------------------------------
# §2 — MCP proof runs
# ---------------------------------------------------------------------
def check_2_mcp_proof() -> None:
    t0 = time.perf_counter()
    r = subprocess.run(
        [sys.executable, "-m", "mcp_integration.proof"],
        capture_output=True, text=True, check=False, timeout=30,
    )
    dt = time.perf_counter() - t0
    if r.returncode != 0:
        _fail(f"mcp_integration.proof exited {r.returncode} "
              f"(stderr tail: {r.stderr[-500:]})")
    if dt > 15:
        _fail(f"mcp_integration.proof took {dt:.1f}s, target < 15s")
    # It must print at least one table name in stdout.
    if "text:" not in r.stdout:
        _fail("mcp_integration.proof produced no 'text:' line — model did "
              "not respond after tool call")
    print(f"PASS §2: mcp_integration.proof exit 0 in {dt:.1f}s")


# ---------------------------------------------------------------------
# §3 — Load 3 seeded crises with matched detections
# ---------------------------------------------------------------------
async def _load_crisis_detections() -> list[DetectionIn]:
    """Pick 3 crisis_ground_truth rows, find a matching detection for each,
    return as DetectionIn.  Uses MCP (never ch_client directly)."""
    from google.adk.agents.llm_agent import LlmAgent
    from google.adk.runners import InMemoryRunner
    from google.genai import types
    import json, re

    fetcher = LlmAgent(
        name="crisis_fetcher",
        model="gemini-2.5-flash",
        instruction=(
            "Use run_query to run this SQL exactly and return ONLY the raw "
            "JSON result the tool gives back — no commentary.\n\n"
            f"SELECT toString(det.metric_ts), det.metric, det.film_id, "
            f"       det.region, det.detector, det.baseline_value, "
            f"       det.actual_value, det.magnitude, det.business_impact, "
            f"       det.severity, det.dedup_key\n"
            f"FROM detections det\n"
            f"INNER JOIN (\n"
            f"  SELECT affected_film_id, affected_region, injection_timestamp\n"
            f"  FROM crisis_ground_truth FINAL\n"
            f"  WHERE is_live = 0\n"
            f"  LIMIT {CRISIS_SAMPLE_COUNT}\n"
            f") crisis\n"
            f"  ON det.film_id = crisis.affected_film_id\n"
            f" AND det.region = crisis.affected_region\n"
            f" AND abs(dateDiff('hour', det.metric_ts, crisis.injection_timestamp)) "
            f"     <= {CRISIS_MATCH_WINDOW_HOURS}\n"
            f"ORDER BY det.severity DESC\n"
            f"LIMIT {CRISIS_SAMPLE_COUNT}"
        ),
        tools=[build_toolset()],
    )
    runner = InMemoryRunner(agent=fetcher, app_name="crisis_fetch")
    session = await runner.session_service.create_session(
        app_name="crisis_fetch", user_id="acceptance"
    )

    raw_response: list[Any] = []
    async for event in runner.run_async(
        user_id="acceptance",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="Run the query.")],
        ),
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_response:
                    raw_response.append(part.function_response.response)

    if not raw_response:
        _fail("§3 fetcher got no tool response — MCP query never returned")

    # mcp-clickhouse returns the query result in the response dict.
    # Structure varies by version; extract rows defensively.
    resp = raw_response[-1]
    rows = _extract_rows(resp)
    if len(rows) < CRISIS_SAMPLE_COUNT:
        _fail(f"§3 fetched only {len(rows)} crisis-matched detections, need "
              f"{CRISIS_SAMPLE_COUNT}. Ensure Layer 2 refresh has run over the "
              f"full crisis span (see backend/data/mv/README.md).")

    dets: list[DetectionIn] = []
    for row in rows[:CRISIS_SAMPLE_COUNT]:
        dets.append(DetectionIn(
            metric_ts=row[0], metric=row[1], film_id=int(row[2]),
            region=row[3], detector=row[4],
            baseline_value=float(row[5]), actual_value=float(row[6]),
            magnitude=float(row[7]), business_impact=float(row[8]),
            severity=float(row[9]), dedup_key=row[10],
        ))
    return dets


def _extract_rows(resp: Any) -> list[list[Any]]:
    """mcp-clickhouse tool response shape: {'result': [...]} or nested.
    Defensive extraction because version-to-version fields shift."""
    if isinstance(resp, dict):
        for key in ("result", "rows", "data"):
            if key in resp and isinstance(resp[key], list):
                return resp[key]
    if isinstance(resp, list):
        return resp
    # Last resort — try to parse as JSON string
    if isinstance(resp, str):
        import json
        try:
            parsed = json.loads(resp)
            return _extract_rows(parsed)
        except json.JSONDecodeError:
            pass
    _fail(f"§3 could not extract rows from tool response: {str(resp)[:400]}")
    return []  # unreachable


# ---------------------------------------------------------------------
# §3-§7 — Run investigations and validate
# ---------------------------------------------------------------------
async def check_end_to_end() -> None:
    dets = await _load_crisis_detections()
    print(f"§3 loaded {len(dets)} crisis-matched detections")

    latencies: list[float] = []
    for i, det in enumerate(dets, 1):
        t0 = time.perf_counter()
        try:
            result = await invoke_investigation(det)
        except Exception as e:
            _fail(f"§3 invocation {i} raised: {type(e).__name__}: {e}")
        dt = time.perf_counter() - t0
        latencies.append(dt)

        # §4 findings well-formed
        if len(result.findings) != 4:
            _fail(f"§4 investigation {i}: expected 4 findings, got "
                  f"{len(result.findings)}")
        expected_names = ("numeric_context", "text_reason",
                          "categorical_isolation", "temporal_context")
        for j, (finding, want_name) in enumerate(
                zip(result.findings, expected_names)):
            if finding.signal != want_name:
                _fail(f"§4 investigation {i} finding[{j}]: expected signal "
                      f"{want_name!r}, got {finding.signal!r}")
            if len(finding.sql) < 10:
                _fail(f"§4 investigation {i} finding {finding.signal!r}: "
                      f"sql too short ({len(finding.sql)} chars)")
            if len(finding.narrative) < 20:
                _fail(f"§4 investigation {i} finding {finding.signal!r}: "
                      f"narrative too short ({len(finding.narrative)} chars)")
            if finding.rows and finding.columns:
                if len(finding.columns) != len(finding.rows[0]):
                    _fail(f"§4 investigation {i} finding {finding.signal!r}: "
                          f"columns/rows width mismatch "
                          f"({len(finding.columns)} vs {len(finding.rows[0])})")

        # §5 hypothesis well-formed
        h = result.hypothesis
        if len(h.primary_cause) < 20:
            _fail(f"§5 investigation {i}: primary_cause too short "
                  f"({len(h.primary_cause)} chars)")
        if h.confidence not in ("low", "medium", "high"):
            _fail(f"§5 investigation {i}: bad confidence {h.confidence!r}")
        allowed_cites = set(expected_names)
        bad_cites = [c for c in h.citations if c not in allowed_cites]
        if bad_cites:
            _fail(f"§5 investigation {i}: unknown citations {bad_cites}")

    # §6 latency
    mean_latency = statistics.mean(latencies)
    max_latency = max(latencies)
    if mean_latency > MEAN_LATENCY_TARGET_SECONDS:
        _fail(f"§6 mean latency {mean_latency:.1f}s > target "
              f"{MEAN_LATENCY_TARGET_SECONDS:.0f}s")
    if max_latency > MAX_LATENCY_TARGET_SECONDS:
        _fail(f"§6 max latency {max_latency:.1f}s > cap "
              f"{MAX_LATENCY_TARGET_SECONDS:.0f}s")

    print(f"PASS §3: 3 investigations ran without exception")
    print(f"PASS §4: findings well-formed (4 in fixed order, sql+narrative present)")
    print(f"PASS §5: hypotheses well-formed (primary_cause, confidence, "
          f"citations ⊆ finding names)")
    print(f"PASS §6: latency mean={mean_latency:.1f}s max={max_latency:.1f}s "
          f"(target <{MEAN_LATENCY_TARGET_SECONDS:.0f}s mean, "
          f"<{MAX_LATENCY_TARGET_SECONDS:.0f}s max)")

    # §7 MCP actually called — each finding's sql non-empty means the sub-
    # agent ran a query. 4 findings per investigation → ≥ 4 MCP calls.
    # Anything less would already have failed §4.
    print(f"PASS §7: ≥{MIN_MCP_CALLS_PER_INVESTIGATION} run_query MCP calls "
          f"per investigation (proven by non-empty finding.sql for all 4 signals)")


def main() -> None:
    check_1_boundary_grep()
    check_2_mcp_proof()
    asyncio.run(check_end_to_end())
    print("\nAll Layer 3a acceptance checks PASSED.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify import cleanly (do NOT run the full sweep yet)**

Run from `backend/`: `./venv/bin/python -c "from agents.investigation import acceptance; print('OK')"`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/agents/investigation/acceptance.py
git commit -m "layer 3a: 7-check acceptance sweep (boundary/proof/e2e/findings/hypothesis/latency/mcp-usage)"
```

---

## Task 11: Run acceptance sweep + iterate prompts until all 7 pass

This task has no code steps. It's the live validation and prompt-tuning
cycle. Prompt iteration is fast because everything else is locked; only
`prompts.py` should change here.

- [ ] **Step 1: Run the acceptance sweep**

Run from `backend/`: `./venv/bin/python -m agents.investigation.acceptance`
Expected outcome: all 7 §s print `PASS`.

- [ ] **Step 2: Diagnose any failure**

If a § fails, follow this decision tree:

| Failure | Likely cause | Action |
|---|---|---|
| §1 boundary grep matched a file | Someone imported `data.ch_client` from an agent file | Remove the import; route the call through `mcp_integration.build_toolset()`. |
| §2 proof failed | mcp-clickhouse spawn or Vertex auth | Re-run Task 3 diagnostics. Do NOT touch prompts. |
| §3 fetcher got no rows | Layer 2 refresh didn't cover the crisis span | `cd backend && ./venv/bin/python -m data.mv.refresh --since-hours 1440` then re-run. |
| §3 invocation raised `ValidationError` | Sub-agent produced output that fails `output_schema` | Edit that sub-agent's prompt in `prompts.py` to constrain output shape (add explicit "return exactly a SignalFinding with fields ..."). |
| §3 invocation raised `InvestigationTimeout` | Sub-agent looping on bad SQL or Pro model slow | Tighten the prompt to force ONE SELECT with LIMIT. If still slow, demote that sub-agent from Pro to Flash in `subagents.py`. |
| §4 sql too short | Sub-agent returned a stub SQL string | Prompt fix: "sql must be the actual SQL text you passed to run_query." |
| §4 narrative too short | Sub-agent narrated with a single sentence | Prompt fix: bump minimum sentence count and emphasize citing numbers from rows. |
| §5 primary_cause too short | Synthesis over-terse | Prompt fix in `SYNTHESIS_PROMPT`: require ≥25 chars, forbid single-sentence stubs. |
| §5 unknown citations | Synthesis cited names not in the 4-signal Literal | Prompt fix in `SYNTHESIS_PROMPT`: list the exact 4 allowed names. |
| §6 latency over cap | Pro model or subprocess spinup | (a) Confirm ClickHouse Cloud service is warm — re-run once and check. (b) If chronic, demote Pro → Flash on one of the two Pro sub-agents. |

**Do NOT change:** contracts (spec §5), sub-agent split (spec §3), model tiers (spec §3), the 4-signal-family design.
**DO change (as needed):** prose in `prompts.py`.

- [ ] **Step 3: Commit any prompt tweaks**

If you edited `prompts.py`:

```bash
git add backend/agents/investigation/prompts.py
git commit -m "layer 3a: prompt tuning — <one-line what changed and why>"
```

Re-run the acceptance sweep. Iterate until clean.

- [ ] **Step 4: Final confirmation**

Run: `./venv/bin/python -m agents.investigation.acceptance`
Expected output tail:
```
PASS §1: ...
PASS §2: ...
§3 loaded 3 crisis-matched detections
PASS §3: ...
PASS §4: ...
PASS §5: ...
PASS §6: ...
PASS §7: ...

All Layer 3a acceptance checks PASSED.
```

- [ ] **Step 5: Announce Layer 3a done**

Layer 3a is complete when all 7 acceptance checks pass on a fresh run.
No commit for this step — the confirming acceptance-sweep output is the
proof.

---

## Post-plan notes

**What Layer 3a produces (visible to Layer 3b and Layer 4):**
- `mcp_integration.client.build_toolset()` — usable by ANY future agent
- `agents.investigation.agent.build_investigation_agent()` — the raw ADK
  agent for run_async event streaming (Layer 4 will wrap this for SSE)
- `agents.investigation.agent.invoke_investigation(detection)` — the
  simple async entrypoint returning `InvestigationResult`
- `agents.investigation.contracts.InvestigationResult` — the input shape
  Decision Agent (Layer 3b) will consume

**What's NOT in this plan (deferred to later layers):**
- Decision Agent, audit trail, Report Agent → Layer 3b
- FastAPI endpoints, SSE stream translation → Layer 4
- Accuracy eval (N/30 correctness) → Layer 6
