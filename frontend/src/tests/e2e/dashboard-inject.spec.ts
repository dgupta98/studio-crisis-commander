import { test, expect } from '@playwright/test'

test('inject flow lands from dashboard', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByTestId('intake-strip')).toBeVisible()
  await page.getByTestId('top-inject-cta').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('Crisis type').selectOption('box_office_drop')
  await page.getByLabel('Film ID').fill('1')
  await page.getByLabel('Region').selectOption('US')
  await page.getByLabel('Magnitude').fill('0.4')
  // Do not submit against real backend in CI; assert modal is populated.
  await expect(page.getByRole('button', { name: /Inject$/i })).toBeEnabled()
})
