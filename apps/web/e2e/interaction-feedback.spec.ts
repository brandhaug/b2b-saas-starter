import { expect, test } from '@playwright/test'

test('keyboard menus retain visible focus and short-screen commands stay reachable', async ({
  page
}) => {
  await page.goto('/demo/api-tokens')
  await page.locator('header [data-slot="select-trigger"]:enabled').waitFor()
  const actions = page.getByRole('button', { name: /^More actions for / }).first()
  await actions.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('menuitem', { name: 'Replace', exact: true })
  ).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const item = page.getByRole('menuitem', { name: 'Revoke', exact: true })
  await expect(item).toBeFocused()
  await expect(item).not.toHaveCSS('box-shadow', 'none')
  await expect(page.getByRole('menu')).toHaveCSS('transition-duration', '0s')
  await page.keyboard.press('Escape')
  await expect(actions).toBeFocused()

  await page.setViewportSize({ width: 390, height: 400 })
  await page.keyboard.press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog', { name: 'Command menu' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toBeInViewport({ ratio: 1 })
  await expect(dialog).toHaveCSS('animation-name', 'none')
  const input = dialog.getByRole('combobox', { name: 'Search commands' })
  await expect(input).toBeFocused()
  await expect(input).toHaveCSS('font-size', '16px')
  await input.fill('Support')
  const option = dialog.getByRole('option', { name: 'Support', exact: true }).first()
  await expect(option).toBeInViewport({ ratio: 1 })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('pointer press feedback respects reduced motion and keyboard activation', async ({
  page
}) => {
  await page.goto('/demo')
  await page.locator('header [data-slot="select-trigger"]:enabled').waitFor()
  const search = page.getByRole('button', { name: 'Search', exact: true })
  await search.hover()
  await page.mouse.down()
  await expect(search).toHaveCSS('transform', 'matrix(0.97, 0, 0, 0.97, 0, 0)')
  await page.mouse.up()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await search.hover()
  await page.mouse.down()
  await expect(search).toHaveCSS('transform', 'none')
  await page.mouse.up()
  await page.keyboard.press('Escape')
  await search.focus()
  await page.keyboard.down('Space')
  await expect(search).toHaveCSS('transform', 'none')
  await page.keyboard.up('Space')
})

test('reduced-motion drawers preserve a fade without positional movement', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/demo/members')
  await page.locator('header [data-slot="select-trigger"]:enabled').waitFor()
  await page.getByRole('button', { name: 'Invite a member', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Invite a member' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('animation-name', 'none')
  await expect(dialog).not.toHaveCSS('transition-duration', '0s')
  await expect(dialog).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
