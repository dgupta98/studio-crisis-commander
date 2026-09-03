import { useEffect, useRef, useState } from 'react'
import { useRunStore, useScopeMatches } from '@/store/runStore'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { SeverityChip } from '@/components/SeverityChip'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { ApiError } from '@/api/client'
import { regionLabel } from '@/lib/regions'

export function ApprovalGate() {
  const state = useRunStore((s) => s.panelStates.approval)
  const rawDecision = useRunStore((s) => s.decision)
  const rawStatus = useRunStore((s) => s.approvalStatus)
  const scopeMatches = useScopeMatches()
  // Only expose the top-level decision when it belongs to the currently
  // selected film×region. Otherwise show only the pending-queue below.
  const decision = scopeMatches ? rawDecision : null
  const status = scopeMatches ? rawStatus : null
  const approve = useRunStore((s) => s.approve)
  const deny = useRunStore((s) => s.deny)
  const auditRows = useRunStore((s) => s.auditRows)
  const [busy, setBusy] = useState(false)
  const [pendingBusyId, setPendingBusyId] = useState<string | null>(null)
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

  const actOnPending = async (
    id: string, fn: (id: string, note: string) => Promise<void>, note: string,
  ) => {
    if (pendingBusyId) return
    setPendingBusyId(id); setError(null)
    try { await fn(id, note) }
    catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.body.slice(0, 100)}` : String(e))
    } finally { setPendingBusyId(null) }
  }

  // Prior runs that never auto-executed remain actionable — surface them so
  // the operator has one place to clear the queue rather than digging through
  // the History drawer.
  const pending = auditRows.filter(
    (r) => r.approval_status === 'pending_approval'
      && r.decision_id !== decision?.decision_id,
  )

  return (
    <PanelStateWrapper state={state} label="Approval" idleLabel="Nothing to approve">
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-ink-soft mb-3">Approval Gate</div>

        {decision && (
          <div className="mb-3">
            <div className="text-sm text-ink mb-1">
              Current decision · <span className="font-mono text-xs text-ink-soft">
                {decision.decision_id.slice(0, 8)}
              </span>
            </div>
            {status === 'approved' && <SeverityChip level="info">Approved</SeverityChip>}
            {status === 'denied' && <SeverityChip level="critical">Denied</SeverityChip>}
            {status === 'auto_executed' && (
              <div>
                <SeverityChip level="info">Auto-executed</SeverityChip>
                <div className="text-xs text-ink-soft mt-1">
                  All action impacts cleared the auto-execute threshold.
                </div>
              </div>
            )}
            {(!status || status === 'pending_approval') && (
              <div className="flex gap-2 mt-2">
                <Button variant="primary" onClick={doApprove} disabled={busy}>
                  {busy ? '...' : 'Approve'}
                </Button>
                <Button variant="secondary" onClick={doDeny} disabled={busy}>
                  {busy ? '...' : 'Deny'}
                </Button>
              </div>
            )}
          </div>
        )}

        {pending.length > 0 && (
          <div className="border-t border-line pt-3">
            <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">
              Pending from prior runs · {pending.length}
            </div>
            <ul className="space-y-2">
              {pending.map((r) => (
                <li key={r.audit_id} className="border-l-2 border-accent pl-2">
                  <div className="text-sm text-ink truncate">{r.report_headline}</div>
                  <div className="text-xs text-ink-soft mb-1">
                    Film {r.film_id} · {regionLabel(r.region)} ·
                    <span className="font-mono ml-1">{r.decision_id.slice(0, 8)}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      onClick={() => void actOnPending(r.decision_id, approve, 'via dashboard queue')}
                      disabled={pendingBusyId === r.decision_id}
                    >
                      {pendingBusyId === r.decision_id ? '...' : 'Approve'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void actOnPending(r.decision_id, deny, 'via dashboard queue')}
                      disabled={pendingBusyId === r.decision_id}
                    >
                      {pendingBusyId === r.decision_id ? '...' : 'Deny'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-2 text-xs text-accent">{error}</div>
        )}
      </Card>
    </PanelStateWrapper>
  )
}
