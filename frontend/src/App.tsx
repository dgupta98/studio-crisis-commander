import { useEffect } from 'react'
import { HeroBanner } from '@/panels/HeroBanner'
import { TelemetryStrip } from '@/panels/TelemetryStrip'
import { AnomalyFeed } from '@/panels/AnomalyFeed'
import { AgentTrace } from '@/panels/AgentTrace'
import { RecommendationPanel } from '@/panels/RecommendationPanel'
import { ApprovalGate } from '@/panels/ApprovalGate'
import { InjectControls } from '@/panels/InjectControls'
import { HistoryDrawer } from '@/panels/HistoryDrawer'
import { useRunStore } from '@/store/runStore'

export function App() {
  const loadDetections = useRunStore((s) => s.loadDetections)
  // AnomalyFeed reads `recentDetections`; without this bootstrap the panel
  // stays blank until pipeline.completed refreshes it.
  useEffect(() => { void loadDetections() }, [loadDetections])
  return (
    <main data-testid="ops-center"
          className="min-h-screen bg-paper text-ink font-body overflow-x-hidden">
      <div className="max-w-[1920px] mx-auto p-6 space-y-4">
        <div data-testid="panel-hero"><HeroBanner /></div>
        <div data-testid="panel-telemetry"><TelemetryStrip /></div>
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
          <div data-testid="panel-trace"><AgentTrace /></div>
          <div className="space-y-4">
            <div data-testid="panel-anomaly"><AnomalyFeed /></div>
            <div data-testid="panel-recommendation"><RecommendationPanel /></div>
            <div data-testid="panel-approval"><ApprovalGate /></div>
            <div data-testid="panel-inject"><InjectControls /></div>
          </div>
        </div>
        <div data-testid="panel-history"><HistoryDrawer /></div>
      </div>
    </main>
  )
}
