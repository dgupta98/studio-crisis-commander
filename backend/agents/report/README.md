# Executive Report Agent (Layer 3b)

Turns `(InvestigationResult, DecisionResult)` into an `ExecutiveReport`
for a C-suite reader: headline, TL;DR, 1–8 anchored `KeyFigure`s,
recommended-actions prose, risks-and-caveats.

## Design rule

**No tools. Provenance is enforced server-side.** The LlmAgent reads
both inputs from session state and emits one JSON blob. It runs no
queries and cites no numbers it didn't get from `inv.findings[*].sql`
or `dec.actions[*].impact_sql`.

Every `KeyFigure.source_query` MUST match verbatim one of those
allowed SQL strings. `_provenance.validate_report_provenance` runs
after the LlmAgent finishes and raises `ReportProvenanceError` if any
figure's `source_query` doesn't appear in the allowed union.

## Layout

| File | Role |
| --- | --- |
| `agent.py` | `invoke_report(inv, dec)` — build LlmAgent, run pipeline, validate provenance (retry once), stamp orchestrator-only fields, attach to audit. |
| `contracts.py` | `ExecutiveReport`, `KeyFigure`, `FindingSource`. |
| `prompts.py` | System prompt (rules for headline / TL;DR / KeyFigure verbatim-copy / prose / caveats). |
| `_provenance.py` | `validate_report_provenance` — verbatim SQL check + signal-binding auto-repair. |
| `tests/` | Unit tests for contracts and provenance. |

## Entry point

```python
from agents.report.agent import invoke_report
report = await invoke_report(inv, dec)   # inv: InvestigationResult, dec: DecisionResult
```

The orchestrator overrides `report_id`, `decision_id`, `created_at`,
`latency_ms` on the returned model; the LLM cannot forge them.

## Provenance validator

Two layers of defence against fabricated numbers:

1. **Verbatim SQL check.** `KeyFigure.source_query` must match one of
   `inv.findings[*].sql` or `dec.actions[*].impact_sql` character-for-
   character (after `strip`). No whitespace normalization, no fuzzy
   match — the prompt says "copy VERBATIM" and we hold it to that.
2. **Signal-binding auto-repair.** Flash occasionally copies the SQL
   correctly but mislabels which `(signal, query_index)` produced it.
   If `source_query` matches ANY allowed SQL in the union, no
   fabrication occurred — we rewrite the `KeyFigure`'s `source.signal`
   and `source.query_index` in place and accept. Only unrecognized SQL
   text is treated as fabrication.

Fabrication violations include a unified diff against the closest
allowed SQL, so post-mortems don't need extra instrumentation.

## Retry policy

`invoke_report` retries once on `ReportProvenanceError` (fresh session,
cold prompt) before re-raising. Retry catches transient Flash
formatting drift; the auto-repair handles the more common
signal-mislabelling case.

Timeouts:
- `REPORT_TIMEOUT_SECONDS = 120.0` — covers healthy Flash structured-
  output latency (20–40s) plus one retry.
- Audit-attach runs outside the LLM timeout.

## Boundaries

- No `data.ch_client` or `clickhouse_connect` imports in this package.
- No tools attached to the LlmAgent — pure input-to-output transform.
- Audit-attach is delegated to `agents.decision.audit`, which is the
  §1-exempt module for ClickHouse writes.
