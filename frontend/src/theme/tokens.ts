export const tokens = {
  color: {
    // Dark cinema palette. Keys stay the same so every existing Tailwind
    // class (`bg-paper`, `text-ink`, `border-line`, `bg-card`, etc.) keeps
    // working — only the resolved hex values changed.
    paper: '#08080c',      // deep near-black page background
    card: '#13131a',       // elevated surface (cards, panels)
    cardAlt: '#1c1c25',    // recessed surface (input fills, secondary panels)
    ink: '#f5f2ea',        // warm white primary text
    inkSoft: '#a09b8f',    // secondary text (AA on #08080c ≈ 10:1)
    accent: '#d4324a',     // crimson — brighter than #A31621 to pop on dark
    line: '#2a2a35',       // subtle border
    sev: {
      info:   { bg: '#1e1e28', fg: '#a09b8f' },
      warn:   { bg: '#3a2e12', fg: '#f0d9a0' },
      crit:   { bg: '#3a1a1a', fg: '#ff9a9a' },
      replay: { bg: '#1c1c25', fg: '#8f8f89' },
    },
  },
  type: {
    display: '"Fraunces", Georgia, "Times New Roman", serif',
    body: 'Inter, ui-sans-serif, system-ui, sans-serif',
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
    // Signal-family colors bumped for glow on dark backgrounds.
    box_office: { hex: '#5ab0ff', fg: '#8fc7ff', rgb: '90, 176, 255',  glow: 'rgba(90, 176, 255, 0.55)' },
    social:     { hex: '#ff7ab0', fg: '#ffa9c9', rgb: '255, 122, 176', glow: 'rgba(255, 122, 176, 0.55)' },
    reviews:    { hex: '#ffd93d', fg: '#ffe680', rgb: '255, 217, 61',  glow: 'rgba(255, 217, 61, 0.55)' },
    streaming:  { hex: '#6bcf7f', fg: '#a3e0af', rgb: '107, 207, 127', glow: 'rgba(107, 207, 127, 0.55)' },
  },
} as const

export type Tokens = typeof tokens
