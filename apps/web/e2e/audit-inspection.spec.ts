import { Deferred, Effect } from 'effect'
import { expect, test, type Page } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'

function auditRequest(url: URL) {
  return (
    url.pathname.startsWith('/_serverFn/') &&
    Buffer.from(url.pathname.slice('/_serverFn/'.length), 'base64url')
      .toString()
      .includes('workspace-audit.ts')
  )
}

const auditPath = '/workspaces/starter-lab/audit'

async function signIn(page: Page, email = 'demo@starter.local') {
  await page.goto(`/sign-in?redirect=${encodeURIComponent(auditPath)}`)
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill('demo-starter-password')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForURL((url) => url.pathname === auditPath)
}

test.beforeEach(() => {
  test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
})

test('event links preserve filters, keyboard focus, and back/forward history', async ({
  page
}) => {
  await signIn(page)
  await page.getByRole('combobox', { name: 'Filter by actor' }).click()
  await page.getByRole('option', { name: 'Ops Lead', exact: true }).click()
  await expect(page).toHaveURL(`${auditPath}?actor=usr_ops`)
  const link = page.getByRole('link', { name: /^Inspect API token created/ }).first()
  await expect(link).toHaveAttribute('href', /actor=usr_ops.*event=aud_token/)
  await expect(page.getByRole('button', { name: /^Sort by/ })).toHaveCount(0)
  await link.focus()
  await link.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Audit event' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('aud_token', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(`${auditPath}?actor=usr_ops`)
  await expect(link).toBeFocused()
  await page.goForward()
  await expect(dialog).toBeVisible()
  await page.goBack()
  await expect(dialog).toHaveCount(0)
  await expect(link).toBeFocused()
  await link.click()
  await expect(dialog).toBeVisible()
  await page.reload()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page).toHaveURL(`${auditPath}?actor=usr_ops`)
  await expect(link).toBeFocused()
})

test('a direct link resolves outside the visible list and closes in place on mobile', async ({
  page
}, testInfo) => {
  await signIn(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${auditPath}?eventType=no.such.event&cursor=invalid&event=aud_token`)
  const dialog = page.getByRole('dialog', { name: 'Audit event' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('tok_ops', { exact: true })).toBeVisible()
  await expect(dialog.getByText('usr_ops', { exact: true })).toBeVisible()
  await expect(dialog.getByText('No permitted metadata recorded.')).toBeVisible()
  const dimensions = await dialog.evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
    width: element.getBoundingClientRect().width
  }))
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
  expect(dimensions.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('audit-mobile.png') })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(`${auditPath}?eventType=no.such.event&cursor=invalid`)
  await expect(page.getByRole('combobox', { name: 'Filter by actor' })).toBeFocused()
})

test('missing and foreign-workspace events have the same unavailable result', async ({
  page
}) => {
  await signIn(page)
  // oxlint-disable no-await-in-loop -- each navigation replaces the same browser page
  for (const event of ['missing', 'aud_admin']) {
    await page.goto(`${auditPath}?event=${event}`)
    const dialog = page.getByRole('dialog', { name: 'Audit event' })
    await expect(dialog.getByText('Event not found', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Event ID', { exact: true })).toHaveCount(0)
  }
  // oxlint-enable no-await-in-loop
})

test('a member cannot inspect an event by direct link', async ({ page }) => {
  await signIn(page, 'engineer@example.com')
  await page.goto(`${auditPath}?event=aud_token`)
  await expect(page.getByRole('dialog', { name: 'Audit event' })).toHaveCount(0)
  await expect(page.getByText('aud_token', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Audit access denied' })).toBeVisible()
})

test('a failed detail request shows a retryable error instead of a missing event', async ({
  page
}) => {
  await signIn(page)
  await expect(
    page.getByRole('link', { name: /^Inspect API token created/ })
  ).toBeVisible()
  const release = Deferred.makeUnsafe<boolean>()
  await page.route(auditRequest, async (route) => {
    await Effect.runPromise(Deferred.await(release))
    await route.abort('failed')
  })
  await page.getByRole('link', { name: /^Inspect API token created/ }).click()
  await expect(page.getByText('Loading…', { exact: true })).toBeAttached()
  await Effect.runPromise(Deferred.succeed(release, true))
  await expect(
    page.getByRole('heading', { name: 'Audit trail unavailable' })
  ).toBeVisible()
  await expect(page.getByText('Event not found', { exact: true })).toHaveCount(0)
  await page.unroute(auditRequest)
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Audit event' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(auditPath)
  await expect(
    page.getByRole('link', { name: /^Inspect API token created/ })
  ).toBeFocused()
})
