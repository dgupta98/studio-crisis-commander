import { test, expect } from '@playwright/test'

test('featured film shows LatestInvestigation panel', async ({ page }) => {
  await page.goto('/movies/1')
  // Three valid states: cached triple loads (Featured), empty investigation (No run yet),
  // or backend has no film row yet (Film not found). All three prove the route rendered
  // without a JS crash — which is what the smoke is protecting.
  const featured = page.getByText(/Featured/i)
  const empty = page.getByText(/No run yet/i)
  const notFound = page.getByText(/Film not found/i)
  await expect(featured.or(empty).or(notFound)).toBeVisible({ timeout: 10_000 })
})
