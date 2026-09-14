/* oxlint-disable effect/noNewPromise -- These promises execute in the browser realm against native Web Animations and requestAnimationFrame APIs, without the application Effect runtime. */
import { expect, test, type Page } from '@playwright/test'

async function slowMotion(page: Page) {
  // Exercise both the original keyframes and their transition replacements.
  await page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- Playwright serializes this callback; its event handler must be declared in the browser realm.
    function slow(event: Event) {
      if (event.target instanceof Element) {
        for (const animation of event.target.getAnimations()) {
          animation.playbackRate = 0.1
        }
      }
    }
    document.addEventListener('animationstart', slow)
    document.addEventListener('transitionrun', slow)
  })
}

test('an opening FAQ reverses from its current height without jumping', async ({
  page
}) => {
  await page.goto('/')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  const question = page.locator('#faq').getByRole('button').nth(1)
  await question.scrollIntoViewIfNeeded()

  await slowMotion(page)
  await question.click()
  const panelId = await question.getAttribute('aria-controls')
  expect(panelId).not.toBeNull()
  const panel = page.locator(`[id="${panelId}"]`)
  await expect
    .poll(() => panel.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(8)

  // Pause at an intermediate height so React's close-commit latency cannot
  // advance the opening. Two frames then allow CSS to commit the reversal.
  const heights = await question.evaluate(async (element) => {
    const content = document.getElementById(element.getAttribute('aria-controls') ?? '')
    if (content === null || !(element instanceof HTMLElement)) {
      // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- A missing test fixture is a browser assertion defect, not an application failure.
      throw new Error('FAQ trigger must control a panel')
    }
    const opening = content.getAnimations()
    for (const animation of opening) {
      animation.pause()
    }
    await Promise.all(opening.map((animation) => animation.ready))
    const before = content.getBoundingClientRect().height
    const full = content.scrollHeight
    element.click()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    return { before, full, after: content.getBoundingClientRect().height }
  })
  expect(heights.before).toBeLessThan(heights.full)
  expect(heights.after).toBeLessThanOrEqual(heights.before + 1)
  await expect(question).toHaveAttribute('aria-expanded', 'false')
  await expect(panel).toBeHidden()
})

test('command palette stays painted during dismissal and can be reopened', async ({
  page
}) => {
  await page.goto('/demo/members')
  const search = page
    .getByRole('button', { name: 'Search', exact: true })
    .filter({ visible: true })
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await search.click()
  const dialog = page.getByRole('dialog', { name: 'Command menu' })
  await expect(dialog).toBeVisible()
  await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
  await slowMotion(page)
  await page.keyboard.press('Escape')
  // Role queries omit the inert closing dialog, but its pixels should remain
  // until the exit completes instead of disappearing on the Escape keypress.
  const closingDialog = page.getByRole('dialog', {
    name: 'Command menu',
    includeHidden: true
  })
  await expect(closingDialog).toBeVisible()
  await expect(closingDialog).toBeHidden()
  await search.click()
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('combobox')).toBeFocused()
})

test('a confirmation stays centered while it fades out', async ({ page }) => {
  await page.goto('/demo/settings')
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Delete workspace', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { includeHidden: true })
  await expect(dialog).toBeVisible()
  const centerBefore = await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
    const bounds = element.getBoundingClientRect()
    return bounds.y + bounds.height / 2
  })
  await slowMotion(page)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  const centerAfter = await dialog.evaluate(async (element) => {
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    const bounds = element.getBoundingClientRect()
    return bounds.y + bounds.height / 2
  })
  // The exit may move a few pixels, never half the dialog's height from
  // accidentally replacing the translate used to center it.
  expect(Math.abs(centerAfter - centerBefore)).toBeLessThanOrEqual(8)
  await expect(dialog).toBeHidden()
})
