import { motion } from 'framer-motion'
import { SignalChip, type SignalFamily } from '../components/SignalChip'
import { tokens } from '../theme/tokens'

const EASE = tokens.motion.ease.cinematic

const AGENTS: { family: SignalFamily; title: string; body: string; role: string }[] = [
  {
    family: 'box_office',
    title: 'Detection Agent',
    role: 'Watches every signal',
    body: 'Pure SQL over 50M+ rows in ClickHouse. MAD-Z anomaly scoring on 5-minute windows. Sub-second at scale, no LLM in the hot path.',
  },
  {
    family: 'social',
    title: 'Investigation Agent',
    role: 'Forms the hypothesis',
    body: 'Four grounded sub-agents fan out via the mcp-clickhouse MCP server. Gemini narrates numbers, SQL computes them.',
  },
  {
    family: 'reviews',
    title: 'Decision Agent',
    role: 'Ranks the response',
    body: 'Bounded action space with cost/impact estimation. Every dollar figure carries the SQL query that produced it.',
  },
  {
    family: 'streaming',
    title: 'Report Agent',
    role: 'Writes the brief',
    body: 'Executive prose with provenance links back to source rows. Refuses to construct actions without supporting SQL.',
  },
]

export function AgentsFold() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-paper px-6 py-24">
      {/* Soft radial glow anchor */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background: `radial-gradient(ellipse at 50% 20%, ${tokens.signal.social.hex}18 0%, transparent 55%)`,
        }}
      />

      <div className="mx-auto flex max-w-6xl flex-col gap-14">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={{ duration: 0.9, ease: EASE }}
          className="text-center"
        >
          <span className="text-[11px] font-mono uppercase tracking-[0.28em] text-accent">The Cast</span>
          <h2 className="mt-3 font-display font-light text-4xl leading-tight tracking-tight md:text-6xl">
            Four agents.<br />
            <span className="italic text-ink-soft">One narrative.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-ink-soft md:text-lg">
            Each agent owns one contract and one output. Composed via Google ADK. Handed off in sequence.
          </p>
        </motion.div>

        <div className="grid gap-5 md:grid-cols-2">
          {AGENTS.map((a, i) => (
            <motion.article
              key={a.family}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.7, ease: EASE, delay: i * 0.08 }}
              className="group relative flex flex-col gap-4 overflow-hidden rounded-lg border border-line bg-card/60 p-8 backdrop-blur-sm transition-all hover:border-accent/60 hover:bg-card"
              style={{
                boxShadow: `0 0 0 1px transparent`,
              }}
            >
              {/* Corner glow that appears on hover, colored per family. */}
              <div
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-40"
                style={{ background: tokens.signal[a.family].glow }}
              />

              <div className="flex items-center justify-between">
                <SignalChip family={a.family} />
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-soft">
                  0{i + 1} / 04
                </span>
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-ink-soft">{a.role}</div>
                <h3 className="mt-2 font-display font-light text-2xl tracking-tight md:text-3xl">{a.title}</h3>
              </div>
              <p className="text-sm leading-relaxed text-ink-soft md:text-base">{a.body}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  )
}
