import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { prefetchDashboard } from '../api/queries'
import { useRunStore } from '@/store/runStore'
import { IntakeStrip } from '../panels/IntakeStrip'
import { AnomalyFeed } from '../panels/AnomalyFeed'
import { AgentTrace } from '../panels/AgentTrace'
import { TelemetryStrip } from '../panels/TelemetryStrip'
import { DashboardWorkspace } from '../panels/DashboardWorkspace'
import { RecentRuns } from '../panels/RecentRuns'

export default function DashboardRoute() {
  const qc = useQueryClient()
  useEffect(() => {
    prefetchDashboard(qc)
    // Populate runStore.recentDetections on mount — the anomaly feed and
    // telemetry strip both read from the store, so without this the panels
    // show empty/idle until an inject fires.
    void useRunStore.getState().loadDetections(50)
    // First-load hydration: if the store is empty (no active/persisted run),
    // seed it from a bundled cached triple so trace/investigation/decision
    // are populated instantly. Judges land on a fully-worked example; they
    // can still Inject Crisis to run a fresh one on top.
    const { runId, report, seedFromCached } = useRunStore.getState()
    if (!runId && !report) {
      void seedFromCached()
    }
  }, [qc])
  return (
    <div data-testid="route-dashboard" className="flex h-full flex-col">
      <IntakeStrip />
      {/* 3-column desktop layout collapses to a single scrolling stack on
          mobile / small tablets — the workspace stays center-of-attention
          and the side rails move above / below it in reading order. */}
      <div className="grid flex-1 gap-3 overflow-hidden p-3 grid-cols-1 lg:grid-cols-[300px_1fr_340px] xl:grid-cols-[320px_1fr_360px]">
        <div className="flex flex-col gap-3 overflow-auto order-2 lg:order-1">
          <AnomalyFeed />
          <RecentRuns />
        </div>
        <div className="overflow-hidden order-1 lg:order-2">
          <DashboardWorkspace />
        </div>
        <div className="overflow-auto order-3">
          <AgentTrace />
        </div>
      </div>
      <TelemetryStrip />
    </div>
  )
}
