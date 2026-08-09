# Layer 3b — Decision Agent + Executive Report Agent + Audit Trail

**Date:** 2026-08-08
**Status:** Design approved, ready for planning
**Depends on:** Layer 3a (Investigation Agent) — merged
**Consumed by:** Layer 4 (Streamlit + FastAPI SSE demo)

## Purpose

Turn a Layer 3a `InvestigationResult` into a `DecisionResult` (1-3 ranked, SQL-grounded, approval-gated actions) and an `ExecutiveReport` (structured C-suite narrative where every figure traces to a query). Persist an immutable audit row per decision so the demo can prove trustworthy AI.

**Rule of thumb (unchanged from spec):** *LLM narrates, SQL computes.* An LLM never invents a number. It selects an action from a fixed taxonomy, fills a param schema, and points at a canonical SQL template. The Python orchestrator runs the SQL and hands the number back into the report.

---

## Section 1 — Architecture & package layout

```
backend/
  agents/
    decision/
      __init__.py
      agent.py            # invoke_decision(), build_decision_agent()
      contracts.py        # RecommendedAction, DecisionResult, ApprovalStatus, ActionType
      prompts.py          # DECISION_PROMPT (single Flash agent)
      actions.py          # canonical SQL templates + threshold table + render_action_sql()
      audit.py            # AuditRow, audit_insert(), approve_decision(), list_recent_audit(), get_audit()
      acceptance.py       # 9-check acceptance sweep
      tests/
        __init__.py
        fixtures/
          inv_sentiment_collapse.json
          inv_marketing_overspend.json
          inv_competitor_collision.json
          regenerate_fixtures.py    # runs Layer 3a live to refresh JSONs
        test_actions.py
        test_contracts.py
        test_audit.py
      README.md
    report/
      __init__.py
      agent.py            # invoke_report(), build_report_agent()
      contracts.py        # KeyFigure, ExecutiveReport, FindingSource
      prompts.py          # REPORT_PROMPT (single Flash agent)
      _provenance.py      # _validate_report_provenance()
      tests/
        test_contracts.py
        test_provenance.py
      README.md
  data/
    audit_schema.sql       # DDL for decision_audit table
    bootstrap_audit.py     # idempotent CREATE TABLE IF NOT EXISTS runner (Layer 1 pattern)
```

**Package split rationale:** decision and report are separately consumable by Layer 4. Keeping them in sibling packages (not a shared `agents/decisions_and_reports/`) means each has its own README, tests, and prompts. Layer 4 can also unit-test them independently.

**Boundary rule (extends Layer 3a's):**
- `agents/decision/`, `agents/report/` never import `data.ch_client` or `clickhouse_connect`.
- **Exception:** `data/bootstrap_audit.py` uses direct `clickhouse_connect` (Layer 1 pattern — one-shot DDL, not agent runtime).
- **Exception:** `agents/decision/audit.py` MAY fall back to `clickhouse_connect` for INSERTs only, IF the MCP write-path build risk (§6) can't be resolved. Grep for this in acceptance §1 excludes `audit.py` explicitly.

---

## Section 2 — Contracts

```python
# agents/decision/contracts.py
from typing import Literal
from pydantic import BaseModel, Field, model_validator
from datetime import datetime

ActionType = Literal[
    "shift_marketing_spend",
    "pause_campaign",
    "swap_trailer_variant",
    "issue_pr_statement",
    "escalate_to_human",
]

ApprovalStatus = Literal["auto_executed", "pending_approval", "approved", "denied"]

class RecommendedAction(BaseModel):
    action_type: ActionType
    rationale: str = Field(min_length=20)          # 1-2 sentence why, tied to findings
    params: dict                                    # schema per action_type — validated by actions.py
    impact_usd: float | None = None                 # None if SQL failed; must be present if impact_sql set
    impact_sql: str = ""                            # canonical SQL rendered with params
    impact_error: str = ""                          # populated iff SQL failed
    priority: int = Field(ge=1, le=3)              # 1=highest

    @model_validator(mode="after")
    def _impact_sql_required_when_number(self) -> "RecommendedAction":
        if self.impact_usd is not None and not self.impact_sql:
            raise ValueError(
                "impact_sql must be non-empty when impact_usd is set — "
                "every number must trace to a query"
            )
        return self

class DecisionResult(BaseModel):
    decision_id: str                                # UUID4, generated in invoke_decision()
    investigation_id: str                           # from InvestigationResult (see note below)
    actions: list[RecommendedAction] = Field(min_length=1, max_length=3)
    status: ApprovalStatus                          # decision-level, not per-action
    threshold_usd: float                            # highest per-action threshold that gated status
    created_at: datetime
    latency_ms: int
```

**Note on `investigation_id`:** Layer 3a's `InvestigationResult` currently has no `id` field.
The plan's Task 2 adds `investigation_id: str = Field(default_factory=lambda: uuid4().hex)`
to Layer 3a's contract as a non-breaking change (default value; existing consumers unaffected).
This is the ONE bounded touch Layer 3b makes into Layer 3a; called out here so it isn't a surprise.

```python
# agents/report/contracts.py
from typing import Literal
from pydantic import BaseModel, Field

class FindingSource(BaseModel):
    signal: Literal[
        "numeric_context", "text_reason",
        "categorical_isolation", "temporal_context",
        "decision_impact",
    ]
    query_index: int = Field(ge=0)
    # For signal in the 4 investigation types: index into inv.findings[i].sql
    # (Layer 3a currently emits one SQL per finding — usually 0).
    # For signal == "decision_impact": index into dec.actions[i].impact_sql.

class KeyFigure(BaseModel):
    label: str                                       # e.g., "EU-DE sentiment drop"
    value: str                                       # e.g., "-42%" — string to preserve LLM formatting
    source_query: str = Field(min_length=10)         # verbatim SQL from a finding or impact SQL
    source: FindingSource

class ExecutiveReport(BaseModel):
    report_id: str                                    # UUID4, generated in invoke_report()
    decision_id: str                                  # from DecisionResult
    headline: str = Field(min_length=20, max_length=120)
    tldr: str = Field(min_length=40, max_length=400)
    key_figures: list[KeyFigure] = Field(min_length=1, max_length=8)
    recommended_actions_prose: str = Field(min_length=40)   # rendered from decision.actions, no new numbers
    risks_and_caveats: str
    created_at: datetime
    latency_ms: int
```

**Why `value: str` on KeyFigure:** the LLM might format `-42%`, `$1.2M`, `12.4x`, or `3 of 5 regions`. Forcing a float here loses meaning. Provenance is enforced by `source_query` (must exist verbatim in inputs), not by re-parsing the value.

---

## Section 3 — Action taxonomy & impact SQL templates

Fixed enum of 5 actions. Each has:
1. A **param schema** (required keys the LLM must fill).
2. A **canonical SQL template** in `actions.py` that computes `impact_usd` given the params.
3. A **per-action-type approval threshold** in a config table.

### 3.1 Action definitions

| ActionType | Required params | Impact SQL computes | Default threshold |
|---|---|---|---|
| `shift_marketing_spend` | `from_channel`, `to_channel`, `region`, `shift_pct` (0-100), `window_days` | 30-day projected ROI delta = (Σconv_at_new_channel × avg_ticket_price) − (Σconv_at_old_channel × avg_ticket_price), weighted by `shift_pct` | $10,000 |
| `pause_campaign` | `campaign_id`, `region`, `pause_days` | Marketing spend saved = daily_spend × pause_days, minus lost_conversions × avg_ticket_price | $20,000 |
| `swap_trailer_variant` | `film_id`, `region`, `from_variant`, `to_variant` | Projected view-uplift × conversion_rate × avg_ticket_price over next 7 days | $15,000 |
| `issue_pr_statement` | `film_id`, `region`, `message_theme` (str) | Sentiment recovery projection = avg_sentiment_recovery × affected_volume × ticket_conversion_rate (heuristic, may return NULL) | $5,000 |
| `escalate_to_human` | `reason` (str), `severity` ("high"/"critical") | Always returns 0.0 — this action has no computable impact | Always requires approval |

### 3.2 SQL template example (canonical)

```sql
-- actions.py: TEMPLATES["shift_marketing_spend"]
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
  ((new_perf.conv - old_perf.conv) * ({shift_pct} / 100.0)) * ticket.price
) AS impact_usd
FROM old_perf, new_perf, ticket
```

All 5 templates live in `actions.py::TEMPLATES` as parameterized strings. Params are validated against a per-type `ParamSpec` (list of required keys + type hints) before render. Values are formatted with `str.format(**params)` — safe because keys are whitelisted and values are typed (int / float / whitelisted enum).

**Injection defense:** enum-typed params (region, channel) validated against a fixed allowlist loaded from `data.ch_client` at module import (Layer 1 pattern; loaded once). String params (`message_theme`, `reason`) never appear in SQL — they only surface in the report prose.

### 3.3 Threshold config

```python
# actions.py
DEFAULT_THRESHOLDS_USD: dict[ActionType, float] = {
    "shift_marketing_spend": 10_000.0,
    "pause_campaign": 20_000.0,
    "swap_trailer_variant": 15_000.0,
    "issue_pr_statement": 5_000.0,
    "escalate_to_human": float("inf"),   # always requires approval
}

def compute_status(actions: list[RecommendedAction]) -> tuple[ApprovalStatus, float]:
    """Decision is auto_executed only if EVERY action's impact_usd is
    below its per-type threshold. Otherwise pending_approval.
    Returns (status, highest_threshold_that_gated)."""
```

Thresholds are hardcoded for MVP. Config lives in one file (`actions.py`) so tuning is a single edit + rerun of acceptance.

---

## Section 4 — Decision Agent

**Shape:** a **single Flash `LlmAgent` with no tools.** The LLM's job is semantic selection only:
- Read the `InvestigationResult` (findings + hypothesis).
- Emit a `DecisionResult`-shaped JSON via `output_schema=DecisionResult` where `impact_sql` and `impact_usd` are LEFT BLANK.

Python orchestrator (`invoke_decision`) then:
1. Validates each action's `params` against its `ParamSpec` in `actions.py`.
2. Renders each action's canonical SQL via `render_action_sql(action_type, params)`.
3. Fires each rendered SQL via a **single shared `MCPToolset`** (not per-action, saving 5s subprocess spawn × N actions).
4. Populates `impact_usd` and `impact_sql` on each action, or `impact_error` if SQL failed.
5. Calls `compute_status(actions)` → sets `DecisionResult.status` and `threshold_usd`.
6. Calls `audit_insert(decision, action="created")`.
7. Returns the fully-populated `DecisionResult`.

**Why no tools on the LlmAgent:** Layer 3a taught us MCP subprocess spawn is ~5s per sub-agent. Decision doesn't NEED to search — it consumes an already-computed InvestigationResult. Letting the LLM freely query would (a) burn latency, (b) risk making up numbers, (c) make provenance harder. The orchestrator-owned MCP call is deterministic and fast.

**Prompt sketch (`DECISION_PROMPT`):**
```
You are the decision sub-agent. You will be given an InvestigationResult
containing 4 signal findings and a hypothesis.

Your job: emit a DecisionResult with 1-3 RecommendedActions.

RULES:
1. Every action MUST use one of the 5 canonical action_types:
   {shift_marketing_spend, pause_campaign, swap_trailer_variant,
    issue_pr_statement, escalate_to_human}
2. Fill `params` per the schema for that action_type (see below).
3. Rank by priority (1=highest impact / most urgent).
4. Write `rationale` in 1-2 sentences tying the action to specific
   findings ("EU-DE sentiment drop of 42% per numeric_context").
5. LEAVE `impact_sql` AND `impact_usd` BLANK — the orchestrator fills them.
6. If findings are contradictory or hypothesis confidence is "low",
   include `escalate_to_human` as priority 1.

Param schemas per action_type: [renders from actions.py::PARAM_SPECS]
```

Structured output enforced by `output_schema=DecisionResult` + `output_key="decision"`.

**Failure modes handled:**
- LLM emits action_type not in taxonomy → Pydantic Literal rejects → propagate to Layer 4.
- LLM emits impact_usd/impact_sql (violating rule 5) → orchestrator strips them silently and re-renders.
- SQL fails for one action → that action gets `impact_error` set, others proceed. If ALL fail → raise `DecisionImpactError`.

---

## Section 5 — Report Agent

**Shape:** a **single Flash `LlmAgent` with no tools.** Consumes `(InvestigationResult, DecisionResult)`. Produces `ExecutiveReport`.

**Server-side provenance validation (`_provenance.py`):**

```python
def _validate_report_provenance(
    report: ExecutiveReport,
    inv: InvestigationResult,
    dec: DecisionResult,
) -> tuple[bool, list[str]]:
    """For each KeyFigure, source_query must exist verbatim in either:
      - inv.findings[*].sql (matched by source.signal + source.query_index)
      - dec.actions[*].impact_sql (source.signal == 'decision_impact')
    Returns (all_valid, list_of_violations)."""
```

Called by `invoke_report()` after LLM emits. If invalid, raise `ReportProvenanceError` with the offending KeyFigures listed. Layer 4 surfaces this to the UI as "report failed provenance check, retry."

**Prompt sketch (`REPORT_PROMPT`):**
```
You are the executive report agent. You will be given:
  investigation: {investigation}   (4 findings + hypothesis)
  decision:      {decision}         (1-3 actions with impact_usd + impact_sql)

Produce an ExecutiveReport for a C-suite reader.

RULES:
1. `headline`: 1 sentence, the crisis in plain language.
2. `tldr`: 2-4 sentences, what happened + what you're doing about it.
3. `key_figures` (1-8): the SPECIFIC numbers that anchor the story.
   Each KeyFigure MUST include `source_query` copied VERBATIM from either:
     - one of the investigation finding SQLs, OR
     - one of the decision action impact_sql values.
   Do NOT invent numbers. Do NOT paraphrase queries.
4. `recommended_actions_prose`: narrate the decision.actions in the
   order given. Cite each action's impact_usd inline. No new numbers.
5. `risks_and_caveats`: 1-3 sentences on hypothesis confidence,
   contradictions, or low-data findings.
```

Enforced by `output_schema=ExecutiveReport` + `output_key="report"`.

---

## Section 6 — Audit trail

### 6.1 `decision_audit` table schema

```sql
CREATE TABLE IF NOT EXISTS decision_audit (
  decision_id       String,
  investigation_id  String,
  detection_dedup_key String,
  film_id           UInt32,
  region            LowCardinality(String),
  actions_json      String,                 -- serialized list[RecommendedAction]
  status            LowCardinality(String), -- ApprovalStatus
  threshold_usd     Float64,
  agent_run_json    String,                 -- full DecisionResult snapshot at creation
  report_json       String DEFAULT '',      -- filled when report is emitted
  approval_status   LowCardinality(String) DEFAULT 'pending_approval',
  approver          String DEFAULT '',
  approval_note     String DEFAULT '',
  approved_at       Nullable(DateTime),
  created_at        DateTime DEFAULT now(), -- IMMUTABLE — never updated
  updated_at        DateTime DEFAULT now()  -- version key for ReplacingMergeTree
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (decision_id, created_at)
```

**Why ReplacingMergeTree(updated_at):**
- Approve/deny is a natural version bump: new row with same `decision_id`, later `updated_at` → `SELECT ... FINAL` returns latest.
- `created_at` never changes (immutable audit fact).
- Reads use `FINAL` clause — same pattern as Layer 1's `crisis_ground_truth`.

**Idempotency:** creation INSERT uses a fresh UUID as `decision_id`. Approval INSERT re-uses the existing `decision_id` — the ReplacingMergeTree contract handles versioning.

### 6.2 `agents/decision/audit.py` module

```python
class AuditRow(BaseModel):
    decision_id: str
    investigation_id: str
    detection_dedup_key: str
    film_id: int
    region: str
    actions: list[RecommendedAction]
    status: ApprovalStatus
    threshold_usd: float
    agent_run: DecisionResult
    report: ExecutiveReport | None = None
    approval_status: ApprovalStatus
    approver: str = ""
    approval_note: str = ""
    approved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

def audit_insert(decision: DecisionResult, inv: InvestigationResult) -> AuditRow: ...
def audit_attach_report(decision_id: str, report: ExecutiveReport) -> AuditRow: ...
def approve_decision(decision_id: str, approver: str, note: str = "") -> AuditRow: ...
def deny_decision(decision_id: str, approver: str, note: str = "") -> AuditRow: ...
def list_recent_audit(limit: int = 50) -> list[AuditRow]: ...
def get_audit(decision_id: str) -> AuditRow | None: ...
```

`approve_decision` reads current row (FINAL), sets `approval_status="approved"`, `approver`, `approval_note`, `approved_at=now()`, bumps `updated_at=now()`, INSERTs. `deny_decision` is symmetric (`approval_status="denied"`). `audit_attach_report` is called by `invoke_report()` to persist the emitted `ExecutiveReport` onto the existing audit row (same version-bump pattern).

### 6.3 Bootstrap

`backend/data/audit_schema.sql` holds the DDL. `backend/data/bootstrap_audit.py` reads the SQL and runs it via direct `clickhouse-connect` — Layer 1 pattern for one-shot DDL. Idempotent (`IF NOT EXISTS`). Run once during setup; not called from agent runtime.

### 6.4 Build risk — MCP write path

mcp-clickhouse 0.4.1 defaults to `CLICKHOUSE_READONLY_MODE=1`. Writes may fail.

**Resolution order (in order of preference):**
1. Set `CLICKHOUSE_READONLY_MODE=0` in `mcp_integration/client.py` env; verify writes work via a `run_query` INSERT smoke test. **PREFERRED.**
2. If that fails, `agents/decision/audit.py` falls back to `clickhouse_connect` for INSERTs only. Bends rule 2 spirit-vs-letter (audit is agent-adjacent, not agent-runtime). Documented as a known-tradeoff in the README with a `# BUILD-RISK-FALLBACK:` comment.

Task 1 of the implementation plan validates the write path before any other work proceeds.

### 6.5 Concurrency note

Two simultaneous approvals both INSERT with the same `decision_id` — ReplacingMergeTree picks the later `updated_at`. No optimistic-lock check; last-writer-wins is acceptable for a hackathon demo. Documented in the README.

### 6.6 Layer 4 handoff

| Function | Signature | Purpose |
|---|---|---|
| `invoke_decision(inv)` | `async (InvestigationResult) -> DecisionResult` | Runs decision LLM + impact SQL + audit INSERT |
| `invoke_report(inv, dec)` | `async (InvestigationResult, DecisionResult) -> ExecutiveReport` | Runs report LLM + provenance check |
| `approve_decision(decision_id, approver, note)` | `(str, str, str) -> AuditRow` | Human approval flow from UI |
| `list_recent_audit(limit)` | `(int) -> list[AuditRow]` | Sidebar history |
| `get_audit(decision_id)` | `(str) -> AuditRow \| None` | Detail view |

---

## Section 7 — Testing

### 7.1 Golden fixtures

`agents/decision/tests/fixtures/inv_*.json` — 3 real `InvestigationResult` JSON dumps, one per crisis archetype (sentiment collapse, marketing overspend, competitor collision).

`regenerate_fixtures.py` script runs Layer 3a live against 3 hand-picked `dedup_key`s from `crisis_ground_truth` and writes fresh JSONs. Run on demand when Layer 3a contracts change or when we want new archetypes.

Fixtures checked into git (small — a few KB each). Rationale: Layer 3a is ~100s × 3 = 5 min per iteration. Fixtures collapse the iteration loop to <1s of JSON I/O.

### 7.2 Acceptance sweep — `agents/decision/acceptance.py`

Follows Layer 3a's acceptance-sweep pattern (boundary grep + contract validation + latency gate + live smoke), extended to 9 checks for the decision/report/audit surface. Runs against 3 fixtures + 1 live smoke.

| # | Check | What it validates |
|---|---|---|
| §1 | Boundary grep | `agents/decision/`, `agents/report/` never import `data.ch_client` or `clickhouse_connect`. Grep excludes `agents/decision/audit.py` explicitly (see §6.4 fallback). |
| §2 | Fixtures load & validate | Each `inv_*.json` deserializes into a valid `InvestigationResult`. Guards against schema drift. |
| §3 | Action taxonomy compliance | For each fixture, `invoke_decision(inv)` returns 1-3 `RecommendedAction`s where `action_type ∈ ActionType` and `params` matches the schema for that action type. |
| §4 | Impact provenance | For each recommended action, `impact_usd` is a float and `impact_sql` is non-empty. Server-side re-runs the SQL via MCP and asserts result ≈ `impact_usd` (±5% drift tolerance). |
| §5 | Status logic | Given fixture-computed impacts, `status` follows the deterministic threshold table. `escalate_to_human` always → `pending_approval`. |
| §6 | Audit persisted | After `invoke_decision`, one row exists in `decision_audit` with matching `decision_id`. After `approve_decision`, the row's `updated_at` is later and `approval_status = "approved"`. FINAL read returns latest version. |
| §7 | Report provenance | `invoke_report(inv, decision)` returns an `ExecutiveReport` whose every `KeyFigure.source_query` exists verbatim in inputs. `_validate_report_provenance` must return `True`. |
| §8 | Latency (fixture) | Mean decision+report latency across 3 fixtures < 25s, max < 40s. |
| §9 | Live smoke | One end-to-end run: load 1 crisis → Layer 3a → Layer 3b → assert full pipeline succeeds and total latency < 180s. |

Exit 0 if all pass, 1 otherwise. Expected cost: ~$0.20/run.

### 7.3 Unit tests

Pure-Python, no LLM, no MCP. Fast (<1s total).

**`test_actions.py`:**
- `test_shift_marketing_spend_renders_valid_sql`
- `test_render_rejects_unknown_action`
- `test_render_rejects_missing_params`
- `test_threshold_config_covers_all_actions`
- `test_status_logic_matrix` (table-driven)

**`test_contracts.py`:**
- `test_recommended_action_rejects_bad_action_type`
- `test_impact_sql_required_when_impact_usd_set`
- `test_report_key_figure_source_query_required`
- `test_decision_result_rejects_zero_actions`

**`test_audit.py`:**
- `test_audit_row_serialization_round_trip`
- (DB-touching tests live in acceptance sweep.)

### 7.4 Iteration loop

Same as 3a: edit `prompts.py` or `actions.py`, run `python -m agents.decision.acceptance`, iterate. Contracts/taxonomy/thresholds are architectural — not prompt-iterable.

---

## Section 8 — Latency budget & Layer 4 integration

### 8.1 Budget

| Stage | Observed / est. | Timeout cap |
|---|---|---|
| Layer 3a Investigation | 70-110s | 200s (`INVESTIGATION_TIMEOUT_SECONDS`) |
| Layer 3b Decision LLM | est. 8-15s | subsumed by DECISION cap |
| Layer 3b impact SQL orchestration | est. 3-6s | subsumed by DECISION cap |
| Layer 3b audit INSERT | <1s | subsumed by DECISION cap |
| Layer 3b Report LLM | est. 5-10s | 20s (`REPORT_TIMEOUT_SECONDS`) |
| **Total per crisis (observed)** | **~90-140s** | — |
| **Total pipeline cap** | — | **265s** = 200s (3a) + 45s (3b decision) + 20s (3b report) |

`DECISION_TIMEOUT_SECONDS = 45.0`, `REPORT_TIMEOUT_SECONDS = 20.0`. Layer 4's crisis handler wraps all three invocations in a single `asyncio.wait_for(..., timeout=270.0)` outer guard for a 5s buffer.

### 8.2 Layer 4 integration surface

Public API from Layer 3b (agents/decision/agent.py + agents/report/agent.py + agents/decision/audit.py):

```python
async def invoke_decision(inv: InvestigationResult) -> DecisionResult
async def invoke_report(inv: InvestigationResult, dec: DecisionResult) -> ExecutiveReport
def approve_decision(decision_id: str, approver: str, note: str = "") -> AuditRow
def list_recent_audit(limit: int = 50) -> list[AuditRow]
def get_audit(decision_id: str) -> AuditRow | None
```

Also expose `build_decision_agent()` and `build_report_agent()` (mirroring Layer 3a) for Layer 4 to consume raw ADK event streams for SSE.

### 8.3 Error propagation

Fail loud, fail fast, fail with context. No silent fallbacks.

| Failure | Behavior |
|---|---|
| Decision LLM emits invalid structured output | Pydantic raises → propagate |
| Impact SQL fails for one action | Log, set `impact_error`, other actions proceed. If ALL fail → `DecisionImpactError` |
| Audit INSERT fails | Log loudly, raise `AuditWriteError`. Unaudited decisions are worse than delayed ones. |
| Report `source_query` doesn't match inputs | Raise `ReportProvenanceError` |
| Any timeout | `DecisionTimeout` / `ReportTimeout` |

### 8.4 Out of scope

- SSE emission (Layer 4)
- UI code (Layer 4)
- Batch/parallel crisis handling (Layer 4)
- Approval expiry / TTL (v2)
- Re-decision after approval — human re-runs the crisis (v2)

---

## Open build risks

1. **MCP write path** (§6.4) — validated by Task 1 of the plan before other work.
2. **Impact SQL formatting via `str.format`** — injection defense relies on enum-typed param allowlist. Documented in `actions.py` with a `# INJECTION-DEFENSE:` comment.
3. **Fixture drift** — `regenerate_fixtures.py` must be run any time Layer 3a's contracts change. Not automated; documented in `agents/decision/README.md`.

## What this design does NOT change

- Layer 3a Investigation Agent (untouched)
- Layer 1/2 schemas (only ADDS `decision_audit`)
- The mcp-clickhouse boundary rule (extended with one narrow, documented exception)
