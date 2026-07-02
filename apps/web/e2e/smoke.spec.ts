import { expect, test } from '@playwright/test'

test('public homepage renders the starter showcase', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /the hard parts, already wired/i })
  ).toBeVisible()
  await expect(
    page.getByRole('listitem').filter({ hasText: 'TanStack Start' })
  ).toBeVisible()
})

test('public docs render', async ({ page }) => {
  await page.goto('/docs')
  await expect(page.getByRole('heading', { name: 'Documentation' })).toBeVisible()
})

test('unauthenticated workspace visit redirects to sign-in', async ({ page }) => {
  await page.goto('/workspaces/starter-lab')
  await page.waitForURL(/\/sign-in/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  // The original location is preserved so sign-in can return the user.
  expect(new URL(page.url()).searchParams.get('redirect')).toContain(
    '/workspaces/starter-lab'
  )
})

// TODO(e2e): add an authenticated sign-in flow test once the e2e run has a
// real database. The Playwright webServer is `bun run dev`, which aliases
// `cloudflare:workers` to the local shim (no D1 binding) — Better Auth can
// serve `getSession` for anonymous visitors, but `signIn.email` needs the
// `user`/`account` tables, so credential sign-in cannot succeed against this
// server. When CI provisions a local D1 (migrate + `bun run db:seed`) and the
// dev server runs with a real binding, sign in with the seeded demo
// credentials (demo@starter.local, see docs/setup.md) and assert the
// workspace dashboard renders.
