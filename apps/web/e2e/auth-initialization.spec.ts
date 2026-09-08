import { expect, test, type Route } from '@playwright/test'

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('sign-in cannot accept credentials', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.getByLabel('Email', { exact: true })).toBeDisabled()
    await expect(page.getByLabel('Password', { exact: true })).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Continue', exact: true })
    ).toBeDisabled()
    await expect(
      page.getByRole('status').filter({ hasText: 'reload with JavaScript enabled.' })
    ).toBeVisible()
  })
})

test('sign-in enables credential entry only after JavaScript attaches', async ({
  page
}) => {
  const pausedScripts: Array<Route> = []
  let holdScripts = true
  await page.route('**/*', async (route) => {
    if (holdScripts && route.request().resourceType() === 'script') {
      pausedScripts.push(route)
    } else {
      await route.continue()
    }
  })
  await page.goto('/sign-in', { waitUntil: 'commit' })
  const email = page.getByLabel('Email', { exact: true })
  const password = page.getByLabel('Password', { exact: true })
  await expect(email).toBeDisabled()
  await expect(password).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Continue', exact: true })
  ).toBeDisabled()
  holdScripts = false
  // oxlint-disable-next-line effect/noNewPromise -- This test releases intercepted Playwright requests; it does not implement application behavior.
  await Promise.all(pausedScripts.map((route) => route.continue()))
  await page.unroute('**/*')
  await page.locator('form[data-hydrated="true"]').waitFor()
  await expect(email).toBeEnabled()
  await expect(password).toBeEnabled()
  await email.fill('audit@example.invalid')
  await password.fill('audit-only-placeholder')
  await expect(email).toHaveValue('audit@example.invalid')
  await expect(password).toHaveValue('audit-only-placeholder')
  await expect(page).toHaveURL(/\/sign-in$/u)
})
