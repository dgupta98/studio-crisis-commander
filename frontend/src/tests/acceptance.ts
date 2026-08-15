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
