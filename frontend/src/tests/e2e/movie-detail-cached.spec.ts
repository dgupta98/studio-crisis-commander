import { test, expect } from '@playwright/test'

test('featured film shows LatestInvestigation panel', async ({ page }) => {
  await page.goto('/movies/1')
  // Either the cached triple loads (Featured badge visible) or the panel says "No run yet"
  const featured = page.getByText(/Featured/i)
  const empty = page.getByText(/No run yet/i)
  await expect(featured.or(empty)).toBeVisible({ timeout: 10_000 })
})
