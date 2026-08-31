import { QueryClient } from '@tanstack/react-query'

// Module-level QueryClient singleton so non-React code (e.g. the zustand
// runStore's SSE dispatch) can invalidate caches directly. main.tsx wraps
// the app in a QueryClientProvider using this same instance so React
// components and the store share one cache.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
