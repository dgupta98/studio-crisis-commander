"""Unit tests for SseEvent wire format."""
from __future__ import annotations

import json
import re

from api.events import SseEvent


def test_serialize_wire_format():
    ev = SseEvent(seq=3, type="pipeline.started",
                  data={"run_id": "abc", "mode": "live"})
    wire = ev.serialize()
    assert isinstance(wire, bytes)
    text = wire.decode("utf-8")
    # Single `data: <json>` line, terminated by blank line. We deliberately
    # OMIT the `event:` line so the browser fires generic message events
    # (EventSource.onmessage) rather than named events per type. See
    # events.py module docstring for the reasoning.
    assert not text.startswith("event: ")
    assert "event: " not in text
    assert text.startswith("data: ")
    assert text.endswith("\n\n")
    body_line = [ln for ln in text.split("\n") if ln.startswith("data: ")][0]
    body = json.loads(body_line[len("data: "):])
    assert body["seq"] == 3
    assert body["type"] == "pipeline.started"
    assert body["data"] == {"run_id": "abc", "mode": "live"}
    # ISO 8601 UTC with trailing Z or +00:00.
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", body["ts"])


def test_serialize_escapes_newlines_in_data():
    """SSE spec requires data to be single-line-per-`data:` prefix.
    We JSON-encode the payload so newlines never leak into the wire."""
    ev = SseEvent(seq=1, type="x", data={"note": "line1\nline2"})
    text = ev.serialize().decode("utf-8")
    # `data:` should appear exactly once (JSON-encoding hides the newline).
    assert text.count("data: ") == 1


def test_seq_and_ts_readable_from_dict_form():
    """as_dict() gives the same payload we JSON-encode into the wire."""
    ev = SseEvent(seq=0, type="detection.started", data={})
    d = ev.as_dict()
    assert d["seq"] == 0
    assert d["type"] == "detection.started"
    assert d["data"] == {}
    assert "ts" in d
