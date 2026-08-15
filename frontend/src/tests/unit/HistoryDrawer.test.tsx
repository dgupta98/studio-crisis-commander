import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HistoryDrawer } from '@/panels/HistoryDrawer'
import { useRunStore } from '@/store/runStore'
import type { AuditRow } from '@/api/contracts'

const row: AuditRow = {
  audit_id: 'a-1', decision_id: 'd-1', investigation_id: 'i-1',
  created_at: '2026-08-09T00:00:00Z',
  approval_status: 'approved',
  approver: 'dashboard@demo', approval_note: '', denial_reason: '',
  threshold_usd: 250000, total_impact_usd: 100000,
  film_id: 1, region: 'Brazil',
  report_id: 'r-1', report_headline: 'Brazil sentiment collapse',
}

beforeEach(() => useRunStore.getState().reset())

describe('HistoryDrawer', () => {
  it('empty — shows hint', () => {
    render(<HistoryDrawer />)
    expect(screen.getByText(/no past investigations/i)).toBeInTheDocument()
  })

  it('toggles open/closed via header button', () => {
    useRunStore.setState({ auditRows: [row] })
    useRunStore.getState()._recomputePanels()
    render(<HistoryDrawer />)
    const toggle = screen.getByRole('button', { name: /history/i })
    // Starts collapsed — headline not shown
    expect(screen.queryByText('Brazil sentiment collapse')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getByText('Brazil sentiment collapse')).toBeInTheDocument()
  })
})
