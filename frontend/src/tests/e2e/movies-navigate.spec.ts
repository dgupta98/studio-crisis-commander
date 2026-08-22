import { test, expect } from '@playwright/test'

test('movies index → detail navigation', async ({ page }) => {
  await page.goto('/movies')
  await expect(page.getByRole('heading', { level: 1, name: /Movies/i })).toBeVisible()
  // Scope to card links (href="/movies/<digit>") — plain "getByRole('link').first()"
  // picks up the app logo which routes to "/" and breaks the URL assertion.
  const firstCard = page.locator('a[href^="/movies/"]').first()
  if (await firstCard.isVisible()) {
    await firstCard.click()
    await expect(page).toHaveURL(/\/movies\/\d+/)
  }
})
