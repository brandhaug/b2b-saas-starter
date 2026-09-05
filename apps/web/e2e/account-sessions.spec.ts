import { expect, test, type Browser, type Page } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'

// The active-session surface is the account page's security core: one user,
// two devices, and the ability to end one of them from the other. The test
// signs the seeded user in twice — two separate browser contexts are two
// independent session cookies — revokes the other session from the first, and
// checks the second context is really signed out.
async function signIn(page: Page, email: string, redirect: string): Promise<void> {
  await page.goto(`/sign-in?redirect=${encodeURIComponent(redirect)}`)
  // Interacting before React hydrates falls through to a native GET submit; the
  // sign-in form flips data-hydrated in an effect (see smoke.spec.ts).
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill('demo-starter-password')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForURL((url) => url.pathname === redirect)
}

/**
 * A context that identifies as its own device. `clientKey` trusts only
 * `cf-connecting-ip`, and the dev server (unlike the production edge) does not
 * strip a client-supplied one — so each simulated device can pin a distinct
 * value and land in its own rate-limit bucket. Without this, both sign-ins
 * share the one unkeyed bucket with every other spec's sign-ins, and the
 * credential bucket's 5-per-minute cap turns the whole suite into a race
 * against the brute-force brake — which no spec here is testing.
 */
async function deviceContext(
  browser: Browser,
  ip: string,
  options?: { readonly userAgent?: string }
) {
  const context = await browser.newContext({ userAgent: options?.userAgent })
  await context.route('**/*', (route) =>
    route.continue({
      headers: { ...route.request().headers(), 'cf-connecting-ip': ip }
    })
  )
  return context
}

test.beforeEach(() => {
  test.skip(
    !hasLocalD1State(),
    'requires a migrated + seeded local D1 (pnpm run db:migrate:local && pnpm run db:seed)'
  )
})

test('revoking the other session signs that device out', async ({ browser }) => {
  const thisDevice = await deviceContext(browser, '10.0.0.1')
  // The other device carries a distinctive user agent, so its row — and the
  // revoke control inside it — stays identifiable even when the seeded demo
  // account has other sessions (parallel specs sign it in too, so resetting
  // the account's sessions here would yank their sign-ins mid-test).
  const otherDevice = await deviceContext(browser, '10.0.0.2', {
    userAgent: 'AccountSecurityE2E/1.0 (other device)'
  })
  const here = await thisDevice.newPage()
  const there = await otherDevice.newPage()

  await signIn(there, 'demo@starter.local', '/workspaces/starter-lab')
  await signIn(here, 'demo@starter.local', '/account')

  // The panel's query may have fetched before the second sign-in landed; the
  // reload re-runs it against the store that now holds both sessions.
  await here.reload()

  await expect(here.getByRole('heading', { name: 'Active sessions' })).toBeVisible()
  await here.getByText('· This device').waitFor()

  // The other device is the newest session with its distinctive label, and
  // the list sorts newest first — so the first match is this test's session.
  await here.getByRole('button', { name: 'Revoke Browser session' }).first().click()
  // Base UI's AlertDialog exposes `alertdialog`, per the ARIA pattern.
  const revokeDone = here.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/revoke-session') &&
      response.request().method() === 'POST'
  )
  await here
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Revoke session' })
    .click()
  // The revoked context is signed out, but only once the revoke itself has
  // landed — the navigation below must not start before the endpoint returns.
  const revokeResponse = await revokeDone
  expect(revokeResponse.status()).toBe(200)

  await there.goto('/account')
  await there.waitForURL(/\/sign-in/)

  // The acting context keeps its session.
  await here.reload()
  await expect(here.getByText('· This device')).toBeVisible()

  await thisDevice.close()
  await otherDevice.close()
})
