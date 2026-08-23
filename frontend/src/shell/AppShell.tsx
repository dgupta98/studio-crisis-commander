import { useState, useEffect, type PropsWithChildren } from 'react'
import { useLocation } from 'react-router-dom'
import { LeftNav } from './LeftNav'
import { TopBar } from './TopBar'
import { GlobalInjectModal } from './GlobalInjectModal'

export function AppShell({ children }: PropsWithChildren) {
  const [injectOpen, setInjectOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()

  // Close the mobile drawer whenever the route changes so the user isn't
  // left staring at the drawer after tapping a nav link.
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setInjectOpen(true)
      }
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper text-ink">
      {/* Desktop persistent nav. On mobile this collapses to zero width
          and the drawer below takes over. */}
      <div className="hidden md:block">
        <LeftNav />
      </div>

      {/* Mobile drawer + scrim. `fixed` so it overlays main content instead
          of pushing it, `md:hidden` so it never appears on desktop. */}
      {navOpen && (
        <>
          <div
            aria-hidden
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">
            <LeftNav />
          </div>
        </>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          onInject={() => setInjectOpen(true)}
          onOpenNav={() => setNavOpen(true)}
        />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
      <GlobalInjectModal open={injectOpen} onClose={() => setInjectOpen(false)} />
    </div>
  )
}
