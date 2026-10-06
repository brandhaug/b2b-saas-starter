import { createEmailVerificationToken } from 'better-auth/api'
import { submitPurchase } from './purchase-requests'
import { expect, test, installDemoPasskey, signInWithPassword } from './authentication'
import { isolatedClientIp } from './test-isolation'

// Failure cases defined before implementation: lost auth/enrollment return URL,
// substituted plan, unauthorized workspace, duplicate navigation side effects,
// and missing-provider checkout. Provider identity/retry cases remain covered by
// the existing durable checkout contracts.
test.beforeEach(async ({ context }, info) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(info.testId)
  })
})

test('purchase intent survives sign-in and sign-up navigation', async ({ page }) => {
  await page.goto('/pricing')
  const anonymousRefusal = await submitPurchase(page, 'starter-lab')
  expect(await anonymousRefusal.text()).toContain('unauthorized')
  await page.getByRole('button', { name: 'Continue with Team', exact: true }).click()
  await expect(page).toHaveURL(/\/sign-in\?redirect=/)
  await page.getByRole('link', { name: 'Create one' }).click()
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/purchase?plan=team')
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/purchase?plan=team')
})

test('owner selects a workspace and retains the plan through privileged authentication', async ({
  page
}, info) => {
  await signInWithPassword(page, 'demo@starter.local', '/account')
  await page.goto('/purchase?plan=team')
  await expect(page.getByRole('heading', { name: 'Continue with Team' })).toBeVisible()
  await page.getByRole('button', { name: 'Starter Lab', exact: true }).click()
  await expect(page).toHaveURL(/\/verify-authentication\?redirect=/)
  const target = '/workspaces/starter-lab/billing?purchase=team'
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(target)
  await page.getByRole('link', { name: 'Open account security' }).click()
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(target)
  await page.getByRole('link', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/verify-authentication\?redirect=/)
  const authenticator = await installDemoPasskey(page)
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByRole('button', { name: 'Verify with a passkey', exact: true }).click()
  await expect(page).toHaveURL(/\/workspaces\/starter-lab\/billing\?purchase=team/)
  await expect(page.getByRole('heading', { name: 'Continue with Team' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Continue to checkout' })
  ).toBeDisabled()
  const inactiveCheckout = await submitPurchase(page, 'starter-lab')
  expect(await inactiveCheckout.text()).toContain('unavailable')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Continue with Team' })).toBeVisible()
  await page.screenshot({
    path: info.outputPath('purchase-confirmation.png'),
    fullPage: true
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: info.outputPath('purchase-confirmation-mobile.png'),
    fullPage: true
  })
  await page.getByRole('link', { name: 'Manage billing', exact: true }).click()
  await expect(page).toHaveURL(/\/workspaces\/starter-lab\/billing$/)
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Continue with Team' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Continue to checkout' })
  ).toBeDisabled()
  await page.getByRole('link', { name: 'Cancel purchase' }).click()
  await expect(page).toHaveURL(/\/pricing$/)
  await authenticator.cdp.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: authenticator.authenticatorId
  })
})

test('member cannot select a workspace for purchase or act through a crafted billing URL', async ({
  page
}) => {
  await signInWithPassword(page, 'engineer@example.com', '/account')
  await page.goto('/purchase?plan=team')
  await expect(
    page.getByRole('button', { name: 'Starter Lab', exact: true })
  ).toHaveCount(0)
  const memberRefusal = await submitPurchase(page, 'starter-lab')
  expect(await memberRefusal.text()).toContain('forbidden')
  const foreignRefusal = await submitPurchase(page, 'not-your-workspace')
  expect(await foreignRefusal.text()).toContain('isNotFound')
  await page.goto('/workspaces/starter-lab/billing?purchase=team')
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toHaveCount(
    0
  )
  await expect(
    page.getByText('Only workspace owners and admins can continue this purchase.')
  ).toBeVisible()
  await page.goto('/workspaces/not-your-workspace/billing?purchase=team')
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toHaveCount(
    0
  )
  await expect(
    page.getByRole('heading', { name: 'Page not found', exact: true })
  ).toBeVisible()
})

// oxlint-disable-next-line vitest/prefer-each -- Playwright parameterizes tests with a declaration loop; it has no test.each API.
for (const plan of ['enterprise', 'starter', 'price_arbitrary']) {
  test(`rejects ${plan} as a purchase intent`, async ({ ownerPage: page }) => {
    await page.goto(`/purchase?plan=${plan}`)
    await expect(
      page.getByText('Choose a plan from pricing to continue.')
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Starter Lab', exact: true })
    ).toHaveCount(0)
  })
}

test('signup carries email verification return and a new workspace keeps the plan', async ({
  page,
  browser
}, info) => {
  const suffix = `${Date.now()}-${info.parallelIndex}`
  await page.goto('/sign-up?redirect=%2Fpurchase%3Fplan%3Dteam')
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Name', { exact: true }).fill('Purchase browser test')
  const email = `purchase-${suffix}@example.com`
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill('purchase-browser-password')
  const registration = page.waitForRequest(
    (request) =>
      request.url().includes('/api/auth/sign-up/email') && request.method() === 'POST'
  )
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  const request = await registration
  const callback = new URL(request.postDataJSON().callbackURL)
  expect(callback.pathname).toBe('/verify-email')
  expect(callback.searchParams.get('redirect')).toBe('/purchase?plan=team')
  await expect(page).toHaveURL(/\/purchase\?plan=team/)
  await page.locator('html[data-authenticated="true"]').waitFor()
  // The local inbox fixture uses Better Auth's token issuer with the same
  // local secret. The real HTTP exchange and session verification run unchanged.
  const token = await createEmailVerificationToken(
    process.env.BETTER_AUTH_SECRET ?? 'local-dev-secret',
    email
  )
  await page.goto(
    `/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(callback.href)}`
  )
  await expect(
    page.getByRole('heading', { name: 'Email verified', exact: true })
  ).toBeVisible()
  await page.getByRole('link', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/purchase\?plan=team/)
  await page.locator('html[data-authenticated="true"]').waitFor()
  await page.locator('form[data-hydrated="true"]').waitFor()
  await page.getByLabel('Workspace name', { exact: true }).fill(`Purchase ${suffix}`)
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(page).toHaveURL(/\/verify-authentication\?redirect=/)
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(
    `/workspaces/purchase-${suffix}/billing?purchase=team`
  )
  const outsiderContext = await browser.newContext({
    baseURL: info.project.use.baseURL
  })
  const outsider = await outsiderContext.newPage()
  await outsiderContext.setExtraHTTPHeaders({
    'cf-connecting-ip': isolatedClientIp(`${info.testId}:outsider`)
  })
  await signInWithPassword(outsider, 'engineer@example.com', '/account')
  const refused = await submitPurchase(outsider, `purchase-${suffix}`)
  expect(await refused.text()).toContain('isNotFound')
  await outsider.goto(`/workspaces/purchase-${suffix}/billing?purchase=team`)
  await expect(
    outsider.getByRole('heading', { name: 'Page not found', exact: true })
  ).toBeVisible()
  await outsiderContext.close()
})
