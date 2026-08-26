import '@testing-library/jest-dom/vitest'
import React from 'react'
import { vi } from 'vitest'

// Zustand persist middleware captures window.localStorage at module init time.
// jsdom's localStorage stub may not have a working setItem in all vitest
// configurations. Patch it with an in-memory shim synchronously.
const _lsStore: Record<string, string> = {}
const _localStorageMock: Storage = {
  getItem: (k) => _lsStore[k] ?? null,
  setItem: (k, v) => { _lsStore[k] = String(v) },
  removeItem: (k) => { delete _lsStore[k] },
  clear: () => { Object.keys(_lsStore).forEach((k) => delete _lsStore[k]) },
  key: (i) => Object.keys(_lsStore)[i] ?? null,
  get length() { return Object.keys(_lsStore).length },
}
Object.defineProperty(globalThis, 'localStorage', { value: _localStorageMock, writable: true })

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
