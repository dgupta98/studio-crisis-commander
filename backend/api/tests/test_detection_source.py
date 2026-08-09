"""Unit tests for the DetectionIn producer used by the pipeline.

Uses mocked ClickHouse client + mocked refresh_detections — no live queries."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from agents.investigation.contracts import DetectionIn
from api.detection_source import synth_from_crisis, produce_detection
from data.ground_truth import Crisis, CrisisType


def _crisis() -> Crisis:
    return Crisis(
        injection_timestamp=datetime.now(timezone.utc).replace(microsecond=0),
        is_live=True,
        type=CrisisType.REGIONAL_SENTIMENT_COLLAPSE,
        affected_film_id=42,
        affected_region="Brazil",
        magnitude=8.5,
        affected_tables=["audience_sentiment"],
        true_root_cause="synthetic",
        expected_recommendation="issue_pr_statement",
        resolution_window_hours=24,
    )


def test_synth_maps_sentiment_collapse_to_sentiment_metric():
    d = synth_from_crisis(_crisis())
    assert isinstance(d, DetectionIn)
    assert d.film_id == 42
    assert d.region == "Brazil"
    assert d.metric.startswith("audience_sentiment")
    assert d.severity == 8.5
    assert d.dedup_key.startswith(d.metric)


def test_synth_maps_all_crisis_types():
    """Every CrisisType must map to a metric — no KeyError."""
    for ctype in CrisisType:
        c = _crisis()
        c.type = ctype
        d = synth_from_crisis(c)
        assert d.metric  # non-empty


@pytest.mark.asyncio
async def test_produce_detection_uses_refresh_when_row_found():
    """If refresh + select yields a row, produce_detection uses it."""
    crisis = _crisis()
    fake_row = {
        "metric_ts": datetime.now(timezone.utc),
        "metric": "audience_sentiment.avg_score",
        "film_id": 42,
        "region": "Brazil",
        "detector": "zscore",
        "baseline_value": 0.5,
        "actual_value": 0.1,
        "magnitude": 8.5,
        "business_impact": 100.0,
        "severity": 8.5,
        "dedup_key": "audience_sentiment.avg_score|42|Brazil|...|zscore",
    }
    with patch("api.detection_source.refresh_detections",
               new=lambda *a, **kw: 1), \
         patch("api.detection_source._select_matching_row",
               new=AsyncMock(return_value=fake_row)):
        det, source = await produce_detection(crisis, poll_seconds=0.5)
    assert source == "refresh"
    assert det.film_id == 42


@pytest.mark.asyncio
async def test_produce_detection_falls_back_when_row_missing():
    """If select returns None within poll window, we synthesize."""
    crisis = _crisis()
    with patch("api.detection_source.refresh_detections",
               new=lambda *a, **kw: 0), \
         patch("api.detection_source._select_matching_row",
               new=AsyncMock(return_value=None)):
        det, source = await produce_detection(crisis, poll_seconds=0.1)
    assert source == "fallback_synth"
    assert det.film_id == 42
