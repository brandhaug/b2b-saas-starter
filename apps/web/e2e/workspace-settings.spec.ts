import { type Page } from '@playwright/test'
import { expect, signInWithPassword, test } from './authentication'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { isolatedClientIp } from './test-isolation'

// The member case intentionally keeps a real credential round trip; the owner
// case uses the worker-scoped qualified session fixture.
async function signIn(page: Page, email: string, redirect: string): Promise<void> {
  await signInWithPassword(page, email, redirect)
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
}

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(
    !hasLocalD1State(),
    'requires a migrated + seeded local D1 (pnpm run db:migrate:local && pnpm run db:seed)'
  )
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(testInfo.testId)
  })
})

test('an owner opening workspace settings gets the settings page', async ({
  ownerPage
}) => {
  await ownerPage.goto('/workspaces/starter-lab/settings')
  await expect(
    ownerPage.getByRole('heading', { name: 'Workspace settings' })
  ).toBeVisible()
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
  // `exact` matters here too: a member's notification feed legitimately shows
  // a seeded `webhook.delivery_failed` broadcast ("Webhook delivery gave up"),
  // and what the matrix withholds is the `webhook:list`-gated chart Panel,
  // whose title is exactly "Webhook delivery".
  await expect(page.getByText('Webhook delivery', { exact: true })).toHaveCount(0)
})
