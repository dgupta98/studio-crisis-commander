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
