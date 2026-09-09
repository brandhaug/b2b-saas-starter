import { expect, test } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { isolatedClientIp } from './test-isolation'

const isolatedAccountPassword = 'i18n-e2e-password'

test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(testInfo.testId)
  })
})

test('switches public language, keeps it through navigation and refresh, and exposes alternates', async ({
  page
}) => {
  await page.goto('/en/#faq')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('combobox', { name: 'Language', exact: true }).click()
  await page.getByRole('option', { name: 'Norsk bokmål' }).click()
  await expect(page).toHaveURL(/\/nb\/?(?:#faq)?$/u)
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
    'href',
    /\/en\/?(?:#faq)?$/u
  )
  await page
    .getByRole('link', { name: /dokumentasjon/iu })
    .first()
    .click()
  await expect(page).toHaveURL(/\/nb\/docs\/?$/u)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await expect(page.getByRole('combobox', { name: 'Språk', exact: true })).toHaveValue(
    'nb'
  )
})

test('warns before a language switch discards form edits', async ({ page }) => {
  await page.goto('/sign-in')
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByRole('textbox', { name: /email/iu }).fill('draft@example.com')
  await page.getByRole('combobox', { name: 'Language', exact: true }).click()
  await page.getByRole('option', { name: 'Norsk bokmål' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /email/iu })).toHaveValue(
    'draft@example.com'
  )
  await page.getByRole('combobox', { name: 'Language', exact: true }).click()
  await page.getByRole('option', { name: 'Norsk bokmål' }).click()
  await page.getByRole('button', { name: 'Switch language', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await expect(page).toHaveURL(/\/sign-in$/u)
  await expect(page.getByRole('textbox', { name: /e-post/iu })).toHaveValue('')
})

test('detects browser language without a cookie and keeps private routes unprefixed', async ({
  browser,
  baseURL
}) => {
  const context = await browser.newContext({
    locale: 'nb-NO',
    baseURL: baseURL ?? 'http://localhost:3071'
  })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page).toHaveURL(/\/nb\/?$/u)
  await page.goto('/sign-in')
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await expect(page).toHaveURL(/\/sign-in$/u)
  await context.close()
})

test('saved account language and time zone override browser preferences in a new context', async ({
  page,
  context,
  browser,
  baseURL
}, testInfo) => {
  test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
  const headers = { origin: baseURL ?? 'http://localhost:3071' }
  // The request shares this browser context's cookies. Every run owns its
  // account, including retries and runs against an already populated local D1.
  const signup = await context.request.post('/api/auth/sign-up/email', {
    headers,
    data: {
      name: 'I18n E2E',
      email: `i18n-${crypto.randomUUID()}@example.com`,
      password: isolatedAccountPassword
    }
  })
  await expect(signup).toBeOK()
  // oxlint-disable-next-line effect/noTryCatch -- Playwright owns the temporary account lifecycle; cleanup must run after any assertion failure
  try {
    await page.goto('/account')
    await page.locator('html[data-authenticated="true"]').waitFor()
    await page.locator('form').getByRole('combobox', { name: 'Language' }).click()
    await page.getByRole('option', { name: 'Norsk bokmål' }).click()
    await page.locator('input[name="timeZone"]').fill('Europe/Oslo')
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
    await expect(page.locator('html')).toHaveAttribute('data-time-zone', 'Europe/Oslo')

    const secondContext = await browser.newContext({
      baseURL,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'cf-connecting-ip': isolatedClientIp(`${testInfo.testId}:second`)
      }
    })
    // oxlint-disable-next-line effect/noTryCatch -- Playwright owns browser contexts; always release this one and delete the temporary account
    try {
      // Only the login travels. The second browser has no remembered language.
      const cookies = await page.context().cookies()
      await secondContext.addCookies(
        cookies.filter((cookie) => cookie.name !== 'starter_locale')
      )
      const secondPage = await secondContext.newPage()
      await secondPage.goto('/account')
      await expect(secondPage.locator('html')).toHaveAttribute('lang', 'nb')
      await expect(secondPage.locator('html')).toHaveAttribute(
        'data-time-zone',
        'Europe/Oslo'
      )
      await expect(
        secondPage.locator('form').getByRole('combobox', { name: 'Språk' })
      ).toContainText('Norsk bokmål')
      await expect(secondPage.locator('input[name="timeZone"]')).toHaveValue(
        'Europe/Oslo'
      )
      await secondPage.screenshot({
        path: testInfo.outputPath('account-nb.png'),
        fullPage: true
      })
    } finally {
      await secondContext.close()
    }
  } finally {
    // The app's deletion capability owns cleanup; the raw auth endpoint is
    // intentionally unavailable. Either language may be active after a failure.
    await page.goto('/account')
    await page
      .locator('header [data-slot="select-trigger"]:enabled')
      .waitFor({ state: 'attached' })
    await page.locator('#delete-account-password').fill(isolatedAccountPassword)
    await page.getByRole('button', { name: /^(Delete account|Slett konto)$/ }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', {
        name: /^(Yes, delete my account|Ja, slett kontoen min)$/
      })
      .click()
    // Signup alone does not record recent authentication. The refused deletion
    // must return here for a deliberate retry after verifying the password.
    await page.waitForURL(/\/verify-authentication/)
    await page.locator('form[data-hydrated="true"]').waitFor()
    await page.getByLabel(/^(Password|Passord)$/).fill(isolatedAccountPassword)
    await page
      .getByRole('button', { name: /^(Confirm password|Bekreft passord)$/ })
      .click()
    await page.waitForURL(/\/account$/)
    await page
      .locator('header [data-slot="select-trigger"]:enabled')
      .waitFor({ state: 'attached' })
    await expect(page.locator('#delete-account-password')).toBeVisible()
    await page.locator('#delete-account-password').fill(isolatedAccountPassword)
    await page.getByRole('button', { name: /^(Delete account|Slett konto)$/ }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', {
        name: /^(Yes, delete my account|Ja, slett kontoen min)$/
      })
      .click()
    await page.waitForURL(/\/sign-in/)
  }
})

test('the language picker works in the Norwegian mobile menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/nb/')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Åpne meny', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('combobox', { name: 'Språk', exact: true }).click()
  await page.getByRole('option', { name: 'English' }).click()
  await expect(page).toHaveURL(/\/en\/?$/u)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(390)
})
