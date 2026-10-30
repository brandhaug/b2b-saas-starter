import { expect, test } from '@playwright/test'

// Keep the same browser, viewport, routes and measurement boundary when comparing
// rendering implementations. These are local lab samples, not field Web Vitals.
// oxlint-disable-next-line vitest/prefer-each -- Playwright parameterizes tests with loops.
for (const path of ['/', '/sign-in', '/docs/getting-started/quickstart']) {
  test(`records cold-page rendering evidence for ${path}`, async ({
    browser
  }, info) => {
    // Warm the server route consistently; the measured browser context is fresh.
    const warmup = await browser.newPage()
    await warmup.goto(path, { waitUntil: 'networkidle' })
    await warmup.close()
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await page.addInitScript(() => {
      const eventDurations: Array<number> = []
      const samples = { lcp: 0, layoutShift: 0, eventDurations }
      Object.defineProperty(window, 'pagePerformanceSamples', { value: samples })
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          samples.lcp = entry.startTime
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if ('hadRecentInput' in entry && !entry.hadRecentInput && 'value' in entry) {
            samples.layoutShift += Number(entry.value)
          }
        }
      }).observe({ type: 'layout-shift', buffered: true })
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          samples.eventDurations.push(entry.duration)
        }
      }).observe({ type: 'event', buffered: true })
    })
    const response = await page.goto(path, { waitUntil: 'networkidle' })
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const evidence = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0]
      const resources = performance.getEntriesByType('resource')
      const scripts = resources.filter(
        (entry): entry is PerformanceResourceTiming =>
          entry instanceof PerformanceResourceTiming && /\.js(?:\?|$)/.test(entry.name)
      )
      return {
        url: location.pathname,
        navigation: navigation?.toJSON(),
        paints: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
        measurements:
          'pagePerformanceSamples' in window ? window.pagePerformanceSamples : null,
        scriptCount: scripts.length,
        scriptTransferBytes: scripts.reduce(
          (total, entry) => total + entry.transferSize,
          0
        ),
        scriptDecodedBytes: scripts.reduce(
          (total, entry) => total + entry.decodedBodySize,
          0
        )
      }
    })
    await info.attach('page-performance', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json'
    })
    await info.attach('page-appearance', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    })
    await context.close()
  })
}

test('records sign-in input response timing', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto('/sign-in', { waitUntil: 'networkidle' })
  const email = page.getByRole('textbox', { name: 'Email', exact: true })
  await expect(email).toBeEditable()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const start = await page.evaluate(() => performance.now())
  await email.fill('performance@example.com')
  await expect(email).toHaveValue('performance@example.com')
  const end = await page.evaluate(
    () =>
      // oxlint-disable-next-line effect/noNewPromise -- This callback executes in the browser realm, outside the test's Effect runtime.
      new Promise<number>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(performance.now()))
        )
      })
  )
  await info.attach('interaction-performance', {
    body: JSON.stringify({
      interaction: 'fill sign-in email through two animation frames',
      durationMs: end - start,
      boundary:
        'Includes Playwright transport, actionability and assertion overhead; not INP.'
    }),
    contentType: 'application/json'
  })
  await context.close()
})
