import { expect, test, type Browser } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { demoPassword, signInWithPassword } from './authentication'
import { isolatedClientIp } from './test-isolation'

// Each run owns its account. Better Auth bounds list-sessions at the adapter's
// default 100 rows, so a repeatedly reused demo identity cannot reliably expose
// either of this test's sessions. Never clear the shared account's sessions.
async function deviceContext(
  browser: Browser,
  baseURL: string,
  ip: string,
  userAgent: string
) {
  return browser.newContext({
    baseURL,
    userAgent,
    extraHTTPHeaders: { 'cf-connecting-ip': ip }
  })
}

test.beforeEach(() => {
  test.skip(
    !hasLocalD1State(),
    'requires a migrated + seeded local D1 (pnpm run db:migrate:local && pnpm run db:seed)'
  )
})

test('revoking the other session signs that device out', async ({
  browser,
  baseURL
}, info) => {
  if (!baseURL) {
    // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- Missing Playwright configuration is a test setup defect.
    throw new Error('The session acceptance test requires a configured baseURL')
  }
  const identity = `sessions-${crypto.randomUUID()}`
  const email = `${identity}@example.com`
  const origin = new URL(baseURL).origin
  const thisDevice = await deviceContext(
    browser,
    baseURL,
    isolatedClientIp(`${identity}:here`),
    'AccountSecurityE2E/1.0 (Macintosh)'
  )
  const otherDevice = await deviceContext(
    browser,
    baseURL,
    isolatedClientIp(`${identity}:there`),
    'AccountSecurityE2E/1.0 (other device)'
  )
  let registered = false
  // oxlint-disable-next-line effect/noTryCatch -- Playwright owns disposable account and context cleanup even when an assertion fails.
  try {
    const signup = await thisDevice.request.post('/api/auth/sign-up/email', {
      headers: { origin },
      data: { name: 'Session acceptance', email, password: demoPassword }
    })
    await expect(signup).toBeOK()
    registered = true
    // Remove the registration session so exactly two password sessions remain.
    const signout = await thisDevice.request.post('/api/auth/sign-out', {
      headers: { origin },
      data: {}
    })
    await expect(signout).toBeOK()
    const here = await thisDevice.newPage()
    const there = await otherDevice.newPage()
    await signInWithPassword(there, email, '/account')
    await signInWithPassword(here, email, '/account')

    const sessions = here.locator('section').filter({
      has: here.getByRole('heading', { name: 'Active sessions', exact: true })
    })
    await expect(sessions.getByText('· This device', { exact: true })).toBeVisible()
    await expect(sessions.getByRole('listitem')).toHaveCount(2)
    await expect(
      sessions.getByRole('button', { name: 'Revoke session on Mac', exact: true })
    ).toHaveCount(0)
    // A unique other-device control replaces the ambiguous first-match selector.
    const revoke = sessions.getByRole('button', {
      name: 'Revoke session on Browser',
      exact: true
    })
    await expect(revoke).toHaveCount(1)
    await revoke.click()
    const revokeDone = here.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/revoke-session') &&
        response.request().method() === 'POST'
    )
    await here
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Revoke session', exact: true })
      .click()
    const response = await revokeDone
    expect(response.status()).toBe(200)
    await expect(sessions.getByRole('listitem')).toHaveCount(1)

    await there.goto('/account')
    await there.waitForURL(/\/sign-in/)
    await here.reload()
    await here.locator('header select:enabled').waitFor({ state: 'attached' })
    await expect(sessions.getByText('· This device', { exact: true })).toBeVisible()
    await expect(
      sessions.getByRole('button', { name: /^Revoke session on / })
    ).toHaveCount(0)
    await info.attach('session-revocation-evidence', {
      body: JSON.stringify({
        isolatedAccount: true,
        initialDevices: 2,
        remainingDevices: 1,
        revokeStatus: response.status(),
        otherDevicePath: new URL(there.url()).pathname,
        actingDevicePath: new URL(here.url()).pathname
      }),
      contentType: 'application/json'
    })
  } finally {
    // oxlint-disable-next-line effect/noTryCatch -- Contexts must close even if temporary-account deletion fails.
    try {
      if (registered) {
        // Obtain fresh password evidence even after an early assertion failure.
        const signin = await thisDevice.request.post('/api/auth/sign-in/email', {
          headers: { origin },
          data: { email, password: demoPassword }
        })
        await expect(signin).toBeOK()
        const deleted = await thisDevice.request.post(
          '/api/web/deleteAccountServerFn',
          {
            headers: { origin, 'x-starter-client': '1' },
            data: { password: demoPassword }
          }
        )
        await expect(deleted).toBeOK()
      }
    } finally {
      await thisDevice.close()
      await otherDevice.close()
    }
  }
})
