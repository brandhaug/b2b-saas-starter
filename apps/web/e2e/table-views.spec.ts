import { expect, test, type Locator, type Page } from '@playwright/test'

async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('members table filters support all and any matching and survive reload/back', async ({
  page
}) => {
  await page.goto('/demo/members')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  const filterButton = page.getByRole('button', { name: /^Filter/ })
  await filterButton.click()
  const filterDialog = page.getByRole('dialog', { name: 'Filter' })
  await filterDialog.getByRole('button', { name: 'Add filter' }).click()
  await choose(
    page,
    filterDialog.getByRole('combobox', { name: 'Field' }).nth(0),
    'Role'
  )
  await choose(
    page,
    filterDialog.getByRole('combobox', { name: 'Operator' }).nth(0),
    'Is'
  )
  await choose(
    page,
    filterDialog.getByRole('combobox', { name: 'Value' }).nth(0),
    'member'
  )
  await filterDialog.getByRole('button', { name: 'Add filter' }).click()
  await choose(
    page,
    filterDialog.getByRole('combobox', { name: 'Field' }).nth(1),
    'Email'
  )
  await filterDialog.getByRole('textbox', { name: 'Value' }).fill('example.com')

  await expect(page.getByText('Product Engineer', { exact: true })).toBeVisible()
  await expect(page.getByText('Demo Admin', { exact: true })).not.toBeVisible()
  await expect(page).toHaveURL(/tableViews=/)

  await filterDialog.getByRole('button', { name: 'Any' }).click()
  await expect(page.getByText('Martin Brandhaug', { exact: true })).toBeVisible()
  await expect(page.getByText('Ops Lead', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Martin Brandhaug', { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByText('Product Engineer', { exact: true })).toBeVisible()
  await expect(page.getByText('Martin Brandhaug', { exact: true })).not.toBeVisible()
  await expect(page.getByText('Demo Admin', { exact: true })).not.toBeVisible()
})

test('table sort priorities persist and the mobile filter popup fits the viewport', async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/demo/members')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: /^Sort/ }).click()
  const sortDialog = page.getByRole('dialog', { name: 'Sort' })
  await sortDialog.getByRole('button', { name: 'Add sort' }).click()
  await choose(page, sortDialog.getByRole('combobox', { name: 'Field' }).nth(0), 'Role')
  await sortDialog.getByRole('button', { name: 'Add sort' }).click()
  await choose(page, sortDialog.getByRole('combobox', { name: 'Field' }).nth(1), 'Name')
  const rows = page.locator('[data-slot="item"]')
  await expect(rows.nth(0)).toContainText('Ops Lead')
  await expect(rows.nth(1)).toContainText('Product Engineer')
  await sortDialog.getByRole('button', { name: 'Move up' }).nth(1).click()
  await expect(rows.nth(0)).toContainText('Demo Admin')
  await expect(rows.nth(1)).toContainText('Martin Brandhaug')
  await expect(page).toHaveURL(/tableViews=/)
  const sortBox = await sortDialog.boundingBox()
  expect(sortBox).not.toBeNull()
  if (sortBox === null) {
    return
  }
  expect(sortBox.x + sortBox.width).toBeLessThanOrEqual(360)
  expect(sortBox.y + sortBox.height).toBeLessThanOrEqual(740)
  await page.reload()
  await expect(page.getByText('Demo Admin', { exact: true })).toBeVisible()
})
