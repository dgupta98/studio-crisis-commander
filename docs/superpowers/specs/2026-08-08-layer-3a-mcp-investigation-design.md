# Layer 3a — MCP Foundation + Investigation Agent Design

**Status:** approved 2026-08-08
**Depends on:** Layer 2 (Detection) complete — `detections` table populated (~8M rows post full-span refresh), `crisis_ground_truth` seeded with 12 historical crises.
**Blocks:** Layer 3b (Decision + Report Agents will consume `InvestigationResult`); Layer 4 (FastAPI SSE will stream `SequentialAgent` events).

---

## 1. Purpose

Turn a single `detections` row into a grounded, cited investigation the downstream agents (Decision, Report) can act on. Every number in the output must come from a ClickHouse query the agent actually ran through `mcp-clickhouse` — the LLM narrates SQL-computed values, never invents them.

Also: prove the `mcp-clickhouse` integration end-to-end in a standalone script before building the real agent. This is the highest-risk piece of the whole project per BUILD_REPORT §4 ("de-risk step") and it gets its own module so a stumble there doesn't cascade into partial-agent chaos.

## 2. Rules of the layer

- **Google-only AI at runtime.** Gemini via Google ADK (`google-cloud-aiplatform[adk]`). No OpenAI / Anthropic / LangChain / LlamaIndex / CrewAI anywhere in shipped code (Rule 7B, RULES_COMPLIANCE.md §2). This is a Stage-1 pass/fail.
- **All ClickHouse reads from agent code go through `mcp-clickhouse`.** `backend/agents/` and `backend/mcp_integration/` NEVER import `data.ch_client` or `clickhouse_connect`. Enforced by an acceptance grep (§10.1) mirroring Layer 2's §7.
- **Scripted orchestration, not free-form ReAct.** ADK `SequentialAgent` with 4 signal-family sub-agents + 1 synthesis sub-agent. Deterministic pipeline shape, predictable latency, trace-friendly for Layer 4's SSE.
- **LLM narrates, SQL computes.** Every finding carries the SQL it ran and the raw rows returned. Every claim in `Hypothesis` cites one of the four signal-family findings by name.

## 3. Architecture

```
Layer 4 (future) or acceptance.py
        │
        ▼
invoke_investigation(detection: DetectionIn)
        │
        │ 1. build_toolset()     — spawns  uvx mcp-clickhouse  as stdio child process
        │                           lives for one invocation, dies after
        ▼
SequentialAgent(
   sub_agents=[
     numeric_context   (flash, MCPToolset, output_schema=SignalFinding),
     text_reason       (flash, MCPToolset, output_schema=SignalFinding),
     categorical_isolation  (pro,   MCPToolset, output_schema=SignalFinding),
     temporal_context       (pro,   MCPToolset, output_schema=SignalFinding),
     synthesis         (flash, no tools,      output_schema=Hypothesis),
   ]
).run_async(session)
        │
        │  each sub-agent: 2 LLM turns typically
        │    turn 1: Gemini writes SQL → emits function_call(run_select_query, sql=...)
        │    MCP   : mcp-clickhouse executes on ClickHouse Cloud, returns rows
        │    turn 2: Gemini reads rows → emits structured SignalFinding
        │
        │  session.state[<agent_name>] holds each output as it lands.
        │  synthesis reads state[numeric_context..temporal_context], writes Hypothesis.
        ▼
InvestigationResult(
   detection, findings=[4 SignalFinding], hypothesis, started_at, finished_at
)
```

**Transport:** stdio subprocess (not HTTP). ADK's `MCPToolset` with `StdioServerParameters(command="uvx", args=["mcp-clickhouse"], env=<CH creds>)`. One subprocess per `invoke_investigation` call. Zero extra infra; identical local and Cloud Run.

**Model split (targeting <20s total pipeline budget with Decision + Report downstream):**

| Sub-agent | Model | Rationale |
|---|---|---|
| numeric_context | Gemini 2.5 Flash | One rollup table, simple aggregation SQL. Flash handles cleanly. |
| text_reason | Gemini 2.5 Flash | One or two `SELECT ... FROM audience_sentiment WHERE ...` queries. Flash handles cleanly. |
| categorical_isolation | Gemini 2.5 Pro | Multi-table JOIN (rollup + `film_region_weight`), GROUP BY + ORDER BY. Schema-heavy. Pro's fewer SQL mistakes are worth the extra ~2s here. |
| temporal_context | Gemini 2.5 Pro | Cross-table window logic (`detections` history + `competitor_releases` proximity + broader rollup). Schema-heavy. |
| synthesis | Gemini 2.5 Flash | Reads 4 structured findings, writes 3-4 paragraphs. Not free reasoning — Flash is enough. |

**Expected latency:** ~15s per investigation (2× Flash sub-agents ~2s each, 2× Pro sub-agents ~5s each, 1× Flash synthesis ~1.5s). Hard cap: 30s wall clock.

## 4. Files

```
backend/mcp_integration/
├── __init__.py
├── client.py       # build_toolset() — MCPToolset factory (stdio, CH env passthrough)
├── proof.py        # python -m mcp_integration.proof — one-shot agent that lists tables via MCP
└── README.md       # how the wiring works + how to run the proof

backend/agents/
├── __init__.py
└── investigation/
    ├── __init__.py
    ├── contracts.py       # Pydantic: DetectionIn, SignalFinding, Hypothesis, InvestigationResult
    ├── prompts.py         # 5 system prompts (one file for fast iteration)
    ├── subagents.py       # 5 LlmAgent factories
    ├── agent.py           # SequentialAgent factory + invoke_investigation()
    ├── acceptance.py      # 7-check sweep
    ├── tests/
    │   ├── __init__.py
    │   ├── contracts_test.py
    │   └── client_test.py
    └── README.md          # runbook: how to run proof, run investigation, run acceptance
```

> **Naming note.** The local package is `mcp_integration`, not `mcp`. The installed `mcp` package (the official MCP Python SDK, dependency of both `mcp-clickhouse` and ADK's `MCPToolset`) is a top-level import; a local `backend/mcp/` package would shadow it and break every ADK import. Verified against installed venv. AI_BUILD_CONTEXT.md's earlier `backend/mcp/clickhouse_mcp.py` layout was pre-implementation and predates this collision check.

## 5. Data model / Contracts

All Pydantic v2. Live in `backend/agents/investigation/contracts.py`. No ORM — pure DTOs.

```python
class DetectionIn(BaseModel):
    """One row of Layer 2's `detections` table. Layer 4 fetches via MCP and passes in."""
    metric_ts: datetime
    metric: str                    # e.g. "audience_sentiment.avg_score"
    film_id: int
    region: str                    # e.g. "US", "EU-DE", "GLOBAL"
    detector: str                  # "zscore" | "ewma" | "pctchange"
    baseline_value: float
    actual_value: float
    magnitude: float
    business_impact: float
    severity: float
    dedup_key: str

class SignalFinding(BaseModel):
    signal: Literal["numeric_context", "text_reason",
                    "categorical_isolation", "temporal_context"]
    sql: str                       # Full SQL the sub-agent executed via MCP
    columns: list[str]
    rows: list[list[Any]]          # Raw query result. Every number in `narrative` traces here.
    narrative: str                 # 2-4 sentences interpreting the values
    latency_ms: int                # Sub-agent wall time — feeds trace UI + acceptance §6

class Hypothesis(BaseModel):
    primary_cause: str
    contributing_factors: list[str]
    confidence: Literal["low", "medium", "high"]
    citations: list[Literal["numeric_context", "text_reason",
                            "categorical_isolation", "temporal_context"]]

    @field_validator("citations")
    def citations_non_empty(cls, v):
        if not v:
            raise ValueError("Hypothesis must cite at least one finding")
        return v

class InvestigationResult(BaseModel):
    detection: DetectionIn
    findings: list[SignalFinding]  # length 4, in fixed order matching sub-agent order
    hypothesis: Hypothesis
    started_at: datetime
    finished_at: datetime
```

## 6. Sub-agent responsibilities

Each sub-agent has one job, one file (`prompts.py` and `subagents.py`), and produces one structured `SignalFinding` (or `Hypothesis` for synthesis).

### 6.1 `numeric_context` (Flash)
**Reads:** the rollup table matching `detection.metric`. Metric-to-table map is a small constant in `subagents.py`:
- `audience_sentiment.*` → `roll_sentiment_hourly`
- `social_trends.*` → `roll_social_hourly`
- `trailer_analytics.*` → `roll_trailer_hourly`
- `streaming_watch_minutes.*` → `roll_streaming_hourly`
- `box_office_revenue.*` → `box_office_revenue` (daily, no rollup)
- `ticket_refunds.*` → `ticket_refunds`
- `marketing_roi` → `roll_campaign_daily` (or a JOIN with `roll_marketing_daily` if needed)
- `review_scores.*` → `review_scores`

**Job:** Fetch a time series around `detection.metric_ts` (±24h for hourly metrics, ±7d for daily). Compute or observe baseline vs current, describe shape (spike, drop, drift, sustained).
**MCP calls:** 1.
**Output narrative example:** *"Sentiment on `film_id=42` in `EU-DE` dropped from 0.68 avg (24h prior) to 0.31 (current bucket) — a 54% decline sustained across the last 3 hourly buckets."*

### 6.2 `text_reason` (Flash)
**Reads:** `audience_sentiment` (has raw `text` alongside `score` and `volume`), optionally `review_scores`. Filtered by `film_id`, `region`, and a ±6h window around `detection.metric_ts`.
**Job:** Retrieve 5-10 representative texts explaining the drop (lowest-score rows in the window, or highest-volume-lowest-score). Identify recurring themes.
**MCP calls:** 1-2.
**Empty-result handling:** For non-textual anomalies (e.g., competitor collision → box office drop), no text evidence exists. Sub-agent returns `rows=[]` and `narrative="no significant text evidence in the ±6h window."` — legitimate outcome, not an error.

### 6.3 `categorical_isolation` (Pro)
**Reads:** rollup(s) matching the metric, grouped by categorical dimensions. LEFT JOIN with `film_region_weight` for region-share context. For trailer metrics, group by `variant`. For marketing/campaign, group by `channel`.
**Job:** Identify which slice(s) drive the anomaly — is it one region or global? one trailer variant or all? one channel?
**MCP calls:** 1-2 (may need one query to enumerate slices, one to rank them).
**Output narrative example:** *"85% of the drop is concentrated in `EU-DE` (weighted share 0.11) with `EU-FR` and `EU-UK` also negative but smaller. Other regions unchanged."*

### 6.4 `temporal_context` (Pro)
**Reads:** `detections` (sibling detections for same `film_id`+`region` in the last 72h), `competitor_releases` (any competitor releasing within ±14d in same region), broader-window rollup for baseline drift.
**Job:** When did it start? Are there related detections firing on other metrics? Is there a competitor collision that would explain this?
**MCP calls:** 1-2.
**Output narrative example:** *"Onset ~4h ago. Two sibling detections on `social_trends.avg_virality` and `streaming.completion_ratio` for the same film/region fired within the last 3h — consistent with a single triggering event, not a metric artifact."*

### 6.5 `synthesis` (Flash, no tools)
**Reads:** `session.state["numeric_context" .. "temporal_context"]` via ADK prompt templating.
**Job:** Write a hypothesis with primary_cause, 1-3 contributing_factors, a confidence rating (based on how many findings agree), and citations mapping each claim back to the finding(s) that support it.
**MCP calls:** 0.
**Output validation:** `citations ⊆ {numeric_context, text_reason, categorical_isolation, temporal_context}` — enforced by Pydantic validator (§5).

## 7. Session state / hand-off pattern

ADK-native. Each sub-agent is an `LlmAgent(..., output_schema=SignalFinding)` which causes its structured output to land in `session.state[agent.name]`. Synthesis's system prompt uses ADK's `{numeric_context.narrative}` template syntax to pull findings by name, with full finding JSONs also readable from state for citation purposes.

Initial session state seeded by `invoke_investigation`:
```python
session.state = {
    "detection": detection.model_dump(),
    "schema_hints": <preloaded describe_table output for the 4 signal-family tables>,
}
```

`schema_hints` is fetched once at investigation start (via the MCP toolset's `describe_table` tool on the ~8 rollup + source tables the sub-agents might touch) and injected into every sub-agent prompt. This spares the LLM from re-discovering the schema mid-run — saves ~1-2 turns per sub-agent.

## 8. Public API

Exactly one entry point per module.

```python
# backend/mcp_integration/client.py
def build_toolset() -> MCPToolset:
    """Fresh MCPToolset wired to mcp-clickhouse via stdio.
    Reads CH creds from os.environ. Caller owns lifecycle (close on exit)."""

# backend/mcp_integration/proof.py
def main() -> None:
    """python -m mcp_integration.proof. Prints tool call + result + model summary. Exit 0 on success."""

# backend/agents/investigation/agent.py
async def invoke_investigation(detection: DetectionIn) -> InvestigationResult:
    """Run the full 5-sub-agent pipeline against one detection. Raises on hard failures.
    Returns an InvestigationResult with 4 findings and one hypothesis."""

def build_investigation_agent() -> SequentialAgent:
    """Factory. Layer 4 will call this to get the raw SequentialAgent for run_async
    event streaming (SSE trace). invoke_investigation() wraps it for simple use."""
```

## 9. Config / env

No new secrets. Uses existing `.env`:

- `CLICKHOUSE_HOST` / `PORT` / `USER` / `PASSWORD` / `DB` — passed through to the mcp-clickhouse subprocess via `StdioServerParameters(env=...)`.
- `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` — ADK picks these up automatically for Gemini calls.
- `GOOGLE_APPLICATION_CREDENTIALS` — path to the service-account JSON (local dev). On Cloud Run, workload identity supplies creds; the env var is unset.

## 10. Error handling

| # | Failure | Handling |
|---|---|---|
| 1 | Bad SQL (Gemini writes invalid ClickHouse) | mcp-clickhouse returns the error text as tool response. Sub-agent prompt: *"If your query returns an error, revise once and retry."* If retry fails, sub-agent returns `SignalFinding(rows=[], narrative="query failed: <err>")`. Investigation continues degraded; synthesis notes missing evidence. |
| 2 | Empty result set | Not an error. Sub-agent returns `SignalFinding(rows=[], narrative="no evidence found")`. |
| 3 | Gemini transient failure (rate limit, 5xx) | Rely on ADK built-in retry. No additional layer. |
| 4 | Sub-agent output fails `output_schema` validation | Raise loudly. Prompt-engineering bug in our code; acceptance sweep on seeded crises catches these. |
| 5 | Wall-clock timeout | `asyncio.wait_for(SequentialAgent.run_async(), timeout=30)` around the pipeline. On timeout, raise `InvestigationTimeout`. Layer 4's demo-safety layer handles retry. |
| 6 | Bad citation (Hypothesis cites unknown finding) | Pydantic validator on `Hypothesis.citations` (see §5). Drops invalid, does not fail the investigation. |
| 7 | MCP subprocess fails to start | Raise immediately with actionable message: check CH env, check `uvx mcp-clickhouse` availability. |
| 8 | MCP subprocess dies mid-investigation | Investigation raises. One subprocess per invocation; retry means calling `invoke_investigation` again. Layer 4 owns retry policy. |

**Explicitly not built in Layer 3a:** custom Gemini retry loops, model fallback (Pro → Flash), MCP subprocess pooling, persistent investigation state.

### 10.1 Boundary rule enforcement

```python
def check_boundary_grep():
    matches = subprocess.run(
        ["grep", "-rEln", r"(from data\.ch_client|import clickhouse_connect)",
         "backend/agents/", "backend/mcp_integration/",
         "--include=*.py", "--exclude-dir=__pycache__"],
        capture_output=True, text=True,
    ).stdout.strip()
    if matches:
        raise AssertionError(f"boundary violation: {matches}")
```

Zero matches = pass. Same shape as Layer 2's §7 check.

## 11. Testing

Two layers. Golden-output snapshots are deliberately skipped — brittle for LLM output; the eval harness (Layer 6) does real correctness scoring.

### 11.1 Unit tests
- `contracts_test.py` — Pydantic models accept expected shapes; `Hypothesis.citations` validator rejects unknown finding names; empty citations rejected.
- `client_test.py` — `build_toolset()` returns an `MCPToolset` with correct env passthrough. Skips gracefully if `CLICKHOUSE_HOST` unset (CI-friendly).

No unit test for prompts. Iteration is faster via acceptance sweep than mocked LLM tests.

### 11.2 Acceptance sweep (`python -m backend.agents.investigation.acceptance`)

Costs ~$0.10-0.15 in Gemini calls per run. Exit 0 if all pass.

| § | Check | Pass condition |
|---|---|---|
| §1 | Boundary grep | Zero matches for `data\.ch_client` or `clickhouse_connect` under `backend/agents/` or `backend/mcp_integration/` |
| §2 | MCP proof | `python -m mcp_integration.proof` exits 0 within 15s and prints ≥ 1 table name |
| §3 | End-to-end on 3 seeded crises | Pick 3 rows from `crisis_ground_truth FINAL WHERE is_live=0` via MCP, find a matching row in `detections` (within ±6h of crisis `injection_timestamp`, same film+region), call `invoke_investigation(det)`, no exceptions |
| §4 | Findings well-formed | Each result has 4 findings in fixed order (`numeric_context, text_reason, categorical_isolation, temporal_context`); each has non-empty `sql` (>10 chars), non-empty `narrative` (>20 chars); when `rows` non-empty, `len(columns) == len(rows[0])` |
| §5 | Hypothesis well-formed | `primary_cause` non-empty (>20 chars); `confidence` ∈ `{low, medium, high}`; `citations` non-empty and ⊆ finding names |
| §6 | Latency | Mean wall time across 3 investigations < 25s; max < 30s |
| §7 | MCP actually called | Count of `run_select_query` tool invocations per investigation ≥ 4 (one per sub-agent minimum). Zero calls = MCP is bypassed somehow → hard fail |

Instrumentation for §7: wrap the ADK event stream during acceptance runs, count events with `function_call.name == "run_select_query"` per investigation.

## 12. Scope boundaries (explicit)

**In Layer 3a:**
- MCP client factory + stdio wiring
- Standalone MCP proof
- 5-sub-agent SequentialAgent
- `invoke_investigation()` sync entry point
- Contracts, prompts, unit tests, acceptance sweep
- README runbook

**In Layer 3b (next spec, not this one):**
- Decision Agent (approval thresholds, action recommendations)
- Audit trail table + writer
- Executive Report Agent (query provenance rendering)

**In Layer 4:**
- FastAPI endpoints
- SSE stream translation (consumes `SequentialAgent.run_async` events)
- Demo-safety fallback layer

**In Layer 6:**
- Accuracy eval (N/30 primary_cause matches ground truth) — Layer 3a acceptance only checks the pipeline *runs*, not that it's *right*

## 13. Open risks (accepted, not resolved here)

1. **Prompt-tuning is the biggest hidden-defect source.** The acceptance sweep on 3 seeded crises is the guardrail. If a seeded crisis produces garbage narrative, fix is prompt iteration in `prompts.py`, not code changes.
2. **Cold subprocess startup adds ~100-300ms per investigation.** Acceptable for demo (investigations are seconds-scale). Revisit only if Layer 4 needs a warm pool.
3. **Pro sub-agent latency variance.** Pro can occasionally take 5-8s on a hard SQL. 30s hard cap absorbs this; if it becomes chronic, demote that sub-agent to Flash (one-line change).
4. **`text_reason` may have poor evidence for non-textual crisis types.** Handled by "no evidence" narrative — but synthesis's citation quality depends on how it weighs an empty text finding vs. strong numeric+categorical+temporal ones. Prompt engineering problem.
