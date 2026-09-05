import { expect, test } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'

test('public homepage renders the starter showcase', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /the hard parts, already wired/i })
  ).toBeVisible()
  await expect(
    page.getByRole('listitem').filter({ hasText: 'TanStack Start' })
  ).toBeVisible()
})

test('the homepage renders the live seed numbers and the real overview payload', async ({
  page
}) => {
  await page.goto('/')
  // The demo strip reads the same actorless projection the REST endpoint
  // serves, so the numbers are the seed's own.
  await expect(page.getByText('Audit event types')).toBeVisible()
  // The REST snippet embeds the workspace the curl line targets — the seed
  // workspace's real name, not a hand-written placeholder.
  await expect(page.getByText(/"name": "Starter Lab"/).first()).toBeVisible()
})

test('the live demo renders the dashboard without a session', async ({ page }) => {
  await page.goto('/demo')
  await expect(page.getByRole('heading', { name: 'Starter Lab' })).toBeVisible()
  // The demo persona is a member: notifications render, owner panels do not.
  // By role, not `getByText` — the mark-all button's sr-only count says
  // "(N unread notifications)" once a second broadcast is seeded, and the
  // substring locator would resolve to both.
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
  await expect(page.getByText('Needs attention')).toHaveCount(0)
  // Mark-as-read is the one member mutation, and the demo refuses it honestly.
  // The click can land before React hydrates — dev-server module transforms
  // delay hydration, the same warm-up variance the config documents — so the
  // retry loop waits the transforms out until the refusal renders.
  await expect(async () => {
    await page.getByRole('button', { name: 'Mark all read' }).click()
    await expect(page.getByText(/read-only/i)).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 30_000 })
})

test('demo paths other than the fixed route are not found', async ({ page }) => {
  // /demo is pinned to the showcase workspace; any other path under /demo
  // matches no route, so the router's own not-found page answers — the
  // route cannot be pointed at an arbitrary workspace.
  await page.goto('/demo/does-not-exist')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('public docs render', async ({ page }) => {
  await page.goto('/docs')
  await expect(page.getByRole('heading', { name: 'Documentation' })).toBeVisible()
})

test('unauthenticated workspace visit redirects to sign-in', async ({ page }) => {
  await page.goto('/workspaces/starter-lab')
  await page.waitForURL(/\/sign-in/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  // The original location is preserved so sign-in can return the user.
  expect(new URL(page.url()).searchParams.get('redirect')).toContain(
    '/workspaces/starter-lab'
  )
})

test('sign-in page offers the account lifecycle affordances', async ({ page }) => {
  await page.goto('/sign-in')
  await expect(
    page.getByRole('link', { name: 'Forgot your password?' })
  ).toHaveAttribute('href', '/forgot-password')
  await page.getByRole('link', { name: 'Create one' }).click()
  await page.waitForURL(/\/sign-up/)
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
})

test('forgot-password page renders the request form', async ({ page }) => {
  await page.goto('/forgot-password')
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
})

test('reset-password page shows the opaque failure state without a token', async ({
  page
}) => {
  await page.goto('/reset-password')
  await expect(
    page.getByRole('heading', { name: 'This link cannot be used' })
  ).toBeVisible()
})

test('verify-email page reports success without an error param', async ({ page }) => {
  await page.goto('/verify-email')
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
})

test('seeded demo user signs in and reaches the workspace dashboard', async ({
  page
}) => {
  test.skip(
    !hasLocalD1State(),
    'requires a migrated + seeded local D1 (pnpm run db:migrate:local && pnpm run db:seed)'
  )
  await page.goto('/sign-in?redirect=%2Fworkspaces%2Fstarter-lab')
  // Interacting before React hydrates falls through to a native GET submit
  // (the dev server transforms modules on first hit, so hydration lags the
  // DOM). The sign-in form flips data-hydrated in an effect — wait for it.
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Email', { exact: true }).fill('demo@starter.local')
  await page.getByLabel('Password', { exact: true }).fill('demo-starter-password')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForURL(/\/workspaces\/starter-lab/)
  // The seeded dashboard renders real capability data, not the auth screen.
  await expect(page.getByRole('heading', { name: /starter lab/i })).toBeVisible()
})

test('seeded demo user can request a magic link', async ({ page }) => {
  test.skip(
    !hasLocalD1State(),
    'requires a migrated + seeded local D1 (pnpm run db:migrate:local && pnpm run db:seed)'
  )
  await page.goto('/sign-in')
  await page.locator('form[data-hydrated="true"]').waitFor()
  // The second Local Auth Path: switch the form to email-only and send.
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(
    page.getByRole('heading', { name: 'Sign in with an email link' })
  ).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill('demo@starter.local')
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  // Non-disclosing confirmation: the link itself lands in the dev console log
  // (log-mode email dispatch), which the browser cannot reach — the send
  // succeeding is what this flow asserts.
  await expect(page.getByRole('alert')).toContainText(
    'check your inbox for a sign-in link'
  )
})
