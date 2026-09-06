import { expect, test } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'

test('switches public language, keeps it through navigation and refresh, and exposes alternates', async ({
  page
}) => {
  await page.goto('/en/faq')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('nb')
  await expect(page).toHaveURL(/\/nb\/faq$/u)
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
    'href',
    /\/en\/faq$/u
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
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('nb')
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /email/iu })).toHaveValue(
    'draft@example.com'
  )
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('nb')
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
  await page.goto('/faq')
  await expect(page).toHaveURL(/\/nb\/faq$/u)
  await page.goto('/sign-in')
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await expect(page).toHaveURL(/\/sign-in$/u)
  await context.close()
})

test('saved account language and time zone override browser preferences in a new context', async ({
  page,
  browser,
  baseURL
}, testInfo) => {
  test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
  await page.goto('/sign-in?redirect=%2Faccount')
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Email', { exact: true }).fill('demo@starter.local')
  await page.getByLabel('Password', { exact: true }).fill('demo-starter-password')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/u)
  await expect(page.locator('html')).toHaveAttribute('data-authenticated', 'true')
  await page.locator('select[name="locale"]').selectOption('nb')
  await page.locator('input[name="timeZone"]').fill('Europe/Oslo')
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await expect(page.locator('html')).toHaveAttribute('data-time-zone', 'Europe/Oslo')

  const secondContext = await browser.newContext({
    baseURL,
    locale: 'en-US',
    timezoneId: 'America/New_York'
  })
  // oxlint-disable-next-line effect/noTryCatch -- Playwright owns browser contexts; always release this one and restore the local demo preference
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
    await expect(secondPage.locator('select[name="locale"]')).toHaveValue('nb')
    await expect(secondPage.locator('input[name="timeZone"]')).toHaveValue(
      'Europe/Oslo'
    )
    await secondPage.screenshot({
      path: testInfo.outputPath('account-nb.png'),
      fullPage: true
    })
  } finally {
    await secondContext.close()
    await page.locator('select[name="locale"]').selectOption('en')
    await page.locator('input[name="timeZone"]').fill('UTC')
    await page.getByRole('button', { name: 'Lagre innstillinger', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  }
})

test('the language picker works in the Norwegian mobile menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/nb/faq')
  await expect(page.locator('header select')).toBeEnabled({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Åpne meny', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('combobox', { name: 'Språk', exact: true }).selectOption('en')
  await expect(page).toHaveURL(/\/en\/faq$/u)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(390)
})
