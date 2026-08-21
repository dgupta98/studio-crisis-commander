import { useState, type PropsWithChildren } from 'react'
import { LeftNav } from './LeftNav'
import { TopBar } from './TopBar'
import { GlobalInjectModal } from './GlobalInjectModal'

export function AppShell({ children }: PropsWithChildren) {
  const [injectOpen, setInjectOpen] = useState(false)
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper text-ink">
      <LeftNav />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar onInject={() => setInjectOpen(true)} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
      <GlobalInjectModal open={injectOpen} onClose={() => setInjectOpen(false)} />
    </div>
  )
}
