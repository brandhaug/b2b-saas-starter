import { type Page } from '@playwright/test'
import { expect, test } from './authentication'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { isolatedClientIp } from './test-isolation'

test.use({ viewport: { width: 320, height: 740 }, reducedMotion: 'reduce' })

test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(testInfo.testId)
  })
})

async function expectPageFits(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    )
    .toBeLessThanOrEqual(1)
}

// oxlint-disable-next-line vitest/prefer-each -- Playwright parameterizes tests with loops; its test API has no each method.
for (const { locale, signInLabel } of [
  { locale: 'en', signInLabel: 'Sign in' },
  { locale: 'nb', signInLabel: 'Logg inn' }
]) {
  test(`the ${locale} public header keeps sign-in reachable at 320px`, async ({
    page
  }) => {
    await page.goto(`/${locale}/`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectPageFits(page)
    await expect(
      page.getByRole('button', { name: signInLabel, exact: true })
    ).toBeInViewport({ ratio: 1 })
  })
}

test('the short preview navigation can scroll to the explicit sign-in exit', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 400 })
  await page.goto('/demo')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await expectPageFits(page)
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const account = dialog.getByRole('link', { name: 'Try sign-in', exact: true })
  await account.scrollIntoViewIfNeeded()
  await expect(account).toBeInViewport({ ratio: 1 })
  await account.click()
  await page.waitForURL(/\/(?:account|sign-in)(?:\?|$)/u)
  await expect(dialog).toBeHidden()
})

test.describe('owner controls on a narrow screen', () => {
  test.beforeEach(async ({ ownerPage }) => {
    test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
    await ownerPage.goto('/workspaces/starter-lab/members')
    await ownerPage
      .locator('header [data-slot="select-trigger"]:enabled')
      .waitFor({ state: 'attached' })
  })

  test('the roster and armed removal fit without horizontal panning', async ({
    page
  }) => {
    await expectPageFits(page)
    await expect(
      page.getByRole('button', { name: 'Open user menu', exact: true })
    ).toBeInViewport({ ratio: 1 })
    const member = page
      .getByRole('listitem')
      .filter({ hasText: 'engineer@example.com' })
    await member
      .getByRole('button', { name: 'Remove Product Engineer', exact: true })
      .click()
    const confirm = member.getByRole('button', { name: /confirm remove/iu })
    await confirm.scrollIntoViewIfNeeded()
    await expect(confirm).toBeInViewport({ ratio: 1 })
    await expectPageFits(page)
    await page.keyboard.press('Escape')
  })

  test('enlarged confirmation text remains scrollable and cancellable', async ({
    page
  }) => {
    await page.goto('/workspaces/starter-lab/settings')
    await page
      .locator('header [data-slot="select-trigger"]:enabled')
      .waitFor({ state: 'attached' })
    await page.getByRole('button', { name: 'Delete workspace', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await page.setViewportSize({ width: 320, height: 256 })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
    const confirm = dialog.getByRole('button', {
      name: 'Delete this workspace permanently',
      exact: true
    })
    await confirm.scrollIntoViewIfNeeded()
    // Allow subpixel clipping from the doubled text size and scroll rounding.
    await expect(confirm).toBeInViewport({ ratio: 0.99 })
    await expect(dialog).toBeInViewport({ ratio: 1 })
    await expect
      .poll(() =>
        dialog.evaluate((element) => element.scrollWidth - element.clientWidth)
      )
      .toBeLessThanOrEqual(1)
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
    await cancel.scrollIntoViewIfNeeded()
    await expect(cancel).toBeInViewport({ ratio: 0.99 })
    await cancel.click()
    await expect(dialog).toBeHidden()
  })
})
