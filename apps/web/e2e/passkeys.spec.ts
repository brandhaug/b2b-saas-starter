import { expect, test } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { addVirtualAuthenticator, signInAsOwner } from './authentication'
import { isolatedClientIp } from './test-isolation'

test.skip(
  !hasLocalD1State(),
  'requires a migrated + seeded local D1 (pnpm run db:migrate:local && pnpm run db:seed)'
)

test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(testInfo.testId)
  })
})

test('registers, renames, signs in with, and removes a passkey', async ({
  page,
  context
}) => {
  const bootstrap = await signInAsOwner(page, '/account')
  // Remove the fixture authenticator from this browser. Subsequent ceremonies
  // must use the new key, while its qualified session authorizes enrollment.
  await bootstrap.cdp.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: bootstrap.authenticatorId
  })
  await addVirtualAuthenticator(bootstrap.cdp)
  await page.locator('header select:enabled').waitFor({ state: 'attached' })
  await expect(page.getByRole('heading', { name: 'Passkeys', level: 2 })).toBeVisible()
  await expect(page.getByText(/E2E shared authentication/).first()).toBeVisible()
  await page.getByLabel('Name a new passkey').fill('E2E key')
  await page.getByRole('button', { name: 'Add passkey', exact: true }).click()
  await expect(page.getByText('E2E key', { exact: true })).toBeVisible({
    timeout: 15_000
  })

  await page.getByRole('button', { name: 'Rename E2E key passkey' }).click()
  await page.getByLabel('New name').fill('Renamed key')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Renamed key', { exact: true })).toBeVisible()

  // Exercise the explicit sign-in button in a browser without conditional UI.
  // The registration and assertion still use Chromium's real WebAuthn APIs.
  await page.addInitScript(() => {
    // oxlint-disable-next-line effect/noNewPromise -- This browser capability stub implements the native WebAuthn Promise interface.
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false)
  })
  await context.clearCookies()
  await page.goto('/sign-in?redirect=%2Fworkspaces%2Fstarter-lab%2Fsettings')
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible({
    timeout: 15_000
  })

  await page.goto('/account')
  await page.locator('header select:enabled').waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Remove Renamed key passkey' }).click()
  await page.getByRole('button', { name: 'Remove passkey', exact: true }).click()
  await expect(page.getByText('Renamed key', { exact: true })).toHaveCount(0)
})

test('the sign-in page offers passkey autofill where the browser supports it', async ({
  page
}) => {
  await page.goto('/sign-in')
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
    'autocomplete',
    'email webauthn'
  )
})
