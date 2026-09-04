import { expect, test, type CDPSession } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'

// The critical passkey flow (ADR 0012): register a passkey from /account with
// a user-chosen name, rename it, sign out, sign back in with the passkey, and
// remove it. Chromium's CDP virtual authenticator stands in for the hardware:
// `automaticPresenceSimulation` + `isUserVerified` resolve every ceremony
// without a physical device, so the WebAuthn path is exercised end to end —
// the same coverage a manual check against real hardware would give.

test.skip(
  !hasLocalD1State(),
  'requires a migrated + seeded local D1 (pnpm run db:migrate:local && pnpm run db:seed)'
)

async function addVirtualAuthenticator(cdp: CDPSession): Promise<string> {
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    // A platform authenticator with a resident key: the discoverable shape a
    // passkey-first sign-in needs (empty allowCredentials). The options ride
    // nested under `options` — the current protocol shape; the flat form
    // older examples show is rejected as invalid parameters.
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      // Credentials register as synced passkeys (BE + BS flags), matching the
      // account panel's "Synced passkey" display.
      defaultBackupEligibility: true,
      defaultBackupState: true
    }
  })
  return authenticatorId
}

test.beforeEach(async ({ page, context }) => {
  const cdp = await context.newCDPSession(page)
  await addVirtualAuthenticator(cdp)
})

test('registers, renames, signs in with, and removes a passkey', async ({
  page,
  context
}) => {
  // Arrive signed in the Local Auth Path way first.
  await page.goto('/sign-in')
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Email', { exact: true }).fill('demo@starter.local')
  await page.getByLabel('Password', { exact: true }).fill('demo-starter-password')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForURL(/\/workspaces/)

  // Register from /account with a user-chosen name; the virtual authenticator
  // resolves the ceremony the button starts. The "No passkeys yet" copy only
  // renders after hydration (the list query is browser-only), so waiting for
  // it is also the guard against a pre-hydration click falling through to a
  // native form submit.
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Passkeys', level: 2 })).toBeVisible()
  await expect(page.getByText(/No passkeys yet/)).toBeVisible()
  await page.getByLabel('Name a new passkey').fill('E2E key')
  await page.getByRole('button', { name: 'Add passkey' }).click()
  await expect(page.getByText('E2E key')).toBeVisible({ timeout: 15_000 })

  // Rename it.
  await page.getByRole('button', { name: 'Rename E2E key passkey' }).click()
  await page.getByLabel('New name').fill('Renamed key')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Renamed key')).toBeVisible()

  // Sign out (drop the session cookie) and come back through the passkey
  // button — no password, no two-factor hop. On the virtual authenticator the
  // conditional-UI preload may complete the ceremony on its own (a real
  // browser waits for the user to pick the autofill) and navigate away —
  // possibly before the form even hydrates — so the click is best-effort in
  // both directions: the button is server-rendered, and if the page has
  // already left for /workspaces it never becomes actionable and the click
  // times out into the catch. Either path proves the passkey opened the
  // session.
  await context.clearCookies()
  await page.goto('/sign-in')
  await page
    .getByRole('button', { name: 'Sign in with a passkey' })
    .click({ timeout: 10_000 })
    .catch(() => undefined)
  await page.waitForURL(/\/workspaces/, { timeout: 15_000 })

  // Remove the passkey and land back on the empty state. The row's reappearance
  // after the full page load is again the hydration wait.
  await page.goto('/account')
  await expect(page.getByText('Renamed key')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Remove Renamed key passkey' }).click()
  await page.getByRole('button', { name: 'Remove passkey' }).click()
  await expect(page.getByText(/No passkeys yet/)).toBeVisible()
})

test('the sign-in page offers passkey autofill where the browser supports it', async ({
  page
}) => {
  await page.goto('/sign-in')
  // The conditional-UI contract: `webauthn` rides the email field's
  // autocomplete token, last. The preload itself is invisible by design.
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
    'autocomplete',
    'email webauthn'
  )
})
