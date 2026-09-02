import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RecommendationPanel } from './RecommendationPanel'
import { ApprovalGate } from './ApprovalGate'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SqlBlock } from '@/components/SqlBlock'
import { regionLabel } from '@/lib/regions'
import { queries } from '@/api/queries'
import type { Finding, Hypothesis, DetectionRow } from '@/api/contracts'

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
  const selectedFilmId = useRunStore((s) => s.selectedFilmId)
  const selectedRegion = useRunStore((s) => s.selectedRegion)
  const currentRunFilmId = useRunStore((s) => s.currentRunFilmId)

  // If the analyst has picked a different film×region than the current live
  // run, fetch that context's most recent investigation and show it instead.
  const scopedQuery = useQuery({
    ...queries.filmLatestInvestigation(selectedFilmId ?? 0, selectedRegion),
    enabled: selectedFilmId !== null
        && (currentRunFilmId !== selectedFilmId
            || (selectedRegion != null && detection?.region !== selectedRegion)),
    select: (raw) => raw as {
      detection: DetectionRow | null
      decision: { decision_id: string; status: string; recommended_actions: unknown[] } | null
    } | null,
  })

  const displayDetection = detection ?? scopedQuery.data?.detection ?? null

  const hypothesis = useMemo<Hypothesis | null>(() => {
    const list = Array.isArray(events) ? events : []
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].type === 'hypothesis.formed') {
        const data = list[i].data as { hypothesis?: Hypothesis }
        return data.hypothesis ?? null
      }
    }
    return null
  }, [events])

  if (!runId && !displayDetection && selectedFilmId === null) {
    return (
      <div className="p-6 text-center text-sm text-ink-soft">
        Pick a movie on the heat bar to see its investigation history.
        <div className="mt-2 text-xs">Or press <span className="font-mono">Inject Crisis</span> to run a new one.</div>
      </div>
    )
  }

  const subject = displayDetection
    ? (displayDetection.film_title && displayDetection.film_title.trim())
      ? displayDetection.film_title
      : `Film ${displayDetection.film_id}`
    : null

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">Detection</div>
        {displayDetection ? (
          <>
            <div className="font-display text-lg font-semibold tracking-tight text-ink">
              {subject}{displayDetection.region ? ` · ${regionLabel(displayDetection.region)}` : ''}
            </div>
            <div className="mt-1 text-sm text-ink-soft">
              Metric <span className="font-mono text-ink">{displayDetection.metric}</span> ·
              severity <span className="font-mono tabular-nums text-ink">{displayDetection.severity?.toFixed?.(1) ?? displayDetection.severity}</span> ·
              magnitude <span className="font-mono tabular-nums text-ink">{displayDetection.magnitude?.toFixed?.(2) ?? displayDetection.magnitude}</span>
            </div>
            {typeof displayDetection.baseline_value === 'number' && (
              <div className="mt-1 text-xs text-ink-soft">
                Baseline <span className="font-mono tabular-nums text-ink">{displayDetection.baseline_value.toFixed(2)}</span> →
                actual <span className="font-mono tabular-nums text-ink">{displayDetection.actual_value.toFixed(2)}</span>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-ink-soft italic">
            {scopedQuery.isFetching ? 'Loading investigation…' : 'No investigation for this scope.'}
          </div>
        )}
      </Card>

      {findings.length === 0 ? (
        !displayDetection ? null : (
          <Card className="p-4 text-sm text-ink-soft italic">
            No sub-agent findings for this scope.
          </Card>
        )
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
            {f.narrative && <p className="text-sm text-ink mb-2">{f.narrative}</p>}
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
