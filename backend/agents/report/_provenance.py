"""Server-side provenance validation for the Executive Report.

Every KeyFigure.source_query MUST match verbatim one of:
  - inv.findings[query_index].sql where signal matches the finding's signal
  - dec.actions[query_index].impact_sql when signal == "decision_impact"

Match is exact string equality (after strip). We do NOT normalize
whitespace or reformat — the LLM was told "copy VERBATIM" and we hold
it to that. Fuzzy match would let it invent-and-explain-away.

Auto-repair: Flash occasionally copies the correct SQL verbatim but
mislabels which signal/index produced it. If a KeyFigure's source_query
matches ANY allowed SQL (union of finding SQLs + impact SQLs), no
fabrication occurred — we rewrite the metadata to point at the true
source and accept. Only unrecognized SQL text is treated as fabrication.
"""

from __future__ import annotations

import difflib

from agents.decision.contracts import DecisionResult
from agents.investigation.contracts import InvestigationResult
from agents.report.contracts import ExecutiveReport


def _closest_diff(target: str, allowed: list[str]) -> str:
    """Return a short unified diff of `target` vs its nearest allowed match."""
    if not allowed:
        return "(no allowed SQLs in union)"
    matches = difflib.get_close_matches(target, allowed, n=1, cutoff=0.0)
    if not matches:
        return "(no similar SQL found)"
    diff = list(difflib.unified_diff(
        matches[0].splitlines(), target.splitlines(),
        fromfile="allowed", tofile="emitted", lineterm="",
    ))
    return "\n".join(diff[:40]) or "(identical after diff — unicode?)"


def validate_report_provenance(
    report: ExecutiveReport,
    inv: InvestigationResult,
    dec: DecisionResult,
) -> tuple[bool, list[str]]:
    """Return (all_valid, list_of_violations). Mutates report in place to
    correct signal/query_index metadata when source_query matches an
    allowed SQL under different (signal, idx) coordinates."""
    violations: list[str] = []

    # Primary lookups.
    finding_sql_by_signal: dict[str, list[str]] = {
        f.signal: [f.sql.strip()] for f in inv.findings
    }
    impact_sqls: list[str] = [a.impact_sql.strip() for a in dec.actions]
    all_allowed: list[str] = [
        sql for sqls in finding_sql_by_signal.values() for sql in sqls
    ] + impact_sqls

    # Reverse lookup: SQL string -> (signal, query_index). First writer wins;
    # collisions across the union are theoretical only (canonical SQLs differ).
    sql_to_coords: dict[str, tuple[str, int]] = {}
    for signal, sqls in finding_sql_by_signal.items():
        for j, sql in enumerate(sqls):
            sql_to_coords.setdefault(sql, (signal, j))
    for j, sql in enumerate(impact_sqls):
        sql_to_coords.setdefault(sql, ("decision_impact", j))

    for i, kf in enumerate(report.key_figures):
        target = kf.source_query.strip()
        sig = kf.source.signal
        idx = kf.source.query_index

        # Fast path: stated coords already match verbatim.
        if sig == "decision_impact":
            if idx < len(impact_sqls) and impact_sqls[idx] == target:
                continue
        else:
            candidates = finding_sql_by_signal.get(sig, [])
            if idx < len(candidates) and candidates[idx] == target:
                continue

        # Repair path: source_query matches SOMEWHERE in the allowed union.
        repaired = sql_to_coords.get(target)
        if repaired is not None:
            kf.source.signal = repaired[0]  # type: ignore[assignment]
            kf.source.query_index = repaired[1]
            continue

        # No match anywhere — real fabrication.
        diff = _closest_diff(target, all_allowed)
        violations.append(
            f"key_figures[{i}] ({kf.label!r}, stated signal={sig!r} "
            f"idx={idx}): source_query not found in allowed SQL union — "
            f"possibly fabricated. Closest-allowed diff:\n{diff}"
        )

    return (len(violations) == 0), violations
