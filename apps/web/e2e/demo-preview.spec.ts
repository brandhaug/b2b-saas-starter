/* eslint-disable no-await-in-loop -- each navigation checks the same browser tab in sequence */
import { expect, test } from '@playwright/test'

test('visitors browse every workspace section without authentication', async ({
  page
}) => {
  const applicationRequests: Array<string> = []
  await page.route('**/api/auth/**', (route) => {
    applicationRequests.push(route.request().url())
    return route.abort()
  })
  await page.goto('/demo')
  await expect(
    page.getByRole('heading', { name: 'Starter Lab', exact: true })
  ).toBeVisible()
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  const navigation = page.locator('aside').getByRole('navigation')
  for (const name of [
    'Members',
    'Billing',
    'API tokens',
    'Webhook endpoints',
    'Audit trail',
    'General',
    'Assistant'
  ]) {
    await navigation.getByRole('link', { name, exact: true }).click()
    await expect(page).toHaveURL(/\/demo\//)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(
      page.getByText('Preview with sample data. Actions do not make changes.')
    ).toBeVisible()
  }
  expect(applicationRequests).toEqual([])
})

test('preview forms and destructive dialogs explain refusal without sending or changing data', async ({
  page
}) => {
  const submittedRequests: Array<string> = []
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      !new URL(request.url()).pathname.startsWith('/__tsd/')
    ) {
      submittedRequests.push(request.url())
    }
  })
  await page.goto('/demo/members')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Invite a member', exact: true }).click()
  await page.getByLabel('Invite by email', { exact: true }).fill('visitor@example.com')
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click()
  await expect(
    page.getByText(/This preview is read-only. No changes were made./)
  ).toBeVisible()
  await expect(page).toHaveURL(/\/demo\/members$/)

  await page.goto('/demo/settings')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Delete workspace', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(/Type starter-lab/).fill('starter-lab')
  await dialog
    .getByRole('button', { name: 'Delete this workspace permanently', exact: true })
    .click()
  await expect(
    page.getByText(/This preview is read-only. No changes were made./)
  ).toBeVisible()
  expect(submittedRequests).toEqual([])
})

test('unknown preview sections are not found', async ({ page }) => {
  await page.goto('/demo/does-not-exist')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('token creation, replacement, and webhook creation refuse locally', async ({
  page
}) => {
  const writes: Array<string> = []
  await page.route('**/_serverFn/**', (route) => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().url())
      return route.abort()
    }
    return route.continue()
  })
  await page.goto('/demo/api-tokens')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Create a token', exact: true }).click()
  await page.getByLabel('Token name', { exact: true }).fill('Visitor token')
  await page.getByRole('button', { name: 'Create token', exact: true }).click()
  await expect(
    page.getByText(/This preview is read-only. No changes were made./)
  ).toBeVisible()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Local admin token' })
    .getByRole('button', { name: 'Replace', exact: true })
    .click()
  const replacement = page.getByRole('form', {
    name: 'Replace Local admin token',
    exact: true
  })
  await replacement
    .getByRole('button', { name: 'Create replacement', exact: true })
    .click()
  await expect(
    replacement.getByText(/This preview is read-only. No changes were made./)
  ).toBeVisible()
  await page.goto('/demo/webhooks')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Register an endpoint', exact: true }).click()
  await page
    .getByLabel('Endpoint URL', { exact: true })
    .fill('https://example.com/visitor')
  await page.getByRole('button', { name: 'Create endpoint', exact: true }).click()
  await expect(
    page.getByText(/This preview is read-only. No changes were made./)
  ).toBeVisible()
  expect(writes).toEqual([])
})
