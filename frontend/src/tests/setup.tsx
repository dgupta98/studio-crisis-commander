import '@testing-library/jest-dom/vitest'
import React from 'react'
import { vi } from 'vitest'

// Recharts ResponsiveContainer uses ResizeObserver which jsdom does not provide.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Recharts ResponsiveContainer refuses to render children when the jsdom container
// reports zero dimensions. Mock it to pass children through so chart tests can
// assert on rendered SVG elements. (harmless in non-chart tests; other recharts
// exports are passed through unchanged via importOriginal.)
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>()
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  }
})
