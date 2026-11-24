import { Deferred, Effect } from 'effect'
import { expect, test } from '@playwright/test'

function serverFn(url: URL) {
  return url.pathname.startsWith('/_serverFn/')
}

// Failure modes: a slow client navigation leaves the previous page frozen with
// no feedback, the skeleton renders flush against the viewport edge, or it
// outlives the loader and covers the arrived page. /pricing declares no
// pendingComponent of its own and has no server-bound beforeLoad, so the
// held read is its loader and the skeleton is the router default.
test('a slow page read shows the route skeleton until the page arrives', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })

  const release = Deferred.makeUnsafe<boolean>()
  await page.route(serverFn, async (route) => {
    await Effect.runPromise(Deferred.await(release))
    await route.continue()
  })
  await page
    .getByRole('banner')
    .getByRole('link', { name: 'Pricing', exact: true })
    .click()

  const pending = page.getByRole('status').filter({ hasText: 'Loading…' })
  await expect(pending).toBeVisible()
  await expect(pending.locator('[data-slot="skeleton"]').first()).toBeVisible()
  const box = await pending.boundingBox()
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(16)
  await page.screenshot({ path: testInfo.outputPath('route-pending.png') })

  await Effect.runPromise(Deferred.succeed(release, true))
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible()
  await expect(pending).toHaveCount(0)
  await page.unroute(serverFn)

  await testInfo.attach('route-pending-reproduction', {
    body: 'Run: pnpm -C apps/web exec playwright test e2e/route-pending.spec.ts\nObserved: while the /pricing loader read is held, the router default skeleton (status "Loading…" with skeleton bars) renders inset from the viewport edge; releasing the read replaces it with the pricing page.',
    contentType: 'text/plain'
  })
})
