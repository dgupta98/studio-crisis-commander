import { useState, useMemo } from 'react'
import { RecommendationPanel } from './RecommendationPanel'
import { ApprovalGate } from './ApprovalGate'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SqlBlock } from '@/components/SqlBlock'
import { regionLabel } from '@/lib/regions'
import type { Finding, Hypothesis } from '@/api/contracts'

type Tab = 'investigation' | 'recommendation' | 'approval'

const TABS: { id: Tab; label: string }[] = [
  { id: 'investigation', label: 'Investigation' },
  { id: 'recommendation', label: 'Recommendation' },
  { id: 'approval', label: 'Approval' },
]

export function DashboardWorkspace() {
  const [tab, setTab] = useState<Tab>('investigation')
  return (
    <section
      data-testid="dashboard-workspace"
      className="flex h-full flex-col rounded-md border border-line bg-card"
    >
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded px-3 py-1 text-xs ${
              tab === t.id ? 'bg-card-alt text-ink' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-3">
        {tab === 'investigation' && <InvestigationView />}
        {tab === 'recommendation' && <RecommendationPanel />}
        {tab === 'approval' && <ApprovalGate />}
      </div>
    </section>
  )
}

// One-liner rationale for each sub-agent — kept next to the SQL so a
// judge / analyst can tell WHY the query is running, not just what.
const SIGNAL_PURPOSE: Record<Finding['signal'], string> = {
  numeric_context:
    'Pulls the metric across a ±24h window to characterise the anomaly’s shape (spike, drop, drift, plateau) and how long it has persisted.',
  text_reason:
    'Fetches the lowest-sentiment reviews around the anomaly to find WHY sentiment moved — the raw voice-of-the-audience evidence.',
  categorical_isolation:
    'Slices by region / variant / channel to isolate which segment is driving the anomaly instead of blaming the whole population.',
  temporal_context:
    'Looks for sibling detections in the last 72h and competitor releases within ±14 days — is this a lone spike or part of a larger event?',
}

const SIGNAL_LABEL: Record<Finding['signal'], string> = {
  numeric_context: 'Numeric context',
  text_reason: 'Text reason',
  categorical_isolation: 'Categorical isolation',
  temporal_context: 'Temporal context',
}

function InvestigationView() {
  const detection = useRunStore((s) => s.detection)
  const findings = useRunStore((s) => s.findings)
  const events = useRunStore((s) => s.events)
  const runId = useRunStore((s) => s.runId)

  // Hypothesis rides on hypothesis.formed rather than a top-level store
  // slot, so pull it out of the event stream.
  const hypothesis = useMemo<Hypothesis | null>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'hypothesis.formed') {
        const data = events[i].data as { hypothesis?: Hypothesis }
        return data.hypothesis ?? null
      }
    }
    return null
  }, [events])

  if (!runId) {
    return (
      <div className="p-6 text-center text-sm text-ink-soft">
        Investigation output will appear here once a crisis is injected.
        <div className="mt-2 text-xs">Press <span className="font-mono">Inject Crisis</span> in the top bar to begin.</div>
      </div>
    )
  }

  const subject = detection
    ? (detection.film_title && detection.film_title.trim())
      ? detection.film_title
      : `Film ${detection.film_id}`
    : null

  return (
    <div className="flex flex-col gap-4">
      {/* --- Detection banner --------------------------------- */}
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">
          Detection
        </div>
        {detection ? (
          <>
            <div className="font-display text-lg font-semibold tracking-tight text-ink">
              {subject}{detection.region ? ` · ${regionLabel(detection.region)}` : ''}
            </div>
            <div className="mt-1 text-sm text-ink-soft">
              Metric <span className="font-mono text-ink">{detection.metric}</span> ·
              severity <span className="font-mono tabular-nums text-ink">{detection.severity.toFixed(1)}</span> ·
              magnitude <span className="font-mono tabular-nums text-ink">{detection.magnitude.toFixed(2)}</span>
            </div>
            <div className="mt-1 text-xs text-ink-soft">
              Baseline <span className="font-mono tabular-nums text-ink">{detection.baseline_value.toFixed(2)}</span> →
              actual <span className="font-mono tabular-nums text-ink">{detection.actual_value.toFixed(2)}</span>
            </div>
          </>
        ) : (
          <div className="text-sm text-ink-soft italic">Detecting…</div>
        )}
      </Card>

      {/* --- Findings ---------------------------------------- */}
      {findings.length === 0 ? (
        <Card className="p-4 text-sm text-ink-soft italic">
          Sub-agents are running… findings appear as each completes.
        </Card>
      ) : (
        findings.map((f, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs uppercase tracking-wider text-accent font-mono">
                {SIGNAL_LABEL[f.signal] ?? f.signal}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-ink-soft">
                {f.latency_ms}ms
              </div>
            </div>
            <div className="text-xs italic text-ink-soft mb-2">
              {SIGNAL_PURPOSE[f.signal]}
            </div>
            {f.narrative && (
              <p className="text-sm text-ink mb-2">{f.narrative}</p>
            )}
            {f.sql && (
              <details className="group">
                <summary className="cursor-pointer text-xs text-ink-soft hover:text-ink select-none">
                  <span className="group-open:hidden">Show the SQL that produced this →</span>
                  <span className="hidden group-open:inline">Hide SQL</span>
                </summary>
                <div className="mt-2 min-w-0 max-w-full overflow-hidden">
                  <SqlBlock sql={f.sql} />
                </div>
              </details>
            )}
          </Card>
        ))
      )}

      {/* --- Hypothesis -------------------------------------- */}
      {hypothesis && (
        <Card className="p-4 border-accent/40">
          <div className="text-xs uppercase tracking-wider text-accent font-mono mb-2">
            Synthesis · {hypothesis.confidence} confidence
          </div>
          <div className="text-sm font-medium text-ink mb-2">
            {hypothesis.primary_cause}
          </div>
          {hypothesis.contributing_factors.length > 0 && (
            <ul className="text-xs text-ink-soft list-disc pl-4 space-y-0.5 mb-2">
              {hypothesis.contributing_factors.map((cf, i) => <li key={i}>{cf}</li>)}
            </ul>
          )}
          <div className="text-[11px] text-ink-soft uppercase tracking-wider">
            Grounded in: {hypothesis.citations.join(', ')}
          </div>
        </Card>
      )}
    </div>
  )
}
