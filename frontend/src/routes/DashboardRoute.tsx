import { IntakeStrip } from '../panels/IntakeStrip'
import { AnomalyFeed } from '../panels/AnomalyFeed'
import { AgentTrace } from '../panels/AgentTrace'
import { TelemetryStrip } from '../panels/TelemetryStrip'
import { DashboardWorkspace } from '../panels/DashboardWorkspace'

export default function DashboardRoute() {
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
