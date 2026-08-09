# Decision Agent (Layer 3b)

Turns an `InvestigationResult` (Layer 3a) into a `DecisionResult`: 1–3
ranked actions, each with a computed `impact_usd`, gated by threshold,
persisted to the `decision_audit` table for approval workflow.

## Design rule

**LLM narrates. Python computes.** The LlmAgent picks an `action_type`
and fills `params`. The orchestrator renders SQL from a canonical
template (`actions.py::TEMPLATES`), executes it, and writes
`impact_usd` / `impact_sql` back onto the action. The LLM never
composes SQL and never types a number.

This gives us a hard anti-fabrication guarantee: every dollar figure in
a decision traces to a rendered-from-template SQL string that was
actually executed against ClickHouse. `RecommendedAction`'s pydantic
validator enforces `impact_sql` non-empty whenever `impact_usd` is set.

## Layout

| File | Role |
| --- | --- |
| `agent.py` | `invoke_decision(inv)` — the orchestrator: run LlmAgent, validate params, render+execute SQL, compute status, persist audit row. |
| `contracts.py` | `RecommendedAction`, `DecisionResult`, `ActionType`, `ApprovalStatus`. |
| `actions.py` | 5-action taxonomy: SQL templates, param specs, `render_action_sql`, `validate_params`, `compute_status`, `DEFAULT_THRESHOLDS_USD`. |
| `prompts.py` | System prompt (dynamically injects the param reference). |
| `audit.py` | `decision_audit` table I/O: `audit_insert`, `approve_decision`, `deny_decision`, `get_audit`, `list_recent_audit`, sync + async variants. |
| `acceptance.py` | 9-check acceptance sweep (§1–§9). Exits 0 on all-pass. |
| `acceptance_helpers.py` | Live-detection loader + impact-SQL re-executor for §9 and §4. |
| `tests/` | Unit tests for contracts, actions, audit; fixture regenerator. |

## Entry points

```python
from agents.decision.agent import invoke_decision
dec = await invoke_decision(inv)   # inv: InvestigationResult

from agents.decision.audit import (
    approve_decision, deny_decision, get_audit, list_recent_audit,
    async_approve_decision, async_get_audit,
)
```

## Boundaries

- Nothing in this package (`agents/decision/`) imports `data.ch_client`
  or `clickhouse_connect` directly, **except `audit.py`** — the single
  exemption documented in spec §6.4 and enforced by the §1 boundary
  grep in `acceptance.py`.
- The reason: `audit.py` runs both writes (Task 2 build-risk fallback)
  and reads via `clickhouse-connect`; the LLM+MCP read path cost 5–10s
  per SELECT and produced Vertex 499 cascades under acceptance load.
- All *other* ClickHouse access from this package (impact SQL,
  live-detection loader) goes through `audit.run_impact_sql` (also
  §1-exempt because it lives in `audit.py`) or the MCP toolset.

## Running acceptance

```
PYTHONPATH=. venv/bin/python -m agents.decision.acceptance
```

Cost: ~$0.20 per run (fixture §3–§8: ~$0.05; live §9: ~$0.15).
Latency: mean ~60s per fixture, live end-to-end ~150s (budget 180s).

## Actions & thresholds

| Action | Threshold (auto below) |
| --- | --- |
| `issue_pr_statement` | $5,000 |
| `shift_marketing_spend` | $10,000 |
| `swap_trailer_variant` | $15,000 |
| `pause_campaign` | $20,000 |
| `escalate_to_human` | always requires approval |

`compute_status` returns `auto_executed` only when every action's
`impact_usd` is populated AND under its threshold; otherwise
`pending_approval`. `threshold_usd` is set to `0.0` when the only
gating action is `escalate_to_human` (Pydantic v2 serializes `inf` to
JSON `null`, so we don't emit it).

## Audit table

`decision_audit` is `ReplacingMergeTree(updated_at)`; approve/deny
INSERT a new row with the same `decision_id`. Reads use
`SELECT ... FINAL` to get the latest version. `agent_run` and
`report_json` are JSON blobs on the row (not separate tables).
