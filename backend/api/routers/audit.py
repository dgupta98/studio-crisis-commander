"""GET /audit + POST /approve/{id} + POST /deny/{id}."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from agents.decision.audit import (
    AuditRow, async_approve_decision, deny_decision, list_recent_audit,
)
from api.events import SseEvent


router = APIRouter(tags=["audit"])


class ApprovalRequest(BaseModel):
    approver: str
    note: str = ""


@router.get("/audit", response_model=list[AuditRow])
def audit_list(limit: int = 50):
    return list_recent_audit(limit=limit)


@router.post("/approve/{decision_id}", response_model=AuditRow)
async def approve(decision_id: str, req: ApprovalRequest, request: Request):
    try:
        row = await async_approve_decision(decision_id, req.approver, req.note)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    await _echo(request, decision_id, "approval.granted", req)
    return row


@router.post("/deny/{decision_id}", response_model=AuditRow)
async def deny(decision_id: str, req: ApprovalRequest, request: Request):
    try:
        row = deny_decision(decision_id, req.approver, req.note)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    await _echo(request, decision_id, "approval.denied", req)
    return row


async def _echo(request: Request, decision_id: str, ev_type: str,
                req: ApprovalRequest) -> None:
    """Best-effort push of approval event onto any still-live SSE stream."""
    runtime = request.app.state.runtime
    run_id = await runtime.run_id_for_decision(decision_id)
    if run_id is None:
        return
    st = await runtime.get(run_id)
    if st is None or st.status != "running":
        # Post-terminal decision: audit is durable, no live stream to echo to.
        return
    seq = len(st.events)
    await runtime.emit(run_id, SseEvent(
        seq=seq, type=ev_type,
        data={"decision_id": decision_id,
              "approver": req.approver, "note": req.note},
    ))
