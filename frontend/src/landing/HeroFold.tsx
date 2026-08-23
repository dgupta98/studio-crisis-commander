import { Link } from 'react-router-dom'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { useEffect } from 'react'
import { ParticleCascade } from './ParticleCascade'
import { PosterLetterCascade } from './PosterLetterCascade'
import { LiveCounter } from './LiveCounter'
import { SignalChip, type SignalFamily } from '../components/SignalChip'
import { BrandMark } from '../components/BrandMark'
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
    <section className="relative flex min-h-screen items-center overflow-hidden bg-paper px-6 pt-24 pb-16">
      {/* Ambient signal-family orbs — always on, sits behind particles so the
          canvas never renders as a flat black even before particles spawn. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          background: `
            radial-gradient(ellipse 55% 45% at 10% 18%, ${tokens.signal.box_office.hex}55 0%, transparent 65%),
            radial-gradient(ellipse 50% 50% at 90% 15%, ${tokens.signal.social.hex}4a 0%, transparent 65%),
            radial-gradient(ellipse 55% 45% at 15% 88%, ${tokens.signal.reviews.hex}38 0%, transparent 65%),
            radial-gradient(ellipse 50% 50% at 85% 85%, ${tokens.signal.streaming.hex}45 0%, transparent 65%),
            linear-gradient(180deg, #0b0b14 0%, #08080c 55%, #050508 100%)
          `,
        }}
      />

      {/* Projector cone — warm crimson beam from top-center. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh] opacity-60"
        style={{
          background:
            'radial-gradient(ellipse 50% 100% at 50% -10%, rgba(212,50,74,0.22) 0%, rgba(212,50,74,0.08) 40%, transparent 70%)',
        }}
      />

      {/* Anamorphic horizontal light sweep across midline. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 h-px -translate-y-1/2"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,240,220,0.35) 50%, transparent 100%)',
          boxShadow: '0 0 40px 4px rgba(255,220,180,0.18)',
        }}
      />

      <ParticleCascade />

      {/* Falling poster-letter glyphs — non-obstructive, screen-blended. */}
      <PosterLetterCascade />

      {/* Spotlight */}
      {!reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{ background: spotlightBg }}
        />
      )}

      {/* Brand mark — persistent home link, sits just below the top letterbox. */}
      <div className="absolute left-6 top-10 z-30 md:left-10 md:top-14">
        <BrandMark />
      </div>

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

      <div className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14">
        {/* LEFT — headline + CTA */}
        <div className="flex flex-col items-start gap-6 lg:col-span-7">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 1.1 }}
            className="rounded-full border border-line bg-card/60 px-5 py-2 text-xs font-mono uppercase tracking-[0.24em] text-ink-soft backdrop-blur-md"
          >
            <span className="mr-2 inline-block h-2 w-2 -translate-y-0.5 animate-pulse rounded-full bg-accent align-middle" />
            Every claim cited to the row
          </motion.span>

          <h1 className="font-display font-bold text-5xl leading-[1.08] tracking-tight md:text-6xl xl:text-7xl">
            <RevealLine words={HEADLINE_LINE_1} delay={0.12} reduced={reduced} />
            <br />
            <RevealLine words={HEADLINE_LINE_2} delay={0.2} reduced={reduced} accentLast />
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE, delay: 1.6 }}
            className="max-w-2xl font-body text-lg leading-relaxed text-ink-soft md:text-xl"
          >
            Four agents watch every signal. Every dollar figure carries the exact SQL that produced it. Anomaly to
            recommendation in under 90 seconds.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE, delay: 1.8 }}
            className="mt-2 flex flex-wrap items-center gap-4"
          >
            <Link
              to="/dashboard"
              className="group relative overflow-hidden rounded-md border border-accent bg-accent px-8 py-4 text-base font-medium tracking-wide text-white transition-transform hover:-translate-y-0.5 hover:brightness-110"
            >
              <span className="relative z-10">Open Dashboard →</span>
            </Link>
            <Link
              to="/movies"
              className="rounded-md border border-line px-8 py-4 text-base tracking-wide text-ink transition-colors hover:border-accent hover:text-accent"
            >
              Browse Movies
            </Link>
          </motion.div>
        </div>

        {/* RIGHT — telemetry + agents */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 1.4 }}
          className="flex flex-col gap-8 lg:col-span-5"
        >
          {/* Telemetry card */}
          <div className="rounded-lg border border-line bg-card/40 p-8 backdrop-blur-sm">
            <div className="mb-6 flex items-center gap-3 text-xs font-mono uppercase tracking-[0.28em] text-ink-soft">
              <span className="h-px flex-1 bg-line" />
              <span>Live Telemetry</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <LiveCounter />
          </div>

          {/* Agents 2x2 */}
          <div>
            <div className="mb-4 flex items-center gap-3 text-xs font-mono uppercase tracking-[0.28em] text-ink-soft">
              <span className="h-px flex-1 bg-line" />
              <span>The Cast · Four Agents</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {AGENTS.map((a, i) => (
                <article
                  key={a.family}
                  className="group relative flex flex-col gap-3 overflow-hidden rounded-md border border-line bg-card/60 p-6 text-left backdrop-blur-sm transition-all hover:border-accent/50 hover:bg-card"
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-60"
                    style={{ background: tokens.signal[a.family].glow }}
                  />
                  <div className="flex items-center justify-between">
                    <SignalChip family={a.family} />
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft">0{i + 1}</span>
                  </div>
                  <div className="font-display text-xl font-semibold tracking-tight text-ink">{a.title}</div>
                  <div className="text-sm text-ink-soft">{a.role}</div>
                </article>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
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
            {i < words.length - 1 && ' '}
          </span>
        ))}
      </span>
    )
  }
  // `inline-flex` + column-gap gives reliable word spacing even when the
  // inline-block children receive framer-motion transforms — much more
  // robust than trying to enforce marginRight on each span.
  return (
    <span
      className="inline-flex flex-wrap items-baseline"
      style={{ columnGap: '0.28em', rowGap: 0 }}
    >
      {words.map((w, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut', delay: delay + i * 0.02 }}
          className={
            'inline-block will-change-transform ' +
            (accentLast && i === words.length - 1 ? 'italic text-accent' : '')
          }
        >
          {w}
        </motion.span>
      ))}
    </span>
  )
}
