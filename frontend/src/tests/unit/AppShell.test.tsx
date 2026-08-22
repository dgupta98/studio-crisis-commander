import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect } from 'vitest'
import { AppShell } from '../../shell/AppShell'

describe('AppShell', () => {
  it('renders nav links and top bar CTA', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppShell>content</AppShell>
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(screen.getByLabelText('Primary')).toBeInTheDocument()
    expect(screen.getByTestId('top-inject-cta')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
