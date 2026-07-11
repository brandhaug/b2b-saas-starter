import { expect, test } from '@playwright/test'

test('Public Site renders without Workspace runtime data', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /scheduling that stays focused/i })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: /public booking page/i })).toBeVisible()
})

test('public docs render', async ({ page }) => {
  await page.goto('/docs')
  await expect(page.getByRole('heading', { name: 'Documentation' })).toBeVisible()
})

test('superseded authenticated routes are absent', async ({ page }) => {
  await page.goto('/workspaces/starter-lab')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})
