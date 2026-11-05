import { test, expect } from '@playwright/test'

test('original assertion failure stays visible', async ({ page }, info) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveText('owned server')
  if (process.env.POLICY_CANCEL) {
    console.log('POLICY_CANCEL_READY')
    await page.waitForURL('/cancelled-before-navigation')
    return
  }
  expect(info.retry).toBeGreaterThan(0)
})
