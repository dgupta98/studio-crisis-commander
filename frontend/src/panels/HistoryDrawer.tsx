import { useState, useEffect } from 'react'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { SeverityChip } from '@/components/SeverityChip'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import type { AuditRow } from '@/api/contracts'

function statusLevel(status: AuditRow['approval_status']): 'info' | 'warn' | 'critical' {
  if (status === 'approved' || status === 'auto_executed') return 'info'
  if (status === 'denied') return 'critical'
  return 'warn'
}

export function HistoryDrawer() {
  const state = useRunStore((s) => s.panelStates.history)
  const rows = useRunStore((s) => s.auditRows)
  const loadAudit = useRunStore((s) => s.loadAudit)
  const [open, setOpen] = useState(false)

  useEffect(() => { void loadAudit(20) }, [loadAudit])

  return (
    <PanelStateWrapper state={state} label="History" idleLabel="No past investigations yet">
      <Card className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="history-list"
          className="w-full flex items-center justify-between rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="text-xs uppercase tracking-wider text-ink-soft">
            History · {rows.length} runs
          </span>
          <span className="text-ink-soft text-sm">{open ? '▲' : '▼'}</span>
        </button>
        {open && (
          <ul id="history-list" className="mt-3 space-y-2">
            {rows.map((r) => (
              <li key={r.audit_id} className="border-b border-line pb-2 flex items-center gap-3">
                <SeverityChip level={statusLevel(r.approval_status)}>
                  {r.approval_status.replaceAll('_', ' ')}
                </SeverityChip>
                <span className="text-sm text-ink flex-1">{r.report_headline}</span>
                <span
                  className="text-xs font-mono text-ink-soft"
                  title={r.decision_id}
                >{r.decision_id.slice(0, 8)}</span>
              </li>
            ))}
          </ul>
        )}
        {open && rows.length > 0 && (
          <div className="mt-2 flex justify-end">
            <Button variant="ghost" onClick={() => void loadAudit(20)}>Refresh</Button>
          </div>
        )}
      </Card>
    </PanelStateWrapper>
  )
}
