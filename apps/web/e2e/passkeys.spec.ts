/* oxlint-disable anti-slop/no-runtime-typeof -- This regression tests the SDK's browser-constructor capability check. */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import {
  addVirtualAuthenticator,
  installDemoPasskey,
  signInAsOwner,
  signInWithPassword,
  verifyWithPasskey
} from './authentication'
import { isolatedClientIp } from './test-isolation'

test.skip(
  !hasLocalD1State(),
  'requires a migrated + seeded local D1 (pnpm run db:migrate:local && pnpm run db:seed)'
)

test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(`${testInfo.testId}:${testInfo.retry}`)
  })
})

test('registers, renames, signs in with, and removes a passkey', async ({
  page,
  context
}) => {
  const bootstrap = await signInAsOwner(page, '/account')
  // Remove the fixture authenticator from this browser. Subsequent ceremonies
  // must use the new key, while its qualified session authorizes enrollment.
  await bootstrap.remove()
  await exercisePasskeyLifecycle(page, context)
})

// Failure cases: native WebAuthn constructors are absent, installation only
// repairs future documents, or the adapter enables conditional autofill.
test('virtual passkeys work without a native PublicKeyCredential constructor', async ({
  page,
  context
}) => {
  await signInWithPassword(page, 'demo@starter.local', '/account')
  // Model the missing constructor in this document before installation. A
  // separate removal init script would race the adapter on later navigation.
  await page.evaluate(() => {
    Reflect.deleteProperty(globalThis, 'PublicKeyCredential')
  })
  expect(await page.evaluate(() => typeof globalThis.PublicKeyCredential)).toBe(
    'undefined'
  )
  const bootstrap = await installDemoPasskey(page)
  expect(await page.evaluate(() => typeof globalThis.PublicKeyCredential)).toBe(
    'function'
  )
  expect(
    await page.evaluate(() => PublicKeyCredential.isConditionalMediationAvailable())
  ).toBe(false)
  await verifyWithPasskey(page, '/account')
  await bootstrap.remove()
  await exercisePasskeyLifecycle(page, context)
})

async function exercisePasskeyLifecycle(page: Page, context: BrowserContext) {
  const identity = `${test.info().testId}-${test.info().retry}`
  const initialName = `E2E key ${identity}`
  const renamedName = `Renamed key ${identity}`
  await addVirtualAuthenticator(context)
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await expect(page.getByRole('heading', { name: 'Passkeys', level: 2 })).toBeVisible()
  await expect(page.getByText(/E2E shared authentication/).first()).toBeVisible()
  await page.getByLabel('Name a new passkey').fill(initialName)
  await page.getByRole('button', { name: 'Add passkey', exact: true }).click()
  await expect(page.getByText(initialName, { exact: true })).toBeVisible({
    timeout: 15_000
  })

  await page
    .getByRole('button', { name: `Rename ${initialName} passkey`, exact: true })
    .click()
  await page.getByLabel('New name').fill(renamedName)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(renamedName, { exact: true })).toBeVisible()

  // Exercise the explicit sign-in button in a browser without conditional UI.
  // The server still verifies real signatures from Playwright's authenticator.
  await context.clearCookies()
  await page.goto('/sign-in?redirect=%2Fworkspaces%2Fstarter-lab%2Fsettings')
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible({
    timeout: 15_000
  })
  // SSR can expose the heading before the sign-in navigation has finished.
  // Wait for that destination before starting an unrelated full-page visit.
  await page.waitForURL('**/workspaces/starter-lab/settings')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })

  await page.goto('/account')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page
    .getByRole('button', { name: `Remove ${renamedName} passkey`, exact: true })
    .click()
  await page.getByRole('button', { name: 'Remove passkey', exact: true }).click()
  await expect(page.getByText(renamedName, { exact: true })).toHaveCount(0)
}

test('the sign-in page offers passkey autofill where the browser supports it', async ({
  page
}) => {
  await page.goto('/sign-in')
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
    'autocomplete',
    'email webauthn'
  )
})
