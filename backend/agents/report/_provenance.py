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
