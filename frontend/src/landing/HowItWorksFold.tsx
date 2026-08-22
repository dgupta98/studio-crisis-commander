import { motion } from 'framer-motion'
import { tokens } from '../theme/tokens'

const EASE = tokens.motion.ease.cinematic

const STEPS = [
  {
    n: '01',
    title: 'Signals land',
    body: 'ClickHouse ingest across 4 signal families. Detection is pure SQL on 5-min rollups — milliseconds, not seconds.',
    family: 'box_office' as const,
  },
  {
    n: '02',
    title: 'Agents reason',
    body: 'Investigation → Decision → Report runs on Gemini via ADK. Every claim grounded in a returned row set.',
    family: 'social' as const,
  },
  {
    n: '03',
    title: 'Human decides',
    body: 'Ranked actions land in the Approval Gate with full SQL provenance. Approve or deny before anything ships.',
    family: 'streaming' as const,
  },
]

export function HowItWorksFold() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-paper px-6 py-24">
      {/* Vertical gradient rule */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 md:block"
        style={{
          background: `linear-gradient(180deg, transparent, ${tokens.color.line} 20%, ${tokens.color.line} 80%, transparent)`,
        }}
      />

      <div className="mx-auto flex max-w-6xl flex-col gap-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={{ duration: 0.9, ease: EASE }}
          className="text-center"
        >
          <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.28em] text-accent">The Sequence</span>
          <h2 className="mt-3 font-display font-bold text-3xl tracking-tight md:text-5xl">
            How it <span className="text-accent">works.</span>
          </h2>
        </motion.div>

        <div className="grid gap-10 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.8, ease: EASE, delay: i * 0.15 }}
              className="relative flex flex-col gap-4 px-2"
            >
              {/* Big translucent numeral in the background */}
              <span
                aria-hidden
                className="pointer-events-none absolute -left-4 -top-8 select-none font-display text-[8rem] font-black leading-none opacity-[0.04]"
                style={{ color: tokens.signal[s.family].hex }}
              >
                {s.n}
              </span>

              <div
                className="flex h-10 w-10 items-center justify-center rounded-full border font-mono text-xs font-semibold"
                style={{
                  borderColor: tokens.signal[s.family].hex,
                  color: tokens.signal[s.family].hex,
                  boxShadow: `0 0 24px ${tokens.signal[s.family].glow}`,
                }}
              >
                {s.n}
              </div>
              <h3 className="font-display font-semibold text-xl tracking-tight md:text-2xl text-ink">{s.title}</h3>
              <p className="text-sm leading-relaxed text-ink-soft md:text-base">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
