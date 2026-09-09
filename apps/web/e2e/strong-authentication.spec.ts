import { expect, test } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import {
  confirmPasswordForEnrollment,
  installDemoPasskey,
  signInWithPassword,
  verifyWithPasskey
} from './authentication'
import { isolatedClientIp } from './test-isolation'

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(testInfo.testId)
  })
})

test('password-only owners must verify this session with a passkey', async ({
  page
}, testInfo) => {
  const browserErrors: Array<Error> = []
  page.on('pageerror', (error) => browserErrors.push(error))
  await signInWithPassword(
    page,
    'demo@starter.local',
    '/workspaces/starter-lab/settings'
  )
  await expect(
    page.getByRole('heading', { name: 'Verify your identity' })
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Verify and continue', exact: true }).click()
  await expect(page).toHaveURL(/\/verify-authentication\?redirect=/)
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(
    '/workspaces/starter-lab/settings'
  )

  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.screenshot({
    path: testInfo.outputPath('verify-authentication-desktop.png'),
    fullPage: true
  })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(1280)
  await confirmPasswordForEnrollment(page)
  await page.goto('/admin')
  await expect(
    page.getByRole('heading', { name: 'Verify your identity' })
  ).toBeVisible()
  await page.goto('/workspaces/starter-lab/settings')
  await expect(
    page.getByRole('heading', { name: 'Verify your identity' })
  ).toBeVisible()

  const authenticator = await installDemoPasskey(page)
  await verifyWithPasskey(page, '/workspaces/starter-lab/settings')
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible()
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Verify your identity' })).toHaveCount(
    0
  )
  await expect(
    page.getByRole('heading', { name: 'System admin', exact: true })
  ).toBeVisible()
  await authenticator.cdp.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: authenticator.authenticatorId
  })
  await page.context().clearCookies()
  await signInWithPassword(page, 'demo@starter.local', '/account')
  await page.goto('/admin')
  await expect(
    page.getByRole('heading', { name: 'Verify your identity' })
  ).toBeVisible()
  expect(browserErrors).toEqual([])
})
