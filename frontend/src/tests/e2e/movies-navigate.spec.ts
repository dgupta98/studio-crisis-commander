import { test, expect } from '@playwright/test'

test('movies index → detail navigation', async ({ page }) => {
  await page.goto('/movies')
  await expect(page.getByText(/Movies/i)).toBeVisible()
  const firstCard = page.getByRole('link').filter({ hasText: /.+/ }).first()
  if (await firstCard.isVisible()) {
    await firstCard.click()
    await expect(page).toHaveURL(/\/movies\/\d+/)
  }
})
