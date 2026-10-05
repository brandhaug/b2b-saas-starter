import { expect, test } from '@playwright/test'

// Run once without a token and once with a synthetic token. Intercept the vendor
// script so this checks our integration without sending test visits to Cloudflare.
test('optional web analytics loads once across hydrated navigation', async ({
  page
}) => {
  const token = process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN
  const analyticsRequests: Array<string> = []
  await page.route(/cloudflareinsights\.com|posthog\.com/, async (route) => {
    analyticsRequests.push(route.request().url())
    await route.fulfill({
      contentType: 'application/javascript',
      body: 'document.documentElement.dataset.analyticsLoaded = "true"'
    })
  })
  await page.goto('/')
  await page.locator('header [data-slot="select-trigger"]:enabled').waitFor()
  const beacon = page.locator(
    'script[src="https://static.cloudflareinsights.com/beacon.min.js"]'
  )
  if (token) {
    await expect(beacon).toHaveCount(1)
    await expect(beacon).toHaveAttribute('data-cf-beacon', JSON.stringify({ token }))
    await expect(page.locator('html')).toHaveAttribute('data-analytics-loaded', 'true')
  } else {
    await expect(beacon).toHaveCount(0)
  }
  await page.getByRole('link', { name: 'Explore demo', exact: true }).first().click()
  await expect(page).toHaveURL(/\/demo$/)
  await expect(
    page.getByRole('heading', { name: 'Starter Lab', exact: true })
  ).toBeVisible()
  await expect(beacon).toHaveCount(token ? 1 : 0)
  expect(analyticsRequests).toEqual(
    token ? ['https://static.cloudflareinsights.com/beacon.min.js'] : []
  )
})
