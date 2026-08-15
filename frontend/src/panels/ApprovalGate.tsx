import { useState } from 'react'
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

  const doApprove = async () => {
    if (!decision) return
    setBusy(true); setError(null)
    try { await approve(decision.decision_id, 'via dashboard') }
    catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.body.slice(0, 100)}` : String(e))
    } finally { setBusy(false) }
  }

  const doDeny = async () => {
    if (!decision) return
    setBusy(true); setError(null)
    try { await deny(decision.decision_id, 'via dashboard') }
    catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.body.slice(0, 100)}` : String(e))
    } finally { setBusy(false) }
  }

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
            <Button variant="secondary" onClick={doDeny} disabled={busy}>Deny</Button>
          </div>
        )}
        {error && <div className="mt-2 text-xs text-accent">{error}</div>}
      </Card>
    </PanelStateWrapper>
  )
}
