/**
 * The one seeded showcase workspace. Only use this constant where the code
 * genuinely means "the demo workspace" (public showcase loaders, the sign-in
 * shortcut). Workspace routes must thread the current `$workspaceSlug` param
 * instead — there are no demo-slug fallbacks in the shell or palette.
 */
export const DEMO_WORKSPACE_SLUG = 'starter-lab'

/**
 * Credential account created by `pnpm run db:seed` (see scripts/seed.ts and
 * docs/setup.md). Only exists after seeding a local D1 — the plain vite dev
 * shim has no database, so these do nothing there.
 */
export const DEMO_CREDENTIALS = {
  email: 'demo@starter.local',
  password: 'demo-starter-password'
} satisfies { readonly email: string; readonly password: string }

/**
 * Second seeded credential, a plain `member` of the same workspace. It exists
 * so the role-gated UI is visible by hand: the demo account above is an owner
 * and sees every section, so nothing about permissions shows up when signed in
 * as it. Same password on purpose.
 */
export const DEMO_MEMBER_CREDENTIALS = {
  email: 'engineer@example.com',
  password: 'demo-starter-password'
} satisfies { readonly email: string; readonly password: string }
