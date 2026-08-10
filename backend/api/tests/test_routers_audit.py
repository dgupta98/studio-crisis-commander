"""GET /audit + POST /approve + POST /deny (with mocked audit facade)."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from agents.decision.audit import AuditRow
from agents.decision.contracts import DecisionResult, RecommendedAction


def _row(status="pending_approval") -> AuditRow:
    dec = DecisionResult(
        decision_id="dec-1", investigation_id="inv-1",
        actions=[RecommendedAction(
            action_type="issue_pr_statement",
            rationale="stakeholders need clarity",
            params={"film_id": 1, "region": "Brazil", "message_theme": "t"},
            impact_usd=1000.0, impact_sql="SELECT 1000", priority=1,
        )],
        status="pending_approval", threshold_usd=5000.0,
        created_at=datetime.now(timezone.utc),
    )
    return AuditRow(
        decision_id="dec-1", investigation_id="inv-1",
        detection_dedup_key="k", film_id=1, region="Brazil",
        actions=list(dec.actions), status=dec.status,
        threshold_usd=5000.0, agent_run=dec, report=None,
        approval_status=status, approver="", approval_note="",
        approved_at=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def test_audit_list_returns_rows():
    from api.tests.test_fallback import _mk_triple
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.audit.list_recent_audit", return_value=[_row()]):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/audit")
            assert r.status_code == 200
            body = r.json()
            assert len(body) == 1
            assert body[0]["decision_id"] == "dec-1"


def test_approve_calls_facade():
    from api.tests.test_fallback import _mk_triple
    approved = _row(status="approved")
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.audit.async_approve_decision",
               new=AsyncMock(return_value=approved)):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.post("/approve/dec-1",
                        json={"approver": "alice", "note": "ok"})
            assert r.status_code == 200
            body = r.json()
            assert body["approval_status"] == "approved"


def test_deny_calls_facade():
    from api.tests.test_fallback import _mk_triple
    denied = _row(status="denied")
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.audit.deny_decision", return_value=denied):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.post("/deny/dec-1",
                        json={"approver": "bob", "note": "nope"})
            assert r.status_code == 200
            body = r.json()
            assert body["approval_status"] == "denied"
