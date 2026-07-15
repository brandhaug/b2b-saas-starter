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

test('published Merchant pages own a standalone PWA manifest', async ({ page }) => {
  await page.goto('/mara-booking-studio')
  await expect(page).toHaveURL('/mara-booking-studio/')

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBe(
    '/merchant-manifest.webmanifest?merchant=mara-booking-studio'
  )

  const response = await page.request.get(manifestHref!)
  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toContain('application/manifest+json')
  expect(await response.json()).toMatchObject({
    name: 'Mara Booking Studio bookings',
    start_url: '/mara-booking-studio/',
    scope: '/mara-booking-studio/',
    display: 'standalone'
  })

  const unknownResponse = await page.request.get(
    '/merchant-manifest.webmanifest?merchant=missing-merchant'
  )
  expect(unknownResponse.status()).toBe(404)
})

test('superseded authenticated routes are absent', async ({ page }) => {
  await page.goto('/workspaces/starter-lab')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})
