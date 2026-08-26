import { useEffect, useState } from 'react'

// Wrapper over the CSS media query so components can skip / shorten
// animations when the user has requested reduced motion. Framer Motion has
// its own useReducedMotion but reading a stable boolean lets us also
// zero-out delay in staggered lists (which Framer's flag doesn't do alone).
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}
