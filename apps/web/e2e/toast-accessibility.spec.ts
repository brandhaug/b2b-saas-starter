import { expect, test } from '@playwright/test'

// Failure cases: English labels leak into Norwegian, the hotkey hint disappears,
// or the live region loses polite announcements.
// oxlint-disable-next-line vitest/prefer-each -- Playwright declares parameterized cases with a loop.
for (const locale of [
  { path: '/', label: 'Notifications' },
  { path: '/no', label: 'Varsler' }
]) {
  test(`toast announcements are localized at ${locale.path}`, async ({ page }) => {
    await page.goto(locale.path)
    const region = page.getByRole('region', { name: `${locale.label} alt+T` })
    await expect(region).toHaveAttribute('aria-live', 'polite')
    await expect(region).toHaveAttribute('aria-relevant', 'additions text')
  })
}
