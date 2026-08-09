"""SseEvent — serializes one pipeline event to Server-Sent-Events wire format.

Wire form (per event):
    event: <type>\n
    data: <json blob {seq, ts, type, data}>\n
    \n

We keep the JSON blob on a single `data:` line — SSE readers rejoin
multi-line `data:` blocks with '\\n', which corrupts JSON. JSON-encoding
also hides newlines inside string values.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


@dataclass(slots=True)
class SseEvent:
    seq: int
    type: str
    data: dict[str, Any]
    ts: str = field(default_factory=_now_iso)

    def as_dict(self) -> dict[str, Any]:
        return {"seq": self.seq, "ts": self.ts, "type": self.type,
                "data": self.data}

    def serialize(self) -> bytes:
        body = json.dumps(self.as_dict(), separators=(",", ":"), default=str)
        return f"event: {self.type}\ndata: {body}\n\n".encode("utf-8")
