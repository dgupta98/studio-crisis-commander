import { Link } from 'react-router-dom'
import { LiveCounter } from './LiveCounter'

export function CtaFold() {
  return (
    <section className="flex min-h-[80vh] items-center justify-center px-6 py-16">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
        <h2 className="font-display text-4xl tracking-tight">Watch it happen live.</h2>
        <p className="text-sm text-ink-soft">Four agents, five endpoints, one dashboard.</p>
        <LiveCounter />
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="rounded-md border border-accent bg-accent px-6 py-2.5 text-sm font-medium text-black hover:brightness-110"
          >
            Open the dashboard →
          </Link>
        </div>
      </div>
    </section>
  )
}
