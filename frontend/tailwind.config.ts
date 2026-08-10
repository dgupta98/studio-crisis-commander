import type { Config } from 'tailwindcss'
import { tailwindTheme } from './src/theme/tailwind.tokens'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      ...tailwindTheme,
    },
  },
  plugins: [],
} satisfies Config
