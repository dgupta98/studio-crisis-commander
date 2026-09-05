import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'

// Dashboard-side history feed. Reads the same `auditRows` slice the store
// hydrates on approve/deny; we kick a fresh load on mount so users landing
// cold on /dashboard immediately see prior runs (not just runs completed
// during this session).
export function RecentRuns() {
  const rows = useRunStore((s) => s.auditRows)
  const loadAudit = useRunStore((s) => s.loadAudit)

  useEffect(() => {
    void loadAudit(15)
  }, [loadAudit])

  const display = rows.slice(0, 8)

  return (
    <Card data-testid="recent-runs" className="p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-ink-soft">
          Recent runs
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
          {rows.length ? `${rows.length} total` : ''}
        </span>
      </div>
      {display.length === 0 ? (
        <div className="text-xs text-ink-soft">No runs yet — press Inject to start one.</div>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {display.map((r) => (
            <li key={r.audit_id} className="flex items-center gap-3 py-2 text-sm">
              <span className="font-mono text-[10px] text-ink-soft shrink-0 w-28 truncate">
                {new Date(r.created_at).toLocaleString([], {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
              <Link
                to={`/movies/${r.film_id}`}
                className="truncate flex-1 text-ink hover:text-accent"
                title={r.report_headline || `Movie #${r.film_id}`}
              >
                {r.report_headline || `Movie #${r.film_id}`}
              </Link>
              <span className="font-mono text-[10px] uppercase text-ink-soft shrink-0">
                {r.region}
              </span>
              <span
                className={`font-mono text-[10px] uppercase tracking-wider shrink-0 ${
                  r.approval_status === 'approved'      ? 'text-emerald-400'
                  : r.approval_status === 'denied'      ? 'text-rose-400'
                  : 'text-amber-300'
                }`}
              >
                {r.approval_status.replace('_', ' ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
