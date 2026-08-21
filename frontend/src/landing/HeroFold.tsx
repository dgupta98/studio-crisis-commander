import { Link } from 'react-router-dom'
import { ParticleCascade } from './ParticleCascade'
import { LiveCounter } from './LiveCounter'

export function HeroFold() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
      <ParticleCascade />
      <div className="relative z-10 flex max-w-3xl flex-col items-center gap-8">
        <span className="rounded-full border border-line bg-card/70 px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-ink-soft backdrop-blur-sm">
          Detecting data as it lands
        </span>
        <h1 className="font-display text-5xl leading-none tracking-tight md:text-6xl">
          Investigations that arrive<br />before the meeting starts.
        </h1>
        <p className="max-w-xl text-lg text-ink-soft">
          Four autonomous agents pipe box office, social, reviews, and streaming into a single crisis narrative — in milliseconds.
        </p>
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="rounded-md border border-accent bg-accent px-5 py-2 text-sm font-medium text-black hover:brightness-110"
          >
            Open Dashboard →
          </Link>
          <Link to="/movies" className="rounded-md border border-line px-5 py-2 text-sm text-ink hover:border-accent">
            Browse Movies
          </Link>
        </div>
        <div className="mt-8 w-full border-t border-line pt-8">
          <LiveCounter />
        </div>
      </div>
    </section>
  )
}
