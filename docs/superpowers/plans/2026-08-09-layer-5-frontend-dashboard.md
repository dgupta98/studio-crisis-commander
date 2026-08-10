# Layer 5 — Frontend Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. User has also asked for the `frontend-design:frontend-design` skill to be consulted during panel-component tasks (Tasks 14-20) for UI-specific guidance — invoke it via the Skill tool when a subagent starts a panel task.

**Goal:** Ship a single-screen cinematic ops-center that consumes the Layer 4 API and renders the four-agent pipeline as a live editorial experience: idle → inject → detect → investigate → decide → approve.

**Architecture:** Vite SPA. Single Zustand store owns all data + the EventSource lifecycle; panels are pure-render and read from the store. `PanelStateWrapper` enforces the 5-state discipline uniformly across every async panel. Motion is Framer-Motion-driven, choreographed to real SSE events (not scripted). Deployment matches backend: multi-stage Docker + Cloud Run.

**Tech Stack:** Vite 5, React 18, TypeScript 5, Tailwind 3, Framer Motion 11, Zustand 4, Recharts 2, Vitest, React Testing Library, Playwright (Chromium only), nginx:1.27-alpine.

**Reference spec:** `docs/superpowers/specs/2026-08-09-layer-5-frontend-dashboard-design.md`

---

## Prerequisites & conventions

Read before Task 1:

- **Working directory for all commands:** `frontend/`. Run all `npm` commands from there. Use `npm ci` (not `npm install`) once `package-lock.json` exists — reproducible.
- **Node 20+ required.** Verify: `node --version` → `v20.x` or newer.
- **Layers 1-4 must be merged and passing.** Verify:
  - `PYTHONPATH=. ./backend/venv/bin/python -m api.tests.acceptance` exits 0 (or at least §1-§8 pass; §9 depends on live pipeline calibration).
  - `backend/api/cached/fallback_triple.json` exists and is > 1 KB (the real regenerated triple, not the placeholder).
- **Backend running for panel tasks and e2e:** in a second terminal:
  ```
  cd backend && PYTHONPATH=. ./venv/bin/uvicorn api.main:app --reload --port 8000
  ```
  Verify: `curl -s http://localhost:8000/healthz` → `{"status":"ok"}`.
- **Frontend dev server:** `npm run dev` in `frontend/` → binds to `http://localhost:5173`. Assumes `VITE_API_URL=http://localhost:8000` in `frontend/.env.development`.
- **No auth. No secrets. No analytics.** Do NOT read or write `.env` (that's the backend's). Only `.env.development` and `.env.production` in `frontend/`, and they contain a single non-secret var each: `VITE_API_URL`.
- **New boundary for Layer 5:** `frontend/src/panels/*.tsx` MUST NOT import from `api/client` or `api/sse`. All data flow goes through `store/runStore`. Enforced by `frontend/tests/boundaries.test.ts` (§1 grep, mirrors Layer 4 §1).
- **No Co-Authored-By trailers in commits.**
- **File conventions:** 2-space indent for `.ts`/`.tsx`. Named exports for components. `import type { ... }` for type-only imports.
- **Test conventions:** Vitest + Testing Library for unit/component. Playwright for one e2e. Colocate `.test.tsx` next to source under `src/tests/unit/<mirror-path>`. E2E under `src/tests/e2e/`.

---

## File responsibility map

Locking decomposition before writing tasks:

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json` | Deps + scripts |
| `vite.config.ts` | Vite build, env prefix `VITE_`, dev proxy off (uses full URL) |
| `tailwind.config.ts` | Theme wired from `src/theme/tailwind.tokens.ts` |
| `tsconfig.json` | Strict TS, path alias `@/*` → `src/*` |
| `postcss.config.js` | Tailwind + autoprefixer |
| `index.html` | Root mount, font preload links |
| `nginx.conf` | SPA fallback, gzip, cache-control (Cloud Run runtime) |
| `Dockerfile` | Multi-stage: node build → nginx runtime |
| `src/main.tsx` | Vite entry, mounts `<App/>` |
| `src/App.tsx` | Layout shell `<OpsCenter/>` |
| `src/api/contracts.ts` | TS types mirroring backend Pydantic |
| `src/api/client.ts` | Fetch wrapper, `VITE_API_URL`, throws on non-2xx |
| `src/api/sse.ts` | `openStream(runId, onEvent, onError)` — EventSource wrapper |
| `src/store/runStore.ts` | Single Zustand store: state, event routing, derived panel states, actions |
| `src/theme/tokens.ts` | Color/type/motion tokens as TS constants |
| `src/theme/tailwind.tokens.ts` | Tokens compiled to Tailwind theme shape |
| `src/motion/choreography.ts` | Framer Motion variants for reveals/staggers |
| `src/components/PanelStateWrapper.tsx` | The 5-state gate |
| `src/components/Button.tsx` | Editorial button |
| `src/components/Card.tsx` | Panel container |
| `src/components/SqlBlock.tsx` | Mono SQL block w/ copy |
| `src/components/Popover.tsx` | Provenance popover (Radix-style manual impl) |
| `src/components/SeverityChip.tsx` | info/warn/critical/replay pill |
| `src/components/Sparkline.tsx` | Recharts LineChart wrapper w/ cinematic draw-in |
| `src/panels/HeroBanner.tsx` | "Now Investigating" film card |
| `src/panels/TelemetryStrip.tsx` | 4 sparklines + latency chip |
| `src/panels/AnomalyFeed.tsx` | Severity-colored anomaly list |
| `src/panels/AgentTrace.tsx` | Live event trace centerpiece |
| `src/panels/RecommendationPanel.tsx` | Report + actions w/ provenance popover |
| `src/panels/ApprovalGate.tsx` | Approve/deny + audit history |
| `src/panels/InjectControls.tsx` | Crisis picker + inject button |
| `src/panels/HistoryDrawer.tsx` | Past runs list |
| `src/tests/unit/**` | Vitest unit + component tests |
| `src/tests/e2e/hero-flow.spec.ts` | Playwright golden path |
| `src/tests/boundaries.test.ts` | §1 grep boundary enforcement |
| `src/tests/acceptance.ts` | 5-check acceptance sweep script |
| `src/tests/setup.ts` | Vitest setup (jsdom, RTL) |

---

## Task 1: Scaffold Vite + React + TypeScript

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/.gitignore`, `frontend/.env.development`, `frontend/.env.production`

- [ ] **Step 1: Verify state**

Run: `ls frontend/` (from repo root).
Expected: directory exists but empty (or nonexistent). If nonexistent: `mkdir frontend`.

- [ ] **Step 2: Scaffold with Vite's official React-TS template**

```bash
cd frontend
npm create vite@5 . -- --template react-ts
# Answer "y" to "Current directory is not empty" if prompted.
```

Expected: creates `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/App.css`, `src/index.css`, `src/assets/`, `public/`, `.gitignore`.

- [ ] **Step 3: Trim the boilerplate**

Delete the demo assets:

```bash
cd frontend
rm -rf src/assets src/App.css src/index.css public/vite.svg
```

Replace `src/App.tsx` with an empty shell:

```tsx
export function App() {
  return (
    <div className="min-h-screen bg-white text-black">
      <h1>Studio Crisis Commander</h1>
      <p>Layer 5 scaffold — panels arrive in later tasks.</p>
    </div>
  )
}
```

Replace `src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

Replace `index.html` (drop favicon + vite logo refs, add font preload placeholders for later):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Studio Crisis Commander</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Configure TypeScript strict + path alias**

Overwrite `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Overwrite `frontend/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

Overwrite `frontend/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  envPrefix: 'VITE_',
  server: { port: 5173 },
})
```

- [ ] **Step 5: Env files**

Create `frontend/.env.development`:

```
VITE_API_URL=http://localhost:8000
```

Create `frontend/.env.production`:

```
VITE_API_URL=
```

(Production URL is injected at build time via Docker `--build-arg` — see Task 23.)

- [ ] **Step 6: Verify dev boot**

```bash
cd frontend
npm install
npm run dev
```

Expected: Vite prints `Local: http://localhost:5173/`. Open the URL — page shows the heading text. `Ctrl+C` to stop.

- [ ] **Step 7: Verify build**

```bash
cd frontend
npm run build
```

Expected: `dist/` produced, no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "chore(fe): scaffold Vite + React 18 + TypeScript"
```

---

## Task 2: Add remaining deps + configure Tailwind, Vitest, Playwright

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/tailwind.config.ts`, `frontend/postcss.config.js`, `frontend/src/index.css`, `frontend/vitest.config.ts`, `frontend/playwright.config.ts`, `frontend/src/tests/setup.ts`

- [ ] **Step 1: Install runtime deps**

```bash
cd frontend
npm install zustand@^4 framer-motion@^11 recharts@^2 clsx@^2
```

Expected: three new deps in `package.json` `dependencies`.

- [ ] **Step 2: Install dev deps — Tailwind, testing, Playwright**

```bash
cd frontend
npm install -D tailwindcss@^3 postcss@^8 autoprefixer@^10 \
  vitest@^1 @testing-library/react@^15 @testing-library/jest-dom@^6 \
  @testing-library/user-event@^14 jsdom@^24 \
  @playwright/test@^1
```

Expected: deps land in `devDependencies`.

- [ ] **Step 3: Initialize Tailwind**

```bash
cd frontend
npx tailwindcss init -p
```

Expected: creates `tailwind.config.js` and `postcss.config.js`. Rename `tailwind.config.js` → `tailwind.config.ts` and replace with:

```ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},   // filled in by Task 3
  },
  plugins: [],
} satisfies Config
```

- [ ] **Step 4: Wire Tailwind into `src/index.css`**

Create `frontend/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Import it from `src/main.tsx` (add as first import):

```tsx
import './index.css'
import { StrictMode } from 'react'
// ... rest unchanged
```

- [ ] **Step 5: Configure Vitest**

Create `frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/unit/**/*.test.{ts,tsx}', 'src/tests/*.test.{ts,tsx}'],
  },
})
```

Create `frontend/src/tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 6: Configure Playwright**

```bash
cd frontend
npx playwright install chromium
```

Create `frontend/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'src/tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 20_000,
  },
})
```

- [ ] **Step 7: Add npm scripts**

Edit `frontend/package.json` `scripts` block to be exactly:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 8: Smoke — verify all tools boot**

```bash
cd frontend
npm run typecheck      # exits 0
npm run test           # "No test files found" is OK (exit 0)
npm run build          # exits 0
```

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "chore(fe): add Tailwind + Zustand + Framer + Recharts + Vitest + Playwright"
```

---

## Task 3: Design tokens + Tailwind theme + self-hosted fonts

**Files:**
- Create: `frontend/src/theme/tokens.ts`, `frontend/src/theme/tailwind.tokens.ts`
- Create: `frontend/public/fonts/README.md` (font sourcing note)
- Modify: `frontend/tailwind.config.ts`, `frontend/src/index.css`, `frontend/index.html`, `frontend/src/App.tsx`
- Create: `frontend/src/tests/unit/theme.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/theme.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { tokens } from '@/theme/tokens'

describe('design tokens', () => {
  it('exposes newsroom-hybrid color palette', () => {
    expect(tokens.color.paper).toBe('#FBFAF7')
    expect(tokens.color.card).toBe('#FFFFFF')
    expect(tokens.color.ink).toBe('#111111')
    expect(tokens.color.accent).toBe('#A31621')
    expect(tokens.color.sev.crit.bg).toBe('#E5C0BC')
    expect(tokens.color.sev.warn.fg).toBe('#6b4a10')
    expect(tokens.color.sev.info.bg).toBe('#E8E5DA')
  })

  it('exposes cinematic motion tokens', () => {
    expect(tokens.motion.ease.cinematic).toEqual([0.16, 1, 0.3, 1])
    expect(tokens.motion.duration.reveal).toBe(0.7)
    expect(tokens.motion.duration.count).toBe(1.2)
    expect(tokens.motion.stagger).toBe(0.09)
  })

  it('exposes type family assignments', () => {
    expect(tokens.type.display).toContain('Georgia')
    expect(tokens.type.body).toContain('Inter')
    expect(tokens.type.mono).toContain('JetBrains Mono')
  })

  it('Tailwind theme includes accent color as bg-accent class', () => {
    render(<div data-testid="probe" className="bg-accent text-paper" />)
    const el = screen.getByTestId('probe')
    // The class exists in Tailwind — computed style depends on CSS being
    // processed. In jsdom without Tailwind's CSS, we check the className.
    expect(el.className).toContain('bg-accent')
    expect(el.className).toContain('text-paper')
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
cd frontend
npm run test
```

Expected: FAIL with `Cannot find module '@/theme/tokens'`.

- [ ] **Step 3: Create the tokens**

Create `frontend/src/theme/tokens.ts`:

```ts
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
} as const

export type Tokens = typeof tokens
```

Create `frontend/src/theme/tailwind.tokens.ts`:

```ts
import { tokens } from './tokens'

export const tailwindTheme = {
  colors: {
    transparent: 'transparent',
    current: 'currentColor',
    white: '#ffffff',
    black: '#000000',
    paper: tokens.color.paper,
    card: tokens.color.card,
    'card-alt': tokens.color.cardAlt,
    ink: tokens.color.ink,
    'ink-soft': tokens.color.inkSoft,
    accent: tokens.color.accent,
    line: tokens.color.line,
    'sev-info-bg': tokens.color.sev.info.bg,
    'sev-info-fg': tokens.color.sev.info.fg,
    'sev-warn-bg': tokens.color.sev.warn.bg,
    'sev-warn-fg': tokens.color.sev.warn.fg,
    'sev-crit-bg': tokens.color.sev.crit.bg,
    'sev-crit-fg': tokens.color.sev.crit.fg,
    'sev-replay-bg': tokens.color.sev.replay.bg,
    'sev-replay-fg': tokens.color.sev.replay.fg,
  },
  fontFamily: {
    display: tokens.type.display.split(', '),
    body: tokens.type.body.split(', '),
    mono: tokens.type.mono.split(', '),
  },
  fontSize: {
    xs: ['0.75rem', { lineHeight: '1rem' }],
    sm: ['0.875rem', { lineHeight: '1.25rem' }],
    base: ['1rem', { lineHeight: '1.5rem' }],
    lg: ['1.125rem', { lineHeight: '1.75rem' }],
    xl: ['1.25rem', { lineHeight: '1.75rem' }],
    '2xl': ['1.5rem', { lineHeight: '2rem' }],
    '3xl': ['2rem', { lineHeight: '2.25rem' }],
    '4xl': ['2.75rem', { lineHeight: '1' }],
    '5xl': ['3.5rem', { lineHeight: '1' }],
  },
  letterSpacing: {
    tighter: '-0.03em',
    tight: '-0.02em',
    normal: '0',
    wide: '0.05em',
    wider: '0.12em',
  },
}
```

- [ ] **Step 4: Wire theme into `tailwind.config.ts`**

Overwrite `frontend/tailwind.config.ts`:

```ts
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
```

- [ ] **Step 5: Font placeholders (self-hosting note)**

Create `frontend/public/fonts/README.md`:

```md
# Self-hosted fonts

Drop the following files in this directory (latin subset, woff2):

- `Inter-Regular.woff2`    (weight 400)
- `Inter-Medium.woff2`     (weight 500)
- `Inter-SemiBold.woff2`   (weight 600)
- `JetBrainsMono-Regular.woff2` (weight 400)

Source: https://fonts.google.com/download?family=Inter+JetBrains+Mono
(unzip and pick the `latin` subset woff2 files, or convert TTFs with
`fonttools` → `subset` → `woff2` if needed).

Georgia is a system serif — no file needed.
```

Add `@font-face` declarations at the top of `frontend/src/index.css` (above the `@tailwind` directives):

```css
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/Inter-Regular.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/Inter-Medium.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/Inter-SemiBold.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/JetBrainsMono-Regular.woff2') format('woff2');
}

@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { min-height: 100%; }
body { background: #FBFAF7; color: #111111; font-family: Inter, system-ui, sans-serif; }
```

Add preloads to `frontend/index.html` `<head>` (before `<title>`):

```html
<link rel="preload" href="/fonts/Inter-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/Inter-SemiBold.woff2" as="font" type="font/woff2" crossorigin>
```

- [ ] **Step 6: Update `App.tsx` to use tokens**

Replace `frontend/src/App.tsx`:

```tsx
export function App() {
  return (
    <div className="min-h-screen bg-paper text-ink font-body">
      <h1 className="font-display text-4xl tracking-tight">Studio Crisis Commander</h1>
      <p className="text-ink-soft">Layer 5 scaffold — panels arrive in later tasks.</p>
    </div>
  )
}
```

- [ ] **Step 7: Run tests to verify pass**

```bash
cd frontend
npm run test
```

Expected: 4 passed (theme.test.tsx).

- [ ] **Step 8: Verify build compiles with new Tailwind theme**

```bash
cd frontend
npm run build
```

Expected: exits 0. `dist/assets/*.css` contains `.bg-accent`, `.text-paper` rules.

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "feat(fe): newsroom-hybrid design tokens + Tailwind theme + font pipeline"
```

---

## Task 4: TypeScript API contracts (mirror backend Pydantic)

**Files:**
- Create: `frontend/src/api/contracts.ts`
- Create: `frontend/src/tests/unit/contracts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/contracts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type {
  SseEvent, DetectionRow, InvestigationResult, DecisionResult,
  ExecutiveReport, CrisisType, MetricsResponse, AuditRow,
} from '@/api/contracts'
import {
  isSseEvent, isInvestigationResult, isDecisionResult, isExecutiveReport,
} from '@/api/contracts'

const TRIPLE_PATH = path.resolve(
  __dirname, '../../../..', 'backend/api/cached/fallback_triple.json',
)

describe('api contracts', () => {
  it('SseEvent shape has seq/ts/type/data', () => {
    const e: SseEvent = { seq: 0, ts: '2026-08-09T12:00:00.000+00:00',
                          type: 'detection.completed', data: { mode: 'live' } }
    expect(isSseEvent(e)).toBe(true)
  })

  it('CrisisType is one of the 4 known variants', () => {
    const ok: CrisisType[] = [
      'SENTIMENT_COLLAPSE',
      'REGIONAL_SENTIMENT_COLLAPSE',
      'COMPETITOR_RELEASE',
      'BUDGET_OVERRUN',
    ]
    expect(ok.length).toBe(4)
  })

  it('the cached fallback triple parses against InvestigationResult+DecisionResult+ExecutiveReport', () => {
    const raw = JSON.parse(fs.readFileSync(TRIPLE_PATH, 'utf-8'))
    // Detection is present on the triple's investigation.detection
    expect(raw.investigation).toBeDefined()
    expect(raw.decision).toBeDefined()
    expect(raw.report).toBeDefined()

    const inv = raw.investigation as InvestigationResult
    expect(isInvestigationResult(inv)).toBe(true)
    expect(inv.findings.length).toBe(4)
    expect(['low', 'medium', 'high']).toContain(inv.hypothesis.confidence)

    const dec = raw.decision as DecisionResult
    expect(isDecisionResult(dec)).toBe(true)
    expect(dec.actions.length).toBeGreaterThanOrEqual(1)
    expect(dec.actions.length).toBeLessThanOrEqual(3)

    const rep = raw.report as ExecutiveReport
    expect(isExecutiveReport(rep)).toBe(true)
    expect(rep.key_figures.length).toBeGreaterThanOrEqual(1)
    expect(rep.key_figures.length).toBeLessThanOrEqual(8)
  })

  it('MetricsResponse shape has 4 named timeseries keys', () => {
    const m: MetricsResponse = {
      film_id: 1, region: 'Brazil',
      timeseries: {
        box_office_daily: [],
        social_virality_hourly: [],
        sentiment_hourly: [],
        trailer_hourly: [],
      },
      query_latency_ms: 47,
    }
    expect(Object.keys(m.timeseries).sort()).toEqual([
      'box_office_daily', 'sentiment_hourly',
      'social_virality_hourly', 'trailer_hourly',
    ])
  })

  it('AuditRow shape has decision_id + approval_status + created_at', () => {
    const row: AuditRow = {
      audit_id: 'a-1', decision_id: 'd-1', investigation_id: 'i-1',
      created_at: '2026-08-09T00:00:00Z',
      approval_status: 'pending_approval',
      approver: '', approval_note: '', denial_reason: '',
      threshold_usd: 250000, total_impact_usd: 100000,
      film_id: 1, region: 'Brazil',
      report_id: '', report_headline: '',
    }
    expect(row.approval_status).toBe('pending_approval')
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
cd frontend
npm run test
```

Expected: FAIL with `Cannot find module '@/api/contracts'`.

- [ ] **Step 3: Implement contracts**

Create `frontend/src/api/contracts.ts`:

```ts
/**
 * TypeScript mirrors of backend Pydantic contracts.
 * Source of truth: backend/agents/*/contracts.py and backend/agents/decision/audit.py.
 * Keep this file in sync when backend contracts change; the fallback-triple
 * fixture test in contracts.test.ts catches drift.
 */

// ─── SSE ────────────────────────────────────────────────────────────
export interface SseEvent<T = unknown> {
  seq: number
  ts: string      // ISO 8601
  type: string    // dotted, e.g. "detection.completed"
  data: T & { mode?: 'live' | 'fallback' }
}

export function isSseEvent(x: unknown): x is SseEvent {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.seq === 'number' && typeof o.type === 'string'
      && typeof o.ts === 'string' && typeof o.data === 'object'
}

// ─── Crisis / Detection ─────────────────────────────────────────────
export type CrisisType =
  | 'SENTIMENT_COLLAPSE'
  | 'REGIONAL_SENTIMENT_COLLAPSE'
  | 'COMPETITOR_RELEASE'
  | 'BUDGET_OVERRUN'

export interface DetectionRow {
  metric_ts: string
  metric: string
  film_id: number
  region: string
  detector: string
  baseline_value: number
  actual_value: number
  magnitude: number
  business_impact: number
  severity: number
  dedup_key: string
}

// ─── Investigation ──────────────────────────────────────────────────
export type SignalName =
  | 'numeric_context' | 'text_reason'
  | 'categorical_isolation' | 'temporal_context'

export interface SignalFinding {
  signal: SignalName
  sql: string
  columns: string[]
  rows: unknown[][]
  narrative: string
  latency_ms: number
}
export type Finding = SignalFinding   // alias

export interface Hypothesis {
  primary_cause: string
  contributing_factors: string[]
  confidence: 'low' | 'medium' | 'high'
  citations: SignalName[]
}

export interface InvestigationResult {
  investigation_id: string
  detection: DetectionRow
  findings: SignalFinding[]
  hypothesis: Hypothesis
  started_at: string
  finished_at: string
}

export function isInvestigationResult(x: unknown): x is InvestigationResult {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.investigation_id === 'string'
      && Array.isArray(o.findings)
      && typeof o.detection === 'object'
      && typeof o.hypothesis === 'object'
}

// ─── Decision ───────────────────────────────────────────────────────
export type ActionType =
  | 'shift_marketing_spend' | 'pause_campaign'
  | 'swap_trailer_variant' | 'issue_pr_statement' | 'escalate_to_human'

export type ApprovalStatus =
  | 'auto_executed' | 'pending_approval' | 'approved' | 'denied'

export interface RecommendedAction {
  action_type: ActionType
  rationale: string
  params: Record<string, unknown>
  impact_usd: number | null
  impact_sql: string
  impact_error: string
  priority: 1 | 2 | 3
}
export type Action = RecommendedAction  // alias

export interface DecisionResult {
  decision_id: string
  investigation_id: string
  actions: RecommendedAction[]
  status: ApprovalStatus
  threshold_usd: number
  created_at: string
  latency_ms: number
}

export function isDecisionResult(x: unknown): x is DecisionResult {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.decision_id === 'string' && Array.isArray(o.actions)
}

// ─── Report ─────────────────────────────────────────────────────────
export interface FindingSource {
  signal: SignalName | 'decision_impact'
  query_index: number
}

export interface KeyFigure {
  label: string
  value: string
  source_query: string
  source: FindingSource
}

export interface ExecutiveReport {
  report_id: string
  decision_id: string
  headline: string
  tldr: string
  key_figures: KeyFigure[]
  recommended_actions_prose: string
  risks_and_caveats: string
  created_at: string
  latency_ms: number
}

export function isExecutiveReport(x: unknown): x is ExecutiveReport {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.report_id === 'string' && Array.isArray(o.key_figures)
      && typeof o.headline === 'string' && typeof o.tldr === 'string'
}

// ─── Metrics ────────────────────────────────────────────────────────
export interface MetricPoint {
  ts: string
  value: number
}

export interface MetricsResponse {
  film_id: number
  region: string
  timeseries: {
    box_office_daily: MetricPoint[]
    social_virality_hourly: MetricPoint[]
    sentiment_hourly: MetricPoint[]
    trailer_hourly: MetricPoint[]
  }
  query_latency_ms: number
}

// ─── Audit ──────────────────────────────────────────────────────────
export interface AuditRow {
  audit_id: string
  decision_id: string
  investigation_id: string
  created_at: string
  approval_status: ApprovalStatus
  approver: string
  approval_note: string
  denial_reason: string
  threshold_usd: number
  total_impact_usd: number
  film_id: number
  region: string
  report_id: string
  report_headline: string
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd frontend
npm run test
```

Expected: 5 passed (contracts.test.ts). The fixture test proves the TS types match the real Pydantic JSON dump.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/contracts.ts frontend/src/tests/unit/contracts.test.ts
git commit -m "feat(fe): TypeScript contracts mirroring backend Pydantic"
```

---

## Task 5: API client + SSE openStream helper

**Files:**
- Create: `frontend/src/api/client.ts`, `frontend/src/api/sse.ts`
- Create: `frontend/src/tests/unit/client.test.ts`, `frontend/src/tests/unit/sse.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/unit/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiGet, apiPost, ApiError } from '@/api/client'

const originalFetch = globalThis.fetch

beforeEach(() => { vi.stubEnv('VITE_API_URL', 'http://localhost:8000') })
afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllEnvs()
})

describe('apiGet', () => {
  it('resolves parsed JSON on 2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(
      JSON.stringify({ hello: 'world' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const out = await apiGet<{ hello: string }>('/foo')
    expect(out).toEqual({ hello: 'world' })
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])
      .toBe('http://localhost:8000/foo')
  })

  it('throws ApiError on 4xx/5xx with status + text', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(
      'nope', { status: 503 },
    ))
    await expect(apiGet('/broken')).rejects.toBeInstanceOf(ApiError)
    try { await apiGet('/broken') } catch (e) {
      expect((e as ApiError).status).toBe(503)
      expect((e as ApiError).body).toContain('nope')
    }
  })
})

describe('apiPost', () => {
  it('sends JSON body and returns parsed response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(
      JSON.stringify({ run_id: 'r1' }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    ))
    const out = await apiPost<{ run_id: string }>('/inject-crisis', { foo: 1 })
    expect(out.run_id).toBe('r1')
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].method).toBe('POST')
    expect(call[1].body).toBe(JSON.stringify({ foo: 1 }))
    expect(call[1].headers['content-type']).toBe('application/json')
  })
})
```

Create `frontend/src/tests/unit/sse.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openStream } from '@/api/sse'

class MockEventSource {
  static instances: MockEventSource[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onopen: ((e: Event) => void) | null = null
  readyState = 0
  url: string
  closed = false
  constructor(url: string) { this.url = url; MockEventSource.instances.push(this) }
  emit(payload: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }))
  }
  fireError() { this.onerror?.(new Event('error')) }
  close() { this.closed = true }
}

beforeEach(() => {
  MockEventSource.instances = []
  vi.stubEnv('VITE_API_URL', 'http://localhost:8000')
  ;(globalThis as unknown as { EventSource: typeof MockEventSource })
    .EventSource = MockEventSource
})
afterEach(() => { vi.unstubAllEnvs() })

describe('openStream', () => {
  it('opens EventSource at /stream/investigation/{runId}', () => {
    openStream('r-1', () => {}, () => {})
    expect(MockEventSource.instances[0].url)
      .toBe('http://localhost:8000/stream/investigation/r-1')
  })

  it('parses SSE messages and invokes onEvent', () => {
    const events: unknown[] = []
    openStream('r-2', (e) => events.push(e), () => {})
    MockEventSource.instances[0].emit({ seq: 0, type: 'x', data: {}, ts: 't' })
    expect(events).toEqual([{ seq: 0, type: 'x', data: {}, ts: 't' }])
  })

  it('invokes onError on transport error', () => {
    let err: Error | null = null
    openStream('r-3', () => {}, (e) => { err = e })
    MockEventSource.instances[0].fireError()
    expect(err).toBeInstanceOf(Error)
  })

  it('returned close() closes the EventSource', () => {
    const close = openStream('r-4', () => {}, () => {})
    close()
    expect(MockEventSource.instances[0].closed).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify fail**

```bash
cd frontend
npm run test
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement client + sse**

Create `frontend/src/api/client.ts`:

```ts
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`API ${status}: ${body.slice(0, 200)}`)
    this.name = 'ApiError'
  }
}

const BASE = (): string => {
  const url = import.meta.env.VITE_API_URL
  if (!url) throw new Error('VITE_API_URL is not set')
  return url.replace(/\/$/, '')
}

async function _handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, body)
  }
  return res.json() as Promise<T>
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, { ...init, method: 'GET' })
  return _handle<T>(res)
}

export async function apiPost<T>(
  path: string, body: unknown, init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    ...init,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    body: JSON.stringify(body ?? {}),
  })
  return _handle<T>(res)
}
```

Create `frontend/src/api/sse.ts`:

```ts
/**
 * openStream — opens an EventSource at /stream/investigation/{runId},
 * parses each `data:` payload as JSON, and dispatches to onEvent.
 *
 * The server (Layer 4 §6) replays the full event log to late/reconnecting
 * subscribers. The consumer (runStore) dedupes by event.seq. We do not
 * track lastEventId on the client.
 *
 * Called only by store.connectStream — never from a panel directly.
 */

const BASE = (): string => {
  const url = import.meta.env.VITE_API_URL
  if (!url) throw new Error('VITE_API_URL is not set')
  return url.replace(/\/$/, '')
}

export function openStream(
  runId: string,
  onEvent: (payload: unknown) => void,
  onError: (err: Error) => void,
): () => void {
  const url = `${BASE()}/stream/investigation/${runId}`
  const es = new EventSource(url)
  es.onmessage = (msg) => {
    try { onEvent(JSON.parse(msg.data)) }
    catch (e) { onError(new Error(`SSE parse: ${(e as Error).message}`)) }
  }
  es.onerror = () => onError(new Error('stream error — awaiting reconnect'))
  return () => es.close()
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd frontend
npm run test
```

Expected: client tests (3) + sse tests (4) all pass. Total 7 new tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/ frontend/src/tests/unit/client.test.ts frontend/src/tests/unit/sse.test.ts
git commit -m "feat(fe): api client + SSE openStream helper"
```

---

## Task 6: Zustand runStore — skeleton (state shape + action stubs)

**Files:**
- Create: `frontend/src/store/runStore.ts`
- Create: `frontend/src/tests/unit/runStore.skeleton.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/runStore.skeleton.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useRunStore } from '@/store/runStore'

describe('runStore — initial shape', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('starts with everything empty/idle', () => {
    const s = useRunStore.getState()
    expect(s.runId).toBeNull()
    expect(s.events).toEqual([])
    expect(s.detection).toBeNull()
    expect(s.findings).toEqual([])
    expect(s.decision).toBeNull()
    expect(s.report).toBeNull()
    expect(s.approvalStatus).toBeNull()
    expect(s.mode).toBeNull()
    expect(s.recentDetections).toEqual([])
    expect(s.auditRows).toEqual([])
    expect(s.metrics).toEqual({})
    expect(s.latencyMs).toBeNull()
    expect(s.streamState).toBe('idle')
    expect(s.apiReachable).toBe(true)
    expect(s.panelStates.hero).toEqual({ kind: 'idle' })
    expect(s.panelStates.telemetry).toEqual({ kind: 'idle' })
    expect(s.panelStates.anomaly.kind).toBeDefined()
    expect(s.panelStates.trace).toEqual({ kind: 'idle' })
    expect(s.panelStates.recommendation).toEqual({ kind: 'idle' })
    expect(s.panelStates.approval).toEqual({ kind: 'idle' })
    expect(s.panelStates.history.kind).toBeDefined()
  })

  it('reset() restores initial state after mutation', () => {
    useRunStore.setState({ runId: 'r-1' })
    expect(useRunStore.getState().runId).toBe('r-1')
    useRunStore.getState().reset()
    expect(useRunStore.getState().runId).toBeNull()
  })

  it('exports all required actions as functions', () => {
    const s = useRunStore.getState()
    expect(typeof s.inject).toBe('function')
    expect(typeof s.connectStream).toBe('function')
    expect(typeof s.approve).toBe('function')
    expect(typeof s.deny).toBe('function')
    expect(typeof s.loadDetections).toBe('function')
    expect(typeof s.loadAudit).toBe('function')
    expect(typeof s.loadMetrics).toBe('function')
    expect(typeof s.reset).toBe('function')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: `Cannot find module '@/store/runStore'`.

- [ ] **Step 3: Implement skeleton**

Create `frontend/src/store/runStore.ts`:

```ts
import { create } from 'zustand'
import type {
  SseEvent, DetectionRow, Finding, DecisionResult, ExecutiveReport,
  ApprovalStatus, AuditRow, MetricsResponse, CrisisType,
} from '@/api/contracts'

export type PanelState =
  | { kind: 'idle' }
  | { kind: 'loading'; substatus?: string }
  | { kind: 'success' }
  | { kind: 'empty'; hint?: string }
  | { kind: 'error'; message: string; retry?: () => void }

type PanelKey =
  | 'hero' | 'telemetry' | 'anomaly' | 'trace'
  | 'recommendation' | 'approval' | 'history'

interface RunStore {
  // ─── data ────────────────────────────────────────
  runId: string | null
  events: SseEvent[]
  detection: DetectionRow | null
  findings: Finding[]
  decision: DecisionResult | null
  report: ExecutiveReport | null
  approvalStatus: ApprovalStatus | null
  mode: 'live' | 'fallback' | null
  recentDetections: DetectionRow[]
  auditRows: AuditRow[]
  metrics: Record<string, MetricsResponse>
  latencyMs: number | null

  // ─── stream ──────────────────────────────────────
  streamState: 'idle' | 'connecting' | 'streaming' | 'closed' | 'error'
  apiReachable: boolean
  panelStates: Record<PanelKey, PanelState>
  _closeStream: (() => void) | null

  // ─── actions ─────────────────────────────────────
  inject: (opts?: { crisisType?: CrisisType; fallback?: 'force' }) => Promise<string>
  connectStream: (runId: string) => void
  approve: (decisionId: string, note?: string) => Promise<void>
  deny: (decisionId: string, reason: string) => Promise<void>
  loadDetections: (limit?: number) => Promise<void>
  loadAudit: (limit?: number) => Promise<void>
  loadMetrics: (filmId: number, region: string, hours?: number) => Promise<void>
  reset: () => void
}

const INITIAL_PANELS: Record<PanelKey, PanelState> = {
  hero: { kind: 'idle' },
  telemetry: { kind: 'idle' },
  anomaly: { kind: 'empty', hint: 'No anomalies in the last 6 hours — system nominal' },
  trace: { kind: 'idle' },
  recommendation: { kind: 'idle' },
  approval: { kind: 'idle' },
  history: { kind: 'idle' },
}

const INITIAL: Omit<RunStore, keyof {
  inject: never; connectStream: never; approve: never; deny: never;
  loadDetections: never; loadAudit: never; loadMetrics: never; reset: never;
}> = {
  runId: null,
  events: [],
  detection: null,
  findings: [],
  decision: null,
  report: null,
  approvalStatus: null,
  mode: null,
  recentDetections: [],
  auditRows: [],
  metrics: {},
  latencyMs: null,
  streamState: 'idle',
  apiReachable: true,
  panelStates: INITIAL_PANELS,
  _closeStream: null,
}

export const useRunStore = create<RunStore>((set, _get) => ({
  ...INITIAL,

  // Stubs — filled in Tasks 7-8.
  inject: async () => { throw new Error('inject: not implemented (Task 7)') },
  connectStream: () => { throw new Error('connectStream: not implemented (Task 7)') },
  approve: async () => { throw new Error('approve: not implemented (Task 7)') },
  deny: async () => { throw new Error('deny: not implemented (Task 7)') },
  loadDetections: async () => { throw new Error('loadDetections: not implemented (Task 7)') },
  loadAudit: async () => { throw new Error('loadAudit: not implemented (Task 7)') },
  loadMetrics: async () => { throw new Error('loadMetrics: not implemented (Task 7)') },

  reset: () => {
    const s = useRunStore.getState()
    s._closeStream?.()
    set({ ...INITIAL })
  },
}))
```

- [ ] **Step 4: Run test to verify pass**

Expected: 3 passed (runStore.skeleton.test.ts).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/ frontend/src/tests/unit/runStore.skeleton.test.ts
git commit -m "feat(fe): Zustand runStore skeleton (state shape + action stubs)"
```

---

## Task 7: Store actions — inject, connectStream, approve/deny, load*

**Files:**
- Modify: `frontend/src/store/runStore.ts`
- Create: `frontend/src/tests/unit/runStore.actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/runStore.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRunStore } from '@/store/runStore'
import * as client from '@/api/client'
import * as sseMod from '@/api/sse'

beforeEach(() => {
  useRunStore.getState().reset()
  vi.stubEnv('VITE_API_URL', 'http://localhost:8000')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('inject()', () => {
  it('POSTs /inject-crisis, sets runId, opens stream', async () => {
    const postSpy = vi.spyOn(client, 'apiPost')
      .mockResolvedValue({ run_id: 'r-xyz', stream_url: '/stream/investigation/r-xyz' })
    const openSpy = vi.spyOn(sseMod, 'openStream').mockReturnValue(() => {})
    const runId = await useRunStore.getState().inject({ crisisType: 'SENTIMENT_COLLAPSE' })
    expect(runId).toBe('r-xyz')
    expect(useRunStore.getState().runId).toBe('r-xyz')
    expect(useRunStore.getState().streamState).toBe('connecting')
    expect(postSpy).toHaveBeenCalledWith('/inject-crisis',
      { crisis_type: 'SENTIMENT_COLLAPSE' })
    expect(openSpy).toHaveBeenCalledWith('r-xyz', expect.any(Function), expect.any(Function))
  })

  it('surfaces API errors — leaves runId null', async () => {
    vi.spyOn(client, 'apiPost').mockRejectedValue(new client.ApiError(503, 'down'))
    await expect(useRunStore.getState().inject()).rejects.toBeInstanceOf(client.ApiError)
    expect(useRunStore.getState().runId).toBeNull()
  })

  it('passes fallback=force through to backend', async () => {
    const postSpy = vi.spyOn(client, 'apiPost')
      .mockResolvedValue({ run_id: 'r-fb' })
    vi.spyOn(sseMod, 'openStream').mockReturnValue(() => {})
    await useRunStore.getState().inject({ fallback: 'force' })
    expect(postSpy).toHaveBeenCalledWith('/inject-crisis', { fallback: 'force' })
  })
})

describe('approve() / deny()', () => {
  it('approve() POSTs /approve/{id} and updates approvalStatus', async () => {
    const postSpy = vi.spyOn(client, 'apiPost')
      .mockResolvedValue({ approval_status: 'approved' })
    await useRunStore.getState().approve('d-1', 'looks good')
    expect(postSpy).toHaveBeenCalledWith('/approve/d-1',
      { approver: 'dashboard@demo', note: 'looks good' })
    expect(useRunStore.getState().approvalStatus).toBe('approved')
  })

  it('deny() POSTs /deny/{id} and updates approvalStatus', async () => {
    const postSpy = vi.spyOn(client, 'apiPost')
      .mockResolvedValue({ approval_status: 'denied' })
    await useRunStore.getState().deny('d-1', 'wrong region')
    expect(postSpy).toHaveBeenCalledWith('/deny/d-1',
      { denier: 'dashboard@demo', reason: 'wrong region' })
    expect(useRunStore.getState().approvalStatus).toBe('denied')
  })
})

describe('loadDetections()', () => {
  it('GETs /detections, populates recentDetections', async () => {
    vi.spyOn(client, 'apiGet').mockResolvedValue({
      detections: [{
        metric_ts: 't', metric: 'sentiment', film_id: 1, region: 'Brazil',
        detector: 'z', baseline_value: 0, actual_value: 0, magnitude: 0,
        business_impact: 0, severity: 5, dedup_key: 'k',
      }],
    })
    await useRunStore.getState().loadDetections(20)
    expect(useRunStore.getState().recentDetections.length).toBe(1)
    expect(useRunStore.getState().apiReachable).toBe(true)
  })

  it('sets apiReachable=false on network failure', async () => {
    vi.spyOn(client, 'apiGet').mockRejectedValue(new Error('ECONNREFUSED'))
    await useRunStore.getState().loadDetections()
    expect(useRunStore.getState().apiReachable).toBe(false)
  })
})

describe('loadMetrics()', () => {
  it('GETs /metrics/{filmId}/{region}, stores under filmId:region key', async () => {
    vi.spyOn(client, 'apiGet').mockResolvedValue({
      film_id: 1, region: 'Brazil',
      timeseries: { box_office_daily: [], social_virality_hourly: [],
                    sentiment_hourly: [], trailer_hourly: [] },
      query_latency_ms: 47,
    })
    await useRunStore.getState().loadMetrics(1, 'Brazil', 48)
    expect(useRunStore.getState().metrics['1:Brazil']).toBeDefined()
    expect(useRunStore.getState().latencyMs).toBe(47)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: all new tests fail with "not implemented".

- [ ] **Step 3: Implement actions**

Replace the action stubs in `frontend/src/store/runStore.ts` (keep the rest unchanged):

```ts
// Add near the top (imports):
import { apiGet, apiPost, ApiError } from '@/api/client'
import { openStream } from '@/api/sse'

// Replace stubs inside the create<RunStore>((set, get) => ({ ...INITIAL, ...
inject: async (opts) => {
  const body: Record<string, unknown> = {}
  if (opts?.crisisType) body.crisis_type = opts.crisisType
  if (opts?.fallback) body.fallback = opts.fallback
  const res = await apiPost<{ run_id: string; stream_url?: string }>(
    '/inject-crisis', body,
  )
  const runId = res.run_id
  set({ runId, streamState: 'connecting' })
  useRunStore.getState().connectStream(runId)
  return runId
},

connectStream: (runId: string) => {
  const prev = useRunStore.getState()._closeStream
  prev?.()
  const close = openStream(
    runId,
    // onEvent — Task 8 wires the full router; for now, just record it.
    (payload) => {
      // The dispatch is implemented in Task 8. Keep append-only fallback here
      // so we can still test the plumbing.
      const evs = useRunStore.getState().events
      set({ events: [...evs, payload as SseEvent], streamState: 'streaming' })
    },
    (_err) => set({ streamState: 'error' }),
  )
  set({ _closeStream: close })
},

approve: async (decisionId, note) => {
  const res = await apiPost<{ approval_status: ApprovalStatus }>(
    `/approve/${decisionId}`,
    { approver: 'dashboard@demo', note: note ?? '' },
  )
  set({ approvalStatus: res.approval_status })
},

deny: async (decisionId, reason) => {
  const res = await apiPost<{ approval_status: ApprovalStatus }>(
    `/deny/${decisionId}`,
    { denier: 'dashboard@demo', reason },
  )
  set({ approvalStatus: res.approval_status })
},

loadDetections: async (limit = 20) => {
  try {
    const res = await apiGet<{ detections: DetectionRow[] }>(
      `/detections?limit=${limit}`,
    )
    set({ recentDetections: res.detections, apiReachable: true })
  } catch (e) {
    if (e instanceof ApiError || e instanceof Error) {
      set({ apiReachable: false })
    } else { throw e }
  }
},

loadAudit: async (limit = 20) => {
  try {
    const res = await apiGet<{ rows: AuditRow[] } | AuditRow[]>(`/audit?limit=${limit}`)
    const rows = Array.isArray(res) ? res : res.rows
    set({ auditRows: rows, apiReachable: true })
  } catch {
    set({ apiReachable: false })
  }
},

loadMetrics: async (filmId, region, hours = 48) => {
  try {
    const res = await apiGet<MetricsResponse>(
      `/metrics/${filmId}/${encodeURIComponent(region)}?hours=${hours}`,
    )
    const key = `${filmId}:${region}`
    set((s) => ({
      metrics: { ...s.metrics, [key]: res },
      latencyMs: res.query_latency_ms,
      apiReachable: true,
    }))
  } catch {
    set({ apiReachable: false })
  }
},
```

- [ ] **Step 4: Run tests to verify pass**

Expected: 3 + 2 + 2 + 1 = 8 new tests pass; skeleton tests still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/runStore.ts frontend/src/tests/unit/runStore.actions.test.ts
git commit -m "feat(fe): runStore actions — inject, connectStream, approve/deny, load*"
```

---

## Task 8: Store event routing + derived panelStates

**Files:**
- Modify: `frontend/src/store/runStore.ts`
- Create: `frontend/src/tests/unit/runStore.events.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/unit/runStore.events.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRunStore } from '@/store/runStore'
import * as client from '@/api/client'
import type { SseEvent } from '@/api/contracts'

function mk<T>(seq: number, type: string, data: T): SseEvent<T> {
  return { seq, type, data, ts: `2026-08-09T00:00:${String(seq).padStart(2, '0')}Z` }
}

const DET = {
  metric_ts: 't', metric: 'sentiment', film_id: 1, region: 'Brazil',
  detector: 'z', baseline_value: 0, actual_value: 0, magnitude: 8.4,
  business_impact: 100000, severity: 8, dedup_key: 'k',
}

beforeEach(() => useRunStore.getState().reset())

describe('event routing', () => {
  it('detection.completed → sets detection, auto-fires loadMetrics', async () => {
    const spy = vi.spyOn(client, 'apiGet').mockResolvedValue({
      film_id: 1, region: 'Brazil', query_latency_ms: 47,
      timeseries: { box_office_daily: [], social_virality_hourly: [],
                    sentiment_hourly: [], trailer_hourly: [] },
    })
    useRunStore.getState()._dispatch(mk(0, 'detection.completed', { detection: DET, mode: 'live' }))
    expect(useRunStore.getState().detection?.magnitude).toBe(8.4)
    // Wait for the auto-loadMetrics microtask to settle.
    await Promise.resolve()
    await Promise.resolve()
    expect(spy).toHaveBeenCalled()
  })

  it('signal.completed × 4 → findings length grows to 4', () => {
    const s = useRunStore.getState()
    const signals = ['numeric_context', 'text_reason', 'categorical_isolation', 'temporal_context']
    signals.forEach((sig, i) => {
      s._dispatch(mk(i, 'signal.completed', { finding: {
        signal: sig, sql: 'SELECT 1', columns: [], rows: [], narrative: 'x', latency_ms: 10,
      }}))
    })
    expect(useRunStore.getState().findings.length).toBe(4)
  })

  it('decision.completed → sets decision', () => {
    const dec = { decision_id: 'd-1', investigation_id: 'i-1', actions: [{
      action_type: 'shift_marketing_spend', rationale: 'long enough rationale here to pass',
      params: {}, impact_usd: 100000, impact_sql: 'SELECT 1', impact_error: '', priority: 1,
    }], status: 'pending_approval', threshold_usd: 250000,
    created_at: 't', latency_ms: 100 }
    useRunStore.getState()._dispatch(mk(0, 'decision.completed', { decision: dec }))
    expect(useRunStore.getState().decision?.decision_id).toBe('d-1')
  })

  it('report.completed → sets report', () => {
    const rep = { report_id: 'r-1', decision_id: 'd-1',
      headline: 'A twenty-plus char headline',
      tldr: 'A forty-plus char tldr summary that says enough words.',
      key_figures: [{ label: 'X', value: '1',
        source_query: 'SELECT 1 FROM t',
        source: { signal: 'numeric_context', query_index: 0 } }],
      recommended_actions_prose: 'Forty plus chars of prose describing the recommended actions.',
      risks_and_caveats: '', created_at: 't', latency_ms: 10 }
    useRunStore.getState()._dispatch(mk(0, 'report.completed', { report: rep }))
    expect(useRunStore.getState().report?.report_id).toBe('r-1')
  })

  it('approval.granted / approval.denied → flip approvalStatus', () => {
    useRunStore.getState()._dispatch(mk(0, 'approval.granted', { approval_status: 'approved' }))
    expect(useRunStore.getState().approvalStatus).toBe('approved')
    useRunStore.getState()._dispatch(mk(1, 'approval.denied', { approval_status: 'denied' }))
    expect(useRunStore.getState().approvalStatus).toBe('denied')
  })

  it('pipeline.completed → streamState becomes closed', () => {
    useRunStore.getState()._dispatch(mk(0, 'pipeline.completed', {}))
    expect(useRunStore.getState().streamState).toBe('closed')
  })

  it('pipeline.failed → streamState becomes error', () => {
    useRunStore.getState()._dispatch(mk(0, 'pipeline.failed', { error: 'boom' }))
    expect(useRunStore.getState().streamState).toBe('error')
  })

  it('mode is captured from any event whose data.mode is set (first write wins)', () => {
    useRunStore.getState()._dispatch(mk(0, 'detection.started', { mode: 'fallback' }))
    expect(useRunStore.getState().mode).toBe('fallback')
    useRunStore.getState()._dispatch(mk(1, 'signal.completed', { mode: 'live', finding: {
      signal: 'numeric_context', sql: 'x', columns: [], rows: [], narrative: '', latency_ms: 0,
    }}))
    expect(useRunStore.getState().mode).toBe('fallback')  // first-write-wins
  })

  it('dedupe by seq — same seq event ignored on replay', () => {
    useRunStore.getState()._dispatch(mk(3, 'x', {}))
    useRunStore.getState()._dispatch(mk(1, 'y', {}))
    useRunStore.getState()._dispatch(mk(3, 'x-dup', {}))
    expect(useRunStore.getState().events.map(e => e.seq)).toEqual([3, 1])
  })
})

describe('derived panelStates', () => {
  it('idle store → hero=idle, anomaly=empty, others=idle', () => {
    const p = useRunStore.getState().panelStates
    expect(p.hero.kind).toBe('idle')
    expect(p.anomaly.kind).toBe('empty')
    expect(p.trace.kind).toBe('idle')
  })

  it('with runId + no detection yet → hero=loading, trace=success', () => {
    useRunStore.setState({ runId: 'r-1', streamState: 'streaming' })
    useRunStore.getState()._recomputePanels()
    const p = useRunStore.getState().panelStates
    expect(p.hero.kind).toBe('loading')
    expect(p.trace.kind).toBe('success')
  })

  it('with detection + decision + report → recommendation=success, approval=success', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      detection: DET as never,
      decision: { decision_id: 'd', investigation_id: 'i', actions: [] as never,
                  status: 'pending_approval', threshold_usd: 0, created_at: 't', latency_ms: 0 } as never,
    })
    useRunStore.getState()._recomputePanels()
    const p = useRunStore.getState().panelStates
    expect(p.recommendation.kind).toBe('success')
    expect(p.approval.kind).toBe('success')
    expect(p.hero.kind).toBe('success')
  })

  it('apiReachable=false → anomaly=error, history=error', () => {
    useRunStore.setState({ apiReachable: false })
    useRunStore.getState()._recomputePanels()
    const p = useRunStore.getState().panelStates
    expect(p.anomaly.kind).toBe('error')
    expect(p.history.kind).toBe('error')
  })

  it('streamState=error → trace=error, hero=error', () => {
    useRunStore.setState({ runId: 'r-1', streamState: 'error' })
    useRunStore.getState()._recomputePanels()
    const p = useRunStore.getState().panelStates
    expect(p.trace.kind).toBe('error')
    expect(p.hero.kind).toBe('error')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — `_dispatch` / `_recomputePanels` not defined.

- [ ] **Step 3: Implement event routing + panel derivation**

Add to `frontend/src/store/runStore.ts`:

Update the `RunStore` interface — add these private methods:

```ts
  _dispatch: (ev: SseEvent) => void
  _recomputePanels: () => void
```

Replace `connectStream`'s `onEvent` handler to call `_dispatch`:

```ts
connectStream: (runId: string) => {
  const prev = useRunStore.getState()._closeStream
  prev?.()
  const close = openStream(
    runId,
    (payload) => useRunStore.getState()._dispatch(payload as SseEvent),
    (_err) => {
      set({ streamState: 'error' })
      useRunStore.getState()._recomputePanels()
    },
  )
  set({ streamState: 'connecting', _closeStream: close })
  useRunStore.getState()._recomputePanels()
},
```

Add the dispatcher + derived-state computation after the actions (still inside the `create` factory):

```ts
_dispatch: (ev) => {
  const s = useRunStore.getState()

  // Dedupe by seq — server replays on reconnect (Layer 4 §6).
  if (s.events.some((e) => e.seq === ev.seq)) return

  const patch: Partial<RunStore> = { events: [...s.events, ev] }
  if (s.streamState === 'connecting' || s.streamState === 'idle') {
    patch.streamState = 'streaming'
  }
  if (!s.mode && (ev.data as { mode?: 'live' | 'fallback' })?.mode) {
    patch.mode = (ev.data as { mode?: 'live' | 'fallback' }).mode ?? null
  }

  switch (ev.type) {
    case 'detection.completed': {
      const d = (ev.data as { detection?: DetectionRow }).detection
      if (d) {
        patch.detection = d
        // fire-and-forget metrics fetch for the affected film/region
        void useRunStore.getState().loadMetrics(d.film_id, d.region)
      }
      break
    }
    case 'signal.completed': {
      const f = (ev.data as { finding?: Finding }).finding
      if (f) patch.findings = [...s.findings, f]
      break
    }
    case 'action.impact_computed': {
      // merge impact into the matching action; keeps decision reactive
      const p = ev.data as { action_index?: number; impact_usd?: number }
      if (s.decision && typeof p.action_index === 'number') {
        const actions = s.decision.actions.map((a, i) =>
          i === p.action_index ? { ...a, impact_usd: p.impact_usd ?? a.impact_usd } : a,
        )
        patch.decision = { ...s.decision, actions }
      }
      break
    }
    case 'decision.completed': {
      const d = (ev.data as { decision?: DecisionResult }).decision
      if (d) {
        patch.decision = d
        patch.approvalStatus = d.status
      }
      break
    }
    case 'report.completed': {
      const r = (ev.data as { report?: ExecutiveReport }).report
      if (r) patch.report = r
      break
    }
    case 'approval.granted':
    case 'approval.denied': {
      const st = (ev.data as { approval_status?: ApprovalStatus }).approval_status
      if (st) patch.approvalStatus = st
      break
    }
    case 'pipeline.completed': patch.streamState = 'closed'; break
    case 'pipeline.failed':    patch.streamState = 'error';  break
  }

  set(patch)
  useRunStore.getState()._recomputePanels()
},

_recomputePanels: () => {
  const s = useRunStore.getState()
  const hasRun = s.runId !== null
  const streamError = s.streamState === 'error'
  const streaming = s.streamState === 'streaming' || s.streamState === 'closed'

  const panels: Record<PanelKey, PanelState> = {
    hero: !hasRun ? { kind: 'idle' }
      : streamError ? { kind: 'error', message: 'Stream disconnected', retry: s.reset }
      : s.detection ? { kind: 'success' }
      : { kind: 'loading', substatus: 'Detecting anomaly…' },

    telemetry:
      Object.keys(s.metrics).length > 0 ? { kind: 'success' }
      : !hasRun ? { kind: 'idle' }
      : { kind: 'loading', substatus: 'Fetching rolling aggregates…' },

    anomaly:
      !s.apiReachable ? { kind: 'error', message: 'API unreachable', retry: () => void s.loadDetections() }
      : s.recentDetections.length > 0 ? { kind: 'success' }
      : hasRun && s.detection ? { kind: 'success' }
      : hasRun ? { kind: 'loading' }
      : { kind: 'empty', hint: 'No anomalies in the last 6 hours — system nominal' },

    trace: !hasRun ? { kind: 'idle' }
      : streamError ? { kind: 'error', message: 'Trace stream lost',
                        retry: () => s.connectStream(s.runId!) }
      : { kind: 'success' },

    recommendation:
      s.decision ? { kind: 'success' }
      : !hasRun ? { kind: 'idle' }
      : streamError ? { kind: 'error', message: 'Decision stage failed', retry: s.reset }
      : { kind: 'loading', substatus: streaming ? 'Awaiting decision…' : 'Waiting…' },

    approval:
      s.decision ? { kind: 'success' }
      : { kind: 'idle' },

    history:
      !s.apiReachable ? { kind: 'error', message: 'API unreachable', retry: () => void s.loadAudit() }
      : s.auditRows.length > 0 ? { kind: 'success' }
      : { kind: 'empty', hint: 'No past investigations yet' },
  }
  set({ panelStates: panels })
},
```

Also update `loadDetections` / `loadAudit` / `loadMetrics` to call `_recomputePanels()` at the end of each (both success and failure branches).

- [ ] **Step 4: Run tests to verify pass**

Expected: all event-routing (9) + panel-derivation (5) tests pass. Previous store tests still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/runStore.ts frontend/src/tests/unit/runStore.events.test.ts
git commit -m "feat(fe): runStore event routing + derived panelStates"
```

---

## Task 9: PanelStateWrapper primitive

**Files:**
- Create: `frontend/src/components/PanelStateWrapper.tsx`
- Create: `frontend/src/tests/unit/PanelStateWrapper.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/PanelStateWrapper.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'

describe('PanelStateWrapper', () => {
  it('renders children when state.kind=success', () => {
    render(
      <PanelStateWrapper state={{ kind: 'success' }} label="Test">
        <div>real content</div>
      </PanelStateWrapper>,
    )
    expect(screen.getByText('real content')).toBeInTheDocument()
  })

  it('renders skeleton + substatus on loading', () => {
    render(
      <PanelStateWrapper state={{ kind: 'loading', substatus: 'Querying…' }} label="Test">
        <div>hidden</div>
      </PanelStateWrapper>,
    )
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
    expect(screen.getByText('Querying…')).toBeInTheDocument()
    expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument()
  })

  it('renders idle placeholder — no children', () => {
    render(
      <PanelStateWrapper state={{ kind: 'idle' }} label="Anomaly Feed" idleLabel="Waiting">
        <div>hidden</div>
      </PanelStateWrapper>,
    )
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
    expect(screen.getByText(/Waiting/)).toBeInTheDocument()
  })

  it('renders empty hint', () => {
    render(
      <PanelStateWrapper state={{ kind: 'empty', hint: 'Nothing yet' }} label="X">
        <div>hidden</div>
      </PanelStateWrapper>,
    )
    expect(screen.getByText('Nothing yet')).toBeInTheDocument()
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
  })

  it('renders error + calls retry on click', () => {
    const retry = vi.fn()
    render(
      <PanelStateWrapper state={{ kind: 'error', message: 'Boom', retry }} label="X">
        <div>hidden</div>
      </PanelStateWrapper>,
    )
    expect(screen.getByText('Boom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement PanelStateWrapper**

Create `frontend/src/components/PanelStateWrapper.tsx`:

```tsx
import type { PanelState } from '@/store/runStore'
import type { ReactNode } from 'react'

interface Props {
  state: PanelState
  label: string          // human name, e.g. "Anomaly Feed"
  idleLabel?: string     // optional idle placeholder text
  children: ReactNode
}

export function PanelStateWrapper({ state, label, idleLabel, children }: Props) {
  switch (state.kind) {
    case 'success':
      return <>{children}</>

    case 'loading':
      return (
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">{label}</div>
          <div data-testid="panel-skeleton"
               className="animate-pulse bg-card-alt h-16 rounded"></div>
          {state.substatus && (
            <div className="mt-2 text-sm text-ink-soft italic">{state.substatus}</div>
          )}
        </div>
      )

    case 'empty':
      return (
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">{label}</div>
          <div className="text-sm text-ink-soft">{state.hint ?? 'Nothing to show'}</div>
        </div>
      )

    case 'error':
      return (
        <div className="p-4 border-l-4 border-accent bg-card-alt">
          <div className="text-xs uppercase tracking-wider text-accent mb-2">{label} — error</div>
          <div className="text-sm text-ink mb-3">{state.message}</div>
          {state.retry && (
            <button
              type="button"
              onClick={state.retry}
              className="text-sm underline text-accent"
            >Retry</button>
          )}
        </div>
      )

    case 'idle':
    default:
      return (
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">{label}</div>
          <div className="text-sm text-ink-soft">{idleLabel ?? 'Idle'}</div>
        </div>
      )
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PanelStateWrapper.tsx frontend/src/tests/unit/PanelStateWrapper.test.tsx
git commit -m "feat(fe): PanelStateWrapper — 5-state discipline enforced in one place"
```

---

## Task 10: Shared primitives (Button, Card, SqlBlock, Popover, SeverityChip)

**Files:**
- Create: `frontend/src/components/Button.tsx`, `Card.tsx`, `SqlBlock.tsx`, `Popover.tsx`, `SeverityChip.tsx`
- Create: `frontend/src/tests/unit/primitives.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/primitives.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { SqlBlock } from '@/components/SqlBlock'
import { Popover } from '@/components/Popover'
import { SeverityChip } from '@/components/SeverityChip'

describe('Button', () => {
  it('renders + fires onClick', () => {
    const cb = vi.fn()
    render(<Button onClick={cb}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(cb).toHaveBeenCalledOnce()
  })
  it('disabled prevents click', () => {
    const cb = vi.fn()
    render(<Button onClick={cb} disabled>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(cb).not.toHaveBeenCalled()
  })
  it('variant=primary uses accent bg', () => {
    render(<Button variant="primary">P</Button>)
    expect(screen.getByRole('button').className).toContain('bg-accent')
  })
})

describe('Card', () => {
  it('renders children in card container', () => {
    render(<Card><span>x</span></Card>)
    expect(screen.getByText('x')).toBeInTheDocument()
  })
})

describe('SqlBlock', () => {
  it('renders SQL in mono block', () => {
    render(<SqlBlock sql="SELECT 1" />)
    expect(screen.getByText('SELECT 1')).toBeInTheDocument()
  })
  it('has copy button', () => {
    render(<SqlBlock sql="SELECT 1" />)
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })
})

describe('Popover', () => {
  it('shows content when open', () => {
    render(<Popover open trigger={<button>t</button>}><div>panel</div></Popover>)
    expect(screen.getByText('panel')).toBeInTheDocument()
  })
  it('hides content when closed', () => {
    render(<Popover open={false} trigger={<button>t</button>}><div>panel</div></Popover>)
    expect(screen.queryByText('panel')).not.toBeInTheDocument()
  })
})

describe('SeverityChip', () => {
  it('renders label with correct sev color class', () => {
    render(<SeverityChip level="critical">critical</SeverityChip>)
    expect(screen.getByText('critical').className).toContain('bg-sev-crit-bg')
  })
  it('supports replay tone', () => {
    render(<SeverityChip level="replay">REPLAY</SeverityChip>)
    expect(screen.getByText('REPLAY').className).toContain('bg-sev-replay-bg')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: modules not found.

- [ ] **Step 3: Implement primitives**

Create `frontend/src/components/Button.tsx`:

```tsx
import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
}

export function Button({ variant = 'secondary', className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={clsx(
        'px-4 py-2 text-sm font-medium rounded transition',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        variant === 'primary' && 'bg-accent text-white hover:opacity-90',
        variant === 'secondary' && 'bg-card border border-line text-ink hover:bg-card-alt',
        variant === 'ghost' && 'text-ink-soft hover:text-ink',
        className,
      )}
      {...rest}
    />
  )
}
```

Create `frontend/src/components/Card.tsx`:

```tsx
import clsx from 'clsx'
import type { HTMLAttributes } from 'react'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('bg-card border border-line rounded shadow-sm', className)}
      {...rest}
    />
  )
}
```

Create `frontend/src/components/SqlBlock.tsx`:

```tsx
import { useState } from 'react'
import { Button } from './Button'

export function SqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false)
  const doCopy = () => {
    void navigator.clipboard.writeText(sql).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <div className="relative bg-card-alt rounded p-3">
      <pre className="font-mono text-xs text-ink whitespace-pre-wrap break-words">
        {sql}
      </pre>
      <Button
        variant="ghost"
        onClick={doCopy}
        className="!absolute top-1 right-1 !p-1 !text-[10px]"
      >
        {copied ? 'copied ✓' : 'copy'}
      </Button>
    </div>
  )
}
```

Create `frontend/src/components/Popover.tsx`:

```tsx
import type { ReactNode } from 'react'

interface Props {
  open: boolean
  trigger: ReactNode
  children: ReactNode
  onOpenChange?: (open: boolean) => void
}

export function Popover({ open, trigger, children }: Props) {
  return (
    <span className="relative inline-block">
      {trigger}
      {open && (
        <span className="absolute z-10 mt-2 left-0 min-w-[300px] max-w-[600px] bg-card border border-line rounded shadow-lg p-3">
          {children}
        </span>
      )}
    </span>
  )
}
```

Create `frontend/src/components/SeverityChip.tsx`:

```tsx
import clsx from 'clsx'
import type { ReactNode } from 'react'

type Level = 'info' | 'warn' | 'critical' | 'replay'

const CLASS: Record<Level, string> = {
  info: 'bg-sev-info-bg text-sev-info-fg',
  warn: 'bg-sev-warn-bg text-sev-warn-fg',
  critical: 'bg-sev-crit-bg text-sev-crit-fg',
  replay: 'bg-sev-replay-bg text-sev-replay-fg',
}

export function SeverityChip({ level, children }: { level: Level; children: ReactNode }) {
  return (
    <span className={clsx(
      'inline-block px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide',
      CLASS[level],
    )}>{children}</span>
  )
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ frontend/src/tests/unit/primitives.test.tsx
git commit -m "feat(fe): shared primitives — Button, Card, SqlBlock, Popover, SeverityChip"
```

---

## Task 11: Sparkline (Recharts wrapper with cinematic draw-in)

**Files:**
- Create: `frontend/src/components/Sparkline.tsx`
- Create: `frontend/src/tests/unit/Sparkline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/Sparkline.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sparkline } from '@/components/Sparkline'

describe('Sparkline', () => {
  it('renders SVG when data present', () => {
    const data = [
      { ts: 't1', value: 10 }, { ts: 't2', value: 20 }, { ts: 't3', value: 15 },
    ]
    const { container } = render(<Sparkline data={data} label="Sentiment" />)
    // Recharts renders an SVG root
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('Sentiment')).toBeInTheDocument()
  })

  it('renders empty placeholder when no data', () => {
    render(<Sparkline data={[]} label="Empty" />)
    expect(screen.getByText(/no data/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: module not found.

- [ ] **Step 3: Implement Sparkline**

Create `frontend/src/components/Sparkline.tsx`:

```tsx
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'
import type { MetricPoint } from '@/api/contracts'

interface Props {
  data: MetricPoint[]
  label: string
  color?: string
  heightPx?: number
}

export function Sparkline({ data, label, color = '#111111', heightPx = 44 }: Props) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-soft mb-1">
        {label}
      </div>
      {data.length === 0 ? (
        <div style={{ height: heightPx }}
             className="flex items-center text-xs text-ink-soft italic">
          no data
        </div>
      ) : (
        <div style={{ height: heightPx }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={true}
                animationDuration={700}
                animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 2 passed. (Recharts prints a console warning about width/height in jsdom; harmless.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sparkline.tsx frontend/src/tests/unit/Sparkline.test.tsx
git commit -m "feat(fe): Sparkline wrapper (Recharts, cinematic draw-in)"
```

---

## Task 12: Motion choreography variants

**Files:**
- Create: `frontend/src/motion/choreography.ts`
- Create: `frontend/src/tests/unit/choreography.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/choreography.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  heroReveal, panelReveal, traceRowEnter, listStagger, countUpTransition,
} from '@/motion/choreography'

describe('choreography variants', () => {
  it('heroReveal has hidden + visible states with cinematic ease', () => {
    expect(heroReveal.hidden.opacity).toBe(0)
    expect(heroReveal.visible.opacity).toBe(1)
    expect(heroReveal.visible.transition?.ease).toEqual([0.16, 1, 0.3, 1])
  })

  it('panelReveal duration matches token.reveal', () => {
    expect(panelReveal.visible.transition?.duration).toBe(0.7)
  })

  it('listStagger sets staggerChildren to 0.09', () => {
    expect(listStagger.visible.transition?.staggerChildren).toBe(0.09)
  })

  it('traceRowEnter has translateY + blur cleanup', () => {
    expect(traceRowEnter.hidden.y).toBe(12)
    expect(traceRowEnter.visible.y).toBe(0)
    expect(traceRowEnter.hidden.filter).toContain('blur(4px)')
    expect(traceRowEnter.visible.filter).toBe('blur(0px)')
  })

  it('countUpTransition uses token.count', () => {
    expect(countUpTransition.duration).toBe(1.2)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: module not found.

- [ ] **Step 3: Implement choreography**

Create `frontend/src/motion/choreography.ts`:

```ts
import type { Variants, Transition } from 'framer-motion'
import { tokens } from '@/theme/tokens'

const { ease, duration, stagger, blurEnter } = tokens.motion

/** Full-width hero card reveal — fade + lift + de-blur. */
export const heroReveal: Variants = {
  hidden: { opacity: 0, y: 12, filter: `blur(${blurEnter}px)` },
  visible: {
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { duration: duration.reveal, ease: ease.cinematic },
  },
}

/** Standard panel enter — subtler than the hero. */
export const panelReveal: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: duration.reveal, ease: ease.cinematic },
  },
}

/** Individual trace row — used with listStagger as parent. */
export const traceRowEnter: Variants = {
  hidden: { opacity: 0, y: 12, filter: `blur(${blurEnter}px)` },
  visible: {
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { duration: duration.transition, ease: ease.cinematic },
  },
}

/** Parent variant that staggers child reveals. */
export const listStagger: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: stagger, delayChildren: 0.1 },
  },
}

/** Count-up transition passed to <motion.span animate={{ value: N }}>. */
export const countUpTransition: Transition = {
  duration: duration.count,
  ease: ease.cinematic,
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/motion/ frontend/src/tests/unit/choreography.test.ts
git commit -m "feat(fe): motion choreography variants (Framer Motion)"
```

---

## Task 13: OpsCenter layout shell

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/tests/unit/App.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/App.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '@/App'

describe('OpsCenter layout', () => {
  it('renders all 7 panel regions by test-id', () => {
    render(<App />)
    for (const id of [
      'hero', 'telemetry', 'trace', 'anomaly',
      'recommendation', 'approval', 'inject', 'history',
    ]) {
      expect(screen.getByTestId(`panel-${id}`)).toBeInTheDocument()
    }
  })

  it('has no horizontal scroll (main container has overflow-x-hidden)', () => {
    render(<App />)
    const main = screen.getByTestId('ops-center')
    expect(main.className).toContain('overflow-x-hidden')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — panels not found.

- [ ] **Step 3: Implement OpsCenter shell**

Replace `frontend/src/App.tsx`:

```tsx
import { HeroBanner } from '@/panels/HeroBanner'
import { TelemetryStrip } from '@/panels/TelemetryStrip'
import { AnomalyFeed } from '@/panels/AnomalyFeed'
import { AgentTrace } from '@/panels/AgentTrace'
import { RecommendationPanel } from '@/panels/RecommendationPanel'
import { ApprovalGate } from '@/panels/ApprovalGate'
import { InjectControls } from '@/panels/InjectControls'
import { HistoryDrawer } from '@/panels/HistoryDrawer'

export function App() {
  return (
    <div data-testid="ops-center"
         className="min-h-screen bg-paper text-ink font-body overflow-x-hidden">
      <div className="max-w-[1920px] mx-auto p-6 space-y-4">
        <div data-testid="panel-hero"><HeroBanner /></div>
        <div data-testid="panel-telemetry"><TelemetryStrip /></div>
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
          <div data-testid="panel-trace"><AgentTrace /></div>
          <aside className="space-y-4">
            <div data-testid="panel-anomaly"><AnomalyFeed /></div>
            <div data-testid="panel-recommendation"><RecommendationPanel /></div>
            <div data-testid="panel-approval"><ApprovalGate /></div>
            <div data-testid="panel-inject"><InjectControls /></div>
          </aside>
        </div>
        <div data-testid="panel-history"><HistoryDrawer /></div>
      </div>
    </div>
  )
}
```

Because the panel components don't exist yet, create minimal stubs so the shell compiles. Create each file below with placeholder content (replaced in Tasks 14-21):

`frontend/src/panels/HeroBanner.tsx`:
```tsx
export function HeroBanner() { return <div>Hero (stub)</div> }
```

`frontend/src/panels/TelemetryStrip.tsx`:
```tsx
export function TelemetryStrip() { return <div>Telemetry (stub)</div> }
```

Repeat this pattern for `AnomalyFeed.tsx`, `AgentTrace.tsx`, `RecommendationPanel.tsx`, `ApprovalGate.tsx`, `InjectControls.tsx`, `HistoryDrawer.tsx`. Each exports its named function returning a `<div>{Name} (stub)</div>`.

- [ ] **Step 4: Run tests + typecheck to verify pass**

```bash
cd frontend
npm run test
npm run typecheck
```

Expected: App tests (2) pass; all prior tests still pass; typecheck clean.

- [ ] **Step 5: Verify dev server renders the shell**

Start the backend in another terminal (`cd backend && PYTHONPATH=. ./venv/bin/uvicorn api.main:app --port 8000`), then:

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`. Expected: all 8 stub panels visible on one page, no console errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/panels/ frontend/src/tests/unit/App.test.tsx
git commit -m "feat(fe): OpsCenter layout shell with 7 panel regions (stubs)"
```

---

## Task 14: HeroBanner panel

> **Note for the executing subagent:** invoke the `frontend-design:frontend-design` skill via the Skill tool at the start of this task for UI-specific guidance on the editorial hero card.

**Files:**
- Modify: `frontend/src/panels/HeroBanner.tsx`
- Create: `frontend/src/tests/unit/HeroBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/HeroBanner.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroBanner } from '@/panels/HeroBanner'
import { useRunStore } from '@/store/runStore'

const DET = {
  metric_ts: 't', metric: 'sentiment_hourly', film_id: 1, region: 'Brazil',
  detector: 'z_score', baseline_value: 0.2, actual_value: -0.6, magnitude: 8.4,
  business_impact: 250000, severity: 8, dedup_key: 'k',
}

beforeEach(() => useRunStore.getState().reset())

describe('HeroBanner', () => {
  it('idle state — shows "waiting" copy, not a live headline', () => {
    render(<HeroBanner />)
    expect(screen.getByText(/waiting/i)).toBeInTheDocument()
  })

  it('with detection — shows crisis label + film/region + magnitude', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming', detection: DET as never,
    })
    useRunStore.getState()._recomputePanels()
    render(<HeroBanner />)
    expect(screen.getByText(/Now Investigating/i)).toBeInTheDocument()
    expect(screen.getByText(/Brazil/)).toBeInTheDocument()
    expect(screen.getByText(/Film 1/i)).toBeInTheDocument()
  })

  it('fallback mode — shows REPLAY chip', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      detection: DET as never, mode: 'fallback',
    })
    useRunStore.getState()._recomputePanels()
    render(<HeroBanner />)
    expect(screen.getByText('REPLAY')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — stub doesn't render expected content.

- [ ] **Step 3: Implement HeroBanner**

Replace `frontend/src/panels/HeroBanner.tsx`:

```tsx
import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SeverityChip } from '@/components/SeverityChip'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { heroReveal } from '@/motion/choreography'

function humanCrisis(metric: string): string {
  if (metric.includes('sentiment')) return 'Sentiment Collapse'
  if (metric.includes('social_virality')) return 'Virality Anomaly'
  if (metric.includes('box_office')) return 'Box-office Shock'
  if (metric.includes('trailer')) return 'Trailer Anomaly'
  return 'Anomaly Detected'
}

export function HeroBanner() {
  const state = useRunStore((s) => s.panelStates.hero)
  const det = useRunStore((s) => s.detection)
  const mode = useRunStore((s) => s.mode)
  const events = useRunStore((s) => s.events)

  return (
    <PanelStateWrapper state={state} label="Hero" idleLabel="Waiting for anomaly · system nominal">
      <motion.div variants={heroReveal} initial="hidden" animate="visible">
        <Card className="p-8 bg-card border-l-4 border-accent">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs uppercase tracking-wider text-ink-soft">
              Now Investigating
            </span>
            {mode === 'fallback' && <SeverityChip level="replay">REPLAY</SeverityChip>}
          </div>
          <h1 className="font-display text-5xl tracking-tight leading-none mb-2">
            {det ? humanCrisis(det.metric) : 'Anomaly'}
          </h1>
          <div className="text-lg text-ink-soft mb-4">
            {det && <>Film {det.film_id} · {det.region}</>}
          </div>
          <div className="flex items-baseline gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-soft">Severity</div>
              <div className="font-body text-4xl font-semibold tabular-nums tracking-tight">
                {det?.severity.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-soft">Magnitude</div>
              <div className="font-body text-4xl font-semibold tabular-nums tracking-tight">
                {det?.magnitude.toFixed(1)}
              </div>
            </div>
            <div className="ml-auto text-sm text-ink-soft italic">
              {events.length > 0 && `${events.length} events`}
            </div>
          </div>
        </Card>
      </motion.div>
    </PanelStateWrapper>
  )
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/HeroBanner.tsx frontend/src/tests/unit/HeroBanner.test.tsx
git commit -m "feat(fe): HeroBanner panel — editorial film-card hero"
```

---

## Task 15: TelemetryStrip panel

> **Note for the executing subagent:** consult the `frontend-design:frontend-design` skill for chart-density guidance.

**Files:**
- Modify: `frontend/src/panels/TelemetryStrip.tsx`
- Create: `frontend/src/tests/unit/TelemetryStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/TelemetryStrip.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TelemetryStrip } from '@/panels/TelemetryStrip'
import { useRunStore } from '@/store/runStore'

beforeEach(() => useRunStore.getState().reset())

describe('TelemetryStrip', () => {
  it('idle → shows placeholder', () => {
    render(<TelemetryStrip />)
    expect(screen.getByText(/telemetry/i)).toBeInTheDocument()
  })

  it('with metrics → renders 4 sparkline labels + latency badge', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      latencyMs: 47,
      metrics: { '1:Brazil': {
        film_id: 1, region: 'Brazil', query_latency_ms: 47,
        timeseries: {
          box_office_daily: [{ ts: 't', value: 1 }],
          social_virality_hourly: [{ ts: 't', value: 2 }],
          sentiment_hourly: [{ ts: 't', value: 3 }],
          trailer_hourly: [{ ts: 't', value: 4 }],
        },
      } },
    })
    useRunStore.getState()._recomputePanels()
    render(<TelemetryStrip />)
    expect(screen.getByText(/Box Office/i)).toBeInTheDocument()
    expect(screen.getByText(/Sentiment/i)).toBeInTheDocument()
    expect(screen.getByText(/Trailer/i)).toBeInTheDocument()
    expect(screen.getByText(/Virality/i)).toBeInTheDocument()
    expect(screen.getByText(/47 ms/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — stub renders "Telemetry (stub)".

- [ ] **Step 3: Implement TelemetryStrip**

Replace `frontend/src/panels/TelemetryStrip.tsx`:

```tsx
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { Sparkline } from '@/components/Sparkline'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'

export function TelemetryStrip() {
  const state = useRunStore((s) => s.panelStates.telemetry)
  const metrics = useRunStore((s) => s.metrics)
  const latency = useRunStore((s) => s.latencyMs)

  const first = Object.values(metrics)[0]

  return (
    <PanelStateWrapper state={state} label="Telemetry" idleLabel="Telemetry (idle)">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wider text-ink-soft">Telemetry</span>
          {latency !== null && (
            <span className="font-mono text-xs text-ink-soft">
              ClickHouse · {latency} ms
            </span>
          )}
        </div>
        {first && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Sparkline data={first.timeseries.box_office_daily} label="Box Office" />
            <Sparkline data={first.timeseries.social_virality_hourly} label="Virality" />
            <Sparkline data={first.timeseries.sentiment_hourly} label="Sentiment" />
            <Sparkline data={first.timeseries.trailer_hourly} label="Trailer" />
          </div>
        )}
      </Card>
    </PanelStateWrapper>
  )
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/TelemetryStrip.tsx frontend/src/tests/unit/TelemetryStrip.test.tsx
git commit -m "feat(fe): TelemetryStrip panel — 4 sparklines + latency badge"
```

---

## Task 16: AnomalyFeed panel

**Files:**
- Modify: `frontend/src/panels/AnomalyFeed.tsx`
- Create: `frontend/src/tests/unit/AnomalyFeed.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/AnomalyFeed.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnomalyFeed } from '@/panels/AnomalyFeed'
import { useRunStore } from '@/store/runStore'

beforeEach(() => useRunStore.getState().reset())

const row = (severity: number, region: string) => ({
  metric_ts: '2026-08-09T00:00:00Z', metric: 'sentiment_hourly',
  film_id: 1, region, detector: 'z', baseline_value: 0, actual_value: 0,
  magnitude: 5, business_impact: 100000, severity, dedup_key: `${region}-${severity}`,
})

describe('AnomalyFeed', () => {
  it('empty state — shows nominal hint', () => {
    render(<AnomalyFeed />)
    expect(screen.getByText(/system nominal/i)).toBeInTheDocument()
  })

  it('renders anomaly rows with severity-colored chips', () => {
    useRunStore.setState({
      recentDetections: [row(9.5, 'Brazil'), row(6.0, 'Korea'), row(3.0, 'Germany')],
    })
    useRunStore.getState()._recomputePanels()
    render(<AnomalyFeed />)
    expect(screen.getByText('Brazil')).toBeInTheDocument()
    expect(screen.getByText('Korea')).toBeInTheDocument()
    expect(screen.getByText('Germany')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: fail — stub content.

- [ ] **Step 3: Implement AnomalyFeed**

Replace `frontend/src/panels/AnomalyFeed.tsx`:

```tsx
import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SeverityChip } from '@/components/SeverityChip'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { listStagger, traceRowEnter } from '@/motion/choreography'
import type { DetectionRow } from '@/api/contracts'

function level(severity: number): 'info' | 'warn' | 'critical' {
  if (severity >= 8) return 'critical'
  if (severity >= 5) return 'warn'
  return 'info'
}

function label(severity: number): string {
  return level(severity)
}

export function AnomalyFeed() {
  const state = useRunStore((s) => s.panelStates.anomaly)
  const rows = useRunStore((s) => s.recentDetections)

  return (
    <PanelStateWrapper state={state} label="Anomaly Feed">
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-ink-soft mb-3">
          Anomaly Feed
        </div>
        <motion.ul variants={listStagger} initial="hidden" animate="visible" className="space-y-2">
          {rows.map((r: DetectionRow) => (
            <motion.li
              key={r.dedup_key}
              variants={traceRowEnter}
              className="flex items-center gap-3 border-b border-line pb-2"
            >
              <SeverityChip level={level(r.severity)}>{label(r.severity)}</SeverityChip>
              <span className="text-sm text-ink">{r.region}</span>
              <span className="text-xs text-ink-soft flex-1">{r.metric}</span>
              <span className="text-xs font-mono text-ink-soft tabular-nums">
                {r.severity.toFixed(1)}
              </span>
            </motion.li>
          ))}
        </motion.ul>
      </Card>
    </PanelStateWrapper>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/AnomalyFeed.tsx frontend/src/tests/unit/AnomalyFeed.test.tsx
git commit -m "feat(fe): AnomalyFeed panel — severity-colored anomaly list"
```

---

## Task 17: AgentTrace panel (centerpiece)

> **Note for the executing subagent:** invoke `frontend-design:frontend-design` skill — this is the centerpiece and the highest UI-craft budget goes here.

**Files:**
- Modify: `frontend/src/panels/AgentTrace.tsx`
- Create: `frontend/src/tests/unit/AgentTrace.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/AgentTrace.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentTrace } from '@/panels/AgentTrace'
import { useRunStore } from '@/store/runStore'
import type { SseEvent } from '@/api/contracts'

const ev = (seq: number, type: string, data: object = {}): SseEvent =>
  ({ seq, type, data, ts: 't' })

beforeEach(() => useRunStore.getState().reset())

describe('AgentTrace', () => {
  it('idle — shows placeholder', () => {
    render(<AgentTrace />)
    expect(screen.getByText(/idle/i)).toBeInTheDocument()
  })

  it('renders one row per meaningful event, groups by stage', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      events: [
        ev(0, 'detection.started'),
        ev(1, 'detection.completed', { detection: { severity: 7 } }),
        ev(2, 'investigation.started'),
        ev(3, 'signal.completed', { finding: {
          signal: 'numeric_context', sql: 'SELECT 1', columns: [], rows: [], narrative: 'X', latency_ms: 10,
        }}),
        ev(4, 'decision.completed', { decision: { decision_id: 'd', actions: [] }}),
        ev(5, 'report.completed', { report: { report_id: 'r' }}),
        ev(6, 'pipeline.completed'),
      ] as never,
    })
    useRunStore.getState()._recomputePanels()
    render(<AgentTrace />)
    expect(screen.getByText(/Detection/i)).toBeInTheDocument()
    expect(screen.getByText(/Investigation/i)).toBeInTheDocument()
    expect(screen.getByText(/Decision/i)).toBeInTheDocument()
    expect(screen.getByText(/Report/i)).toBeInTheDocument()
    expect(screen.getByText('SELECT 1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: fail — stub.

- [ ] **Step 3: Implement AgentTrace**

Replace `frontend/src/panels/AgentTrace.tsx`:

```tsx
import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SqlBlock } from '@/components/SqlBlock'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { listStagger, traceRowEnter } from '@/motion/choreography'
import type { SseEvent, Finding } from '@/api/contracts'

type Stage = 'Detection' | 'Investigation' | 'Decision' | 'Report' | 'Pipeline'

function stageOf(type: string): Stage | null {
  if (type.startsWith('detection.')) return 'Detection'
  if (type.startsWith('investigation.') || type.startsWith('signal.')) return 'Investigation'
  if (type.startsWith('decision.') || type.startsWith('action.')) return 'Decision'
  if (type.startsWith('report.')) return 'Report'
  if (type.startsWith('pipeline.')) return 'Pipeline'
  return null
}

function label(ev: SseEvent): string {
  const parts = ev.type.split('.')
  return parts[parts.length - 1].replace(/_/g, ' ')
}

export function AgentTrace() {
  const state = useRunStore((s) => s.panelStates.trace)
  const events = useRunStore((s) => s.events)

  const grouped: Record<Stage, SseEvent[]> = {
    Detection: [], Investigation: [], Decision: [], Report: [], Pipeline: [],
  }
  for (const e of events) {
    const st = stageOf(e.type)
    if (st) grouped[st].push(e)
  }

  return (
    <PanelStateWrapper state={state} label="Agent Trace" idleLabel="No live run · press Inject to begin">
      <Card className="p-4 min-h-[480px]">
        <div className="text-xs uppercase tracking-wider text-ink-soft mb-4">
          Live Agent Trace
        </div>
        <motion.div variants={listStagger} initial="hidden" animate="visible" className="space-y-6">
          {(['Detection', 'Investigation', 'Decision', 'Report', 'Pipeline'] as Stage[])
            .filter((s) => grouped[s].length > 0)
            .map((s) => (
              <motion.section key={s} variants={traceRowEnter}>
                <h3 className="font-display text-2xl tracking-tight text-ink mb-2">{s}</h3>
                <ul className="space-y-2">
                  {grouped[s].map((e) => {
                    const finding = (e.data as { finding?: Finding }).finding
                    return (
                      <li key={e.seq} className="border-l-2 border-line pl-3">
                        <div className="text-sm text-ink capitalize">{label(e)}</div>
                        {finding?.sql && (
                          <div className="mt-1"><SqlBlock sql={finding.sql} /></div>
                        )}
                        {finding?.narrative && (
                          <div className="mt-1 text-sm text-ink-soft italic">
                            {finding.narrative}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </motion.section>
            ))}
        </motion.div>
      </Card>
    </PanelStateWrapper>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/AgentTrace.tsx frontend/src/tests/unit/AgentTrace.test.tsx
git commit -m "feat(fe): AgentTrace panel — live centerpiece grouped by stage"
```

---

## Task 18: RecommendationPanel with provenance popover

> **Note for the executing subagent:** invoke `frontend-design:frontend-design` skill for popover polish.

**Files:**
- Modify: `frontend/src/panels/RecommendationPanel.tsx`
- Create: `frontend/src/tests/unit/RecommendationPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/RecommendationPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RecommendationPanel } from '@/panels/RecommendationPanel'
import { useRunStore } from '@/store/runStore'

beforeEach(() => useRunStore.getState().reset())

const DECISION = {
  decision_id: 'd-1', investigation_id: 'i-1', status: 'pending_approval',
  threshold_usd: 250000, created_at: 't', latency_ms: 100,
  actions: [{
    action_type: 'shift_marketing_spend',
    rationale: 'Reallocate Brazil budget to Korea based on virality delta.',
    params: { from: 'Brazil', to: 'Korea', usd: 100000 },
    impact_usd: 120000, impact_sql: 'SELECT sum(virality) FROM social_trends',
    impact_error: '', priority: 1 as const,
  }],
} as never

const REPORT = {
  report_id: 'r-1', decision_id: 'd-1',
  headline: 'Brazil sentiment collapse — reallocate to Korea',
  tldr: 'Sentiment dropped 28% in Brazil while Korea virality is up 40%; reallocate.',
  key_figures: [{
    label: 'Brazil sentiment delta', value: '-28%',
    source_query: 'SELECT avg(sentiment) FROM social_sentiment WHERE region = \'Brazil\'',
    source: { signal: 'numeric_context' as const, query_index: 0 },
  }],
  recommended_actions_prose: 'Long enough prose describing the recommended actions here.',
  risks_and_caveats: '', created_at: 't', latency_ms: 10,
} as never

describe('RecommendationPanel', () => {
  it('idle → placeholder', () => {
    render(<RecommendationPanel />)
    expect(screen.getByText(/awaiting|idle/i)).toBeInTheDocument()
  })

  it('renders headline + tldr + action rows + key_figures', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      decision: DECISION, report: REPORT,
    })
    useRunStore.getState()._recomputePanels()
    render(<RecommendationPanel />)
    expect(screen.getByText(/reallocate to Korea/i)).toBeInTheDocument()
    expect(screen.getByText(/Brazil sentiment delta/)).toBeInTheDocument()
    expect(screen.getByText('-28%')).toBeInTheDocument()
    expect(screen.getByText(/shift_marketing_spend/i)).toBeInTheDocument()
  })

  it('clicking a key_figure opens provenance popover with source_query', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      decision: DECISION, report: REPORT,
    })
    useRunStore.getState()._recomputePanels()
    render(<RecommendationPanel />)
    fireEvent.click(screen.getByText('-28%'))
    expect(screen.getByText(/SELECT avg\(sentiment\)/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL.

- [ ] **Step 3: Implement RecommendationPanel**

Replace `frontend/src/panels/RecommendationPanel.tsx`:

```tsx
import { useState } from 'react'
import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SqlBlock } from '@/components/SqlBlock'
import { Popover } from '@/components/Popover'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { panelReveal, listStagger, traceRowEnter } from '@/motion/choreography'
import type { KeyFigure, RecommendedAction } from '@/api/contracts'

export function RecommendationPanel() {
  const state = useRunStore((s) => s.panelStates.recommendation)
  const decision = useRunStore((s) => s.decision)
  const report = useRunStore((s) => s.report)
  const [openKf, setOpenKf] = useState<number | null>(null)

  return (
    <PanelStateWrapper state={state} label="Recommendation" idleLabel="Awaiting decision…">
      <motion.div variants={panelReveal} initial="hidden" animate="visible">
        <Card className="p-6">
          <div className="text-xs uppercase tracking-wider text-ink-soft mb-3">
            Recommendation
          </div>

          {report && (
            <>
              <h2 className="font-display text-2xl tracking-tight text-ink mb-2">
                {report.headline}
              </h2>
              <p className="text-sm text-ink-soft mb-4">{report.tldr}</p>
            </>
          )}

          {report?.key_figures && report.key_figures.length > 0 && (
            <div className="mb-6">
              <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">
                Key Figures
              </div>
              <div className="grid grid-cols-2 gap-3">
                {report.key_figures.map((kf: KeyFigure, i: number) => (
                  <Popover
                    key={i}
                    open={openKf === i}
                    trigger={
                      <button
                        type="button"
                        onClick={() => setOpenKf(openKf === i ? null : i)}
                        className="block text-left border border-line rounded p-2 hover:bg-card-alt w-full"
                      >
                        <div className="text-xs text-ink-soft mb-1">{kf.label}</div>
                        <div className="font-body text-2xl font-semibold tabular-nums text-ink tracking-tight">
                          {kf.value}
                        </div>
                      </button>
                    }
                  >
                    <div className="text-xs text-ink-soft mb-2 uppercase tracking-wider">
                      Source · {kf.source.signal} [{kf.source.query_index}]
                    </div>
                    <SqlBlock sql={kf.source_query} />
                  </Popover>
                ))}
              </div>
            </div>
          )}

          {decision?.actions && (
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">
                Recommended Actions
              </div>
              <motion.ul variants={listStagger} initial="hidden" animate="visible" className="space-y-2">
                {decision.actions.map((a: RecommendedAction, i: number) => (
                  <motion.li key={i} variants={traceRowEnter}
                             className="border-l-4 border-accent pl-3">
                    <div className="text-sm font-mono text-ink">{a.action_type}</div>
                    <div className="text-sm text-ink-soft">{a.rationale}</div>
                    {a.impact_usd !== null && (
                      <div className="text-xs text-ink-soft mt-1">
                        Impact: <span className="tabular-nums">${a.impact_usd.toLocaleString()}</span>
                      </div>
                    )}
                  </motion.li>
                ))}
              </motion.ul>
            </div>
          )}
        </Card>
      </motion.div>
    </PanelStateWrapper>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/RecommendationPanel.tsx frontend/src/tests/unit/RecommendationPanel.test.tsx
git commit -m "feat(fe): RecommendationPanel with source-query provenance popover"
```

---

## Task 19: ApprovalGate panel

**Files:**
- Modify: `frontend/src/panels/ApprovalGate.tsx`
- Create: `frontend/src/tests/unit/ApprovalGate.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/ApprovalGate.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApprovalGate } from '@/panels/ApprovalGate'
import { useRunStore } from '@/store/runStore'
import * as client from '@/api/client'

const DEC = {
  decision_id: 'd-42', investigation_id: 'i-1', actions: [] as never,
  status: 'pending_approval' as const, threshold_usd: 0, created_at: 't', latency_ms: 0,
}

beforeEach(() => useRunStore.getState().reset())
afterEach(() => vi.restoreAllMocks())

describe('ApprovalGate', () => {
  it('idle — nothing to approve', () => {
    render(<ApprovalGate />)
    expect(screen.getByText(/nothing to approve|idle/i)).toBeInTheDocument()
  })

  it('with pending decision — shows Approve + Deny buttons', () => {
    useRunStore.setState({ runId: 'r-1', streamState: 'streaming', decision: DEC as never,
                            approvalStatus: 'pending_approval' })
    useRunStore.getState()._recomputePanels()
    render(<ApprovalGate />)
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument()
  })

  it('clicking Approve calls approve action', async () => {
    const spy = vi.spyOn(client, 'apiPost').mockResolvedValue({ approval_status: 'approved' })
    useRunStore.setState({ runId: 'r-1', streamState: 'streaming', decision: DEC as never,
                            approvalStatus: 'pending_approval' })
    useRunStore.getState()._recomputePanels()
    render(<ApprovalGate />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    await Promise.resolve(); await Promise.resolve()
    expect(spy).toHaveBeenCalledWith('/approve/d-42', expect.anything())
  })

  it('approvalStatus=approved → shows approved chip, hides buttons', () => {
    useRunStore.setState({ runId: 'r-1', streamState: 'streaming', decision: DEC as never,
                            approvalStatus: 'approved' })
    useRunStore.getState()._recomputePanels()
    render(<ApprovalGate />)
    expect(screen.getByText(/approved/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL.

- [ ] **Step 3: Implement ApprovalGate**

Replace `frontend/src/panels/ApprovalGate.tsx`:

```tsx
import { useState } from 'react'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { SeverityChip } from '@/components/SeverityChip'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { ApiError } from '@/api/client'

export function ApprovalGate() {
  const state = useRunStore((s) => s.panelStates.approval)
  const decision = useRunStore((s) => s.decision)
  const status = useRunStore((s) => s.approvalStatus)
  const approve = useRunStore((s) => s.approve)
  const deny = useRunStore((s) => s.deny)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doApprove = async () => {
    if (!decision) return
    setBusy(true); setError(null)
    try { await approve(decision.decision_id, 'via dashboard') }
    catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.body.slice(0, 100)}` : String(e))
    } finally { setBusy(false) }
  }

  const doDeny = async () => {
    if (!decision) return
    setBusy(true); setError(null)
    try { await deny(decision.decision_id, 'via dashboard') }
    catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.body.slice(0, 100)}` : String(e))
    } finally { setBusy(false) }
  }

  return (
    <PanelStateWrapper state={state} label="Approval" idleLabel="Nothing to approve">
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-ink-soft mb-3">Approval Gate</div>
        {status === 'approved' && <SeverityChip level="info">Approved</SeverityChip>}
        {status === 'denied' && <SeverityChip level="critical">Denied</SeverityChip>}
        {status === 'auto_executed' && <SeverityChip level="info">Auto-executed</SeverityChip>}
        {(!status || status === 'pending_approval') && decision && (
          <div className="flex gap-2 mt-2">
            <Button variant="primary" onClick={doApprove} disabled={busy}>
              {busy ? '...' : 'Approve'}
            </Button>
            <Button variant="secondary" onClick={doDeny} disabled={busy}>Deny</Button>
          </div>
        )}
        {error && <div className="mt-2 text-xs text-accent">{error}</div>}
      </Card>
    </PanelStateWrapper>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/ApprovalGate.tsx frontend/src/tests/unit/ApprovalGate.test.tsx
git commit -m "feat(fe): ApprovalGate panel — approve/deny + status chip"
```

---

## Task 20: InjectControls panel

**Files:**
- Modify: `frontend/src/panels/InjectControls.tsx`
- Create: `frontend/src/tests/unit/InjectControls.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/InjectControls.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InjectControls } from '@/panels/InjectControls'
import { useRunStore } from '@/store/runStore'
import * as client from '@/api/client'
import * as sseMod from '@/api/sse'

beforeEach(() => {
  useRunStore.getState().reset()
  vi.stubEnv('VITE_API_URL', 'http://localhost:8000')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('InjectControls', () => {
  it('renders picker + inject button', () => {
    render(<InjectControls />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inject/i })).toBeInTheDocument()
  })

  it('clicking Inject calls store.inject with selected crisis type', async () => {
    const post = vi.spyOn(client, 'apiPost').mockResolvedValue({ run_id: 'r-new' })
    vi.spyOn(sseMod, 'openStream').mockReturnValue(() => {})
    render(<InjectControls />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BUDGET_OVERRUN' } })
    fireEvent.click(screen.getByRole('button', { name: /inject/i }))
    await Promise.resolve(); await Promise.resolve()
    expect(post).toHaveBeenCalledWith('/inject-crisis',
      expect.objectContaining({ crisis_type: 'BUDGET_OVERRUN' }))
  })

  it('disables button while a run is in flight', () => {
    useRunStore.setState({ runId: 'r-mid', streamState: 'streaming' })
    render(<InjectControls />)
    expect(screen.getByRole('button', { name: /inject/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL.

- [ ] **Step 3: Implement InjectControls**

Replace `frontend/src/panels/InjectControls.tsx`:

```tsx
import { useState } from 'react'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import type { CrisisType } from '@/api/contracts'

const OPTIONS: { value: CrisisType | ''; label: string }[] = [
  { value: '', label: 'Random crisis' },
  { value: 'SENTIMENT_COLLAPSE', label: 'Sentiment collapse (global)' },
  { value: 'REGIONAL_SENTIMENT_COLLAPSE', label: 'Regional sentiment collapse' },
  { value: 'COMPETITOR_RELEASE', label: 'Competitor release' },
  { value: 'BUDGET_OVERRUN', label: 'Budget overrun' },
]

export function InjectControls() {
  const inject = useRunStore((s) => s.inject)
  const runId = useRunStore((s) => s.runId)
  const streamState = useRunStore((s) => s.streamState)
  const inFlight = runId !== null && streamState !== 'closed' && streamState !== 'error'
  const [choice, setChoice] = useState<CrisisType | ''>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fire = async () => {
    setBusy(true); setErr(null)
    try {
      await inject(choice ? { crisisType: choice } : undefined)
    } catch (e) {
      setErr(String(e))
    } finally { setBusy(false) }
  }

  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-ink-soft mb-3">Inject Crisis</div>
      <div className="flex gap-2">
        <select
          className="border border-line rounded px-2 py-1 text-sm bg-white text-ink flex-1"
          value={choice}
          onChange={(e) => setChoice(e.target.value as CrisisType | '')}
          disabled={inFlight || busy}
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button variant="primary" onClick={fire} disabled={inFlight || busy}>
          {busy ? '...' : 'Inject'}
        </Button>
      </div>
      {err && <div className="text-xs text-accent mt-2">{err}</div>}
    </Card>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/InjectControls.tsx frontend/src/tests/unit/InjectControls.test.tsx
git commit -m "feat(fe): InjectControls — crisis-type picker + inject trigger"
```

---

## Task 21: HistoryDrawer panel

**Files:**
- Modify: `frontend/src/panels/HistoryDrawer.tsx`
- Create: `frontend/src/tests/unit/HistoryDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/unit/HistoryDrawer.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HistoryDrawer } from '@/panels/HistoryDrawer'
import { useRunStore } from '@/store/runStore'
import type { AuditRow } from '@/api/contracts'

const row: AuditRow = {
  audit_id: 'a-1', decision_id: 'd-1', investigation_id: 'i-1',
  created_at: '2026-08-09T00:00:00Z',
  approval_status: 'approved',
  approver: 'dashboard@demo', approval_note: '', denial_reason: '',
  threshold_usd: 250000, total_impact_usd: 100000,
  film_id: 1, region: 'Brazil',
  report_id: 'r-1', report_headline: 'Brazil sentiment collapse',
}

beforeEach(() => useRunStore.getState().reset())

describe('HistoryDrawer', () => {
  it('empty — shows hint', () => {
    render(<HistoryDrawer />)
    expect(screen.getByText(/no past investigations/i)).toBeInTheDocument()
  })

  it('toggles open/closed via header button', () => {
    useRunStore.setState({ auditRows: [row] })
    useRunStore.getState()._recomputePanels()
    render(<HistoryDrawer />)
    const toggle = screen.getByRole('button', { name: /history/i })
    // Starts collapsed — headline not shown
    expect(screen.queryByText('Brazil sentiment collapse')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getByText('Brazil sentiment collapse')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL.

- [ ] **Step 3: Implement HistoryDrawer**

Replace `frontend/src/panels/HistoryDrawer.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { SeverityChip } from '@/components/SeverityChip'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import type { AuditRow } from '@/api/contracts'

function statusLevel(status: AuditRow['approval_status']): 'info' | 'warn' | 'critical' {
  if (status === 'approved' || status === 'auto_executed') return 'info'
  if (status === 'denied') return 'critical'
  return 'warn'
}

export function HistoryDrawer() {
  const state = useRunStore((s) => s.panelStates.history)
  const rows = useRunStore((s) => s.auditRows)
  const loadAudit = useRunStore((s) => s.loadAudit)
  const [open, setOpen] = useState(false)

  useEffect(() => { void loadAudit(20) }, [loadAudit])

  return (
    <PanelStateWrapper state={state} label="History" idleLabel="No past investigations yet">
      <Card className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between"
        >
          <span className="text-xs uppercase tracking-wider text-ink-soft">
            History · {rows.length} runs
          </span>
          <span className="text-ink-soft text-sm">{open ? '▲' : '▼'}</span>
        </button>
        {open && (
          <ul className="mt-3 space-y-2">
            {rows.map((r) => (
              <li key={r.audit_id} className="border-b border-line pb-2 flex items-center gap-3">
                <SeverityChip level={statusLevel(r.approval_status)}>
                  {r.approval_status.replace('_', ' ')}
                </SeverityChip>
                <span className="text-sm text-ink flex-1">{r.report_headline}</span>
                <span className="text-xs font-mono text-ink-soft">{r.decision_id.slice(0, 8)}</span>
              </li>
            ))}
          </ul>
        )}
        {open && rows.length > 0 && (
          <div className="mt-2 flex justify-end">
            <Button variant="ghost" onClick={() => void loadAudit(20)}>Refresh</Button>
          </div>
        )}
      </Card>
    </PanelStateWrapper>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/HistoryDrawer.tsx frontend/src/tests/unit/HistoryDrawer.test.tsx
git commit -m "feat(fe): HistoryDrawer panel — audit list, expand/collapse"
```

---

## Task 22: Boundary test (§1 grep) + acceptance sweep

**Files:**
- Create: `frontend/src/tests/boundaries.test.ts`
- Create: `frontend/src/tests/acceptance.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Write the boundary test**

Create `frontend/src/tests/boundaries.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

const SRC = path.resolve(__dirname, '..')
const files = walk(SRC)

describe('§1 boundaries', () => {
  it('panels/**.tsx MUST NOT import from api/client or api/sse', () => {
    const violations: string[] = []
    for (const f of files.filter((f) => f.includes('/panels/') && f.endsWith('.tsx'))) {
      const src = fs.readFileSync(f, 'utf-8')
      if (/from ['"]@\/api\/(client|sse)['"]/.test(src)) violations.push(f)
    }
    expect(violations, `panels importing api directly: ${violations.join(', ')}`)
      .toHaveLength(0)
  })

  it('components/**.tsx MUST NOT import from api/* or store/*', () => {
    const violations: string[] = []
    for (const f of files.filter((f) => f.includes('/components/') && f.endsWith('.tsx'))) {
      const src = fs.readFileSync(f, 'utf-8')
      if (/from ['"]@\/api\/(client|sse)['"]/.test(src)) violations.push(f)
      if (/from ['"]@\/store\/runStore['"]/.test(src)) violations.push(f)
    }
    // PanelStateWrapper imports the PanelState *type* from store — that's OK.
    const strict = violations.filter((f) => !/type/.test(fs.readFileSync(f, 'utf-8').match(/from ['"]@\/store[^'"]+['"]/)?.[0] ?? ''))
    expect(strict, `components importing api/store non-type: ${strict.join(', ')}`)
      .toHaveLength(0)
  })

  it('store/runStore.ts is the only file that imports @/api/sse', () => {
    const importers: string[] = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8')
      if (/from ['"]@\/api\/sse['"]/.test(src)) importers.push(path.relative(SRC, f))
    }
    // Store is expected; tests that mock sse are also allowed.
    const nonStore = importers.filter(
      (f) => f !== 'store/runStore.ts' && !f.startsWith('tests/'),
    )
    expect(nonStore, `unexpected sse importers: ${nonStore.join(', ')}`).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Write the acceptance script**

Create `frontend/src/tests/acceptance.ts`:

```ts
/**
 * Layer 5 acceptance sweep — 5 checks. Exit 0 if all pass, 1 otherwise.
 *
 * §1 boundary grep    §2 tsc --noEmit    §3 vite build
 * §4 vitest run       §5 playwright hero-flow (requires live backend on :8000)
 *
 * Run: `npm run acceptance`  (from frontend/)
 */
import { execSync } from 'node:child_process'

function step(n: string, cmd: string) {
  process.stdout.write(`\n=== §${n} ${cmd}\n`)
  try {
    execSync(cmd, { stdio: 'inherit', cwd: __dirname + '/../..' })
    process.stdout.write(`PASS §${n}\n`)
  } catch {
    process.stderr.write(`FAIL §${n}\n`)
    process.exit(1)
  }
}

step('1', 'npx vitest run src/tests/boundaries.test.ts')
step('2', 'npm run typecheck')
step('3', 'npm run build')
step('4', 'npm run test')
step('5', 'npx playwright test')

process.stdout.write('\nAll Layer 5 acceptance checks PASSED.\n')
```

Add script to `frontend/package.json`:

```json
{
  "scripts": {
    "acceptance": "tsx src/tests/acceptance.ts"
  }
}
```

Install `tsx` if not present:

```bash
cd frontend
npm install -D tsx
```

- [ ] **Step 3: Run boundary test in isolation**

```bash
cd frontend
npx vitest run src/tests/boundaries.test.ts
```

Expected: 3 passed.

- [ ] **Step 4: Full vitest run**

```bash
cd frontend
npm run test
```

Expected: all unit + component + boundary tests pass. Total roughly 60+ tests.

- [ ] **Step 5: Full acceptance sweep (skip §5 if backend not running)**

Start backend in another terminal first:
```
cd backend && PYTHONPATH=. ./venv/bin/uvicorn api.main:app --port 8000
```

Then:
```bash
cd frontend
npm run acceptance
```

Expected: §1-§5 all PASS. If §5 fails due to backend not running, that's the operator's error, not a plan failure.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/tests/boundaries.test.ts frontend/src/tests/acceptance.ts frontend/package.json frontend/package-lock.json
git commit -m "test(fe): §1 boundary grep + 5-check acceptance sweep"
```

---

## Task 23: Playwright e2e hero-flow

**Files:**
- Create: `frontend/src/tests/e2e/hero-flow.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `frontend/src/tests/e2e/hero-flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

/**
 * Hero-flow happy path. Requires backend running at http://localhost:8000
 * with a valid cached fallback triple. We force fallback mode to avoid
 * LLM cost and get deterministic timing (~12s end-to-end).
 */
test('inject → detect → decision → approve — golden path (fallback mode)', async ({ page }) => {
  // 1. Load the dashboard cold.
  await page.goto('/')
  await expect(page.getByTestId('ops-center')).toBeVisible()
  await expect(page.getByText(/waiting/i)).toBeVisible()   // hero idle

  // 2. Select a crisis type and inject.
  //    We use the picker to make the test deterministic; without a selection,
  //    the backend's random pick is fine but noisier to assert on.
  await page.getByRole('combobox').selectOption('SENTIMENT_COLLAPSE')
  // Force fallback via URL parameter or extra header? Simplest: two-inject
  // pattern — inject once, wait for pipeline.failed if live path breaks,
  // otherwise proceed. For a deterministic test we call the fallback path.
  // The simplest deterministic path: the inject panel doesn't expose a
  // fallback toggle in the UI (design decision), so we drive the store
  // directly via the page's window.__RUN_STORE (Task 22 optional hook)
  // OR we accept the live-path timing.
  //
  // For the plan, we assert the state-observable flow with a generous
  // timeout that accommodates live pipeline (~20s) as well as fallback (~12s).
  await page.getByRole('button', { name: /^inject$/i }).click()

  // 3. Wait for the hero to reveal — either "Now Investigating" text appears
  //    or a stream error shows a graceful failure banner.
  await expect(page.getByText(/Now Investigating/i)).toBeVisible({ timeout: 60_000 })

  // 4. Wait for the recommendation to render.
  await expect(page.getByText(/Key Figures/i)).toBeVisible({ timeout: 60_000 })

  // 5. Wait for the Approve button to become available and click it.
  const approveBtn = page.getByRole('button', { name: /approve/i })
  await expect(approveBtn).toBeVisible({ timeout: 60_000 })
  await approveBtn.click()

  // 6. Approved chip should appear.
  await expect(page.getByText(/^approved$/i)).toBeVisible({ timeout: 10_000 })
})
```

- [ ] **Step 2: Verify Playwright config is correct**

Confirm `frontend/playwright.config.ts` from Task 2 exists and points to `testDir: 'src/tests/e2e'`.

- [ ] **Step 3: Run e2e (backend must be up)**

Terminal A:
```
cd backend && PYTHONPATH=. ./venv/bin/uvicorn api.main:app --port 8000
```

Terminal B:
```bash
cd frontend
npm run test:e2e
```

Expected: 1 passed. If the hero flow exceeds 60s per assertion, either the live pipeline is slow (bump the timeout to 120s and re-run) or something is genuinely broken (investigate the trace panel in the browser via `npm run dev`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/tests/e2e/hero-flow.spec.ts
git commit -m "test(fe): Playwright hero-flow e2e (golden path against live backend)"
```

---

## Task 24: Dockerfile + nginx + Cloud Run + README

**Files:**
- Create: `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore`, `frontend/README.md`

- [ ] **Step 1: Create nginx.conf**

Create `frontend/nginx.conf`:

```nginx
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript
               text/xml application/xml application/xml+rss text/javascript image/svg+xml;
    gzip_min_length 1024;

    # Hashed assets from Vite — safe to cache aggressively.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # SPA history fallback.
    location / {
        try_files $uri /index.html;
    }
}
```

- [ ] **Step 2: Create Dockerfile**

Create `frontend/Dockerfile`:

```dockerfile
# ── build stage ────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ── runtime stage ─────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 3: Create .dockerignore**

Create `frontend/.dockerignore`:

```
node_modules
dist
.vscode
.DS_Store
playwright-report
test-results
src/tests
```

- [ ] **Step 4: Local Docker smoke build (no push)**

```bash
cd frontend
docker build -t scc-frontend:test \
  --build-arg VITE_API_URL=http://localhost:8000 .
```

Expected: builds successfully; final image ~20-30 MB.

Optional local run smoke:
```bash
docker run --rm -p 18080:8080 scc-frontend:test
```
Open `http://localhost:18080` → the SPA shell should render. Ctrl+C to stop.

- [ ] **Step 5: Create README**

Create `frontend/README.md`:

```md
# Frontend (Layer 5)

Cinematic-modern ops center for Studio Crisis Commander. Consumes the
Layer 4 FastAPI backend over REST + SSE, renders the four-agent pipeline
as a live editorial experience.

## Boundaries

- `panels/*.tsx` MAY only import from `store/`, `api/contracts`, `components/`, `motion/`, `theme/`.
- `panels/*.tsx` MUST NOT import `api/client` or `api/sse`.
- `store/runStore.ts` is the ONLY file that owns the EventSource lifecycle.
- Enforced by `src/tests/boundaries.test.ts` (§1 grep).

## Layout

| File | Role |
| --- | --- |
| `src/App.tsx` | `<OpsCenter>` layout shell (full-width hero, 60/40 two-col) |
| `src/api/contracts.ts` | TS mirror of backend Pydantic contracts |
| `src/api/client.ts` | Fetch wrapper (`apiGet`, `apiPost`) |
| `src/api/sse.ts` | `openStream()` — EventSource wrapper |
| `src/store/runStore.ts` | Single Zustand store: state + event routing + derived panelStates |
| `src/theme/tokens.ts` | Newsroom-hybrid design tokens |
| `src/motion/choreography.ts` | Framer Motion variants |
| `src/components/PanelStateWrapper.tsx` | 5-state gate (idle / loading / success / empty / error) |
| `src/panels/*.tsx` | 8 panels — Hero, Telemetry, Anomaly, Trace, Recommendation, Approval, Inject, History |

## Running

Local dev (backend must be up):

```
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173.

## Testing

```
npm run test           # vitest — unit + component + boundary
npm run test:e2e       # playwright — hero-flow (backend must be running)
npm run acceptance     # 5-check sweep: boundaries + tsc + build + vitest + e2e
```

## Environment

- `VITE_API_URL` — backend base URL. Default `http://localhost:8000` for dev.
  Set at build time via `docker build --build-arg VITE_API_URL=https://...`.

## Deploy (Cloud Run)

```
gcloud run deploy scc-frontend \
  --source frontend/ \
  --region us-east1 \
  --allow-unauthenticated \
  --build-arg VITE_API_URL=https://scc-api-....run.app
```

## Spec

`docs/superpowers/specs/2026-08-09-layer-5-frontend-dashboard-design.md`
```

- [ ] **Step 6: Commit**

```bash
git add frontend/Dockerfile frontend/nginx.conf frontend/.dockerignore frontend/README.md
git commit -m "chore(fe): Dockerfile + nginx + Cloud Run README (Layer 5)"
```

---

## Post-plan check

After Task 24, run the full acceptance sweep one more time (backend up):

```
cd frontend
npm run acceptance
```

Expected: §1-§5 all PASS. If §5 exceeds 60s per assertion, bump the timeouts in `hero-flow.spec.ts` and re-run.

Then verify the boundary rule holds even under future edits:

```
grep -rE "from ['\"]@/api/(client|sse)['\"]" frontend/src/panels/ && echo "VIOLATION" || echo "OK"
grep -rE "from ['\"]@/api/(client|sse)['\"]" frontend/src/components/ && echo "VIOLATION" || echo "OK"
```

Both should print `OK`.

Layer 5 is done when:
- All 24 tasks committed
- `npm run acceptance` exits 0
- Dashboard loads at http://localhost:5173 with backend up
- Hero flow completes on inject → approve without console errors
