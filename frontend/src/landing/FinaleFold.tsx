import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { PosterMarquee } from './PosterMarquee'
import { tokens } from '../theme/tokens'

const EASE = tokens.motion.ease.cinematic

const STEPS = [
  {
    n: '01',
    title: 'Signals land',
    body: 'ClickHouse ingest across 4 signal families. Detection is pure SQL on 5-min rollups.',
    family: 'box_office' as const,
  },
  {
    n: '02',
    title: 'Agents reason',
    body: 'Investigation → Decision → Report on Gemini via ADK. Every claim grounded in returned rows.',
    family: 'social' as const,
  },
  {
    n: '03',
    title: 'Human decides',
    body: 'Ranked actions land in the Approval Gate with full SQL provenance. Approve or deny.',
    family: 'streaming' as const,
  },
]

export function FinaleFold() {
  return (
    <section className="relative flex min-h-screen flex-col overflow-hidden bg-paper pt-20">
      {/* Ambient split gradient */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-50"
        style={{
          background: `radial-gradient(ellipse at 20% 100%, ${tokens.signal.box_office.hex}18 0%, transparent 55%),
                       radial-gradient(ellipse at 80% 0%,   ${tokens.signal.social.hex}18 0%, transparent 55%)`,
        }}
      />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-14 px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={{ duration: 0.8, ease: EASE }}
          className="text-center"
        >
          <span className="text-[11px] font-mono uppercase tracking-[0.28em] text-accent">The Sequence</span>
          <h2 className="mt-2 font-display font-light text-4xl leading-tight tracking-tight md:text-6xl">
            How it <span className="italic">works.</span>
          </h2>
        </motion.div>

        {/* 3 steps — compact horizontal */}
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.7, ease: EASE, delay: i * 0.12 }}
              className="relative flex flex-col gap-3"
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full border font-mono text-xs"
                style={{
                  borderColor: tokens.signal[s.family].hex,
                  color: tokens.signal[s.family].hex,
                  boxShadow: `0 0 24px ${tokens.signal[s.family].glow}`,
                }}
              >
                {s.n}
              </div>
              <h3 className="font-display text-xl tracking-tight md:text-2xl">{s.title}</h3>
              <p className="font-body text-sm leading-relaxed text-ink-soft">{s.body}</p>
            </motion.div>
          ))}
        </div>

        {/* CTA row — compact, tucked between steps and marquee */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ duration: 0.8, ease: EASE }}
          className="flex flex-col items-center gap-4 border-t border-line/50 pt-10 text-center"
        >
          <span className="text-[11px] font-mono uppercase tracking-[0.28em] text-accent">Now Showing</span>
          <h2 className="font-display font-light text-3xl leading-tight tracking-tight md:text-5xl">
            Watch it happen <span className="italic text-accent">live.</span>
          </h2>
          <div className="mt-2 flex items-center gap-3">
            <Link
              to="/dashboard"
              className="rounded-md border border-accent bg-accent px-6 py-2.5 text-sm font-medium tracking-wide text-white transition-transform hover:-translate-y-0.5 hover:brightness-110"
            >
              Open the dashboard →
            </Link>
            <Link
              to="/movies"
              className="rounded-md border border-line px-6 py-2.5 text-sm tracking-wide text-ink transition-colors hover:border-accent hover:text-accent"
            >
              Browse Movies
            </Link>
          </div>
        </motion.div>
      </div>

      {/* Marquee at the very bottom */}
      <div className="mt-14 w-full">
        <PosterMarquee />
      </div>

      <footer className="w-full px-6 py-5 text-center text-[10px] font-mono uppercase tracking-[0.3em] text-ink-soft">
        Google Cloud × ClickHouse · Studio Crisis Commander
      </footer>
    </section>
  )
}
