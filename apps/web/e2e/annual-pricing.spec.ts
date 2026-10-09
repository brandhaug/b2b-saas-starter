import { expect, test } from '@playwright/test'

// Local provider-free evidence: annual totals must stay visibly illustrative.
test('public pricing labels annual example totals without a discount claim', async ({
  page
}, testInfo) => {
  await page.goto('/en/pricing')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Annual', exact: true }).click()
  await expect(page.getByText('$144.00/seat/year', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Catalog example price', { exact: false }).first()
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('annual-pricing-desktop.png'),
    fullPage: true
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: testInfo.outputPath('annual-pricing-mobile.png'),
    fullPage: true
  })
  await page.getByRole('button', { name: 'Monthly', exact: true }).click()
  await expect(page.getByText('$12.00/seat/mo', { exact: true })).toBeVisible()
})
