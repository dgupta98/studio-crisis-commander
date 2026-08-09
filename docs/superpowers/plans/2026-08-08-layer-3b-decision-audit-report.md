# Layer 3b — Decision Agent + Executive Report + Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a Layer 3a `InvestigationResult` into (a) a `DecisionResult` with 1-3 SQL-grounded, threshold-gated actions and (b) an `ExecutiveReport` where every KeyFigure traces to a query. Persist an immutable audit row per decision.

**Architecture:** Two Flash `LlmAgent`s (no tools) doing semantic selection only; Python orchestrator renders canonical impact SQL from a fixed 5-action taxonomy and executes it through a shared `MCPToolset`; audit rows persisted to a `ReplacingMergeTree(updated_at)` table. Server-side provenance check validates the report's `source_query` references before returning.

**Tech Stack:** Python 3.12, Google ADK (`google-cloud-aiplatform[adk]>=1.101.0`), `mcp-clickhouse==0.4.1`, Gemini 2.5 Flash via Vertex AI, Pydantic v2, pytest, `clickhouse-connect` (Layer 1 fallback + one-shot DDL only).

**Reference spec:** `docs/superpowers/specs/2026-08-08-layer-3b-decision-audit-report-design.md`

---

## Prerequisites & conventions

Read before Task 1:

- **Working directory for all commands:** `backend/`. Venv at `backend/venv/`. Run Python as `./venv/bin/python`; modules as `./venv/bin/python -m <dotted.path>`.
- **Layer 3a must be merged and passing.** Verify: `./venv/bin/python -m agents.investigation.acceptance` exits 0. Layer 3a's contracts, `build_toolset()`, and `invoke_investigation()` are prerequisites.
- **Layer 1/2 data present.** Verify: `./venv/bin/python -c "from data.ch_client import client; c = client().__enter__(); print(c.query('SELECT count() FROM detections').result_rows[0][0])"` prints a number > 0. Also verify `crisis_ground_truth` has ≥ 3 non-live rows.
- **`.env` already configured** (Layer 3a set this up). Do NOT read or print `.env`. The extra keys Layer 3a added (`GOOGLE_GENAI_USE_VERTEXAI=1`, absolute `GOOGLE_APPLICATION_CREDENTIALS`) must remain.
- **Boundary rule extends Layer 3a's:** `agents/decision/` and `agents/report/` MUST NOT import `data.ch_client` or `clickhouse_connect`. Two documented exceptions:
  1. `backend/data/bootstrap_audit.py` uses `clickhouse_connect` for one-shot DDL (Layer 1 pattern).
  2. `agents/decision/audit.py` MAY use `clickhouse_connect` for INSERTs only IF Task 2 shows the MCP write path is blocked. This is a fallback, not the default.
- **The audit.py exception is enforced by an explicit grep exclusion** in the acceptance sweep. All other files in `agents/decision/`, `agents/report/` are strict-boundary.
- **No Co-Authored-By trailers in commits.**
- **File conventions match Layer 3a:** `from __future__ import annotations`, module docstring, `if __name__ == "__main__"` at bottom of runnable modules, `argparse` for CLI flags.
- **Model IDs (locked by Layer 3a):** `FLASH = "gemini-2.5-flash"`, `PRO = "gemini-2.5-pro"`. Layer 3b uses Flash exclusively (both decision and report agents).

---

## Task 1: Scaffold packages

**Files:**
- Create: `backend/agents/decision/__init__.py`
- Create: `backend/agents/decision/tests/__init__.py`
- Create: `backend/agents/decision/tests/fixtures/__init__.py`
- Create: `backend/agents/report/__init__.py`
- Create: `backend/agents/report/tests/__init__.py`

- [ ] **Step 1: Verify state**

Run: `ls backend/agents/`
Expected: shows `investigation/` and `__init__.py`. If `decision/` or `report/` already exist, investigate before continuing.

- [ ] **Step 2: Create package skeletons**

```bash
mkdir -p backend/agents/decision/tests/fixtures
mkdir -p backend/agents/report/tests
touch backend/agents/decision/__init__.py
touch backend/agents/decision/tests/__init__.py
touch backend/agents/decision/tests/fixtures/__init__.py
touch backend/agents/report/__init__.py
touch backend/agents/report/tests/__init__.py
```

- [ ] **Step 3: Verify imports work**

Run (from `backend/`): `./venv/bin/python -c "import agents.decision; import agents.report; import agents.decision.tests.fixtures; print('OK')"`
Expected: prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/agents/decision backend/agents/report
git commit -m "layer 3b: scaffold agents/decision and agents/report packages"
```

---

## Task 2: MCP write-path smoke test (validate build risk from spec §6.4)

**Purpose:** Before we design around MCP writes, prove they work. mcp-clickhouse 0.4.1 defaults to readonly. This task discovers the truth.

**Files:**
- Create: `backend/mcp_integration/write_smoke.py`

- [ ] **Step 1: Write the smoke test**

Create `backend/mcp_integration/write_smoke.py`:

```python
"""Layer 3b build-risk smoke test.

Layer 3b needs to INSERT audit rows via MCP. mcp-clickhouse 0.4.1 defaults
to readonly mode. This script proves whether writes succeed with the
CLICKHOUSE_READONLY_MODE=0 env flip, or whether audit.py must fall back
to clickhouse-connect (spec §6.4 fallback path).

Exit 0 => MCP writes work. Design proceeds with MCP for audit.
Exit 2 => MCP writes blocked. Design falls back to clickhouse-connect
          for audit INSERTs only (documented in agents/decision/audit.py).
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from mcp_integration.client import build_toolset


TEST_TABLE = "_layer3b_write_smoke"


async def main() -> int:
    # Force write mode on the MCP subprocess.
    os.environ["CLICKHOUSE_READONLY_MODE"] = "0"

    marker = uuid.uuid4().hex
    ddl = f"CREATE TABLE IF NOT EXISTS {TEST_TABLE} (marker String) ENGINE = Memory"
    ins = f"INSERT INTO {TEST_TABLE} VALUES ('{marker}')"
    sel = f"SELECT marker FROM {TEST_TABLE} WHERE marker = '{marker}'"
    drop = f"DROP TABLE IF EXISTS {TEST_TABLE}"

    agent = LlmAgent(
        name="write_smoke",
        model="gemini-2.5-flash",
        instruction=(
            "Call run_query with EACH of the following SQL statements in order. "
            "Return only 'OK' after the last one succeeds.\n"
            f"1) {ddl}\n2) {ins}\n3) {sel}\n4) {drop}\n"
        ),
        tools=[build_toolset()],
    )
    runner = InMemoryRunner(agent=agent, app_name="write_smoke")
    session = await runner.session_service.create_session(
        app_name="write_smoke", user_id="smoke"
    )

    saw_select_result = False
    error_text = ""
    async for event in runner.run_async(
        user_id="smoke",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="Run the statements.")],
        ),
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_response:
                    payload = str(part.function_response.response)
                    if marker in payload:
                        saw_select_result = True
                    lower = payload.lower()
                    if "readonly" in lower or "denied" in lower or "not allowed" in lower:
                        error_text = payload[:400]

    if saw_select_result:
        print("MCP-WRITE-OK: INSERT + SELECT roundtrip succeeded with CLICKHOUSE_READONLY_MODE=0.")
        return 0
    print("MCP-WRITE-BLOCKED: could not observe INSERTed marker in SELECT result.", file=sys.stderr)
    if error_text:
        print(f"  hint: {error_text}", file=sys.stderr)
    print("  → agents/decision/audit.py MUST fall back to clickhouse-connect (spec §6.4).", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

- [ ] **Step 2: Run the smoke test**

Run (from `backend/`): `./venv/bin/python -m mcp_integration.write_smoke`

Expected outcome — one of:
- **Exit 0** with `MCP-WRITE-OK`: proceed with MCP writes. Set the env flip in `mcp_integration/client.py` in the next step.
- **Exit 2** with `MCP-WRITE-BLOCKED`: proceed with clickhouse-connect fallback. Skip Step 3 and add a `BUILD-RISK-FALLBACK` comment in `audit.py` (Task 7).

- [ ] **Step 3 (only if Step 2 exit 0): Persist the env flip in `client.py`**

Edit `backend/mcp_integration/client.py`. Find `_env_for_subprocess()` (around line 38) and add one line before the `return env` at the end:

```python
    # Layer 3b requires writes (audit INSERTs). Default mcp-clickhouse readonly.
    env["CLICKHOUSE_READONLY_MODE"] = "0"
    return env
```

Then re-run the smoke test WITHOUT setting the env var manually — the change should make it pass without external env poking:

```bash
unset CLICKHOUSE_READONLY_MODE
./venv/bin/python -m mcp_integration.write_smoke
```
Expected: exit 0 (still). Confirms the client wiring is self-contained.

Also re-run Layer 3a acceptance to prove reads still work:
```bash
./venv/bin/python -m agents.investigation.acceptance
```
Expected: all 7 checks PASS as before.

- [ ] **Step 4: Commit**

If Step 3 ran (MCP works):
```bash
git add backend/mcp_integration/write_smoke.py backend/mcp_integration/client.py
git commit -m "layer 3b: mcp write-path smoke + enable CLICKHOUSE_READONLY_MODE=0 for audit inserts"
```

If Step 3 skipped (MCP blocked, using fallback):
```bash
git add backend/mcp_integration/write_smoke.py
git commit -m "layer 3b: mcp write-path smoke — writes blocked, audit will use clickhouse-connect fallback"
```

Record the outcome in your notes — Task 7 branches on it.

---

## Task 3: Bootstrap `decision_audit` table

**Files:**
- Create: `backend/data/audit_schema.sql`
- Create: `backend/data/bootstrap_audit.py`

- [ ] **Step 1: Write the schema**

Create `backend/data/audit_schema.sql`:

```sql
-- Layer 3b — Decision audit trail.
-- ReplacingMergeTree(updated_at): approve/deny INSERTs a new row with the
-- same decision_id and later updated_at. SELECT ... FINAL returns latest.
-- created_at is IMMUTABLE — never modified. updated_at is the version key.
CREATE TABLE IF NOT EXISTS decision_audit (
  decision_id         String,
  investigation_id    String,
  detection_dedup_key String,
  film_id             UInt32,
  region              LowCardinality(String),
  actions_json        String,
  status              LowCardinality(String),
  threshold_usd       Float64,
  agent_run_json      String,
  report_json         String DEFAULT '',
  approval_status     LowCardinality(String) DEFAULT 'pending_approval',
  approver            String DEFAULT '',
  approval_note       String DEFAULT '',
  approved_at         Nullable(DateTime),
  created_at          DateTime DEFAULT now(),
  updated_at          DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (decision_id, created_at);
```

- [ ] **Step 2: Write the bootstrap runner**

Create `backend/data/bootstrap_audit.py`:

```python
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
```

- [ ] **Step 3: Run the bootstrap**

Run (from `backend/`): `./venv/bin/python -m data.bootstrap_audit`
Expected: prints `Audit schema OK: decision_audit (16 columns).`

- [ ] **Step 4: Confirm idempotency by running again**

Run: `./venv/bin/python -m data.bootstrap_audit`
Expected: same output, no error (the `CREATE TABLE IF NOT EXISTS` is a no-op on second run).

- [ ] **Step 5: Verify-only path**

Run: `./venv/bin/python -m data.bootstrap_audit --verify`
Expected: same success message.

- [ ] **Step 6: Commit**

```bash
git add backend/data/audit_schema.sql backend/data/bootstrap_audit.py
git commit -m "layer 3b: decision_audit table + idempotent bootstrap runner"
```

---

## Task 4: Add `investigation_id` to Layer 3a's `InvestigationResult` (bounded touch)

**Purpose:** Layer 3b's audit rows key off `investigation_id`. Layer 3a's contract has no such field. Add one with a `default_factory` so existing consumers (Layer 3a's own acceptance sweep, tests) don't break.

**Files:**
- Modify: `backend/agents/investigation/contracts.py` (add `investigation_id` field with `default_factory=uuid4`)
- Create: `backend/agents/investigation/tests/test_investigation_id.py`

- [ ] **Step 1: Write the failing test**

Create `backend/agents/investigation/tests/test_investigation_id.py`:

```python
"""Layer 3b touch: InvestigationResult must expose an id."""

from __future__ import annotations

from datetime import datetime, timezone

from agents.investigation.contracts import (
    DetectionIn, Hypothesis, InvestigationResult, SignalFinding,
)


def _sample_finding(name: str) -> SignalFinding:
    return SignalFinding(
        signal=name,               # type: ignore[arg-type]
        sql="SELECT 1",
        columns=["x"],
        rows=[[1]],
        narrative="baseline for the test — pretend this is a real narrative.",
    )


def _sample_result() -> InvestigationResult:
    det = DetectionIn(
        metric_ts=datetime(2026, 1, 1, tzinfo=timezone.utc),
        metric="audience_sentiment.avg", film_id=1, region="US-CA",
        detector="test", baseline_value=0.5, actual_value=0.2,
        magnitude=-0.6, business_impact=1000.0, severity=1.0,
        dedup_key="k",
    )
    hyp = Hypothesis(
        primary_cause="Test cause exceeding twenty-five characters minimum.",
        contributing_factors=[], confidence="medium",
        citations=["numeric_context"],
    )
    return InvestigationResult(
        detection=det,
        findings=[
            _sample_finding("numeric_context"),
            _sample_finding("text_reason"),
            _sample_finding("categorical_isolation"),
            _sample_finding("temporal_context"),
        ],
        hypothesis=hyp,
        started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        finished_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def test_investigation_id_auto_generated():
    r = _sample_result()
    assert isinstance(r.investigation_id, str)
    assert len(r.investigation_id) == 32  # UUID4 hex


def test_investigation_id_unique_per_instance():
    a = _sample_result()
    b = _sample_result()
    assert a.investigation_id != b.investigation_id


def test_investigation_id_round_trips_through_json():
    r = _sample_result()
    reloaded = InvestigationResult.model_validate_json(r.model_dump_json())
    assert reloaded.investigation_id == r.investigation_id
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `./venv/bin/pytest agents/investigation/tests/test_investigation_id.py -v`
Expected: FAIL — `AttributeError: 'InvestigationResult' object has no attribute 'investigation_id'`.

- [ ] **Step 3: Add the field**

Edit `backend/agents/investigation/contracts.py`. At the top add `from uuid import uuid4`:

```python
from uuid import uuid4
```

Then modify the `InvestigationResult` class body to add `investigation_id`:

```python
class InvestigationResult(BaseModel):
    """Top-level artifact returned by invoke_investigation()."""

    investigation_id: str = Field(default_factory=lambda: uuid4().hex)
    detection: DetectionIn
    findings: list[SignalFinding] = Field(
        ..., description="length 4, in fixed order matching sub-agent order"
    )
    hypothesis: Hypothesis
    started_at: datetime
    finished_at: datetime
```

- [ ] **Step 4: Run the new tests**

Run: `./venv/bin/pytest agents/investigation/tests/test_investigation_id.py -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Re-run Layer 3a acceptance to prove no regression**

Run: `./venv/bin/python -m agents.investigation.acceptance`
Expected: all 7 checks PASS. `investigation_id` field is defaulted, so `_parse_finding_from_state` etc. are unaffected.

- [ ] **Step 6: Commit**

```bash
git add backend/agents/investigation/contracts.py backend/agents/investigation/tests/test_investigation_id.py
git commit -m "layer 3a: add investigation_id (uuid4) to InvestigationResult — non-breaking"
```

---

## Task 5: Decision contracts (`agents/decision/contracts.py`)

**Files:**
- Create: `backend/agents/decision/contracts.py`
- Create: `backend/agents/decision/tests/test_contracts.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/agents/decision/tests/test_contracts.py`:

```python
"""Pydantic contract tests for agents.decision.contracts."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from agents.decision.contracts import (
    ActionType, ApprovalStatus, DecisionResult, RecommendedAction,
)


def _valid_action(**over) -> RecommendedAction:
    base = dict(
        action_type="pause_campaign",
        rationale="Pausing to stop marketing overspend during a sentiment crisis.",
        params={"campaign_id": 42, "region": "EU-DE", "pause_days": 3},
        priority=1,
    )
    base.update(over)
    return RecommendedAction(**base)


def test_action_type_literal_rejects_unknown():
    with pytest.raises(ValidationError):
        RecommendedAction(
            action_type="nuke_from_orbit",   # type: ignore[arg-type]
            rationale="Trying to sneak in an unsupported action type here.",
            params={},
            priority=1,
        )


def test_rationale_min_length_enforced():
    with pytest.raises(ValidationError):
        _valid_action(rationale="short")


def test_priority_range_1_to_3():
    _valid_action(priority=1)
    _valid_action(priority=3)
    with pytest.raises(ValidationError):
        _valid_action(priority=0)
    with pytest.raises(ValidationError):
        _valid_action(priority=4)


def test_impact_usd_requires_impact_sql():
    """The whole point of the layer: numbers must trace to queries."""
    with pytest.raises(ValidationError, match="impact_sql"):
        _valid_action(impact_usd=1234.0, impact_sql="")


def test_impact_usd_none_allows_empty_sql():
    a = _valid_action(impact_usd=None, impact_sql="")
    assert a.impact_usd is None


def test_impact_sql_alone_is_allowed():
    """Orchestrator can render impact_sql before the query runs; impact_usd
    stays None until the query returns."""
    a = _valid_action(impact_usd=None, impact_sql="SELECT 1")
    assert a.impact_sql == "SELECT 1"


def _valid_decision(**over) -> DecisionResult:
    base = dict(
        decision_id="d-1",
        investigation_id="i-1",
        actions=[_valid_action()],
        status="pending_approval",
        threshold_usd=20_000.0,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        latency_ms=1_000,
    )
    base.update(over)
    return DecisionResult(**base)


def test_decision_requires_at_least_one_action():
    with pytest.raises(ValidationError):
        _valid_decision(actions=[])


def test_decision_caps_at_three_actions():
    with pytest.raises(ValidationError):
        _valid_decision(actions=[_valid_action() for _ in range(4)])


def test_status_literal_enforced():
    with pytest.raises(ValidationError):
        _valid_decision(status="lgtm")   # type: ignore[arg-type]
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `./venv/bin/pytest agents/decision/tests/test_contracts.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agents.decision.contracts'`.

- [ ] **Step 3: Write the contracts module**

Create `backend/agents/decision/contracts.py`:

```python
"""Pydantic contracts for the Decision Agent.

Rule of thumb: LLM narrates, SQL computes. RecommendedAction enforces that
via a model_validator — impact_sql MUST be non-empty whenever impact_usd
is populated. That's the whole spec §2 provenance guarantee at the type
level.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


ActionType = Literal[
    "shift_marketing_spend",
    "pause_campaign",
    "swap_trailer_variant",
    "issue_pr_statement",
    "escalate_to_human",
]


ApprovalStatus = Literal[
    "auto_executed",
    "pending_approval",
    "approved",
    "denied",
]


class RecommendedAction(BaseModel):
    """One ranked action inside a DecisionResult."""

    action_type: ActionType
    rationale: str = Field(min_length=20)
    params: dict = Field(default_factory=dict)
    impact_usd: float | None = None
    impact_sql: str = ""
    impact_error: str = ""
    priority: int = Field(ge=1, le=3)

    @model_validator(mode="after")
    def _impact_sql_required_when_number(self) -> "RecommendedAction":
        if self.impact_usd is not None and not self.impact_sql:
            raise ValueError(
                "impact_sql must be non-empty when impact_usd is set — "
                "every number must trace to a query"
            )
        return self


class DecisionResult(BaseModel):
    """Top-level artifact returned by invoke_decision()."""

    decision_id: str
    investigation_id: str
    actions: list[RecommendedAction] = Field(min_length=1, max_length=3)
    status: ApprovalStatus
    threshold_usd: float
    created_at: datetime
    latency_ms: int = 0
```

- [ ] **Step 4: Run tests**

Run: `./venv/bin/pytest agents/decision/tests/test_contracts.py -v`
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/decision/contracts.py backend/agents/decision/tests/test_contracts.py
git commit -m "layer 3b: decision contracts (RecommendedAction, DecisionResult) with impact_sql invariant"
```

---

## Task 6: Action taxonomy — SQL templates, param specs, threshold logic (`agents/decision/actions.py`)

**Files:**
- Create: `backend/agents/decision/actions.py`
- Create: `backend/agents/decision/tests/test_actions.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/agents/decision/tests/test_actions.py`:

```python
"""Unit tests for agents.decision.actions."""

from __future__ import annotations

import pytest

from agents.decision.actions import (
    ACTION_TYPES,
    DEFAULT_THRESHOLDS_USD,
    PARAM_SPECS,
    TEMPLATES,
    compute_status,
    render_action_sql,
    validate_params,
)
from agents.decision.contracts import RecommendedAction


# ---- taxonomy completeness ----

def test_all_action_types_have_template():
    assert set(TEMPLATES.keys()) == set(ACTION_TYPES)


def test_all_action_types_have_param_spec():
    assert set(PARAM_SPECS.keys()) == set(ACTION_TYPES)


def test_all_action_types_have_threshold():
    assert set(DEFAULT_THRESHOLDS_USD.keys()) == set(ACTION_TYPES)


# ---- param validation ----

def test_validate_params_rejects_missing_required():
    with pytest.raises(ValueError, match="missing required param"):
        validate_params(
            "pause_campaign",
            {"campaign_id": 1, "region": "US-CA"},  # missing pause_days
        )


def test_validate_params_rejects_extra_keys():
    with pytest.raises(ValueError, match="unexpected param"):
        validate_params(
            "pause_campaign",
            {"campaign_id": 1, "region": "US-CA", "pause_days": 2, "junk": "x"},
        )


def test_validate_params_rejects_wrong_type():
    with pytest.raises(ValueError, match="type"):
        validate_params(
            "pause_campaign",
            {"campaign_id": "not-an-int", "region": "US-CA", "pause_days": 2},
        )


def test_validate_params_rejects_unknown_action():
    with pytest.raises(ValueError, match="unknown action_type"):
        validate_params("nuke_from_orbit", {})   # type: ignore[arg-type]


# ---- SQL render ----

def test_render_shift_marketing_spend_produces_sql():
    sql = render_action_sql(
        "shift_marketing_spend",
        {
            "film_id": 42, "region": "EU-DE",
            "from_channel": "tiktok", "to_channel": "youtube",
            "shift_pct": 30.0, "window_days": 14,
        },
    )
    assert "roll_campaign_daily" in sql
    assert "42" in sql
    assert "'EU-DE'" in sql
    assert "'tiktok'" in sql
    assert "'youtube'" in sql
    assert "impact_usd" in sql


def test_render_escalate_to_human_returns_constant_zero():
    sql = render_action_sql(
        "escalate_to_human",
        {"reason": "low confidence hypothesis", "severity": "high"},
    )
    assert "SELECT" in sql
    assert "0.0" in sql
    # No user string interpolated into SQL — reason/severity are prose only.
    assert "low confidence" not in sql


def test_render_pause_campaign():
    sql = render_action_sql(
        "pause_campaign",
        {"campaign_id": 7, "region": "US-CA", "pause_days": 5},
    )
    assert "roll_campaign_daily" in sql or "campaign_performance" in sql
    assert " 7" in sql or "= 7" in sql
    assert "'US-CA'" in sql
    assert "5" in sql


# ---- threshold / status logic ----

def _a(action_type: str, impact_usd: float | None) -> RecommendedAction:
    return RecommendedAction(
        action_type=action_type,               # type: ignore[arg-type]
        rationale="Test action with sufficient rationale text length here.",
        params={},
        impact_usd=impact_usd,
        impact_sql="SELECT 1" if impact_usd is not None else "",
        priority=1,
    )


def test_status_auto_when_all_under_threshold():
    actions = [_a("issue_pr_statement", 100.0)]  # threshold 5_000
    status, thresh = compute_status(actions)
    assert status == "auto_executed"
    assert thresh == DEFAULT_THRESHOLDS_USD["issue_pr_statement"]


def test_status_pending_when_any_over_threshold():
    actions = [
        _a("issue_pr_statement", 100.0),
        _a("shift_marketing_spend", 50_000.0),  # threshold 10_000
    ]
    status, thresh = compute_status(actions)
    assert status == "pending_approval"
    # highest-magnitude threshold that gated is shift_marketing_spend's.
    assert thresh == DEFAULT_THRESHOLDS_USD["shift_marketing_spend"]


def test_status_pending_when_escalate_present():
    actions = [_a("escalate_to_human", 0.0), _a("issue_pr_statement", 100.0)]
    status, _ = compute_status(actions)
    assert status == "pending_approval"


def test_status_pending_when_impact_unknown():
    """impact_usd=None means SQL failed — safest to require approval."""
    actions = [_a("pause_campaign", None)]
    status, _ = compute_status(actions)
    assert status == "pending_approval"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/pytest agents/decision/tests/test_actions.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agents.decision.actions'`.

- [ ] **Step 3: Write the actions module**

Create `backend/agents/decision/actions.py`:

```python
"""Action taxonomy: canonical SQL templates + param specs + threshold logic.

Every RecommendedAction the Decision Agent proposes MUST match one of the
five ActionTypes here. The LLM picks the type and fills `params`; the
orchestrator calls render_action_sql() to produce the exact SQL that
computes impact_usd — the LLM never composes SQL.

INJECTION-DEFENSE: str.format is safe here because (a) param keys are
whitelisted per PARAM_SPECS, (b) param values are type-checked (int /
float / whitelisted enum), (c) free-text params (reason, message_theme)
are NEVER interpolated into SQL — they surface only in the report prose.
"""

from __future__ import annotations

from typing import get_args

from agents.decision.contracts import ActionType, RecommendedAction, ApprovalStatus


ACTION_TYPES: tuple[str, ...] = tuple(get_args(ActionType))


# --- param specs -----------------------------------------------------
# type is a python type; enum whitelists are enforced by validate_params.
# Free-text params (never interpolated into SQL) get type=str.

PARAM_SPECS: dict[str, dict[str, type]] = {
    "shift_marketing_spend": {
        "film_id": int,
        "region": str,          # ClickHouse region code, quoted in template
        "from_channel": str,
        "to_channel": str,
        "shift_pct": float,     # 0-100
        "window_days": int,
    },
    "pause_campaign": {
        "campaign_id": int,
        "region": str,
        "pause_days": int,
    },
    "swap_trailer_variant": {
        "film_id": int,
        "region": str,
        "from_variant": str,
        "to_variant": str,
    },
    "issue_pr_statement": {
        # free-text params — not interpolated into SQL, only into prose.
        "film_id": int,
        "region": str,
        "message_theme": str,
    },
    "escalate_to_human": {
        # both free-text — SQL template returns constant 0.
        "reason": str,
        "severity": str,
    },
}


DEFAULT_THRESHOLDS_USD: dict[str, float] = {
    "shift_marketing_spend": 10_000.0,
    "pause_campaign":        20_000.0,
    "swap_trailer_variant":  15_000.0,
    "issue_pr_statement":     5_000.0,
    "escalate_to_human":     float("inf"),   # always requires approval
}


# --- SQL templates ---------------------------------------------------
# Formatted with str.format(**params). Free-text params in PR/escalate
# actions are omitted from the template (they don't appear in SQL).

TEMPLATES: dict[str, str] = {
    "shift_marketing_spend": """
WITH old_perf AS (
  SELECT sum(sum_conversions) AS conv
  FROM roll_campaign_daily
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND channel = '{from_channel}'
    AND day >= today() - INTERVAL {window_days} DAY
),
new_perf AS (
  SELECT sum(sum_conversions) AS conv
  FROM roll_campaign_daily
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND channel = '{to_channel}'
    AND day >= today() - INTERVAL {window_days} DAY
),
ticket AS (
  SELECT avg(revenue_usd / nullIf(tickets_sold, 0)) AS price
  FROM box_office_revenue
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND date >= today() - INTERVAL 30 DAY
)
SELECT toFloat64(
  ((new_perf.conv - old_perf.conv) * ({shift_pct} / 100.0)) * coalesce(ticket.price, 0)
) AS impact_usd
FROM old_perf, new_perf, ticket
""".strip(),

    "pause_campaign": """
WITH daily AS (
  SELECT
    avg(sum_spend)       AS spend_per_day,
    avg(sum_conversions) AS conv_per_day
  FROM roll_campaign_daily
  WHERE campaign_id = {campaign_id}
    AND region = '{region}'
    AND day >= today() - INTERVAL 14 DAY
),
ticket AS (
  SELECT avg(revenue_usd / nullIf(tickets_sold, 0)) AS price
  FROM box_office_revenue
  WHERE region = '{region}'
    AND date >= today() - INTERVAL 30 DAY
)
SELECT toFloat64(
  (daily.spend_per_day * {pause_days})
  - (daily.conv_per_day * {pause_days} * coalesce(ticket.price, 0))
) AS impact_usd
FROM daily, ticket
""".strip(),

    "swap_trailer_variant": """
WITH from_perf AS (
  SELECT
    avg(sum_views) AS views,
    avg(sum_completion_x_views / nullIf(sum_views, 0)) AS completion_rate
  FROM roll_trailer_hourly
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND variant = '{from_variant}'
    AND ts >= now() - INTERVAL 7 DAY
),
to_perf AS (
  SELECT
    avg(sum_views) AS views,
    avg(sum_completion_x_views / nullIf(sum_views, 0)) AS completion_rate
  FROM roll_trailer_hourly
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND variant = '{to_variant}'
    AND ts >= now() - INTERVAL 7 DAY
),
ticket AS (
  SELECT avg(revenue_usd / nullIf(tickets_sold, 0)) AS price
  FROM box_office_revenue
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND date >= today() - INTERVAL 30 DAY
)
SELECT toFloat64(
  (to_perf.views * to_perf.completion_rate - from_perf.views * from_perf.completion_rate)
  * 24.0 * 7.0                                        -- project to a 7-day window
  * 0.02                                              -- coarse view→ticket rate
  * coalesce(ticket.price, 0)
) AS impact_usd
FROM from_perf, to_perf, ticket
""".strip(),

    "issue_pr_statement": """
WITH sent AS (
  SELECT
    avg(sum_score_weighted / nullIf(sum_volume, 0)) AS avg_score,
    sum(sum_volume) AS total_volume
  FROM roll_sentiment_hourly
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND ts >= now() - INTERVAL 24 HOUR
),
ticket AS (
  SELECT avg(revenue_usd / nullIf(tickets_sold, 0)) AS price
  FROM box_office_revenue
  WHERE film_id = {film_id}
    AND region = '{region}'
    AND date >= today() - INTERVAL 30 DAY
)
SELECT toFloat64(
  -- heuristic: 15% sentiment recovery x affected_volume x 1% conversion rate
  0.15 * coalesce(sent.total_volume, 0) * 0.01 * coalesce(ticket.price, 0)
) AS impact_usd
FROM sent, ticket
""".strip(),

    "escalate_to_human": "SELECT toFloat64(0.0) AS impact_usd",
}


# --- render + validate -----------------------------------------------

def validate_params(action_type: str, params: dict) -> None:
    """Raise ValueError if params don't match the spec for action_type.

    Enforces (a) known action_type, (b) exact key set, (c) value types.
    Enum whitelisting for region/channel/variant is handled by ClickHouse
    at query time — if the LLM sends garbage, the query returns empty
    rather than crashing.
    """
    if action_type not in PARAM_SPECS:
        raise ValueError(f"unknown action_type: {action_type!r}")
    spec = PARAM_SPECS[action_type]
    missing = set(spec) - set(params)
    if missing:
        raise ValueError(
            f"missing required param(s) for {action_type}: {sorted(missing)}"
        )
    extra = set(params) - set(spec)
    if extra:
        raise ValueError(
            f"unexpected param(s) for {action_type}: {sorted(extra)}"
        )
    for k, expected in spec.items():
        v = params[k]
        # Accept int as float where float is expected.
        if expected is float and isinstance(v, int):
            continue
        if not isinstance(v, expected):
            raise ValueError(
                f"param {k!r} for {action_type} expected type "
                f"{expected.__name__}, got {type(v).__name__}"
            )


def render_action_sql(action_type: str, params: dict) -> str:
    """Validate params, then render the template.

    Return an executable SELECT that yields one column `impact_usd`.
    """
    validate_params(action_type, params)
    template = TEMPLATES[action_type]
    # Only interpolate keys the template needs — free-text params for
    # PR/escalate aren't referenced in SQL.
    return template.format(**params)


def compute_status(
    actions: list[RecommendedAction],
) -> tuple[ApprovalStatus, float]:
    """Decide auto_executed vs pending_approval.

    auto_executed only if EVERY action has:
      - impact_usd populated (SQL succeeded), AND
      - impact_usd < DEFAULT_THRESHOLDS_USD[action_type].
    escalate_to_human's inf threshold guarantees it always forces
    pending_approval.

    Returns (status, threshold_that_gated). If auto, threshold is the
    lowest ceiling that was cleared (informational). If pending, it's the
    threshold of the highest-magnitude action that failed the gate.
    """
    gating_threshold = 0.0
    all_auto = True
    for a in actions:
        thr = DEFAULT_THRESHOLDS_USD[a.action_type]
        if a.impact_usd is None or a.impact_usd >= thr:
            all_auto = False
            if thr > gating_threshold and thr != float("inf"):
                gating_threshold = thr
            elif thr == float("inf") and gating_threshold == 0.0:
                gating_threshold = thr
    if all_auto:
        # Report the highest per-action ceiling that was cleared.
        return "auto_executed", max(
            DEFAULT_THRESHOLDS_USD[a.action_type] for a in actions
        )
    return "pending_approval", gating_threshold
```

- [ ] **Step 4: Run tests**

Run: `./venv/bin/pytest agents/decision/tests/test_actions.py -v`
Expected: 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/decision/actions.py backend/agents/decision/tests/test_actions.py
git commit -m "layer 3b: action taxonomy (5 canonical actions, SQL templates, thresholds, status logic)"
```

---

## Task 7: Audit module (`agents/decision/audit.py`)

**Branch on Task 2 outcome:**
- If Task 2 exit 0 (MCP writes work): audit.py uses MCP for both reads and writes.
- If Task 2 exit 2 (MCP blocked): audit.py uses MCP for reads, `clickhouse-connect` for INSERTs only. Include a `BUILD-RISK-FALLBACK` comment.

The code below shows the **MCP-path** implementation. If falling back, replace the `_run_write()` helper body (marked below) with a `clickhouse-connect` INSERT and add the top-of-file comment.

**Files:**
- Create: `backend/agents/decision/audit.py`
- Create: `backend/agents/decision/tests/test_audit.py`

- [ ] **Step 1: Write the failing test (contract-only; DB-touching tests live in acceptance sweep)**

Create `backend/agents/decision/tests/test_audit.py`:

```python
"""Contract tests for AuditRow. Live-DB tests live in acceptance.py."""

from __future__ import annotations

from datetime import datetime, timezone

from agents.decision.audit import AuditRow
from agents.decision.contracts import DecisionResult, RecommendedAction


def _sample_row() -> AuditRow:
    action = RecommendedAction(
        action_type="pause_campaign",
        rationale="Pausing campaign to reduce overspend detected in EU-DE.",
        params={"campaign_id": 42, "region": "EU-DE", "pause_days": 3},
        impact_usd=15_000.0,
        impact_sql="SELECT toFloat64(15000.0) AS impact_usd",
        priority=1,
    )
    dec = DecisionResult(
        decision_id="d-1", investigation_id="i-1",
        actions=[action], status="pending_approval",
        threshold_usd=20_000.0,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        latency_ms=1234,
    )
    return AuditRow(
        decision_id="d-1", investigation_id="i-1",
        detection_dedup_key="k-1", film_id=42, region="EU-DE",
        actions=[action], status="pending_approval",
        threshold_usd=20_000.0, agent_run=dec, report=None,
        approval_status="pending_approval",
        approver="", approval_note="", approved_at=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def test_audit_row_round_trips_through_json():
    r = _sample_row()
    reloaded = AuditRow.model_validate_json(r.model_dump_json())
    assert reloaded.decision_id == "d-1"
    assert reloaded.agent_run.decision_id == "d-1"
    assert reloaded.actions[0].impact_usd == 15_000.0
    assert reloaded.report is None


def test_audit_row_preserves_timezone():
    r = _sample_row()
    reloaded = AuditRow.model_validate_json(r.model_dump_json())
    assert reloaded.created_at.tzinfo is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/pytest agents/decision/tests/test_audit.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agents.decision.audit'`.

- [ ] **Step 3: Write the audit module**

Create `backend/agents/decision/audit.py`:

```python
"""Audit persistence for the Decision + Report agents.

Reads/writes ClickHouse via mcp-clickhouse (Layer 3a boundary rule).

BUILD-RISK-FALLBACK (spec §6.4): if mcp-clickhouse cannot INSERT (readonly
mode couldn't be flipped), replace _run_write() with a clickhouse-connect
call — this is the ONE exception to the agents/ boundary rule, narrowly
scoped to audit INSERTs. Task 2's write_smoke.py determines which path
is live. Grep for BUILD-RISK-FALLBACK to find the swap point.

Schema: decision_audit is ReplacingMergeTree(updated_at) — creation and
approve/deny both INSERT a new row with the same decision_id; SELECT ...
FINAL returns the latest version.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types
from pydantic import BaseModel, Field

from agents.decision.contracts import (
    ApprovalStatus, DecisionResult, RecommendedAction,
)
from agents.investigation.contracts import InvestigationResult
from mcp_integration.client import build_toolset


# Report is imported lazily to avoid a circular import between
# agents.decision (which references it in AuditRow) and agents.report.
def _report_model_class() -> type[BaseModel]:
    from agents.report.contracts import ExecutiveReport
    return ExecutiveReport


class AuditRow(BaseModel):
    """One versioned row from decision_audit (FINAL-resolved)."""

    decision_id: str
    investigation_id: str
    detection_dedup_key: str
    film_id: int
    region: str
    actions: list[RecommendedAction]
    status: ApprovalStatus
    threshold_usd: float
    agent_run: DecisionResult
    report: Any = None                       # ExecutiveReport | None (lazy)
    approval_status: ApprovalStatus
    approver: str = ""
    approval_note: str = ""
    approved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------
# MCP write helper
# ---------------------------------------------------------------------

async def _run_write(sql: str) -> None:
    """Fire a single SQL statement through mcp-clickhouse.

    We drive it through a stub LlmAgent whose only job is to call
    run_query with the SQL we hand it verbatim.

    BUILD-RISK-FALLBACK: to swap to clickhouse-connect, replace this
    body with:
        from data.ch_client import client
        with client() as c:
            c.command(sql)
    and delete the LlmAgent / runner scaffolding. Add a top-of-file
    comment noting Task 2 forced the fallback.
    """
    agent = LlmAgent(
        name="audit_writer",
        model="gemini-2.5-flash",
        instruction=(
            "Call run_query with EXACTLY this SQL and return only 'OK':\n\n"
            + sql
        ),
        tools=[build_toolset()],
    )
    runner = InMemoryRunner(agent=agent, app_name="audit_writer")
    session = await runner.session_service.create_session(
        app_name="audit_writer", user_id="audit"
    )
    async for _ in runner.run_async(
        user_id="audit",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="Run it.")],
        ),
    ):
        pass


async def _run_read(sql: str) -> list[list[Any]]:
    """Fire a single SELECT through mcp-clickhouse and return the rows."""
    agent = LlmAgent(
        name="audit_reader",
        model="gemini-2.5-flash",
        instruction=(
            "Call run_query with EXACTLY this SQL and return ONLY the raw "
            "JSON result the tool gives back:\n\n" + sql
        ),
        tools=[build_toolset()],
    )
    runner = InMemoryRunner(agent=agent, app_name="audit_reader")
    session = await runner.session_service.create_session(
        app_name="audit_reader", user_id="audit"
    )
    rows: list[list[Any]] = []
    async for event in runner.run_async(
        user_id="audit",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="Run it.")],
        ),
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_response:
                    rows = _extract_rows(part.function_response.response)
    return rows


def _extract_rows(resp: Any) -> list[list[Any]]:
    """mcp-clickhouse returns {'structuredContent':{'result':<json-str>}, ...}
    where the json-str parses to {'columns':[...], 'rows':[[...]]}."""
    if isinstance(resp, dict):
        sc = resp.get("structuredContent")
        if isinstance(sc, dict) and isinstance(sc.get("result"), str):
            try:
                parsed = json.loads(sc["result"])
                if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list):
                    return parsed["rows"]
            except json.JSONDecodeError:
                pass
        content = resp.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    txt = item.get("text")
                    if isinstance(txt, str):
                        try:
                            parsed = json.loads(txt)
                            if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list):
                                return parsed["rows"]
                        except json.JSONDecodeError:
                            pass
    return []


def _sql_escape(s: str) -> str:
    """Escape a string for interpolation into a ClickHouse single-quoted literal."""
    return s.replace("\\", "\\\\").replace("'", "\\'")


# ---------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------

def audit_insert(decision: DecisionResult, inv: InvestigationResult) -> AuditRow:
    """Insert the initial audit row for a freshly-created decision.

    approval_status is derived from decision.status:
      - auto_executed  -> approval_status='auto_executed'   (no human needed)
      - pending_approval -> approval_status='pending_approval'
    """
    now = datetime.now(timezone.utc)
    approval_status: ApprovalStatus = (
        "auto_executed" if decision.status == "auto_executed" else "pending_approval"
    )
    row = AuditRow(
        decision_id=decision.decision_id,
        investigation_id=decision.investigation_id,
        detection_dedup_key=inv.detection.dedup_key,
        film_id=inv.detection.film_id,
        region=inv.detection.region,
        actions=list(decision.actions),
        status=decision.status,
        threshold_usd=decision.threshold_usd,
        agent_run=decision,
        report=None,
        approval_status=approval_status,
        approver="",
        approval_note="",
        approved_at=None,
        created_at=now,
        updated_at=now,
    )
    _insert_row(row)
    return row


def audit_attach_report(decision_id: str, report: BaseModel) -> AuditRow:
    """Version-bump the audit row to include the emitted ExecutiveReport."""
    current = get_audit(decision_id)
    if current is None:
        raise ValueError(f"no audit row for decision_id={decision_id!r}")
    current.report = report
    current.updated_at = datetime.now(timezone.utc)
    _insert_row(current)
    return current


def approve_decision(decision_id: str, approver: str, note: str = "") -> AuditRow:
    return _set_approval(decision_id, approver, note, "approved")


def deny_decision(decision_id: str, approver: str, note: str = "") -> AuditRow:
    return _set_approval(decision_id, approver, note, "denied")


def _set_approval(
    decision_id: str, approver: str, note: str, status: ApprovalStatus,
) -> AuditRow:
    current = get_audit(decision_id)
    if current is None:
        raise ValueError(f"no audit row for decision_id={decision_id!r}")
    now = datetime.now(timezone.utc)
    current.approval_status = status
    current.approver = approver
    current.approval_note = note
    current.approved_at = now
    current.updated_at = now
    _insert_row(current)
    return current


def list_recent_audit(limit: int = 50) -> list[AuditRow]:
    sql = (
        "SELECT decision_id, investigation_id, detection_dedup_key, film_id, "
        "region, actions_json, status, threshold_usd, agent_run_json, "
        "report_json, approval_status, approver, approval_note, "
        "toString(approved_at), toString(created_at), toString(updated_at) "
        "FROM decision_audit FINAL "
        f"ORDER BY updated_at DESC LIMIT {int(limit)}"
    )
    rows = asyncio.run(_run_read(sql))
    return [_row_to_audit(r) for r in rows]


def get_audit(decision_id: str) -> AuditRow | None:
    sql = (
        "SELECT decision_id, investigation_id, detection_dedup_key, film_id, "
        "region, actions_json, status, threshold_usd, agent_run_json, "
        "report_json, approval_status, approver, approval_note, "
        "toString(approved_at), toString(created_at), toString(updated_at) "
        "FROM decision_audit FINAL "
        f"WHERE decision_id = '{_sql_escape(decision_id)}' LIMIT 1"
    )
    rows = asyncio.run(_run_read(sql))
    if not rows:
        return None
    return _row_to_audit(rows[0])


# ---------------------------------------------------------------------
# internals
# ---------------------------------------------------------------------

def _insert_row(row: AuditRow) -> None:
    actions_json = _sql_escape(json.dumps([a.model_dump(mode="json") for a in row.actions]))
    agent_run_json = _sql_escape(row.agent_run.model_dump_json())
    report_json = ""
    if row.report is not None:
        report_json = _sql_escape(row.report.model_dump_json())
    approved_at_sql = (
        "NULL" if row.approved_at is None
        else f"toDateTime('{row.approved_at.strftime('%Y-%m-%d %H:%M:%S')}')"
    )
    sql = (
        "INSERT INTO decision_audit "
        "(decision_id, investigation_id, detection_dedup_key, film_id, region, "
        " actions_json, status, threshold_usd, agent_run_json, report_json, "
        " approval_status, approver, approval_note, approved_at, "
        " created_at, updated_at) VALUES "
        f"('{_sql_escape(row.decision_id)}',"
        f" '{_sql_escape(row.investigation_id)}',"
        f" '{_sql_escape(row.detection_dedup_key)}',"
        f" {int(row.film_id)},"
        f" '{_sql_escape(row.region)}',"
        f" '{actions_json}',"
        f" '{_sql_escape(row.status)}',"
        f" {float(row.threshold_usd)},"
        f" '{agent_run_json}',"
        f" '{report_json}',"
        f" '{_sql_escape(row.approval_status)}',"
        f" '{_sql_escape(row.approver)}',"
        f" '{_sql_escape(row.approval_note)}',"
        f" {approved_at_sql},"
        f" toDateTime('{row.created_at.strftime('%Y-%m-%d %H:%M:%S')}'),"
        f" toDateTime('{row.updated_at.strftime('%Y-%m-%d %H:%M:%S')}'))"
    )
    asyncio.run(_run_write(sql))


def _row_to_audit(cols: list[Any]) -> AuditRow:
    (
        decision_id, investigation_id, detection_dedup_key, film_id, region,
        actions_json, status, threshold_usd, agent_run_json, report_json,
        approval_status, approver, approval_note,
        approved_at_str, created_at_str, updated_at_str,
    ) = cols
    ReportCls = _report_model_class()
    report = ReportCls.model_validate_json(report_json) if report_json else None
    return AuditRow(
        decision_id=decision_id,
        investigation_id=investigation_id,
        detection_dedup_key=detection_dedup_key,
        film_id=int(film_id),
        region=region,
        actions=[RecommendedAction.model_validate(a) for a in json.loads(actions_json)],
        status=status,
        threshold_usd=float(threshold_usd),
        agent_run=DecisionResult.model_validate_json(agent_run_json),
        report=report,
        approval_status=approval_status,
        approver=approver,
        approval_note=approval_note,
        approved_at=_parse_ch_dt(approved_at_str),
        created_at=_parse_ch_dt(created_at_str) or datetime.now(timezone.utc),
        updated_at=_parse_ch_dt(updated_at_str) or datetime.now(timezone.utc),
    )


def _parse_ch_dt(s: str | None) -> datetime | None:
    if not s or s in ("1970-01-01 00:00:00", "None"):
        return None
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
```

**Fallback swap (only if Task 2 exit 2):** replace the body of `_run_write()` with:

```python
    from data.ch_client import client
    # BUILD-RISK-FALLBACK: mcp-clickhouse readonly could not be flipped
    # (Task 2 write_smoke exited 2). Audit INSERTs use clickhouse-connect
    # directly — spec §6.4 documented exception, narrowly scoped.
    with client() as c:
        c.command(sql)
```

And add at the top of the file (after the docstring):
```python
# BUILD-RISK-FALLBACK ACTIVE: Task 2 confirmed MCP writes are blocked;
# audit INSERTs use clickhouse-connect (see _run_write). Reads still use MCP.
```

- [ ] **Step 4: Run tests**

Run: `./venv/bin/pytest agents/decision/tests/test_audit.py -v`
Expected: 2 tests PASS.

- [ ] **Step 5: Live smoke — write, read back, approve, read again**

Run this one-liner from `backend/`:

```bash
./venv/bin/python -c "
from datetime import datetime, timezone
from uuid import uuid4
from agents.investigation.contracts import DetectionIn, Hypothesis, InvestigationResult, SignalFinding
from agents.decision.contracts import DecisionResult, RecommendedAction
from agents.decision.audit import audit_insert, get_audit, approve_decision

did = uuid4().hex
det = DetectionIn(metric_ts=datetime(2026,1,1,tzinfo=timezone.utc), metric='m',
    film_id=1, region='US-CA', detector='t', baseline_value=0.5,
    actual_value=0.2, magnitude=-0.6, business_impact=1.0, severity=1.0,
    dedup_key='live-smoke')
inv = InvestigationResult(detection=det, findings=[
    SignalFinding(signal=s, sql='SELECT 1', columns=['x'], rows=[[1]],
        narrative='smoke test narrative long enough to validate.')
    for s in ('numeric_context','text_reason','categorical_isolation','temporal_context')
], hypothesis=Hypothesis(primary_cause='Live smoke hypothesis with enough text.',
    contributing_factors=[], confidence='low', citations=['numeric_context']),
    started_at=datetime.now(timezone.utc), finished_at=datetime.now(timezone.utc))
dec = DecisionResult(decision_id=did, investigation_id=inv.investigation_id,
    actions=[RecommendedAction(action_type='issue_pr_statement',
        rationale='Smoke test action with sufficient rationale length ok.',
        params={'film_id':1,'region':'US-CA','message_theme':'x'},
        impact_usd=100.0, impact_sql='SELECT toFloat64(100.0) AS impact_usd', priority=1)],
    status='auto_executed', threshold_usd=5000.0,
    created_at=datetime.now(timezone.utc), latency_ms=0)
row = audit_insert(dec, inv)
print('inserted', row.decision_id)
back = get_audit(did)
assert back is not None and back.decision_id == did, 'missing after insert'
print('read back OK, status =', back.approval_status)
approved = approve_decision(did, 'live-smoke@example.com', 'looks good')
assert approved.approval_status == 'approved', 'approve did not flip status'
after = get_audit(did)
print('after approve, status =', after.approval_status, 'approver =', after.approver)
"
```

Expected: prints `inserted <hex>`, then `read back OK, status = auto_executed`, then `after approve, status = approved approver = live-smoke@example.com`. No stack trace.

If this fails with a readonly error and you followed the MCP path in Step 3, apply the fallback swap and re-run.

- [ ] **Step 6: Commit**

```bash
git add backend/agents/decision/audit.py backend/agents/decision/tests/test_audit.py
git commit -m "layer 3b: audit module (AuditRow + insert/approve/deny/get/list via mcp)"
```

If you applied the fallback swap, use this commit message instead:
```
layer 3b: audit module (fallback: clickhouse-connect for INSERTs, mcp for reads)
```

---

## Task 8: Decision prompt (`agents/decision/prompts.py`)

**Files:**
- Create: `backend/agents/decision/prompts.py`

- [ ] **Step 1: Write the prompt module**

Create `backend/agents/decision/prompts.py`:

```python
"""System prompt for the Decision Agent.

One agent, one prompt, one file so iteration is a single edit.

The LLM does semantic selection ONLY — it never composes SQL, never
computes impact_usd. The orchestrator renders canonical SQL from
actions.py::TEMPLATES and executes it.
"""

from __future__ import annotations

from agents.decision.actions import PARAM_SPECS


def _render_param_reference() -> str:
    """Formatted PARAM_SPECS block for inclusion in the prompt."""
    lines = []
    for action_type, spec in PARAM_SPECS.items():
        keys = ", ".join(f"{k}:{v.__name__}" for k, v in spec.items())
        lines.append(f"  {action_type}({keys})")
    return "\n".join(lines)


DECISION_PROMPT = f"""\
You are the Decision Agent for Studio Crisis Commander.

You will be given an InvestigationResult in session state as `investigation`:
  - `detection` (the anomaly)
  - `findings` (4 signal findings: numeric_context, text_reason,
    categorical_isolation, temporal_context — each with sql/rows/narrative)
  - `hypothesis` (primary_cause, confidence, citations)

Your job: emit a DecisionResult with 1-3 RecommendedActions.

RULES (violations will fail validation):
  1. Every action MUST use one of the 5 canonical action_types:
       shift_marketing_spend, pause_campaign, swap_trailer_variant,
       issue_pr_statement, escalate_to_human
  2. Fill `params` per the schema for that action_type (see below).
     Types matter: film_id is int, shift_pct is float, etc.
  3. Rank actions by `priority` (1=highest impact / most urgent, 3=lowest).
  4. Write `rationale` in 1-2 sentences (>=20 chars) tying the action to
     specific findings ("EU-DE sentiment drop of 42% per numeric_context").
  5. LEAVE `impact_sql` AND `impact_usd` BLANK / null / empty — the
     orchestrator fills them by running canonical SQL. If you emit values
     here they will be stripped.
  6. If hypothesis.confidence is "low" OR findings contradict each other,
     include `escalate_to_human` as priority 1 with a `reason` param
     summarizing the ambiguity.
  7. Reuse `investigation_id`, and set `decision_id` to any short string
     (orchestrator overrides). Set `status="pending_approval"` and
     `threshold_usd=0` — orchestrator recomputes.

Param schemas per action_type:
{_render_param_reference()}

Return ONLY a valid DecisionResult JSON object matching the output schema.
"""
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `./venv/bin/python -c "from agents.decision.prompts import DECISION_PROMPT; assert 'action_type' in DECISION_PROMPT; assert 'pause_campaign(campaign_id' in DECISION_PROMPT; print('OK')"`
Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/agents/decision/prompts.py
git commit -m "layer 3b: decision prompt (semantic selection only, orchestrator fills impact)"
```

---

## Task 9: Decision agent + orchestrator (`agents/decision/agent.py`)

**Files:**
- Create: `backend/agents/decision/agent.py`

- [ ] **Step 1: Write the agent module**

Create `backend/agents/decision/agent.py`:

```python
"""Decision Agent — one Flash LlmAgent (no tools) + Python orchestrator.

Flow:
  1. LlmAgent proposes actions with rationale + params (no SQL/no numbers).
  2. Orchestrator validates params, renders canonical SQL per action.
  3. Orchestrator executes each SQL through a shared MCPToolset.
  4. Orchestrator populates impact_usd / impact_sql on each action.
  5. Orchestrator computes status (auto vs pending) from thresholds.
  6. Orchestrator writes the audit row.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from agents.decision.actions import (
    compute_status, render_action_sql, validate_params,
)
from agents.decision.audit import audit_insert
from agents.decision.contracts import DecisionResult, RecommendedAction
from agents.decision.prompts import DECISION_PROMPT
from agents.investigation.contracts import InvestigationResult
from mcp_integration.client import build_toolset


DECISION_TIMEOUT_SECONDS = 45.0
FLASH = "gemini-2.5-flash"


class DecisionImpactError(RuntimeError):
    """All actions had SQL failures — nothing to auto-execute or approve."""


class DecisionTimeout(RuntimeError):
    """Decision pipeline exceeded DECISION_TIMEOUT_SECONDS."""


def build_decision_agent() -> LlmAgent:
    """Fresh LlmAgent for the Decision step. No tools — semantic only.

    Layer 4 uses this directly for SSE event streaming.
    """
    return LlmAgent(
        name="decision",
        model=FLASH,
        instruction=DECISION_PROMPT,
        tools=[],
        output_schema=DecisionResult,
        output_key="decision",
        description="Proposes 1-3 SQL-grounded, threshold-gated actions.",
    )


async def invoke_decision(inv: InvestigationResult) -> DecisionResult:
    """Run the Decision Agent, orchestrate impact SQL, persist audit row."""
    try:
        return await asyncio.wait_for(
            _run_pipeline(inv), timeout=DECISION_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError as e:
        raise DecisionTimeout(
            f"Decision exceeded {DECISION_TIMEOUT_SECONDS:.0f}s"
        ) from e


async def _run_pipeline(inv: InvestigationResult) -> DecisionResult:
    t0 = time.perf_counter()

    # --- 1. LLM proposes actions ---------------------------------------
    agent = build_decision_agent()
    runner = InMemoryRunner(agent=agent, app_name="decision")
    session = await runner.session_service.create_session(
        app_name="decision", user_id="decision-user",
        state={"investigation": inv.model_dump(mode="json")},
    )
    async for _ in runner.run_async(
        user_id="decision-user",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(
                text="Propose 1-3 RecommendedActions for the investigation."
            )],
        ),
    ):
        pass

    reloaded = await runner.session_service.get_session(
        app_name="decision", user_id="decision-user", session_id=session.id,
    )
    raw = reloaded.state.get("decision")
    if raw is None:
        raise RuntimeError("decision agent produced no output in session state")
    if isinstance(raw, str):
        raw = json.loads(raw)

    # Strip any impact fields the LLM might have leaked in violation of Rule 5.
    for a in raw.get("actions", []):
        a["impact_usd"] = None
        a["impact_sql"] = ""
        a["impact_error"] = ""

    proposed = DecisionResult.model_validate(raw)

    # --- 2. Validate params + render SQL --------------------------------
    rendered: list[tuple[RecommendedAction, str]] = []
    for a in proposed.actions:
        try:
            validate_params(a.action_type, a.params)
            sql = render_action_sql(a.action_type, a.params)
            a.impact_sql = sql
        except ValueError as e:
            a.impact_error = f"param validation: {e}"
            sql = ""
        rendered.append((a, sql))

    # --- 3. Execute impact SQL via a shared MCP toolset ------------------
    toolset = build_toolset()
    impacts = await _run_impacts(toolset, [sql for _, sql in rendered])
    for (action, _), impact in zip(rendered, impacts):
        if isinstance(impact, Exception):
            action.impact_error = str(impact)[:400]
        elif impact is None:
            action.impact_error = "query returned no rows"
        else:
            action.impact_usd = impact

    if all(a.impact_usd is None for a in proposed.actions):
        raise DecisionImpactError(
            "All impact SQLs failed — no action has a computed impact_usd. "
            "Details: " + " | ".join(
                f"[{a.action_type}] {a.impact_error}" for a in proposed.actions
            )
        )

    # --- 4. Recompute status + finalize the DecisionResult ---------------
    status, threshold = compute_status(list(proposed.actions))
    final = DecisionResult(
        decision_id=uuid4().hex,
        investigation_id=inv.investigation_id,
        actions=list(proposed.actions),
        status=status,
        threshold_usd=threshold,
        created_at=datetime.now(timezone.utc),
        latency_ms=int((time.perf_counter() - t0) * 1000),
    )

    # --- 5. Audit persist ------------------------------------------------
    audit_insert(final, inv)

    return final


# ---------------------------------------------------------------------
# Impact-SQL executor — runs each rendered SQL through mcp-clickhouse and
# extracts the single Float64 impact_usd cell. Runs sequentially (small
# N=1..3; sequential keeps the shared MCP subprocess simple).
# ---------------------------------------------------------------------

async def _run_impacts(
    toolset: Any, sqls: list[str],
) -> list[float | None | Exception]:
    results: list[float | None | Exception] = []
    for sql in sqls:
        if not sql:
            results.append(None)
            continue
        try:
            results.append(await _run_one_impact(toolset, sql))
        except Exception as e:                                # noqa: BLE001
            results.append(e)
    return results


async def _run_one_impact(toolset: Any, sql: str) -> float | None:
    """Run one impact SQL via a stub agent that uses the shared toolset."""
    agent = LlmAgent(
        name="impact_runner",
        model=FLASH,
        instruction=(
            "Call run_query with EXACTLY this SQL and return ONLY the raw "
            "JSON result the tool gives back:\n\n" + sql
        ),
        tools=[toolset],
    )
    runner = InMemoryRunner(agent=agent, app_name="impact")
    session = await runner.session_service.create_session(
        app_name="impact", user_id="impact",
    )
    rows: list[list[Any]] = []
    async for event in runner.run_async(
        user_id="impact",
        session_id=session.id,
        new_message=types.Content(
            role="user", parts=[types.Part.from_text(text="Run it.")],
        ),
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_response:
                    rows = _extract_rows(part.function_response.response) or rows
    if not rows or not rows[0]:
        return None
    val = rows[0][0]
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _extract_rows(resp: Any) -> list[list[Any]]:
    """Mirror of audit._extract_rows — mcp-clickhouse response parser."""
    if isinstance(resp, dict):
        sc = resp.get("structuredContent")
        if isinstance(sc, dict) and isinstance(sc.get("result"), str):
            try:
                parsed = json.loads(sc["result"])
                if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list):
                    return parsed["rows"]
            except json.JSONDecodeError:
                pass
        content = resp.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    txt = item.get("text")
                    if isinstance(txt, str):
                        try:
                            parsed = json.loads(txt)
                            if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list):
                                return parsed["rows"]
                        except json.JSONDecodeError:
                            pass
    return []
```

- [ ] **Step 2: Verify import**

Run: `./venv/bin/python -c "from agents.decision.agent import invoke_decision, build_decision_agent, DECISION_TIMEOUT_SECONDS; print('OK', DECISION_TIMEOUT_SECONDS)"`
Expected: prints `OK 45.0`.

- [ ] **Step 3: Commit**

```bash
git add backend/agents/decision/agent.py
git commit -m "layer 3b: decision agent + orchestrator (llm selects, orchestrator runs impact sql)"
```

---

## Task 10: Report contracts (`agents/report/contracts.py`)

**Files:**
- Create: `backend/agents/report/contracts.py`
- Create: `backend/agents/report/tests/test_contracts.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/agents/report/tests/test_contracts.py`:

```python
"""Contract tests for agents.report.contracts."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from agents.report.contracts import (
    ExecutiveReport, FindingSource, KeyFigure,
)


def _valid_kf(**over) -> KeyFigure:
    base = dict(
        label="EU-DE sentiment drop",
        value="-42%",
        source_query="SELECT avg_score FROM roll_sentiment_hourly WHERE 1=1",
        source=FindingSource(signal="numeric_context", query_index=0),
    )
    base.update(over)
    return KeyFigure(**base)


def test_key_figure_source_query_required():
    with pytest.raises(ValidationError):
        _valid_kf(source_query="")


def test_key_figure_source_query_min_length():
    with pytest.raises(ValidationError):
        _valid_kf(source_query="SELECT 1")


def test_finding_source_signal_literal_enforced():
    with pytest.raises(ValidationError):
        FindingSource(signal="not_a_signal", query_index=0)  # type: ignore[arg-type]


def test_finding_source_query_index_non_negative():
    with pytest.raises(ValidationError):
        FindingSource(signal="numeric_context", query_index=-1)


def _valid_report(**over) -> ExecutiveReport:
    base = dict(
        report_id="r-1", decision_id="d-1",
        headline="Trailer variant B is driving a large drop in EU-DE completions.",
        tldr=(
            "EU-DE completions on trailer variant B fell 22% over 24h. "
            "We're swapping to variant A and issuing a coordinated PR nudge."
        ),
        key_figures=[_valid_kf()],
        recommended_actions_prose=(
            "Swap trailer variant to A in EU-DE (projected $12,400 uplift). "
            "Issue PR statement addressing pacing concerns."
        ),
        risks_and_caveats=(
            "Confidence is medium; text_reason found only 6 low-score reviews."
        ),
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        latency_ms=1000,
    )
    base.update(over)
    return ExecutiveReport(**base)


def test_report_requires_at_least_one_key_figure():
    with pytest.raises(ValidationError):
        _valid_report(key_figures=[])


def test_report_caps_key_figures_at_eight():
    with pytest.raises(ValidationError):
        _valid_report(key_figures=[_valid_kf() for _ in range(9)])


def test_report_headline_min_length():
    with pytest.raises(ValidationError):
        _valid_report(headline="short")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/pytest agents/report/tests/test_contracts.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agents.report.contracts'`.

- [ ] **Step 3: Write the contracts module**

Create `backend/agents/report/contracts.py`:

```python
"""Pydantic contracts for the Executive Report Agent.

KeyFigure.source_query is the provenance anchor: every number cited in
the report MUST come from a SQL that was actually run (either an
investigation finding SQL, or a decision action impact_sql).

value is a string, not a float — the LLM may format as "-42%", "$1.2M",
"3 of 5 regions", etc. Provenance is enforced via source_query, not by
re-parsing the number.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class FindingSource(BaseModel):
    """Points at the query that produced a KeyFigure.

    For signal in the 4 investigation types: query_index selects into
    inv.findings[i].sql (Layer 3a emits one SQL per finding — usually 0).

    For signal == 'decision_impact': query_index selects into
    dec.actions[i].impact_sql.
    """

    signal: Literal[
        "numeric_context", "text_reason",
        "categorical_isolation", "temporal_context",
        "decision_impact",
    ]
    query_index: int = Field(ge=0)


class KeyFigure(BaseModel):
    """One anchored number in the executive report."""

    label: str = Field(min_length=3)
    value: str = Field(min_length=1)
    source_query: str = Field(min_length=10)
    source: FindingSource


class ExecutiveReport(BaseModel):
    """Top-level artifact returned by invoke_report()."""

    report_id: str
    decision_id: str
    headline: str = Field(min_length=20, max_length=200)
    tldr: str = Field(min_length=40, max_length=800)
    key_figures: list[KeyFigure] = Field(min_length=1, max_length=8)
    recommended_actions_prose: str = Field(min_length=40)
    risks_and_caveats: str
    created_at: datetime
    latency_ms: int = 0
```

- [ ] **Step 4: Run tests**

Run: `./venv/bin/pytest agents/report/tests/test_contracts.py -v`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/report/contracts.py backend/agents/report/tests/test_contracts.py
git commit -m "layer 3b: report contracts (ExecutiveReport, KeyFigure, FindingSource)"
```

---

## Task 11: Report provenance validator (`agents/report/_provenance.py`)

**Files:**
- Create: `backend/agents/report/_provenance.py`
- Create: `backend/agents/report/tests/test_provenance.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/agents/report/tests/test_provenance.py`:

```python
"""Unit tests for _validate_report_provenance."""

from __future__ import annotations

from datetime import datetime, timezone

from agents.decision.contracts import DecisionResult, RecommendedAction
from agents.investigation.contracts import (
    DetectionIn, Hypothesis, InvestigationResult, SignalFinding,
)
from agents.report._provenance import validate_report_provenance
from agents.report.contracts import ExecutiveReport, FindingSource, KeyFigure


def _inv() -> InvestigationResult:
    det = DetectionIn(
        metric_ts=datetime(2026, 1, 1, tzinfo=timezone.utc), metric="m",
        film_id=1, region="US-CA", detector="t", baseline_value=0.5,
        actual_value=0.2, magnitude=-0.6, business_impact=1.0,
        severity=1.0, dedup_key="k",
    )
    findings = [
        SignalFinding(signal="numeric_context",
                      sql="SELECT sum FROM roll_sentiment_hourly WHERE 1",
                      columns=["x"], rows=[[1]],
                      narrative="Baseline narrative that's long enough."),
        SignalFinding(signal="text_reason",
                      sql="SELECT raw_text FROM reviews_text WHERE 2",
                      columns=["y"], rows=[[1]],
                      narrative="Baseline narrative that's long enough."),
        SignalFinding(signal="categorical_isolation",
                      sql="SELECT region FROM roll_sentiment_hourly WHERE 3",
                      columns=["z"], rows=[[1]],
                      narrative="Baseline narrative that's long enough."),
        SignalFinding(signal="temporal_context",
                      sql="SELECT ts FROM detections WHERE 4",
                      columns=["w"], rows=[[1]],
                      narrative="Baseline narrative that's long enough."),
    ]
    return InvestigationResult(
        detection=det, findings=findings,
        hypothesis=Hypothesis(
            primary_cause="Test primary cause with enough characters here.",
            contributing_factors=[], confidence="medium",
            citations=["numeric_context"],
        ),
        started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        finished_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def _dec(inv: InvestigationResult) -> DecisionResult:
    return DecisionResult(
        decision_id="d-1", investigation_id=inv.investigation_id,
        actions=[RecommendedAction(
            action_type="issue_pr_statement",
            rationale="Test rationale with sufficient character length here.",
            params={"film_id": 1, "region": "US-CA", "message_theme": "x"},
            impact_usd=100.0,
            impact_sql="SELECT toFloat64(100.0) AS impact_usd",
            priority=1,
        )],
        status="auto_executed", threshold_usd=5000.0,
        created_at=datetime.now(timezone.utc), latency_ms=0,
    )


def _report(source_query: str, source: FindingSource) -> ExecutiveReport:
    return ExecutiveReport(
        report_id="r-1", decision_id="d-1",
        headline="Test headline with more than the twenty char minimum here.",
        tldr="Test tldr text that is comfortably above the forty character minimum ok.",
        key_figures=[KeyFigure(label="k", value="v",
                               source_query=source_query, source=source)],
        recommended_actions_prose=(
            "Prose section with sufficient length to clear the minimum threshold."
        ),
        risks_and_caveats="Caveat.",
        created_at=datetime.now(timezone.utc),
    )


def test_provenance_ok_when_source_query_matches_finding():
    inv = _inv()
    dec = _dec(inv)
    r = _report(
        source_query=inv.findings[0].sql,
        source=FindingSource(signal="numeric_context", query_index=0),
    )
    ok, violations = validate_report_provenance(r, inv, dec)
    assert ok, violations


def test_provenance_ok_when_source_query_matches_impact_sql():
    inv = _inv()
    dec = _dec(inv)
    r = _report(
        source_query=dec.actions[0].impact_sql,
        source=FindingSource(signal="decision_impact", query_index=0),
    )
    ok, violations = validate_report_provenance(r, inv, dec)
    assert ok, violations


def test_provenance_fails_when_source_query_is_fabricated():
    inv = _inv()
    dec = _dec(inv)
    r = _report(
        source_query="SELECT * FROM some_table_the_agent_invented",
        source=FindingSource(signal="numeric_context", query_index=0),
    )
    ok, violations = validate_report_provenance(r, inv, dec)
    assert not ok
    assert violations and "fabricated" in violations[0].lower() or "not found" in violations[0].lower()


def test_provenance_fails_on_wrong_signal_binding():
    """source_query matches an impact_sql, but source claims it's from numeric_context."""
    inv = _inv()
    dec = _dec(inv)
    r = _report(
        source_query=dec.actions[0].impact_sql,
        source=FindingSource(signal="numeric_context", query_index=0),
    )
    ok, violations = validate_report_provenance(r, inv, dec)
    assert not ok


def test_provenance_fails_on_out_of_range_query_index():
    inv = _inv()
    dec = _dec(inv)
    r = _report(
        source_query=dec.actions[0].impact_sql,
        source=FindingSource(signal="decision_impact", query_index=5),
    )
    ok, violations = validate_report_provenance(r, inv, dec)
    assert not ok
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/pytest agents/report/tests/test_provenance.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agents.report._provenance'`.

- [ ] **Step 3: Write the validator**

Create `backend/agents/report/_provenance.py`:

```python
"""Server-side provenance validation for the Executive Report.

Every KeyFigure.source_query MUST match verbatim one of:
  - inv.findings[query_index].sql where signal matches the finding's signal
  - dec.actions[query_index].impact_sql when signal == "decision_impact"

Match is exact string equality (after strip). We do NOT normalize
whitespace or reformat — the LLM was told "copy VERBATIM" and we hold
it to that. Fuzzy match would let it invent-and-explain-away.
"""

from __future__ import annotations

from agents.decision.contracts import DecisionResult
from agents.investigation.contracts import InvestigationResult
from agents.report.contracts import ExecutiveReport


def validate_report_provenance(
    report: ExecutiveReport,
    inv: InvestigationResult,
    dec: DecisionResult,
) -> tuple[bool, list[str]]:
    """Return (all_valid, list_of_violations)."""
    violations: list[str] = []

    # Build the lookup: signal -> list of allowed SQL strings.
    finding_sql_by_signal: dict[str, list[str]] = {
        f.signal: [f.sql.strip()] for f in inv.findings
    }
    impact_sqls: list[str] = [a.impact_sql.strip() for a in dec.actions]

    for i, kf in enumerate(report.key_figures):
        target = kf.source_query.strip()
        sig = kf.source.signal
        idx = kf.source.query_index

        if sig == "decision_impact":
            if idx >= len(impact_sqls):
                violations.append(
                    f"key_figures[{i}] ({kf.label!r}): query_index={idx} "
                    f"out of range for decision.actions (len={len(impact_sqls)})"
                )
                continue
            if impact_sqls[idx] != target:
                violations.append(
                    f"key_figures[{i}] ({kf.label!r}): source_query does not "
                    f"match dec.actions[{idx}].impact_sql — possibly fabricated"
                )
        else:
            candidates = finding_sql_by_signal.get(sig, [])
            if idx >= len(candidates):
                violations.append(
                    f"key_figures[{i}] ({kf.label!r}): query_index={idx} "
                    f"out of range for signal={sig!r} (len={len(candidates)})"
                )
                continue
            if candidates[idx] != target:
                violations.append(
                    f"key_figures[{i}] ({kf.label!r}): source_query does not "
                    f"match inv.findings signal={sig!r} sql[{idx}] — "
                    f"possibly fabricated or wrong signal binding"
                )

    return (len(violations) == 0), violations
```

- [ ] **Step 4: Run tests**

Run: `./venv/bin/pytest agents/report/tests/test_provenance.py -v`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/report/_provenance.py backend/agents/report/tests/test_provenance.py
git commit -m "layer 3b: report provenance validator (verbatim source_query match, no fuzzy)"
```

---

## Task 12: Report prompt + agent (`agents/report/prompts.py` + `agents/report/agent.py`)

**Files:**
- Create: `backend/agents/report/prompts.py`
- Create: `backend/agents/report/agent.py`

- [ ] **Step 1: Write the prompt**

Create `backend/agents/report/prompts.py`:

```python
"""System prompt for the Executive Report Agent.

Reads (investigation, decision) from session state and emits ONE
ExecutiveReport JSON. No tools. Provenance-checked after emit.
"""

from __future__ import annotations


REPORT_PROMPT = """\
You are the Executive Report Agent for Studio Crisis Commander.

You will be given in session state:
  investigation: {investigation}   (4 findings + hypothesis)
  decision:      {decision}         (1-3 actions with impact_usd + impact_sql)

Produce an ExecutiveReport for a C-suite reader.

RULES (violations fail validation):
  1. `headline` (>=20 chars, <=200): one sentence, the crisis in plain
     language. NO NUMBERS in the headline.
  2. `tldr` (>=40 chars, <=800): 2-4 sentences. What happened and what
     you're doing about it. You MAY cite numbers here, but each one MUST
     also appear as a KeyFigure below with matching source_query.
  3. `key_figures` (1-8): the specific numbers that anchor the story.
     For EACH KeyFigure:
       - `label` (>=3 chars): short human-readable description.
       - `value` (string): format naturally — "-42%", "$1.2M", "3 of 5 regions".
       - `source_query`: COPY VERBATIM from EITHER:
           * investigation.findings[i].sql for one of the 4 signal
             findings, OR
           * decision.actions[i].impact_sql when the number is an
             action's impact_usd.
         Do NOT paraphrase, reformat, add whitespace, or truncate.
       - `source.signal`: match the signal name whose SQL you copied
         ("numeric_context" | "text_reason" | "categorical_isolation" |
          "temporal_context" | "decision_impact").
       - `source.query_index`: 0 for finding SQLs (there's one each);
         for decision_impact, the index into decision.actions.
  4. `recommended_actions_prose` (>=40 chars): narrate decision.actions
     in the order given. Cite each action's impact_usd inline (this
     satisfies rule 3 for those numbers). NO new numbers beyond what
     appears in decision.actions.
  5. `risks_and_caveats`: 1-3 sentences on hypothesis confidence,
     contradictions across findings, or low-data signals. May cite the
     confidence label ("medium"), no other numbers.

You do NOT need to set report_id, created_at, latency_ms — the
orchestrator overrides them.

Return ONLY a valid ExecutiveReport JSON object matching the output schema.
"""
```

- [ ] **Step 2: Write the agent**

Create `backend/agents/report/agent.py`:

```python
"""Executive Report Agent — one Flash LlmAgent (no tools) + provenance check.

Flow:
  1. LlmAgent reads (investigation, decision) from session state.
  2. Emits an ExecutiveReport (Pydantic-validated by output_schema).
  3. Orchestrator runs validate_report_provenance — raises
     ReportProvenanceError if any KeyFigure.source_query doesn't match
     inputs verbatim.
  4. Orchestrator overrides report_id, created_at, latency_ms.
  5. Orchestrator attaches the report to the audit row.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from uuid import uuid4

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from agents.decision.audit import audit_attach_report
from agents.decision.contracts import DecisionResult
from agents.investigation.contracts import InvestigationResult
from agents.report._provenance import validate_report_provenance
from agents.report.contracts import ExecutiveReport
from agents.report.prompts import REPORT_PROMPT


REPORT_TIMEOUT_SECONDS = 20.0
FLASH = "gemini-2.5-flash"


class ReportProvenanceError(RuntimeError):
    """Report emitted KeyFigures whose source_query does not match inputs."""

    def __init__(self, violations: list[str]) -> None:
        super().__init__(
            "report provenance violations:\n  - " + "\n  - ".join(violations)
        )
        self.violations = violations


class ReportTimeout(RuntimeError):
    """Report pipeline exceeded REPORT_TIMEOUT_SECONDS."""


def build_report_agent() -> LlmAgent:
    """Fresh LlmAgent for the Report step. No tools — no queries."""
    return LlmAgent(
        name="report",
        model=FLASH,
        instruction=REPORT_PROMPT,
        tools=[],
        output_schema=ExecutiveReport,
        output_key="report",
        description="C-suite executive report with query-anchored KeyFigures.",
    )


async def invoke_report(
    inv: InvestigationResult, dec: DecisionResult,
) -> ExecutiveReport:
    try:
        return await asyncio.wait_for(
            _run_pipeline(inv, dec), timeout=REPORT_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError as e:
        raise ReportTimeout(
            f"Report exceeded {REPORT_TIMEOUT_SECONDS:.0f}s"
        ) from e


async def _run_pipeline(
    inv: InvestigationResult, dec: DecisionResult,
) -> ExecutiveReport:
    t0 = time.perf_counter()

    agent = build_report_agent()
    runner = InMemoryRunner(agent=agent, app_name="report")
    session = await runner.session_service.create_session(
        app_name="report", user_id="report-user",
        state={
            "investigation": inv.model_dump(mode="json"),
            "decision": dec.model_dump(mode="json"),
        },
    )
    async for _ in runner.run_async(
        user_id="report-user",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="Write the executive report.")],
        ),
    ):
        pass

    reloaded = await runner.session_service.get_session(
        app_name="report", user_id="report-user", session_id=session.id,
    )
    raw = reloaded.state.get("report")
    if raw is None:
        raise RuntimeError("report agent produced no output in session state")
    if isinstance(raw, str):
        raw = json.loads(raw)

    report = ExecutiveReport.model_validate(raw)

    ok, violations = validate_report_provenance(report, inv, dec)
    if not ok:
        raise ReportProvenanceError(violations)

    final = report.model_copy(update={
        "report_id": uuid4().hex,
        "decision_id": dec.decision_id,
        "created_at": datetime.now(timezone.utc),
        "latency_ms": int((time.perf_counter() - t0) * 1000),
    })

    audit_attach_report(dec.decision_id, final)
    return final
```

- [ ] **Step 3: Verify imports**

Run: `./venv/bin/python -c "from agents.report.agent import invoke_report, build_report_agent, REPORT_TIMEOUT_SECONDS, ReportProvenanceError; print('OK', REPORT_TIMEOUT_SECONDS)"`
Expected: prints `OK 20.0`.

- [ ] **Step 4: Commit**

```bash
git add backend/agents/report/prompts.py backend/agents/report/agent.py
git commit -m "layer 3b: report agent (llm + provenance-verified executive report)"
```

---

## Task 13: Fixture regenerator + capture 3 real InvestigationResults

**Files:**
- Create: `backend/agents/decision/tests/fixtures/regenerate_fixtures.py`
- Create: `backend/agents/decision/tests/fixtures/inv_sentiment_collapse.json` (generated)
- Create: `backend/agents/decision/tests/fixtures/inv_marketing_overspend.json` (generated)
- Create: `backend/agents/decision/tests/fixtures/inv_competitor_collision.json` (generated)

- [ ] **Step 1: Write the regenerator script**

Create `backend/agents/decision/tests/fixtures/regenerate_fixtures.py`:

```python
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
    "marketing_overspend":  "marketing_overspend",
    "competitor_collision": "competitor_release",
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
      WHERE is_live = 0 AND crisis_kind = '{kind}'
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


async def main() -> int:
    exit_code = 0
    for name, kind in ARCHETYPES.items():
        det = _pick_detection_for(kind)
        if det is None:
            print(f"SKIP {name}: no non-live crisis of kind={kind!r}", file=sys.stderr)
            exit_code = 1
            continue
        print(f"[{name}] running Layer 3a against {det.dedup_key} ...", flush=True)
        result = await invoke_investigation(det)
        out = FIXTURE_DIR / f"inv_{name}.json"
        out.write_text(result.model_dump_json(indent=2))
        print(f"[{name}] wrote {out.name} ({out.stat().st_size} bytes)")
    return exit_code


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

- [ ] **Step 2: Run it to produce fixtures**

Run (from `backend/`): `./venv/bin/python -m agents.decision.tests.fixtures.regenerate_fixtures`

Expected: three `inv_*.json` files under `agents/decision/tests/fixtures/`, each a few KB. Total wall time ~5-6 minutes (three Layer 3a runs). If any archetype prints `SKIP`, the crisis_ground_truth may not have that kind — check with:
```bash
./venv/bin/python -c "from data.ch_client import client; c=client().__enter__(); print(c.query(\"SELECT crisis_kind, count() FROM crisis_ground_truth FINAL WHERE is_live=0 GROUP BY crisis_kind\").result_rows)"
```
If a kind is missing entirely, edit `ARCHETYPES` to pick an available substitute and re-run.

- [ ] **Step 3: Sanity check the fixtures load**

Run:
```bash
./venv/bin/python -c "
import json
from pathlib import Path
from agents.investigation.contracts import InvestigationResult
for f in Path('agents/decision/tests/fixtures').glob('inv_*.json'):
    obj = InvestigationResult.model_validate_json(f.read_text())
    print(f.name, '->', obj.detection.dedup_key, 'confidence:', obj.hypothesis.confidence)
"
```
Expected: 3 lines, one per fixture, each with a dedup_key and a confidence label.

- [ ] **Step 4: Commit fixtures + regenerator**

```bash
git add backend/agents/decision/tests/fixtures/
git commit -m "layer 3b: golden fixtures (3 InvestigationResult archetypes) + regenerator"
```

---

## Task 14: Acceptance sweep (`agents/decision/acceptance.py`)

**Files:**
- Create: `backend/agents/decision/acceptance.py`

- [ ] **Step 1: Write the acceptance sweep**

Create `backend/agents/decision/acceptance.py`:

```python
"""Layer 3b acceptance sweep — 9 checks. Exit 0 if all pass, 1 otherwise.

  §1 boundary grep    §2 fixtures load     §3 taxonomy compliance
  §4 impact provenance §5 status logic     §6 audit persisted
  §7 report provenance §8 latency (fixture) §9 live end-to-end smoke

§9 costs ~$0.15 (one Layer 3a + one Layer 3b run). Fixture-only checks
(§3-§8) cost ~$0.05 across the 3 fixtures. Total ~$0.20/run.
"""

from __future__ import annotations

import asyncio
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

from agents.decision.acceptance_helpers import (
    load_one_crisis_detection,
    reload_impact_via_mcp,
)
from agents.decision.actions import (
    ACTION_TYPES, DEFAULT_THRESHOLDS_USD, compute_status, validate_params,
)
from agents.decision.agent import invoke_decision
from agents.decision.audit import (
    approve_decision, audit_attach_report, get_audit,
)
from agents.decision.contracts import DecisionResult
from agents.investigation.agent import invoke_investigation
from agents.investigation.contracts import InvestigationResult
from agents.report._provenance import validate_report_provenance
from agents.report.agent import invoke_report


FIXTURE_DIR = Path(__file__).parent / "tests" / "fixtures"
MEAN_LATENCY_TARGET_SECONDS = 25.0
MAX_LATENCY_TARGET_SECONDS = 40.0
IMPACT_DRIFT_TOLERANCE = 0.05
LIVE_TOTAL_LATENCY_CAP = 180.0


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
         "backend/agents/decision/", "backend/agents/report/",
         "--include=*.py",
         "--exclude=backend/agents/decision/audit.py",
         "--exclude-dir=venv", "--exclude-dir=__pycache__"],
        capture_output=True, text=True, check=False,
    )
    bad = [p for p in r.stdout.strip().split("\n") if p]
    # audit.py is an explicit fallback exception (spec §6.4). Anything else
    # is a boundary violation.
    bad = [p for p in bad if not p.endswith("/audit.py")]
    if bad:
        _fail(f"boundary violation — {bad}")
    print("PASS §1: no direct ClickHouse client imports in decision/report "
          "(audit.py fallback exempt per spec §6.4)")


# ---------------------------------------------------------------------
# §2 — Fixtures load & validate
# ---------------------------------------------------------------------
def check_2_fixtures_load() -> list[InvestigationResult]:
    paths = sorted(FIXTURE_DIR.glob("inv_*.json"))
    if len(paths) < 3:
        _fail(f"§2 need >=3 fixtures under {FIXTURE_DIR}, found {len(paths)}. "
              f"Run agents.decision.tests.fixtures.regenerate_fixtures.")
    invs: list[InvestigationResult] = []
    for p in paths:
        try:
            invs.append(InvestigationResult.model_validate_json(p.read_text()))
        except Exception as e:
            _fail(f"§2 fixture {p.name} failed to validate: {e}")
    print(f"PASS §2: {len(invs)} fixtures load & validate against Layer 3a schema")
    return invs


# ---------------------------------------------------------------------
# §3-§8 driven together (share the decision+report runs)
# ---------------------------------------------------------------------
async def check_3_to_8(invs: list[InvestigationResult]) -> None:
    latencies: list[float] = []
    for i, inv in enumerate(invs, 1):
        # ---- §3 + latency + §5 (via invoke_decision) ----
        t0 = time.perf_counter()
        try:
            dec = await invoke_decision(inv)
        except Exception as e:
            _fail(f"§3 fixture {i}: invoke_decision raised: {type(e).__name__}: {e}")
        decision_dt = time.perf_counter() - t0

        # §3: taxonomy compliance + params match spec.
        if not (1 <= len(dec.actions) <= 3):
            _fail(f"§3 fixture {i}: {len(dec.actions)} actions, expected 1-3")
        for j, a in enumerate(dec.actions):
            if a.action_type not in ACTION_TYPES:
                _fail(f"§3 fixture {i} action[{j}]: unknown type {a.action_type!r}")
            try:
                validate_params(a.action_type, a.params)
            except ValueError as e:
                _fail(f"§3 fixture {i} action[{j}] ({a.action_type}): {e}")

        # §4: impact provenance — re-run each impact_sql via MCP and verify
        # value matches within tolerance. Skips escalate_to_human (SELECT 0).
        for j, a in enumerate(dec.actions):
            if a.impact_usd is None:
                continue  # Recorded impact_error is acceptable (checked in §5).
            if not a.impact_sql:
                _fail(f"§4 fixture {i} action[{j}]: impact_usd set but "
                      f"impact_sql empty — provenance broken")
            reloaded = await reload_impact_via_mcp(a.impact_sql)
            if reloaded is None:
                # SQL succeeded once (impact_usd set), can't reload now — flag.
                _fail(f"§4 fixture {i} action[{j}]: re-run returned no rows")
            drift = abs(reloaded - a.impact_usd) / max(abs(a.impact_usd), 1.0)
            if drift > IMPACT_DRIFT_TOLERANCE:
                _fail(f"§4 fixture {i} action[{j}] ({a.action_type}): "
                      f"impact drift {drift:.2%} > {IMPACT_DRIFT_TOLERANCE:.0%} "
                      f"(stored={a.impact_usd}, reloaded={reloaded})")

        # §5: status logic — recompute from actions and verify agent output matches.
        expected_status, _ = compute_status(list(dec.actions))
        if dec.status != expected_status:
            _fail(f"§5 fixture {i}: status={dec.status!r}, "
                  f"deterministic compute_status says {expected_status!r}")
        if any(a.action_type == "escalate_to_human" for a in dec.actions):
            if dec.status != "pending_approval":
                _fail(f"§5 fixture {i}: escalate action present but status "
                      f"is {dec.status!r} (must be pending_approval)")

        # §6: audit persisted — get_audit returns the row; approve mutates status.
        row = get_audit(dec.decision_id)
        if row is None:
            _fail(f"§6 fixture {i}: no audit row for decision_id={dec.decision_id}")
        if row.approval_status not in ("pending_approval", "auto_executed"):
            _fail(f"§6 fixture {i}: initial approval_status is "
                  f"{row.approval_status!r}, expected pending_approval or auto_executed")

        # ---- §7 + latency (via invoke_report) ----
        t1 = time.perf_counter()
        try:
            report = await invoke_report(inv, dec)
        except Exception as e:
            _fail(f"§7 fixture {i}: invoke_report raised: {type(e).__name__}: {e}")
        report_dt = time.perf_counter() - t1

        ok, violations = validate_report_provenance(report, inv, dec)
        if not ok:
            _fail(f"§7 fixture {i}: provenance failed: {violations}")

        # §6 continuation: approve and re-read; verify version bump.
        original_updated = row.updated_at
        approved = approve_decision(dec.decision_id, "acceptance@example", "auto-approved for test")
        if approved.approval_status != "approved":
            _fail(f"§6 fixture {i}: approve_decision left status={approved.approval_status!r}")
        if approved.updated_at <= original_updated:
            _fail(f"§6 fixture {i}: updated_at did not advance after approve")

        latencies.append(decision_dt + report_dt)

    # §8: latency budget
    mean = statistics.mean(latencies)
    mx = max(latencies)
    if mean > MEAN_LATENCY_TARGET_SECONDS:
        _fail(f"§8 mean fixture latency {mean:.1f}s > {MEAN_LATENCY_TARGET_SECONDS:.0f}s")
    if mx > MAX_LATENCY_TARGET_SECONDS:
        _fail(f"§8 max fixture latency {mx:.1f}s > {MAX_LATENCY_TARGET_SECONDS:.0f}s")

    print("PASS §3: action taxonomy + param spec compliance across all fixtures")
    print("PASS §4: impact_usd re-execution within tolerance for all populated actions")
    print("PASS §5: status logic matches deterministic compute_status")
    print("PASS §6: audit rows persisted; approve flips status and bumps updated_at")
    print("PASS §7: report provenance validates for every KeyFigure")
    print(f"PASS §8: latency mean={mean:.1f}s max={mx:.1f}s "
          f"(targets <{MEAN_LATENCY_TARGET_SECONDS:.0f}s mean, "
          f"<{MAX_LATENCY_TARGET_SECONDS:.0f}s max)")


# ---------------------------------------------------------------------
# §9 — Live end-to-end smoke: 3a → 3b for one fresh crisis
# ---------------------------------------------------------------------
async def check_9_live_smoke() -> None:
    det = await load_one_crisis_detection()
    print(f"§9 loaded live detection: {det.dedup_key} ({det.metric} in {det.region})")
    t0 = time.perf_counter()
    inv = await invoke_investigation(det)
    dec = await invoke_decision(inv)
    report = await invoke_report(inv, dec)
    dt = time.perf_counter() - t0
    if dt > LIVE_TOTAL_LATENCY_CAP:
        _fail(f"§9 live e2e {dt:.1f}s > cap {LIVE_TOTAL_LATENCY_CAP:.0f}s")
    if not report.key_figures:
        _fail("§9 live e2e: report has zero key_figures")
    print(f"PASS §9: live 3a→3b in {dt:.1f}s "
          f"(actions={len(dec.actions)}, key_figures={len(report.key_figures)})")


def main() -> None:
    check_1_boundary_grep()
    invs = check_2_fixtures_load()
    asyncio.run(check_3_to_8(invs))
    asyncio.run(check_9_live_smoke())
    print("\nAll Layer 3b acceptance checks PASSED.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write the acceptance helpers**

Create `backend/agents/decision/acceptance_helpers.py`:

```python
"""Helpers used by acceptance.py — kept separate so imports stay clean.

load_one_crisis_detection: pick one non-live crisis and turn its matching
detection into a DetectionIn. Uses MCP (never ch_client directly) so §1
boundary grep passes.

reload_impact_via_mcp: re-run an already-rendered impact SQL to confirm
the value the LLM stored matches the query.
"""

from __future__ import annotations

import json
from typing import Any

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from agents.investigation.contracts import DetectionIn
from mcp_integration.client import build_toolset


async def load_one_crisis_detection() -> DetectionIn:
    """Pick one crisis_ground_truth row with a matching detection.

    Returns the highest-severity match. Fails loudly if none found.
    """
    sql = (
        "SELECT toString(det.metric_ts), det.metric, det.film_id, det.region, "
        "       det.detector, det.baseline_value, det.actual_value, det.magnitude, "
        "       det.business_impact, det.severity, det.dedup_key "
        "FROM detections det "
        "INNER JOIN ("
        "  SELECT affected_film_id, affected_region, injection_timestamp "
        "  FROM crisis_ground_truth FINAL WHERE is_live = 0 LIMIT 5"
        ") crisis "
        "  ON det.film_id = crisis.affected_film_id "
        " AND det.region = crisis.affected_region "
        " AND abs(dateDiff('hour', det.metric_ts, crisis.injection_timestamp)) <= 6 "
        "ORDER BY det.severity DESC LIMIT 1"
    )
    rows = await _run_query(sql)
    if not rows:
        raise RuntimeError(
            "no crisis-matched detection available for live smoke — "
            "Layer 2 rollup may not cover the crisis span"
        )
    r = rows[0]
    return DetectionIn(
        metric_ts=r[0], metric=r[1], film_id=int(r[2]), region=r[3],
        detector=r[4], baseline_value=float(r[5]), actual_value=float(r[6]),
        magnitude=float(r[7]), business_impact=float(r[8]),
        severity=float(r[9]), dedup_key=r[10],
    )


async def reload_impact_via_mcp(sql: str) -> float | None:
    """Re-run an impact SQL and return the first cell as a float."""
    rows = await _run_query(sql)
    if not rows or not rows[0]:
        return None
    val = rows[0][0]
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


async def _run_query(sql: str) -> list[list[Any]]:
    agent = LlmAgent(
        name="acceptance_query",
        model="gemini-2.5-flash",
        instruction=(
            "Call run_query with EXACTLY this SQL and return ONLY the raw "
            "JSON result the tool gives back:\n\n" + sql
        ),
        tools=[build_toolset()],
    )
    runner = InMemoryRunner(agent=agent, app_name="acceptance_query")
    session = await runner.session_service.create_session(
        app_name="acceptance_query", user_id="acceptance",
    )
    rows: list[list[Any]] = []
    async for event in runner.run_async(
        user_id="acceptance",
        session_id=session.id,
        new_message=types.Content(
            role="user", parts=[types.Part.from_text(text="Run it.")],
        ),
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_response:
                    rows = _extract_rows(part.function_response.response) or rows
    return rows


def _extract_rows(resp: Any) -> list[list[Any]]:
    if isinstance(resp, dict):
        sc = resp.get("structuredContent")
        if isinstance(sc, dict) and isinstance(sc.get("result"), str):
            try:
                parsed = json.loads(sc["result"])
                if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list):
                    return parsed["rows"]
            except json.JSONDecodeError:
                pass
        content = resp.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    txt = item.get("text")
                    if isinstance(txt, str):
                        try:
                            parsed = json.loads(txt)
                            if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list):
                                return parsed["rows"]
                        except json.JSONDecodeError:
                            pass
    return []
```

- [ ] **Step 3: Run acceptance**

Run (from repo root): `cd backend && ./venv/bin/python -m agents.decision.acceptance`

Expected output (in order):
```
PASS §1: no direct ClickHouse client imports in decision/report (audit.py fallback exempt per spec §6.4)
PASS §2: 3 fixtures load & validate against Layer 3a schema
PASS §3: action taxonomy + param spec compliance across all fixtures
PASS §4: impact_usd re-execution within tolerance for all populated actions
PASS §5: status logic matches deterministic compute_status
PASS §6: audit rows persisted; approve flips status and bumps updated_at
PASS §7: report provenance validates for every KeyFigure
PASS §8: latency mean=<X.X>s max=<Y.Y>s (targets <25s mean, <40s max)
§9 loaded live detection: <dedup_key> ...
PASS §9: live 3a→3b in <T.T>s (actions=N, key_figures=M)

All Layer 3b acceptance checks PASSED.
```

If §4 fails with drift > 5%, the impact SQL is non-deterministic (rare — most templates aggregate over closed time windows). Investigate before retrying.

If §7 fails, the LLM is fabricating source_query strings. Iterate the REPORT_PROMPT to hammer "COPY VERBATIM" harder.

If §8 fails, either the fixture is unusually complex or Vertex was slow. Re-run once; if it fails twice, tighten the prompt (shorter, more directive).

- [ ] **Step 4: Commit**

```bash
git add backend/agents/decision/acceptance.py backend/agents/decision/acceptance_helpers.py
git commit -m "layer 3b: 9-check acceptance sweep (boundary/fixtures/taxonomy/impact/status/audit/provenance/latency/live)"
```

---

## Task 15: READMEs

**Files:**
- Create: `backend/agents/decision/README.md`
- Create: `backend/agents/report/README.md`

- [ ] **Step 1: Write decision README**

Create `backend/agents/decision/README.md`:

```markdown
# `agents/decision/` — Layer 3b Decision Agent

Turns a Layer 3a `InvestigationResult` into a `DecisionResult` — 1-3
ranked, SQL-grounded, threshold-gated actions. Persists an immutable
audit row per decision.

## Contents

| File | Purpose |
|---|---|
| `contracts.py`    | Pydantic: `RecommendedAction`, `DecisionResult`, `ActionType`, `ApprovalStatus` |
| `prompts.py`      | `DECISION_PROMPT` (single Flash agent) |
| `actions.py`      | 5 canonical actions + SQL templates + thresholds + `compute_status` |
| `audit.py`        | `AuditRow` + `audit_insert` / `approve_decision` / `get_audit` / `list_recent_audit` |
| `agent.py`        | `invoke_decision()`, `build_decision_agent()` |
| `acceptance.py`   | 9-check acceptance sweep (validates on 3 fixtures + 1 live smoke) |
| `acceptance_helpers.py` | MCP-based helpers used by acceptance |
| `tests/`          | Unit tests (contracts, actions, audit) + fixtures |

## Prerequisites

- Layer 3a merged + acceptance passing.
- Layer 1/2 data present. `decision_audit` bootstrapped:
  `./venv/bin/python -m data.bootstrap_audit`.
- MCP write path validated: `./venv/bin/python -m mcp_integration.write_smoke`
  exits 0 (default MCP path) or exits 2 (fallback active — see audit.py
  BUILD-RISK-FALLBACK comment).

## Public API

```python
from agents.decision.agent import invoke_decision
from agents.decision.audit import approve_decision, get_audit, list_recent_audit

dec = await invoke_decision(inv)          # InvestigationResult -> DecisionResult
row = get_audit(dec.decision_id)           # AuditRow | None
approve_decision(dec.decision_id, approver="ops@studio.com", note="LGTM")
```

## Model choice

Single Flash `LlmAgent` (no tools). The LLM picks action_type + params
+ rationale + priority. The Python orchestrator (`invoke_decision`)
validates params, renders canonical SQL from `actions.py::TEMPLATES`,
runs each SQL through a shared `MCPToolset`, populates impact_usd, then
computes status via the deterministic threshold table.

## Iterating

Fast loop:
1. Edit prompts.py or actions.py.
2. `./venv/bin/python -m agents.decision.acceptance` (uses fixtures — fast).
3. Repeat.

Slow loop (contract or archetype change):
1. `./venv/bin/python -m agents.decision.tests.fixtures.regenerate_fixtures`
   (regenerates all 3 fixtures — ~5 min).
2. Re-run acceptance.

## Boundary rule

`agents/decision/` never imports `data.ch_client` or `clickhouse_connect`.
The one exception is `audit.py` when the MCP write-path fallback is active
(spec §6.4). Enforced by acceptance §1 (grep excludes audit.py).

## Concurrency note

Two simultaneous `approve_decision` calls both INSERT with the same
decision_id — ReplacingMergeTree(updated_at) picks the later version.
Last-writer-wins is acceptable for the hackathon demo scope. No
optimistic-lock check.
```

- [ ] **Step 2: Write report README**

Create `backend/agents/report/README.md`:

```markdown
# `agents/report/` — Layer 3b Executive Report Agent

Consumes `(InvestigationResult, DecisionResult)` and produces an
`ExecutiveReport` — a C-suite narrative where every KeyFigure traces
to a query that was actually run.

## Contents

| File | Purpose |
|---|---|
| `contracts.py`     | Pydantic: `ExecutiveReport`, `KeyFigure`, `FindingSource` |
| `prompts.py`       | `REPORT_PROMPT` (single Flash agent) |
| `_provenance.py`   | `validate_report_provenance()` — verbatim source_query match |
| `agent.py`         | `invoke_report()`, `build_report_agent()`, `ReportProvenanceError` |
| `tests/`           | Unit tests (contracts, provenance) |

## Public API

```python
from agents.report.agent import invoke_report

report = await invoke_report(inv, dec)   # (InvestigationResult, DecisionResult) -> ExecutiveReport
```

The orchestrator attaches the emitted report to the audit row for the
decision_id (via `agents.decision.audit.audit_attach_report`).

## Provenance rule

Every KeyFigure carries `source_query` — this MUST match verbatim one of:
- an `inv.findings[i].sql`
- a `dec.actions[i].impact_sql`

Server-side `validate_report_provenance` enforces this after the LLM
emits and BEFORE the report leaves `invoke_report`. Failure raises
`ReportProvenanceError` with a list of violations.

Match is exact string equality (after strip). No fuzzy matching — the
prompt says "COPY VERBATIM" and we hold the LLM to it.

## Model choice

Single Flash `LlmAgent`, no tools. Report is pure narration — no queries
run at this stage.

## Iterating

Same pattern as decision agent. Report iteration typically means
tightening the "COPY VERBATIM" instruction in `prompts.py` when the LLM
tries to paraphrase source_query strings.
```

- [ ] **Step 3: Verify links / commit**

Nothing to run. Commit:
```bash
git add backend/agents/decision/README.md backend/agents/report/README.md
git commit -m "layer 3b: READMEs for agents/decision and agents/report"
```

---

## Post-implementation verification

Run these to close out Layer 3b:

- [ ] `./venv/bin/pytest agents/decision/tests agents/report/tests -v`
  Expected: all unit tests PASS (contracts, actions, provenance, audit round-trip).

- [ ] `./venv/bin/python -m agents.decision.acceptance`
  Expected: all 9 checks PASS.

- [ ] `./venv/bin/python -m agents.investigation.acceptance`
  Expected: all 7 checks PASS (Layer 3a untouched by 3b except the additive `investigation_id` field).

- [ ] `git log --oneline main..HEAD` (or since Task 1's commit)
  Expected: ~15 commits, each small and reviewable, none with `Co-Authored-By` trailers.

If all three checks pass, Layer 3b is complete and Layer 4 (Streamlit + FastAPI SSE demo) can begin.
