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
