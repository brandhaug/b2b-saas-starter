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
  await expect(page.getByLabel('Email')).toBeVisible()
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
    'requires a migrated + seeded local D1 (bun run db:migrate:local && bun run db:seed)'
  )
  await page.goto('/sign-in?redirect=%2Fworkspaces%2Fstarter-lab')
  // Interacting before React hydrates falls through to a native GET submit
  // (the dev server transforms modules on first hit, so hydration lags the
  // DOM). The sign-in form flips data-hydrated in an effect — wait for it.
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Email').fill('demo@starter.local')
  await page.getByLabel('Password').fill('demo-starter-password')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForURL(/\/workspaces\/starter-lab/)
  // The seeded dashboard renders real capability data, not the auth screen.
  await expect(page.getByRole('heading', { name: /starter lab/i })).toBeVisible()
})
