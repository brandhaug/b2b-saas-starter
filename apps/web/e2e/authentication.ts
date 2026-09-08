/* oxlint-disable effect/noNodeBuiltinImport -- Playwright runs this credential fixture in Node, outside application runtimes. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type CDPSession, type Page } from '@playwright/test'

export function credentialPath(worker: number): string {
  return join(import.meta.dirname, `../test-results/demo-passkey-${worker}.json`)
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

export async function installDemoPasskey(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const authenticatorId = await addVirtualAuthenticator(cdp)
  const path = credentialPath(test.info().parallelIndex)
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

export async function signInAsOwner(page: Page, redirect: string) {
  // Install after password sign-in so conditional passkey autofill cannot
  // race the password form. Verification creates its own qualified session.
  await signInWithPassword(page, 'demo@starter.local', '/account')
  const authenticator = await installDemoPasskey(page)
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
