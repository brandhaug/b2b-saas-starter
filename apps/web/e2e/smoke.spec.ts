import { expect, test } from '@playwright/test'
import { signInAsOwner } from './authentication'
import { isolatedClientIp } from './test-isolation'
import { hasLocalD1State } from '../src/lib/local-d1-state'

test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(testInfo.testId)
  })
})

test('public homepage renders the starter showcase', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /the hard parts, already wired/i })
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: /Shared application layer/ })
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

test('repository decisions stay readable when moving through the card stack', async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await page.locator('header [data-slot="select-trigger"]:enabled').waitFor()
  const first = page
    .getByRole('article', { includeHidden: true })
    .filter({ hasText: 'Capabilities stay shared' })
  const second = page
    .getByRole('article', { includeHidden: true })
    .filter({ hasText: 'Optional providers remain inactive' })
  const third = page
    .getByRole('article', { includeHidden: true })
    .filter({ hasText: 'The Seed and Live adapters represent' })
  await first.evaluate((card) =>
    window.scrollTo({
      top: window.scrollY + card.getBoundingClientRect().top - 127,
      behavior: 'instant'
    })
  )
  // Confirm the scroll interaction loaded before exercising its controls.
  await expect(first).toHaveCSS('position', 'fixed')
  await first.getByRole('button', { name: 'Next repository decision' }).click()
  await expect(second).toBeInViewport({ ratio: 1 })
  await expect(second).toHaveCSS('opacity', '1')
  // Trial clicks also check that another pinned card does not cover the link.
  await second.getByRole('link').click({ trial: true })
  await second.getByRole('button', { name: 'Next repository decision' }).click()
  await expect(third).toBeInViewport({ ratio: 1 })
  await expect(third).toHaveCSS('opacity', '1')
  await third.getByRole('link').click({ trial: true })
  await third.getByRole('button', { name: 'Previous repository decision' }).click()
  await expect(second).toBeInViewport({ ratio: 1 })
  await second.getByRole('link').click({ trial: true })
  await second.getByRole('button', { name: 'Previous repository decision' }).click()
  await expect(first).toBeInViewport({ ratio: 1 })
  await first.getByRole('link').click({ trial: true })
})

test('the request trace and provider accordion reveal the selected content', async ({
  page
}) => {
  await page.goto('/')
  await page.locator('header [data-slot="select-trigger"]:enabled').waitFor()
  const contract = page.getByRole('tab', { name: 'Contract', exact: true })
  await contract.click()
  await expect(contract).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toHaveCount(1)
  await expect(page.getByRole('tabpanel')).toContainText('HttpApiGroup')
  await contract.press('ArrowRight')
  const capability = page.getByRole('tab', { name: 'Capability', exact: true })
  await expect(capability).toBeFocused()
  await capability.press('Enter')
  await expect(
    page.getByRole('tab', { name: 'Capability', exact: true })
  ).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toHaveCount(1)
  await expect(
    page.getByRole('tabpanel', { name: 'Capability', exact: true })
  ).toContainText('workspaceOverview')
  await expect(page.getByRole('tabpanel')).not.toContainText('HttpApiGroup')
  const stripe = page.getByRole('button', { name: 'Stripe', exact: true })
  const sentry = page.getByRole('button', { name: 'Sentry', exact: true })
  await sentry.click()
  await expect(sentry).toHaveAttribute('aria-expanded', 'true')
  await expect(stripe).toHaveAttribute('aria-expanded', 'false')
  const provider = page.getByRole('article').filter({ has: sentry })
  await expect(provider.getByRole('link', { name: 'Read the docs' })).toBeVisible()
  await sentry.click()
  await expect(sentry).toHaveAttribute('aria-expanded', 'false')
  await expect(provider.getByRole('link', { name: 'Read the docs' })).toBeHidden()
})

test('public docs render', async ({ page }) => {
  await page.goto('/docs')
  await expect(page.getByRole('heading', { name: 'Documentation' })).toBeVisible()
})

test('knowledge search loads metadata without downloading article bodies', async ({
  page
}) => {
  // The E2E server is Vite dev, where compiled article requests retain .mdx.
  const articleRequests: Array<string> = []
  const articles = /\/content\/docs\/.*\.mdx(?:\?|$)/
  await page.route(articles, (route) => {
    articleRequests.push(route.request().url())
    return route.abort()
  })
  // Knowledge search belongs to the public header; credential entry has its
  // own focused shell. Wait for the header's hydration gate before clicking.
  await page.goto('/')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page
    .getByRole('button', { name: 'Search', exact: true })
    .filter({ visible: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill('Quickstart')
  const quickstart = dialog.getByRole('option', { name: 'Quickstart', exact: true })
  await expect(quickstart).toBeVisible()
  expect(articleRequests).toEqual([])

  await page.unroute(articles)
  await quickstart.click()
  await expect(
    page.getByRole('heading', { name: 'Quickstart', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Install and run', exact: true })
  ).toBeVisible()
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
  await signInAsOwner(page, '/workspaces/starter-lab')
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
  await page.getByText('Other sign-in methods', { exact: true }).click()
  await page.getByRole('button', { name: 'Email link', exact: true }).click()
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

test('demo credentials fill the sign-in form without submitting', async ({ page }) => {
  await page.goto('/sign-in')
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByRole('button', { name: 'View demo credentials', exact: true }).click()
  await page
    .getByRole('button', { name: 'Fill owner credentials', exact: true })
    .click()
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    'demo@starter.local'
  )
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(
    'demo-starter-password'
  )
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
  await expect(page).toHaveURL(/\/sign-in$/)
})
