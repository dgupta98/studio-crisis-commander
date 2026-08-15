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
  it('panels/**.tsx MUST NOT import from api/client or api/sse (except { ApiError })', () => {
    const violations: string[] = []
    for (const f of files.filter((f) => f.includes('/panels/') && f.endsWith('.tsx'))) {
      const src = fs.readFileSync(f, 'utf-8')
      // Find every import from api/client or api/sse
      const matches = src.matchAll(/import\s+(\{[^}]+\})\s+from\s+['"]@\/api\/(client|sse)['"]/g)
      for (const m of matches) {
        const specifiers = m[1].replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
        // Allowed: exactly ["ApiError"]. Anything else is a violation.
        if (specifiers.length !== 1 || specifiers[0] !== 'ApiError') violations.push(f)
      }
    }
    expect(violations, `panels importing api directly (non-ApiError): ${violations.join(', ')}`)
      .toHaveLength(0)
  })

  it('components/**.tsx MUST NOT import from api/* or store/* (value imports)', () => {
    const violations: string[] = []
    for (const f of files.filter((f) => f.includes('/components/') && f.endsWith('.tsx'))) {
      const src = fs.readFileSync(f, 'utf-8')
      if (/from ['"]@\/api\/(client|sse)['"]/.test(src)) violations.push(f)
      // Iterate every store import; `import type { … }` is fine, value imports are not.
      for (const m of src.matchAll(/import(\s+type)?\s+[^;]*from\s+['"]@\/store\/[^'"]+['"]/g)) {
        if (!m[1]) violations.push(f)
      }
    }
    expect(violations, `components importing api/store non-type: ${violations.join(', ')}`)
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
