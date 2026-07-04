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
