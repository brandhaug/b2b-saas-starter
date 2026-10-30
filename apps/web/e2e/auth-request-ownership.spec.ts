import { expect, test, type Route } from '@playwright/test'

test('recovery excludes duplicate code requests and allows retry after failure', async ({
  page
}) => {
  const requests: Array<Route> = []
  await page.route('**/api/auth/email-otp/request-password-reset', (route) => {
    requests.push(route)
  })
  await page.goto('/forgot-password')
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Email', { exact: true }).fill('recovery@example.invalid')
  const code = page.getByRole('button', { name: 'Use an email code instead' })
  await code.click()
  await expect(code).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeDisabled()
  await code.dispatchEvent('click')
  expect(requests).toHaveLength(1)
  await requests[0]?.fulfill({ status: 429, json: { code: 'rate_limited' } })
  await expect(page.getByRole('alert')).toContainText('Too many attempts')
  await expect(code).toBeEnabled()
  await code.click()
  await expect(code).toBeDisabled()
  expect(requests).toHaveLength(2)
  await requests[1]?.fulfill({ status: 200, json: { status: true } })
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible()
  await expect(page).toHaveURL(/\/forgot-password$/u)
})

test('a delayed email-code verification cannot navigate after changing address', async ({
  page
}) => {
  await page.route('**/api/auth/email-otp/send-verification-otp', (route) =>
    route.fulfill({ status: 200, json: { success: true } })
  )
  const verification: Array<Route> = []
  await page.route('**/api/auth/sign-in/email-otp', (route) => {
    verification.push(route)
  })
  await page.goto('/sign-in/email-code')
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Email', { exact: true }).fill('first@example.invalid')
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click()
  await page.getByLabel('Digit 1 of 6').fill('123456')
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect(page.getByRole('button', { name: 'Verify and sign in' })).toBeDisabled()
  expect(verification).toHaveLength(1)
  await page.getByRole('button', { name: 'Use a different email' }).click()
  await page.getByLabel('Email', { exact: true }).fill('second@example.invalid')
  await verification[0]?.fulfill({
    status: 200,
    json: { token: 'test-token', user: { id: 'old-attempt' } }
  })
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    'second@example.invalid'
  )
  await expect(page).toHaveURL(/\/sign-in\/email-code$/u)
})
