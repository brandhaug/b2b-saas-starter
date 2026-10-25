import { type Page } from '@playwright/test'
import { expect, test } from './authentication'

const configured = Boolean(
  process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN &&
  process.env.PRIVACY_CONTROLLER_NAME &&
  process.env.PRIVACY_CONTACT_EMAIL
)
const beaconSelector =
  'script[src="https://static.cloudflareinsights.com/beacon.min.js"]'

async function interceptAnalytics(page: Page) {
  const requests: Array<string> = []
  await page.route(/cloudflareinsights\.com/, async (route) => {
    requests.push(route.request().url())
    await route.fulfill({
      contentType: 'application/javascript',
      body: `document.documentElement.dataset.analyticsLoaded = 'true';
        addEventListener('pagehide', () => navigator.sendBeacon('https://cloudflareinsights.com/cdn-cgi/rum', '{}'));`
    })
  })
  return requests
}

test('an unconfigured deployment has no analytics requests or consent prompt', async ({
  page
}) => {
  test.skip(configured, 'run without the optional token or controller configuration')
  const requests = await interceptAnalytics(page)
  await page.goto('/')
  await page.locator('header [data-slot="select-trigger"]:enabled').waitFor()
  await expect(page.locator(beaconSelector)).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Browser analytics' })).toHaveCount(0)
  expect(requests).toEqual([])
})

test.describe('configured browser analytics', () => {
  test.skip(
    !configured,
    'run with a synthetic analytics token; vendor requests are intercepted'
  )

  test('requires opt-in, persists it across navigation, and stops on withdrawal', async ({
    page
  }, testInfo) => {
    const requests = await interceptAnalytics(page)
    await page.goto('/')
    const consent = page.getByRole('region', { name: 'Browser analytics' })
    await consent.waitFor()
    await expect(consent).toBeVisible()
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    expect(requests).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('consent-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath('consent-mobile.png') })
    await consent.getByRole('button', { name: 'Allow analytics', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-analytics-loaded', 'true')
    await expect(page.locator(beaconSelector)).toHaveCount(1)
    await page.getByRole('link', { name: 'Explore demo', exact: true }).first().click()
    await expect(page).toHaveURL(/\/demo$/)
    await expect(page.locator(beaconSelector)).toHaveCount(1)
    expect(requests).toHaveLength(1)
    await page.getByRole('button', { name: 'Analytics settings', exact: true }).click()
    await consent
      .getByRole('button', { name: 'Decline analytics', exact: true })
      .click()
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Analytics settings', exact: true })
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Analytics settings', exact: true })
    ).toBeVisible()
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    // The already-loaded beacon must not flush a final payload on withdrawal.
    expect(requests).toHaveLength(1)
    await testInfo.attach('consent-evidence', {
      body: JSON.stringify({ beforeConsent: 0, scriptLoads: 1, afterWithdrawal: 0 }),
      contentType: 'application/json'
    })
  })

  test('declining persists without loading the vendor on public or account pages', async ({
    page
  }) => {
    const requests = await interceptAnalytics(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Decline analytics', exact: true }).click()
    await page.goto('/sign-in')
    await expect(
      page.getByRole('button', { name: 'Analytics settings', exact: true })
    ).toBeVisible()
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('region', { name: 'Browser analytics' })).toHaveCount(0)
    expect(requests).toEqual([])
  })

  test('withdrawal in another tab stops an already-loaded beacon', async ({
    page,
    context
  }) => {
    const requests = await interceptAnalytics(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click()
    await expect(page.locator(beaconSelector)).toHaveCount(1)
    const other = await context.newPage()
    await interceptAnalytics(other)
    await other.goto('/')
    await other.getByRole('button', { name: 'Analytics settings', exact: true }).click()
    await other.getByRole('button', { name: 'Decline analytics', exact: true }).click()
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    expect(requests).toHaveLength(1)
    await other.close()
  })

  test('expired permission returns to opt-in without contacting the vendor', async ({
    page
  }) => {
    const requests = await interceptAnalytics(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click()
    await expect(page.locator(beaconSelector)).toHaveCount(1)
    await page.addInitScript(() => {
      const originalNow = Date.now
      Date.now = () => originalNow() + 181 * 24 * 60 * 60 * 1000
    })
    await page.reload()
    await expect(page.getByRole('region', { name: 'Browser analytics' })).toBeVisible()
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    expect(requests.filter((url) => url.endsWith('beacon.min.js'))).toHaveLength(1)
  })

  test('unavailable preference storage leaves analytics disabled', async ({ page }) => {
    const requests = await interceptAnalytics(page)
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        // oxlint-disable-next-line effect/noThrowStatement -- Exercise the native browser storage failure boundary.
        throw new DOMException('Storage blocked', 'SecurityError')
      }
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Analytics remains off')
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    expect(requests).toEqual([])
  })

  test('withdrawal clears stale acceptance when saving fails and preserves application access', async ({
    page,
    context
  }) => {
    const requests = await interceptAnalytics(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-analytics-loaded', 'true')
    const other = await context.newPage()
    const otherRequests = await interceptAnalytics(other)
    await other.goto('/')
    await expect(other.locator('html')).toHaveAttribute('data-analytics-loaded', 'true')
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        // oxlint-disable-next-line effect/noThrowStatement -- Simulate a browser becoming unable to persist consent.
        throw new DOMException('Storage blocked', 'SecurityError')
      }
    })
    await page.getByRole('button', { name: 'Analytics settings', exact: true }).click()
    await page.getByRole('button', { name: 'Decline analytics', exact: true }).click()
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    await expect(other.locator(beaconSelector)).toHaveCount(0)
    await page.reload()
    await expect(
      page.getByRole('button', { name: /^(Analytics settings|Allow analytics)$/ })
    ).toBeVisible()
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    expect(
      await page.evaluate(async () => {
        const response = await fetch('/privacy')
        return response.status
      })
    ).toBe(200)
    expect(requests).toHaveLength(1)
    expect(otherRequests).toHaveLength(1)
    await other.close()
  })

  test('expired consent blocks the loaded vendor before a hidden-page report', async ({
    page
  }) => {
    const requests = await interceptAnalytics(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-analytics-loaded', 'true')
    await page.evaluate(() => {
      const record = JSON.parse(
        localStorage.getItem('starter.analytics-consent') ?? '{}'
      )
      localStorage.setItem(
        'starter.analytics-consent',
        JSON.stringify({ ...record, decidedAt: Date.now() - 181 * 24 * 60 * 60 * 1000 })
      )
      document.dispatchEvent(new Event('visibilitychange'))
      dispatchEvent(new Event('pagehide'))
    })
    await expect(page.getByRole('region', { name: 'Browser analytics' })).toBeVisible()
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    expect(requests).toHaveLength(1)
  })

  test('a necessary refusal cookie preserves withdrawal when local storage is read-only', async ({
    page,
    context
  }) => {
    const requests = await interceptAnalytics(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-analytics-loaded', 'true')
    await page.evaluate(() => {
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- page.evaluate serializes this closure into the browser.
      function blocked() {
        // oxlint-disable-next-line effect/noThrowStatement -- Exercise read-only browser persistence.
        throw new DOMException('Storage blocked', 'SecurityError')
      }
      Storage.prototype.setItem = blocked
      Storage.prototype.removeItem = blocked
    })
    await page.getByRole('button', { name: 'Analytics settings', exact: true }).click()
    await page.getByRole('button', { name: 'Decline analytics', exact: true }).click()
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Analytics settings', exact: true })
    ).toBeVisible()
    const other = await context.newPage()
    const otherRequests = await interceptAnalytics(other)
    await other.goto('/')
    await expect(
      other.getByRole('button', { name: 'Analytics settings', exact: true })
    ).toBeVisible()
    expect(otherRequests).toEqual([])
    expect(
      await page.evaluate(async () => {
        const response = await fetch('/privacy')
        return response.status
      })
    ).toBe(200)
    expect(requests).toHaveLength(1)
    await other.close()
    await page.getByRole('button', { name: 'Analytics settings', exact: true }).click()
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-analytics-loaded', 'true')
  })

  test('withdrawal while the vendor script is still loading cancels collection', async ({
    page
  }) => {
    const requests = await interceptAnalytics(page)
    // oxlint-disable-next-line effect/noNewPromise -- Hold a Playwright route until the browser action releases it.
    const delayed = Promise.withResolvers<undefined>()
    await page.route(
      'https://static.cloudflareinsights.com/beacon.min.js',
      async (route) => {
        // Leave the script pending until withdrawal replaces its document.
        await delayed.promise
        await route.abort()
      }
    )
    await page.goto('/')
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click()
    await expect(page.locator(beaconSelector)).toHaveCount(1)
    await page.getByRole('button', { name: 'Analytics settings', exact: true }).click()
    await page.getByRole('button', { name: 'Decline analytics', exact: true }).click()
    delayed.resolve(undefined)
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Analytics settings', exact: true })
    ).toBeVisible()
    expect(requests).toEqual([])
  })

  test('invalid preference storage returns to opt-in', async ({ page }) => {
    const requests = await interceptAnalytics(page)
    await page.addInitScript(() =>
      localStorage.setItem('starter.analytics-consent', '{invalid')
    )
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Browser analytics' })).toBeVisible()
    expect(requests).toEqual([])
  })

  test('workspace pages share the consent controls and stop on withdrawal', async ({
    ownerPage: page
  }) => {
    const requests = await interceptAnalytics(page)
    await page.goto('/workspaces/starter-lab/settings')
    await expect(
      page.getByRole('heading', { name: 'Workspace settings', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-analytics-loaded', 'true')
    await page.getByRole('button', { name: 'Analytics settings', exact: true }).click()
    await page.getByRole('button', { name: 'Decline analytics', exact: true }).click()
    await expect(page.locator(beaconSelector)).toHaveCount(0)
    await expect(
      page.getByRole('heading', { name: 'Workspace settings', exact: true })
    ).toBeVisible()
    expect(requests).toHaveLength(1)
  })
})
