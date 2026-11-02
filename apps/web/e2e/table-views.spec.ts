import { expect, test, type Locator, type Page } from '@playwright/test'

async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('members table filters support all and any matching and survive reload/back', async ({
  page
}, testInfo) => {
  await page.goto('/demo/members')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Role', exact: true }).click()
  const member = page.getByRole('radio', { name: 'member', exact: true })
  await expect(member).not.toBeChecked()
  await page.getByRole('textbox', { name: 'Search values…' }).fill('member')
  await member.click()
  await page.getByRole('button', { name: 'Role: Is member', exact: true }).click()
  await expect(member).toBeChecked()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Email', exact: true }).click()
  await page.getByRole('textbox', { name: 'Value' }).fill('example.com')

  await expect(page.getByText('Product Engineer', { exact: true })).toBeVisible()
  await expect(page.getByText('Demo Admin', { exact: true })).not.toBeVisible()
  await expect(page).toHaveURL(/tableViews=/)

  await page.getByRole('button', { name: 'Any', exact: true }).click()
  await expect(page.getByText('Martin Brandhaug', { exact: true })).toBeVisible()
  await expect(page.getByText('Ops Lead', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Martin Brandhaug', { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByText('Product Engineer', { exact: true })).toBeVisible()
  await expect(page.getByText('Martin Brandhaug', { exact: true })).not.toBeVisible()
  await expect(page.getByText('Demo Admin', { exact: true })).not.toBeVisible()
  await testInfo.attach('members-default-filters', {
    body: await page.screenshot(),
    contentType: 'image/png'
  })
})

test('table sort priorities persist and the mobile filter popup fits the viewport', async ({
  page
}, testInfo) => {
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
  await sortDialog.getByRole('combobox', { name: 'Field' }).nth(0).click()
  await expect(page.getByRole('option', { name: 'Name', exact: true })).toHaveCount(0)
  await page.getByRole('option', { name: 'Role', exact: true }).click()
  const rows = page.locator('[data-slot="item"]')
  await expect(rows.nth(0)).toContainText('Ops Lead')
  await expect(rows.nth(1)).toContainText('Product Engineer')
  await sortDialog.getByRole('button', { name: 'Move up' }).nth(1).click()
  await choose(
    page,
    sortDialog.getByRole('combobox', { name: 'Direction' }).nth(1),
    'Descending'
  )
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
  await testInfo.attach('members-mobile-sort', {
    body: await page.screenshot(),
    contentType: 'image/png'
  })
  await page.reload()
  await expect(rows.nth(0)).toContainText('Demo Admin')
  await expect(rows.nth(1)).toContainText('Martin Brandhaug')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: /^Sort/ }).click()
  await expect(sortDialog.getByRole('combobox', { name: 'Field' })).toHaveText([
    /^Name/,
    /^Role/
  ])
  await expect(sortDialog.getByRole('combobox', { name: 'Direction' })).toHaveText([
    /^Ascending/,
    /^Descending/
  ])
})

test('text filters keep focus and the selected operator, then clear persisted filters and sorts', async ({
  page
}) => {
  await page.goto('/demo/members')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Name', exact: true }).click()
  await choose(page, page.getByRole('combobox', { name: 'Operator' }), 'Is')
  const value = page.getByRole('textbox', { name: 'Value' })
  await value.pressSequentially('Product Engineer')
  await expect(value).toBeFocused()
  await expect(value).toHaveValue('Product Engineer')
  await expect(page.getByText('Product Engineer', { exact: true })).toBeVisible()
  await expect(page.getByText('Demo Admin', { exact: true })).toBeHidden()
  await value.press('Backspace')
  await expect(page.getByText('Product Engineer', { exact: true })).toBeHidden()
  await value.pressSequentially('r')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Sort/ }).click()
  const sort = page.getByRole('dialog', { name: 'Sort' })
  await sort.getByRole('button', { name: 'Add sort' }).click()
  await choose(page, sort.getByRole('combobox', { name: 'Field' }), 'Name')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByText('Product Engineer', { exact: true })).toBeVisible()
  await expect(page.getByText('Demo Admin', { exact: true })).toBeHidden()
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(page).not.toHaveURL(/tableViews=/)
  await page.reload()
  await expect(page.getByText('Demo Admin', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sort', exact: true })).toBeVisible()
})
