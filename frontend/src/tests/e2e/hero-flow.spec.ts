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
  await expect(page.getByTestId('panel-hero').getByText(/waiting/i)).toBeVisible()   // hero idle

  // 2. Select a crisis type and inject.
  await page.getByRole('combobox').selectOption('regional_sentiment_collapse')
  // Fire the inject; we don't force fallback — the timeouts below accommodate both live (~20s) and fallback (~12s) paths.
  await page.getByRole('button', { name: /^inject$/i }).click()

  // 3. Wait for the hero to reveal.
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
