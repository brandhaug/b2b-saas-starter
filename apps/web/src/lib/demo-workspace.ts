/**
 * The one seeded showcase workspace. Only use this constant where the code
 * genuinely means "the demo workspace" (public showcase loaders, the sign-in
 * shortcut). Workspace routes must thread the current `$workspaceSlug` param
 * instead — there are no demo-slug fallbacks in the shell or palette.
 */
export const DEMO_WORKSPACE_SLUG = 'starter-lab'

/**
 * Credential account created by `bun run db:seed` (see scripts/seed.ts and
 * docs/setup.md). Only exists after seeding a local D1 — the plain vite dev
 * shim has no database, so these do nothing there.
 */
export const DEMO_CREDENTIALS = {
  email: 'demo@starter.local',
  password: 'demo-starter-password'
} as const
