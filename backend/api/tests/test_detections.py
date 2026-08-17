def test_detection_in_accepts_latency_ms():
    from agents.investigation.contracts import DetectionIn
    d = DetectionIn(
        metric_ts="2026-08-16T00:00:00Z",
        metric="box_office",
        film_id=1,
        region="US",
        detector="mad_z",
        baseline_value=100.0,
        actual_value=200.0,
        magnitude=2.5,
        business_impact=0.4,
        severity=0.9,
        dedup_key="abc",
        film_title="",
        latency_ms=1234,
    )
    assert d.latency_ms == 1234


def test_detection_in_latency_ms_optional():
    from agents.investigation.contracts import DetectionIn
    d = DetectionIn(
        metric_ts="2026-08-16T00:00:00Z",
        metric="box_office",
        film_id=1,
        region="US",
        detector="mad_z",
        baseline_value=100.0,
        actual_value=200.0,
        magnitude=2.5,
        business_impact=0.4,
        severity=0.9,
        dedup_key="abc",
        film_title="",
    )
    assert d.latency_ms is None
