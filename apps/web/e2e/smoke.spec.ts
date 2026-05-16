import { expect, test } from '@playwright/test'

test('public homepage renders the starter showcase', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /inspect a b2b saas starter/i })
  ).toBeVisible()
  await expect(page.getByText('TanStack Start', { exact: true })).toBeVisible()
})

test('docs and workspace smoke routes render', async ({ page }) => {
  await page.goto('/docs')
  await expect(page.getByRole('heading', { name: 'Docs' })).toBeVisible()

  await page.goto('/workspaces/starter-lab')
  await expect(page.getByRole('heading', { name: 'Starter Lab' })).toBeVisible()
  await expect(page.getByText('Starter modules', { exact: true })).toBeVisible()
})
