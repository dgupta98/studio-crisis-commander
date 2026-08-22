import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const routes = ['/', '/dashboard', '/movies', '/movies/1', '/audit', '/settings']

for (const path of routes) {
  test(`a11y: ${path} has no serious violations`, async ({ page }) => {
    await page.goto(path)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
    if (serious.length) console.log(JSON.stringify(serious, null, 2))
    expect(serious).toEqual([])
  })
}

test('reduced-motion disables particle canvas on landing', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto('/')
  await expect(page.locator('[data-fallback="reduced-motion"]')).toBeVisible()
  await ctx.close()
})
