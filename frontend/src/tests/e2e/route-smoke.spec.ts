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
