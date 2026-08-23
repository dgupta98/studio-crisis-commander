export const tokens = {
  color: {
    // Dark cinema palette tuned for stronger readability and more premium contrast.
    // Keys stay the same so every existing Tailwind class (`bg-paper`, `text-ink`,
    // `border-line`, `bg-card`, etc.) keeps working while the visual tone feels richer.
    paper: '#0a0b10',      // deep near-black page background
    card: '#151922',       // elevated surface (cards, panels)
    cardAlt: '#1d2330',    // recessed surface (inputs, secondary panels)
    ink: '#f9f6f1',        // warm white primary text
    inkSoft: '#c0b7a8',    // brighter secondary text for legibility
    accent: '#f14a67',     // vivid crimson to pop against dark surfaces
    line: '#3a4254',       // stronger but still subtle border
    sev: {
      info:   { bg: '#1d2633', fg: '#d7d1c5' },
      warn:   { bg: '#3d2d15', fg: '#f4d28a' },
      crit:   { bg: '#3b1d22', fg: '#ffb7ad' },
      replay: { bg: '#1b2230', fg: '#d6d8d7' },
    },
  },
  type: {
    display: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
    body: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
    mono: '"JetBrains Mono", Menlo, Consolas, monospace',
  },
  motion: {
    ease: {
      cinematic: [0.16, 1, 0.3, 1] as [number, number, number, number],
      brisk: [0.4, 0, 0.2, 1] as [number, number, number, number],
    },
    duration: {
      micro: 0.16,
      transition: 0.4,
      reveal: 0.7,
      count: 1.2,
    },
    stagger: 0.09,
    blurEnter: 4, // px
  },
  space: {
    xs: '0.25rem', sm: '0.5rem', md: '1rem', lg: '1.5rem', xl: '2.5rem', xxl: '4rem',
  },
  signal: {
    // Signal-family colors shifted brighter for a more legible, cinematic dashboard.
    box_office: { hex: '#63b7ff', fg: '#9ed4ff', rgb: '99, 183, 255', glow: 'rgba(99, 183, 255, 0.62)' },
    social:     { hex: '#ff80bb', fg: '#ffabd6', rgb: '255, 128, 187', glow: 'rgba(255, 128, 187, 0.62)' },
    reviews:    { hex: '#ffd952', fg: '#ffea8a', rgb: '255, 217, 82', glow: 'rgba(255, 217, 82, 0.62)' },
    streaming:  { hex: '#74db8d', fg: '#a9efb3', rgb: '116, 219, 141', glow: 'rgba(116, 219, 141, 0.62)' },
  },
} as const

export type Tokens = typeof tokens
