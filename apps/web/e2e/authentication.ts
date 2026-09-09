/* oxlint-disable effect/noNodeBuiltinImport -- Playwright runs this credential fixture in Node, outside application runtimes. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  expect,
  test as base,
  type BrowserContext,
  type CDPSession,
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

export async function addVirtualAuthenticator(cdp: CDPSession): Promise<string> {
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      defaultBackupEligibility: true,
      defaultBackupState: true
    }
  })
  return authenticatorId
}

export async function installDemoPasskey(
  page: Page,
  worker = base.info().parallelIndex
) {
  const cdp = await page.context().newCDPSession(page)
  const authenticatorId = await addVirtualAuthenticator(cdp)
  const path = credentialPath(worker)
  const credential = JSON.parse(readFileSync(path, 'utf8'))
  await cdp.send('WebAuthn.addCredential', { authenticatorId, credential })
  // Each worker uses its own key. Keep its counter even when a later page
  // assertion fails, so the next browser can make a fresh signed assertion.
  cdp.on('WebAuthn.credentialAsserted', (event) => {
    if (event.authenticatorId === authenticatorId) {
      writeFileSync(path, JSON.stringify(event.credential), { mode: 0o600 })
    }
  })
  return { cdp, authenticatorId }
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
    await page.locator('header select:enabled').waitFor({ state: 'attached' })
  }
}

export async function verifyWithPasskey(page: Page, redirect: string): Promise<void> {
  await page.goto(`/verify-authentication?redirect=${encodeURIComponent(redirect)}`)
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByRole('button', { name: 'Verify with a passkey', exact: true }).click()
  await page.waitForURL((url) => url.pathname === redirect)
  await page.locator('html[data-authenticated="true"]').waitFor()
  await page.locator('header select:enabled').waitFor({ state: 'attached' })
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
      await authenticator.cdp.send('WebAuthn.removeVirtualAuthenticator', {
        authenticatorId: authenticator.authenticatorId
      })
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
