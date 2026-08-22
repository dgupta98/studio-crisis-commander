import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    visualizer({ filename: 'dist/stats.html', gzipSize: true }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  envPrefix: 'VITE_',
  server: { port: 5173 },
})
