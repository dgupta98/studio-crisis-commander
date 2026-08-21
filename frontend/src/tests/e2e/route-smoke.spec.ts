import { test, expect } from '@playwright/test'

const routes = [
  { path: '/', tid: 'route-landing' },
  { path: '/dashboard', tid: 'route-dashboard' },
  { path: '/movies', tid: 'route-movies' },
  { path: '/movies/1', tid: 'route-movie-detail' },
  { path: '/audit', tid: 'route-audit' },
  { path: '/settings', tid: 'route-settings' },
]

for (const r of routes) {
  test(`route ${r.path} renders`, async ({ page }) => {
    await page.goto(r.path)
    await expect(page.getByTestId(r.tid)).toBeVisible()
  })
}

test('landing shows headline and CTA', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Investigations that arrive/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open Dashboard/i })).toBeVisible()
})

test('landing → dashboard CTA nav', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /Open Dashboard/i }).first().click()
  await expect(page).toHaveURL(/\/dashboard$/)
})
