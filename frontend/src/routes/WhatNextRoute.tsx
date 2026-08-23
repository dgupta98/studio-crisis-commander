import { motion } from 'framer-motion'
import { tokens } from '../theme/tokens'

const FEATURES: { title: string; body: string; family: keyof typeof tokens.signal }[] = [
  { title: 'Trailers and Teasers', body: 'Official previews, teaser drops, and campaign highlights across all major releases.', family: 'box_office' },
  { title: 'Reels and Promotions', body: 'Short-form promos, countdowns, and branded activity from social-first marketing channels.', family: 'social' },
  { title: 'News, Blogs, and Wikipedia', body: 'Coverage from editorial sources, blogs, and reference pages for each movie story.', family: 'reviews' },
  { title: 'Reviews and Ratings', body: 'Critic verdicts, audience reactions, and shared sentiment summarized in one place.', family: 'streaming' },
  { title: 'IMDb and OTT Details', body: 'Metadata, cast data, platform availability, and release information from source libraries.', family: 'box_office' },
  { title: 'Social Media Discussions', body: 'Threads, fan conversations, commentary, and buzz across social platforms.', family: 'social' },
  { title: 'Sentiment Analysis', body: 'Track positive, negative, and neutral shifts over time across sources and formats.', family: 'reviews' },
  { title: 'Trend Tracking', body: 'See what is rising, declining, or trending during launch and post-release cycles.', family: 'streaming' },
  { title: 'Real-Time Updates', body: 'Monitor new releases, reactions, platform changes, and breaking movie moments as they happen.', family: 'box_office' },
  { title: 'Regional and Language Filtering', body: 'Filter movie intelligence by geography, language, and local audience activity.', family: 'social' },
  { title: 'Cast and Crew Insights', body: 'Follow updates, interviews, and performance narratives around the people behind each film.', family: 'reviews' },
  { title: 'Release and OTT Alerts', body: 'Track premiere windows, platform rollouts, and launch-day announcements in real time.', family: 'streaming' },
  { title: 'Box Office Data', body: 'Collections, event momentum, and revenue movement across release windows.', family: 'box_office' },
  { title: 'Audience vs Critic Comparison', body: 'Compare public reactions with professional opinion side by side.', family: 'social' },
  { title: 'Recommendation Engine', body: 'Spot films by relevance, overlap, and audience similarity across media signals.', family: 'reviews' },
  { title: 'Fake News and Duplicate Content Filtering', body: 'Separate genuine coverage from noise, duplicate posts, and low-quality signals.', family: 'streaming' },
  { title: 'All Movie Keywords in One Place', body: 'A single intelligence hub for every movie topic, source, and content format.', family: 'box_office' },
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

export default function WhatNextRoute() {
  return (
    <div data-testid="route-what-next" className="min-h-screen bg-paper px-4 py-8 text-ink md:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: tokens.motion.ease.cinematic }}
          className="rounded-2xl border border-line bg-card/40 p-6 md:p-8"
        >
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-[0.28em] text-accent">What Next?</span>
              <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">
                A single movie intelligence <span className="text-accent">hub.</span>
              </h1>
            </div>
            <p className="max-w-xl text-sm leading-relaxed text-ink-soft md:text-base">
              In the future, the platform will collect movie-related content across platforms and formats using the right
              keywords, turning scattered signals into one complete view of every title.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {FEATURES.map((feature, index) => (
              <motion.article
                key={feature.title}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: tokens.motion.ease.cinematic, delay: index * 0.04 }}
                className="group relative overflow-hidden rounded-xl border border-line bg-paper/80 p-4"
              >
                <div
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-px opacity-80"
                  style={{ background: `linear-gradient(90deg, transparent, ${tokens.signal[feature.family].hex}, transparent)` }}
                />
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span
                    aria-hidden
                    className="inline-flex h-2.5 w-2.5 rounded-full"
                    style={{ background: tokens.signal[feature.family].hex, boxShadow: `0 0 14px ${tokens.signal[feature.family].glow}` }}
                  />
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft">Future</span>
                </div>
                <h2 className="font-display text-xl font-semibold tracking-tight text-ink">{feature.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{feature.body}</p>
              </motion.article>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-line bg-card/30 p-5">
            <div className="mb-4 text-[11px] font-mono uppercase tracking-[0.28em] text-accent">Source coverage</div>
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
        </motion.section>
      </div>
    </div>
  )
}
