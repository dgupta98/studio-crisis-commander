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

const NEXT_FEATURES: { title: string; body: string; family: keyof typeof tokens.signal }[] = [
  { title: 'Trailers and Teasers', body: 'Video previews, teaser drops, and official campaign highlights.', family: 'box_office' },
  { title: 'Reels and Promotions', body: 'Short-form promo clips, countdowns, and branded campaign activity.', family: 'social' },
  { title: 'News, Blogs, and Wikipedia', body: 'Stories, editorial coverage, and reference pages around every release.', family: 'reviews' },
  { title: 'Reviews and Ratings', body: 'Critic scores, audience reactions, and verdict summaries in one place.', family: 'streaming' },
  { title: 'IMDb and OTT Details', body: 'Cast, runtime, platform availability, and metadata from major sources.', family: 'box_office' },
  { title: 'Social Media Discussions', body: 'Threads, fan reactions, and public sentiment across social channels.', family: 'social' },
  { title: 'Sentiment Analysis', body: 'Positive, negative, and neutral reaction tracking across sources.', family: 'reviews' },
  { title: 'Trend Tracking', body: 'What is rising, fading, and being discussed across the movie cycle.', family: 'streaming' },
  { title: 'Real-Time Updates', body: 'Live changes across releases, reactions, and platform activity.', family: 'box_office' },
  { title: 'Regional and Language Filtering', body: 'Browse content by geography, language, and market-specific buzz.', family: 'social' },
  { title: 'Cast and Crew Insights', body: 'Career updates, interviews, performance trends, and feature coverage.', family: 'reviews' },
  { title: 'Release and OTT Alerts', body: 'Track premieres, streaming windows, and launch-day updates.', family: 'streaming' },
  { title: 'Box Office Data', body: 'Collections, performance trends, and day-over-day momentum.', family: 'box_office' },
  { title: 'Audience vs Critic Comparison', body: 'Compare public reactions against professional reviews side by side.', family: 'social' },
  { title: 'Recommendation Engine', body: 'Surface matches based on genre, discourse, and audience overlap.', family: 'reviews' },
  { title: 'Fake News and Duplicate Content Filtering', body: 'Separate signal from noise and reduce redundant mentions.', family: 'streaming' },
  { title: 'All Movie Keywords in One Place', body: 'A single intelligence hub for every movie topic, platform, and format.', family: 'box_office' },
]

const SOURCES = [
  'YouTube',
  'Instagram',
  'TikTok',
  'X / Twitter',
  'IMDb',
  'Wikipedia',
  'Reviews',
  'Blogs',
  'News Portals',
  'OTT Platforms',
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
          <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.28em] text-accent">The Sequence</span>
          <h2 className="mt-2 font-display font-bold text-3xl leading-tight tracking-tight md:text-5xl">
            How it <span className="text-accent">works.</span>
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
                className="flex h-10 w-10 items-center justify-center rounded-full border font-mono text-xs font-semibold"
                style={{
                  borderColor: tokens.signal[s.family].hex,
                  color: tokens.signal[s.family].hex,
                  boxShadow: `0 0 24px ${tokens.signal[s.family].glow}`,
                }}
              >
                {s.n}
              </div>
              <h3 className="font-display font-semibold text-lg tracking-tight md:text-xl text-ink">{s.title}</h3>
              <p className="text-sm leading-relaxed text-ink-soft">{s.body}</p>
            </motion.div>
          ))}
        </div>

        {/* What Next? vision section */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={{ duration: 0.8, ease: EASE }}
          className="rounded-2xl border border-line bg-card/40 p-6 md:p-8"
        >
          <div className="mb-6 flex flex-col gap-4 text-center md:text-left">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.28em] text-accent">
              What Next?
            </span>
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <h2 className="max-w-2xl font-display font-bold text-3xl leading-tight tracking-tight md:text-5xl">
                A single movie intelligence <span className="text-accent">hub.</span>
              </h2>
              <p className="max-w-xl text-sm leading-relaxed text-ink-soft md:text-base">
                In the future, the platform will collect movie content across formats and platforms using relevant keywords,
                turning scattered signals into one complete view of every film.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {NEXT_FEATURES.map((feature, i) => (
              <motion.article
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-10%' }}
                transition={{ duration: 0.55, ease: EASE, delay: i * 0.04 }}
                className="group relative overflow-hidden rounded-xl border border-line bg-paper/80 p-4 transition-colors hover:border-accent/50 hover:bg-card"
              >
                <div
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-px opacity-80"
                  style={{ background: `linear-gradient(90deg, transparent, ${tokens.signal[feature.family].hex}, transparent)` }}
                />
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span
                    className="inline-flex h-2.5 w-2.5 rounded-full"
                    style={{ background: tokens.signal[feature.family].hex, boxShadow: `0 0 14px ${tokens.signal[feature.family].glow}` }}
                  />
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft">Future</span>
                </div>
                <h3 className="font-display text-lg font-semibold tracking-tight text-ink">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{feature.body}</p>
              </motion.article>
            ))}
          </div>

          <div className="mt-7 rounded-2xl border border-line bg-card/30 p-5">
            <div className="mb-3 text-[11px] font-mono font-semibold uppercase tracking-[0.28em] text-accent">
              Coverage across platforms
            </div>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((source) => (
                <span
                  key={source}
                  className="rounded-full border border-line bg-paper/80 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-ink-soft"
                >
                  {source}
                </span>
              ))}
            </div>
          </div>
        </motion.div>

        {/* CTA row — compact, tucked between steps and marquee */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ duration: 0.8, ease: EASE }}
          className="flex flex-col items-center gap-4 border-t border-line/50 pt-10 text-center"
        >
          <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.28em] text-accent">Now Showing</span>
          <h2 className="font-display font-bold text-3xl leading-tight tracking-tight md:text-4xl">
            Watch it happen <span className="text-accent">live.</span>
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
