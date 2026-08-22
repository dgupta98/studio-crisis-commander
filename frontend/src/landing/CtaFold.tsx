import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LiveCounter } from './LiveCounter'
import { PosterMarquee } from './PosterMarquee'
import { tokens } from '../theme/tokens'

const EASE = tokens.motion.ease.cinematic

export function CtaFold() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-between overflow-hidden bg-paper pt-24">
      {/* Ambient split gradient */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-60"
        style={{
          background: `radial-gradient(ellipse at 20% 100%, ${tokens.signal.box_office.hex}18 0%, transparent 50%),
                       radial-gradient(ellipse at 80% 100%, ${tokens.signal.social.hex}18 0%, transparent 50%)`,
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-15%' }}
        transition={{ duration: 0.9, ease: EASE }}
        className="mx-auto flex max-w-4xl flex-col items-center gap-8 px-6 text-center"
      >
        <span className="text-[11px] font-mono uppercase tracking-[0.28em] text-accent">Now Showing</span>
        <h2 className="font-display font-light text-5xl leading-[1.05] tracking-tight md:text-7xl">
          Watch it happen <span className="italic text-accent">live.</span>
        </h2>
        <p className="max-w-xl font-body text-base text-ink-soft md:text-lg">
          Four agents, five endpoints, one dashboard. Every dollar figure links to the query that produced it.
        </p>
        <LiveCounter />
        <div className="mt-4 flex items-center gap-3">
          <Link
            to="/dashboard"
            className="group relative overflow-hidden rounded-md border border-accent bg-accent px-8 py-3.5 text-sm font-medium tracking-wide text-white transition-transform hover:-translate-y-0.5 hover:brightness-110"
          >
            <span className="relative z-10">Open the dashboard →</span>
          </Link>
          <Link
            to="/movies"
            className="rounded-md border border-line px-8 py-3.5 text-sm tracking-wide text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Browse Movies
          </Link>
        </div>
      </motion.div>

      <div className="mt-16 w-full">
        <PosterMarquee />
      </div>

      <footer className="w-full px-6 py-6 text-center text-[10px] font-mono uppercase tracking-[0.3em] text-ink-soft">
        Google Cloud × ClickHouse · Studio Crisis Commander
      </footer>
    </section>
  )
}
