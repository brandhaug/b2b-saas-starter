/* eslint-disable no-await-in-loop -- Each capture changes the same browser page and must finish before the next viewport or navigation. */
/* oxlint-disable effect/noNodeBuiltinImport -- Evidence artifacts are written by Playwright's Node runner. */
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type Page } from '@playwright/test'
import { expect, test, signInWithPassword } from './authentication'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { isolatedClientIp } from './test-isolation'

const phase = process.env.EVIDENCE_PHASE
const output = resolve(import.meta.dirname, '../../../docs/evidence/app-layout')
const sections = [
  { path: '', name: 'overview', heading: 'Starter Lab' },
  { path: '/members', name: 'members', heading: 'Members' },
  { path: '/members?tab=invitations', name: 'invitations', heading: 'Members' },
  { path: '/members?tab=delivery', name: 'member-delivery', heading: 'Members' },
  { path: '/billing', name: 'billing', heading: 'Billing' },
  { path: '/api-tokens', name: 'api-tokens', heading: 'API tokens' },
  { path: '/webhooks', name: 'webhooks', heading: 'Webhook endpoints' },
  {
    path: '/webhooks?tab=delivery',
    name: 'webhook-delivery',
    heading: 'Webhook endpoints'
  },
  { path: '/audit', name: 'audit', heading: 'Audit trail' },
  { path: '/settings', name: 'settings', heading: 'Workspace settings' },
  { path: '/settings?tab=sso', name: 'sso', heading: 'Workspace settings' },
  { path: '/settings?tab=exports', name: 'exports', heading: 'Workspace settings' },
  { path: '/assistant', name: 'assistant', heading: 'AI assistant' }
]
const accountPages = [
  { path: '/account', name: 'account', heading: 'Account' },
  {
    path: '/account/notifications',
    name: 'account-notifications',
    heading: 'Notification preferences'
  },
  { path: '/admin', name: 'admin', heading: 'System admin' },
  { path: '/workspaces', name: 'workspace-picker', heading: 'Your workspaces' }
]

test.use({
  reducedMotion: 'reduce',
  colorScheme: 'dark',
  viewport: { width: 1440, height: 1000 }
})
test.beforeEach(async ({ context }, testInfo) => {
  test.skip(
    phase !== 'before' && phase !== 'after',
    'Set EVIDENCE_PHASE=before or after to record review evidence.'
  )
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(testInfo.testId)
  })
})

async function capture(page: Page, path: string, heading: string, name: string) {
  await page.goto(path)
  await expect(
    page.getByRole('heading', { level: 1, name: heading, exact: true })
  ).toBeVisible()
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await expect(page.getByRole('main')).not.toContainText(
    /Something went wrong|Loading…/u
  )
  const tab = new URL(path, 'http://localhost').searchParams.get('tab')
  if (tab !== null) {
    await expect(page).toHaveURL(new RegExp(`tab=${tab}(?:&|$)`, 'u'))
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1)
    await expect(page.getByRole('tabpanel')).toBeVisible()
  }
  await page.evaluate(() => document.fonts.ready)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    )
    .toBeLessThanOrEqual(1)
  const directory = resolve(output, phase ?? 'after')
  await mkdir(directory, { recursive: true })
  await page.screenshot({
    path: resolve(directory, `${name}.png`),
    fullPage: true,
    animations: 'disabled'
  })
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 }
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })
    for (const section of sections) {
      test(`demo ${section.name}`, async ({ page }) => {
        await capture(
          page,
          `/demo${section.path}`,
          section.heading,
          `demo-${section.name}-${viewport.name}`
        )
      })
      test(`workspace ${section.name}`, async ({ ownerPage }) => {
        test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
        await capture(
          ownerPage,
          `/workspaces/starter-lab${section.path}`,
          section.heading,
          `workspace-${section.name}-${viewport.name}`
        )
      })
    }
    test('demo notifications', async ({ page }) => {
      await capture(
        page,
        '/demo/notifications',
        'Notifications',
        `demo-notifications-${viewport.name}`
      )
    })
    for (const account of accountPages) {
      test(account.name, async ({ ownerPage }) => {
        test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
        await capture(
          ownerPage,
          account.path,
          account.heading,
          `${account.name}-${viewport.name}`
        )
      })
    }
  })
}

// oxlint-disable-next-line vitest/prefer-each -- Playwright parameterizes tests with loops; its test API has no each method.
for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 720 }
]) {
  test(`public preview asset ${viewport.name}`, async ({ page }) => {
    test.skip(
      phase !== 'after',
      'Prior published preview assets are preserved from Git.'
    )
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/demo')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Starter Lab', exact: true })
    ).toBeVisible()
    await page
      .locator('header [data-slot="select-trigger"]:enabled')
      .waitFor({ state: 'attached' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
      path: resolve(output, 'after', `public-preview-${viewport.name}.png`),
      animations: 'disabled'
    })
  })
}

test('final layout navigation smoke', async ({ page }) => {
  test.skip(
    phase !== 'after',
    'Verifies the new global rail and related-page navigation.'
  )
  await page.goto('/demo')
  await page
    .getByRole('navigation', { name: 'Global navigation' })
    .getByRole('button', { name: 'Search', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page
    .getByRole('navigation', { name: 'Related pages' })
    .getByRole('link', { name: 'Open Assistant', exact: true })
    .click()
  await expect(page).toHaveURL(/\/demo\/assistant$/u)
  await page
    .getByRole('navigation', { name: 'Global navigation' })
    .getByRole('link', { name: 'Open Settings', exact: true })
    .click()
  await expect(page).toHaveURL(/\/demo\/settings$/u)
  await page.getByRole('button', { name: 'Delete workspace', exact: true }).click()
  const confirmation = page.getByRole('alertdialog')
  await confirmation.getByLabel(/Type starter-lab/u).fill('starter-lab')
  await confirmation
    .getByRole('button', { name: 'Delete this workspace permanently', exact: true })
    .click()
  await expect(
    page.getByText('This preview is read-only. No changes were made.')
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 320, height: 400 })
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  const exit = page
    .getByRole('dialog')
    .getByRole('link', { name: 'Try sign-in', exact: true })
  await exit.scrollIntoViewIfNeeded()
  await expect(exit).toBeInViewport({ ratio: 1 })
})

test('suspended workspace recovery evidence', async ({ ownerPage: page }) => {
  test.skip(
    process.env.EVIDENCE_SUSPENDED !== '1',
    'Opt in to reversible suspension of the local demo workspace.'
  )
  await page.goto('/admin')
  const panel = page
    .getByRole('heading', { name: 'Starter Lab', exact: true })
    .locator('../../..')
  await panel
    .getByLabel('Internal reason', { exact: true })
    .fill('Temporary layout evidence capture')
  await panel
    .getByLabel('Customer explanation', { exact: true })
    .fill('This workspace is temporarily suspended for a local layout review.')
  await panel.getByRole('button', { name: 'Suspend workspace', exact: true }).click()
  await expect(
    panel.getByRole('button', { name: 'Reactivate workspace', exact: true })
  ).toBeVisible()
  // oxlint-disable-next-line effect/noTryCatch -- Playwright must restore the local workspace even if a browser assertion fails.
  try {
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 1000 },
      { name: 'mobile', width: 390, height: 844 }
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await capture(
        page,
        '/workspaces/starter-lab/suspended',
        'Starter Lab is suspended',
        `workspace-suspended-${viewport.name}`
      )
    }
  } finally {
    await page.goto('/admin')
    await panel
      .getByLabel('Internal reason', { exact: true })
      .fill('Layout evidence captured; restore local workspace')
    await panel
      .getByRole('button', { name: 'Reactivate workspace', exact: true })
      .click()
    await expect(
      panel.getByRole('button', { name: 'Suspend workspace', exact: true })
    ).toBeVisible()
  }
})

test('short desktop rail and mobile footer remain reachable', async ({
  ownerPage: page
}) => {
  test.skip(phase !== 'after', 'Verifies accessibility of the new app frame.')
  await page.setViewportSize({ width: 1440, height: 400 })
  await page.goto('/workspaces/starter-lab')
  const settings = page
    .getByRole('navigation', { name: 'Global navigation' })
    .getByRole('link', { name: 'Open Settings', exact: true })
  const userMenu = page.getByRole('button', { name: 'Open user menu', exact: true })
  await settings.scrollIntoViewIfNeeded()
  await expect(settings).toBeInViewport({ ratio: 1 })
  await expect(userMenu).toBeInViewport({ ratio: 1 })
  const settingsBounds = await settings.boundingBox()
  const accountBounds = await userMenu.boundingBox()
  expect(settingsBounds).not.toBeNull()
  expect(accountBounds).not.toBeNull()
  if (settingsBounds !== null && accountBounds !== null) {
    expect(settingsBounds.y + settingsBounds.height).toBeLessThanOrEqual(
      accountBounds.y
    )
  }
  for (const width of [390, 700]) {
    await page.setViewportSize({ width, height: 844 })
    const support = page
      .getByRole('contentinfo')
      .getByRole('link', { name: 'Support', exact: true })
    await expect(support).toBeInViewport({ ratio: 1 })
    const target = await support.boundingBox()
    expect(target).not.toBeNull()
    expect(target?.height).toBeGreaterThanOrEqual(44)
    expect(target?.width).toBeGreaterThanOrEqual(44)
  }
})

test('member forbidden workspace evidence', async ({ page }) => {
  await signInWithPassword(page, 'engineer@example.com', '/account')
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await capture(
      page,
      '/workspaces/starter-lab/audit',
      'Audit access denied',
      `workspace-forbidden-${viewport.name}`
    )
  }
})

async function captureSetupSheet(page: Page, path: string, name: string) {
  await page.goto(path)
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await expect(page.locator('aside.app-context')).toHaveCount(0)
  const main = page.getByRole('main')
  const bounds = await main.boundingBox()
  expect(bounds).not.toBeNull()
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeGreaterThanOrEqual(
    (page.viewportSize()?.width ?? 0) - 1
  )
  const setup = page.getByRole('button', { name: 'Set up your workspace', exact: true })
  const sheet = page.getByRole('dialog', { name: 'Set up your workspace', exact: true })
  await expect(sheet).toBeHidden()
  await setup.click()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('Invite a member', { exact: true })).toBeVisible()
  await expect(sheet).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() => sheet.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({
    path: resolve(output, 'after', `${name}.png`),
    animations: 'disabled'
  })
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.setViewportSize({ width: 390, height: 400 })
    const developerSetup = sheet.getByText('Developer setup', { exact: true })
    await developerSetup.scrollIntoViewIfNeeded()
    await expect(developerSetup).toBeInViewport({ ratio: 1 })
    await developerSetup.click()
    const lastStep = sheet.getByRole('link').last()
    await lastStep.scrollIntoViewIfNeeded()
    await expect(lastStep).toBeInViewport({ ratio: 1 })
  }
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(setup).toBeFocused()
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 }
]) {
  test.describe(`on-demand setup ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })
    test.beforeEach(() => {
      test.skip(
        phase !== 'after',
        'Verifies the on-demand setup sheet replacing inline setup.'
      )
    })
    test('demo', async ({ page }) => {
      await captureSetupSheet(page, '/demo', `demo-setup-open-${viewport.name}`)
    })
    test('workspace', async ({ ownerPage }) => {
      await captureSetupSheet(
        ownerPage,
        '/workspaces/starter-lab',
        `workspace-setup-open-${viewport.name}`
      )
    })
  })
}
