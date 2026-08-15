import { useEffect, useRef, useState } from 'react'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { SeverityChip } from '@/components/SeverityChip'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { ApiError } from '@/api/client'

export function ApprovalGate() {
  const state = useRunStore((s) => s.panelStates.approval)
  const decision = useRunStore((s) => s.decision)
  const status = useRunStore((s) => s.approvalStatus)
  const approve = useRunStore((s) => s.approve)
  const deny = useRunStore((s) => s.deny)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Synchronous re-entrancy guard: `busy` is state and only reflects on the
  // next render, so a rapid second click would fire another POST before the
  // first render sees busy=true.
  const inFlightRef = useRef(false)

  // Fresh decision (new run) — drop any error/busy left over from prior run.
  useEffect(() => {
    inFlightRef.current = false
    setBusy(false)
    setError(null)
  }, [decision?.decision_id])

  const run = async (fn: () => Promise<void>) => {
    if (!decision || inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true); setError(null)
    try { await fn() }
    catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.body.slice(0, 100)}` : String(e))
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  const doApprove = () => run(() => approve(decision!.decision_id, 'via dashboard'))
  const doDeny = () => run(() => deny(decision!.decision_id, 'via dashboard'))

  return (
    <PanelStateWrapper state={state} label="Approval" idleLabel="Nothing to approve">
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-ink-soft mb-3">Approval Gate</div>
        {status === 'approved' && <SeverityChip level="info">Approved</SeverityChip>}
        {status === 'denied' && <SeverityChip level="critical">Denied</SeverityChip>}
        {status === 'auto_executed' && <SeverityChip level="info">Auto-executed</SeverityChip>}
        {(!status || status === 'pending_approval') && decision && (
          <div className="flex gap-2 mt-2">
            <Button variant="primary" onClick={doApprove} disabled={busy}>
              {busy ? '...' : 'Approve'}
            </Button>
            <Button variant="secondary" onClick={doDeny} disabled={busy}>
              {busy ? '...' : 'Deny'}
            </Button>
          </div>
        )}
        {error && (
          <div role="alert" className="mt-2 text-xs text-accent">{error}</div>
        )}
      </Card>
    </PanelStateWrapper>
  )
}
