import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { AppShell } from '../../shell/AppShell'

describe('AppShell', () => {
  it('renders nav links and top bar CTA', () => {
    render(
      <MemoryRouter>
        <AppShell>content</AppShell>
      </MemoryRouter>
    )
    expect(screen.getByLabelText('Primary')).toBeInTheDocument()
    expect(screen.getByTestId('top-inject-cta')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
