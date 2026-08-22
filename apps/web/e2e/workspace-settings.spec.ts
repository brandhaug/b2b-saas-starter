import { expect, test, type Page } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'

// Sign-in is the only way into the authenticated area — the /workspaces subtree
// gate redirects anonymous visitors — so every test here starts with a real
// credential round trip against the seeded local D1.
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

test.beforeEach(() => {
  test.skip(
    !hasLocalD1State(),
    'requires a migrated + seeded local D1 (bun run db:migrate:local && bun run db:seed)'
  )
})

test('an owner opening workspace settings gets the settings page', async ({ page }) => {
  await signIn(page, 'demo@starter.local', '/workspaces/starter-lab/settings')
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible()
})

test('a member sees no api token form and no webhook delivery card', async ({
  page
}) => {
  await signIn(page, 'engineer@example.com', '/workspaces/starter-lab/settings')
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible()
  // Everything the matrix denies a member is absent, not disabled: the loader
  // never read it, so there is nothing on the page to disable.
  await expect(page.getByRole('button', { name: 'Create token' })).toHaveCount(0)
  // `exact` matters: the page description names both sections in prose, which
  // is copy rather than workspace data and stays for every role.
  await expect(page.getByText('API tokens', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Outbound webhooks', { exact: true })).toHaveCount(0)

  await page.goto('/workspaces/starter-lab')
  await expect(page.getByText('Webhook delivery')).toHaveCount(0)
})
