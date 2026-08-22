export const tokens = {
  color: {
    paper: '#FBFAF7',
    card: '#FFFFFF',
    cardAlt: '#EFECE4',
    ink: '#111111',
    inkSoft: '#4a4a4a',
    accent: '#A31621',
    line: '#E5E1D6',
    sev: {
      info: { bg: '#E8E5DA', fg: '#4a4a4a' },
      warn: { bg: '#F0D9A0', fg: '#6b4a10' },
      crit: { bg: '#E5C0BC', fg: '#831818' },
      replay: { bg: '#EFECE4', fg: '#4a4a4a' },
    },
  },
  type: {
    display: 'Georgia, "Times New Roman", serif',
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
    box_office: { hex: '#4a9eff', fg: '#1a5fb4', rgb: '74, 158, 255', glow: 'rgba(74, 158, 255, 0.35)' },
    social:     { hex: '#ff6b9d', fg: '#b91d5c', rgb: '255, 107, 157', glow: 'rgba(255, 107, 157, 0.35)' },
    reviews:    { hex: '#ffd93d', fg: '#7a5c00', rgb: '255, 217, 61', glow: 'rgba(255, 217, 61, 0.35)' },
    streaming:  { hex: '#6bcf7f', fg: '#1e7a3a', rgb: '107, 207, 127', glow: 'rgba(107, 207, 127, 0.35)' },
  },
} as const

export type Tokens = typeof tokens
