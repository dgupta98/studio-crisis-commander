import { Link } from 'react-router-dom'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { useEffect } from 'react'
import { ParticleCascade } from './ParticleCascade'
import { LiveCounter } from './LiveCounter'
import { SignalChip, type SignalFamily } from '../components/SignalChip'
import { tokens } from '../theme/tokens'
import { useReducedMotion } from '../hooks/useReducedMotion'

const EASE = tokens.motion.ease.cinematic

const HEADLINE_LINE_1 = ['Investigations', 'that', 'arrive']
const HEADLINE_LINE_2 = ['before', 'the', 'meeting', 'starts.']

const AGENTS: { family: SignalFamily; title: string; role: string }[] = [
  { family: 'box_office', title: 'Detection',     role: 'Pure SQL, sub-second' },
  { family: 'social',     title: 'Investigation', role: 'Grounded via mcp-clickhouse' },
  { family: 'reviews',    title: 'Decision',      role: 'Ranked with impact SQL' },
  { family: 'streaming',  title: 'Report',        role: 'Provenance to every row' },
]

export function HeroFold() {
  const reduced = useReducedMotion()

  const mouseX = useMotionValue(0.5)
  const mouseY = useMotionValue(0.5)
  const springX = useSpring(mouseX, { stiffness: 60, damping: 20 })
  const springY = useSpring(mouseY, { stiffness: 60, damping: 20 })
  const spotlightBg = useTransform(
    [springX, springY],
    ([x, y]) =>
      `radial-gradient(circle at ${(x as number) * 100}% ${(y as number) * 100}%, ${tokens.signal.social.hex}22 0%, transparent 40%)`,
  )

  useEffect(() => {
    if (reduced) return
    const handler = (e: MouseEvent) => {
      mouseX.set(e.clientX / window.innerWidth)
      mouseY.set(e.clientY / window.innerHeight)
    }
    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [mouseX, mouseY, reduced])

  return (
    <section className="relative flex min-h-screen flex-col items-center overflow-hidden bg-paper px-6 pt-24 pb-16 text-center">
      <ParticleCascade />

      {/* Spotlight */}
      {!reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{ background: spotlightBg }}
        />
      )}

      {/* Letterbox bars */}
      <motion.div
        aria-hidden
        initial={{ y: '-100%' }}
        animate={{ y: 0 }}
        transition={{ duration: 1.1, ease: EASE, delay: 0.1 }}
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[4vh] bg-black md:h-[5vh]"
      />
      <motion.div
        aria-hidden
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ duration: 1.1, ease: EASE, delay: 0.1 }}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[4vh] bg-black md:h-[5vh]"
      />

      {/* Film grain */}
      {!reduced && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06] mix-blend-overlay"
          style={{
            backgroundImage:
              'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%220.8%22/></svg>")',
          }}
        />
      )}

      {/* HERO block */}
      <div className="relative z-10 flex max-w-4xl flex-col items-center gap-6">
        <motion.span
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 1.1 }}
          className="rounded-full border border-line bg-card/60 px-4 py-1.5 text-[11px] font-mono uppercase tracking-[0.24em] text-ink-soft backdrop-blur-md"
        >
          <span className="mr-2 inline-block h-1.5 w-1.5 -translate-y-0.5 animate-pulse rounded-full bg-accent align-middle" />
          Detecting data as it lands
        </motion.span>

        <h1 className="font-display font-light text-5xl leading-[1.02] tracking-tight md:text-6xl lg:text-7xl">
          <RevealLine words={HEADLINE_LINE_1} delay={0.7} reduced={reduced} />
          <br />
          <RevealLine words={HEADLINE_LINE_2} delay={1.15} reduced={reduced} accentLast />
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 1.6 }}
          className="max-w-2xl text-base text-ink-soft md:text-lg"
        >
          Four autonomous agents pipe box office, social, reviews, and streaming into a single crisis narrative — in
          milliseconds.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 1.8 }}
          className="flex items-center gap-3"
        >
          <Link
            to="/dashboard"
            className="group relative overflow-hidden rounded-md border border-accent bg-accent px-6 py-3 text-sm font-medium tracking-wide text-white transition-transform hover:-translate-y-0.5 hover:brightness-110"
          >
            <span className="relative z-10">Open Dashboard →</span>
          </Link>
          <Link
            to="/movies"
            className="rounded-md border border-line px-6 py-3 text-sm tracking-wide text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Browse Movies
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, ease: EASE, delay: 2.0 }}
          className="mt-6 w-full border-t border-line/50 pt-6"
        >
          <LiveCounter />
        </motion.div>
      </div>

      {/* AGENTS strip — compact 4-up under the hero */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay: 2.3 }}
        className="relative z-10 mt-14 w-full max-w-6xl"
      >
        <div className="mb-4 flex items-center justify-center gap-3 text-[10px] font-mono uppercase tracking-[0.28em] text-ink-soft">
          <span className="h-px w-8 bg-line" />
          <span>The Cast · Four Agents, One Narrative</span>
          <span className="h-px w-8 bg-line" />
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {AGENTS.map((a, i) => (
            <article
              key={a.family}
              className="group relative flex flex-col gap-2 overflow-hidden rounded-md border border-line bg-card/60 p-4 text-left backdrop-blur-sm transition-all hover:border-accent/50 hover:bg-card"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-50"
                style={{ background: tokens.signal[a.family].glow }}
              />
              <div className="flex items-center justify-between">
                <SignalChip family={a.family} />
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-soft">0{i + 1}</span>
              </div>
              <div className="font-display text-lg tracking-tight">{a.title}</div>
              <div className="text-xs text-ink-soft">{a.role}</div>
            </article>
          ))}
        </div>
      </motion.div>
    </section>
  )
}

function RevealLine({
  words,
  delay,
  reduced,
  accentLast,
}: {
  words: string[]
  delay: number
  reduced: boolean
  accentLast?: boolean
}) {
  if (reduced) {
    return (
      <span>
        {words.map((w, i) => (
          <span key={i} className={accentLast && i === words.length - 1 ? 'italic text-accent' : undefined}>
            {w}
            {i < words.length - 1 && ' '}
          </span>
        ))}
      </span>
    )
  }
  return (
    <span>
      {words.map((w, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 28, filter: 'blur(12px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.9, ease: EASE, delay: delay + i * 0.09 }}
          className={
            'inline-block will-change-transform ' +
            (accentLast && i === words.length - 1 ? 'italic text-accent' : '')
          }
        >
          {w}
          {i < words.length - 1 && ' '}
        </motion.span>
      ))}
    </span>
  )
}
