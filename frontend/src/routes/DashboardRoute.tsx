import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { prefetchDashboard } from '../api/queries'
import { useRunStore } from '@/store/runStore'
import { IntakeStrip } from '../panels/IntakeStrip'
import { AnomalyFeed } from '../panels/AnomalyFeed'
import { AgentTrace } from '../panels/AgentTrace'
import { TelemetryStrip } from '../panels/TelemetryStrip'
import { DashboardWorkspace } from '../panels/DashboardWorkspace'

export default function DashboardRoute() {
  const qc = useQueryClient()
  useEffect(() => {
    prefetchDashboard(qc)
    // Populate runStore.recentDetections on mount — the anomaly feed and
    // telemetry strip both read from the store, so without this the panels
    // show empty/idle until an inject fires.
    void useRunStore.getState().loadDetections(50)
  }, [qc])
  return (
    <div data-testid="route-dashboard" className="flex h-full flex-col">
      <IntakeStrip />
      <div className="grid flex-1 grid-cols-[320px_1fr_360px] gap-3 overflow-hidden p-3">
        <div className="overflow-auto">
          <AnomalyFeed />
        </div>
        <div className="overflow-hidden">
          <DashboardWorkspace />
        </div>
        <div className="overflow-auto">
          <AgentTrace />
        </div>
      </div>
      <TelemetryStrip />
    </div>
  )
}
