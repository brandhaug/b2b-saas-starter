/* oxlint-disable effect/noNodeBuiltinImport -- Playwright runs this credential fixture in Node, outside application runtimes. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  expect,
  test as base,
  type BrowserContext,
  type Route,
  type Page
} from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { isolatedClientIp } from './test-isolation'

type WorkerFixtures = {
  ownerStorageState: Awaited<ReturnType<BrowserContext['storageState']>>
}

type TestFixtures = {
  ownerPage: Page
}

export function credentialPath(worker: number): string {
  return join(import.meta.dirname, `../.auth/demo-passkey-${worker}.json`)
}
export function fixturePasskeyName(worker: number): string {
  return `E2E shared authentication ${worker}`
}
export const demoPassword = 'demo-starter-password'

export async function addVirtualAuthenticator(context: BrowserContext) {
  // Playwright's context authenticator supplies discoverable platform keys and
  // user-present/user-verified assertions in Chromium, Firefox and WebKit.
  await context.credentials.install()
  // The virtual API resolves conditional requests immediately instead of
  // waiting for a user to choose an autofill suggestion. Keep these ceremonies
  // explicit, including after reloads, independent of init-script ordering.
  await context.addInitScript(() => {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- WebAuthn is optional in browser runtimes despite the DOM declarations.
    if (globalThis.PublicKeyCredential) {
      Object.defineProperty(PublicKeyCredential, 'isConditionalMediationAvailable', {
        configurable: true,
        // oxlint-disable-next-line effect/noNewPromise -- The browser capability stub implements the native WebAuthn Promise interface.
        get: () => () => Promise.resolve(false),
        set() {
          // Keep the explicit-ceremony policy when Playwright installs later.
        }
      })
    }
  })
  return context.credentials
}

export async function installDemoPasskey(
  page: Page,
  worker = base.info().parallelIndex
) {
  const context = page.context()
  const credentials = await addVirtualAuthenticator(context)
  const path = credentialPath(worker)
  const credential = JSON.parse(readFileSync(path, 'utf8'))
  await credentials.create(credential.rpId, credential)
  // Each worker uses its own key. Keep its counter even when a later page
  // assertion fails, so the next browser can make a fresh signed assertion.
  async function persistAssertion(route: Route) {
    const [current] = await credentials.get({ id: credential.id })
    if (current) {
      writeFileSync(path, JSON.stringify(current), { mode: 0o600 })
    }
    // Earlier routes may attach the simulated device's rate-limit identity.
    await route.fallback()
  }
  // Persist before the assertion reaches Better Auth, even if navigation or a
  // later assertion fails. Credentials has no assertion event API.
  const verification = '**/api/auth/passkey/verify-authentication'
  await context.route(verification, persistAssertion)
  return {
    async remove() {
      await context.unroute(verification, persistAssertion)
      await credentials.delete(credential.id)
    }
  }
}

export async function signInWithPassword(
  page: Page,
  email: string,
  redirect: string
): Promise<void> {
  await page.goto(`/sign-in?redirect=${encodeURIComponent(redirect)}`)
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(demoPassword)
  const signedIn = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/sign-in/email') &&
      response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const response = await signedIn
  expect(response.status()).toBe(200)
  await page.waitForURL((url) => url.pathname === redirect)
  await page.locator('html[data-authenticated="true"]').waitFor()
  if (redirect === '/account') {
    await page
      .locator('header [data-slot="select-trigger"]:enabled')
      .waitFor({ state: 'attached' })
  }
}

export async function verifyWithPasskey(page: Page, redirect: string): Promise<void> {
  await page.goto(`/verify-authentication?redirect=${encodeURIComponent(redirect)}`)
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByRole('button', { name: 'Verify with a passkey', exact: true }).click()
  await page.waitForURL((url) => url.pathname === redirect)
  await page.locator('html[data-authenticated="true"]').waitFor()
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
}

export async function signInAsOwner(
  page: Page,
  redirect: string,
  worker = base.info().parallelIndex
) {
  // Install after password sign-in so conditional passkey autofill cannot
  // race the password form. Verification creates its own qualified session.
  await signInWithPassword(page, 'demo@starter.local', '/account')
  const authenticator = await installDemoPasskey(page, worker)
  await verifyWithPasskey(page, redirect)
  return authenticator
}

export async function confirmPasswordForEnrollment(page: Page): Promise<void> {
  await page.goto('/verify-authentication?redirect=%2Faccount')
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Password', { exact: true }).fill(demoPassword)
  await page.getByRole('button', { name: 'Confirm password', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Password confirmed.')
}

/**
 * Ordinary owner-facing UI tests share one qualified session per worker. The
 * browser context is still new for every test, so cookies and client state do
 * not leak between tests; only the expensive password + passkey ceremony is
 * reused. The worker's passkey credential remains in authentication.ts' file
 * and continues to receive assertion-counter updates.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  ownerStorageState: [
    async ({ browser }, provide, testInfo) => {
      if (!hasLocalD1State()) {
        await provide({ cookies: [], origins: [] })
        return
      }
      const context = await browser.newContext({
        baseURL: testInfo.project.use.baseURL
      })
      await context.setExtraHTTPHeaders({
        'cf-connecting-ip': isolatedClientIp(`owner-auth:${testInfo.workerIndex}`)
      })
      const page = await context.newPage()
      const authenticator = await signInAsOwner(
        page,
        '/account',
        testInfo.parallelIndex
      )
      const state = await context.storageState()
      await authenticator.remove()
      await context.close()
      await provide(state)
    },
    { scope: 'worker' }
  ],
  ownerPage: async ({ context, page, ownerStorageState }, provide) => {
    await context.addCookies(ownerStorageState.cookies)
    await provide(page)
  }
})

export { expect } from '@playwright/test'
