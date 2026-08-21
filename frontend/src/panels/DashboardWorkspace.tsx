import { useState } from 'react'
import { RecommendationPanel } from './RecommendationPanel'
import { ApprovalGate } from './ApprovalGate'

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

function InvestigationView() {
  return (
    <div className="text-sm text-ink-soft">
      Investigation output renders here (from runStore).
    </div>
  )
}
