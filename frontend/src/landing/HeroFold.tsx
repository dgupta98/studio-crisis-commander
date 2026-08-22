import { Link } from 'react-router-dom'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { useEffect } from 'react'
import { ParticleCascade } from './ParticleCascade'
import { LiveCounter } from './LiveCounter'
import { tokens } from '../theme/tokens'
import { useReducedMotion } from '../hooks/useReducedMotion'

const EASE = tokens.motion.ease.cinematic

const HEADLINE_LINE_1 = ['Investigations', 'that', 'arrive']
const HEADLINE_LINE_2 = ['before', 'the', 'meeting', 'starts.']

export function HeroFold() {
  const reduced = useReducedMotion()

  // Spotlight follow. Springs smooth the cursor position for buttery motion.
  const mouseX = useMotionValue(0.5)
  const mouseY = useMotionValue(0.5)
  const springX = useSpring(mouseX, { stiffness: 60, damping: 20 })
  const springY = useSpring(mouseY, { stiffness: 60, damping: 20 })
  const bgX = useTransform(springX, (v) => `${v * 100}%`)
  const bgY = useTransform(springY, (v) => `${v * 100}%`)

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
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-paper px-6 text-center">
      <ParticleCascade />

      {/* Spotlight — tinted radial gradient tracking the cursor. */}
      {!reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{
            background: useTransform(
              [bgX, bgY],
              ([x, y]) =>
                `radial-gradient(circle at ${x} ${y}, ${tokens.signal.social.hex}22 0%, transparent 40%)`,
            ),
          }}
        />
      )}

      {/* Letterbox bars — slide in from top/bottom on load. */}
      <motion.div
        aria-hidden
        initial={{ y: '-100%' }}
        animate={{ y: 0 }}
        transition={{ duration: 1.1, ease: EASE, delay: 0.1 }}
        className="pointer-events-none absolute inset-x-0 top-0 h-[6vh] bg-black"
      />
      <motion.div
        aria-hidden
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ duration: 1.1, ease: EASE, delay: 0.1 }}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[6vh] bg-black"
      />

      {/* Film-grain overlay — very subtle. */}
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

      <div className="relative z-10 flex max-w-4xl flex-col items-center gap-8">
        {/* Micro-eyebrow */}
        <motion.span
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 1.3 }}
          className="rounded-full border border-line bg-card/60 px-4 py-1.5 text-[11px] font-mono uppercase tracking-[0.24em] text-ink-soft backdrop-blur-md"
        >
          <span className="inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-accent mr-2 align-middle animate-pulse" />
          Detecting data as it lands
        </motion.span>

        {/* Headline — word-by-word blur-clear reveal */}
        <h1 className="font-display font-light text-5xl leading-[1.02] tracking-tight md:text-7xl lg:text-8xl">
          <RevealLine words={HEADLINE_LINE_1} delay={0.9} reduced={reduced} />
          <br />
          <RevealLine words={HEADLINE_LINE_2} delay={1.4} reduced={reduced} accentLast />
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 1.9 }}
          className="max-w-xl text-lg text-ink-soft md:text-xl"
        >
          Four autonomous agents pipe box office, social, reviews, and streaming into a single crisis narrative — in
          milliseconds.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 2.1 }}
          className="flex items-center gap-3"
        >
          <Link
            to="/dashboard"
            className="group relative overflow-hidden rounded-md border border-accent bg-accent px-6 py-3 text-sm font-medium tracking-wide text-white transition-transform hover:-translate-y-0.5 hover:brightness-110"
          >
            <span className="relative z-10">Open Dashboard →</span>
            <span
              aria-hidden
              className="absolute inset-0 -z-0 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            />
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
          transition={{ duration: 1.2, ease: EASE, delay: 2.4 }}
          className="mt-10 w-full border-t border-line/60 pt-8"
        >
          <LiveCounter />
        </motion.div>
      </div>

      {/* Scroll cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.6 }}
        transition={{ duration: 1, delay: 2.8 }}
        className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-[10px] font-mono uppercase tracking-[0.3em] text-ink-soft"
      >
        <div className="flex flex-col items-center gap-2">
          <span>scroll</span>
          <motion.span
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            className="block h-4 w-px bg-ink-soft"
          />
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
          {i < words.length - 1 && ' '}
        </motion.span>
      ))}
    </span>
  )
}
