import { type Session } from '@b2b-saas-starter/auth'

/**
 * A Better Auth session stand-in for server-fn handler tests. The handlers
 * under test read exactly three things off the session — `user.id` (the
 * actor), `user.email` (the invitation surfaces), and
 * `session.impersonatedBy` (the admin stop path) — so this is the whole
 * shape that matters; the plugin-inferred `Session` carries many more
 * optional fields no reader in this app touches.
 *
 * The canonical wiring beside every handler test — copy it verbatim, flip
 * the id per case:
 *
 * ```ts
 * const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))
 * vi.mock('./auth', async (importOriginal) => ({
 *   ...(await importOriginal<typeof AuthModule>()),
 *   requireRequestSession: async () => fixtureSession(actor)
 * }))
 * ```
 *
 * Tests re-point `actor.userId` between fixture identities (`usr_demo` owns
 * the seed workspace, `usr_dev` is its plain member) — a `beforeEach` reset,
 * never a restore as the test's last statement, or a failed assertion leaks
 * the flipped identity into the next case. `userId` is required on purpose:
 * a forgotten actor must be a type error, not a silent test-as-owner.
 */
export type FixtureSession = {
  /** The acting user's id — the actor `requireRequestSession` vouches for. */
  readonly userId: string
  /** The acting user's address; defaults to the id's seed address shape. */
  readonly email?: string | undefined
  readonly emailVerified?: boolean | undefined
  /** The session's impersonation actor, or null for an ordinary session. */
  readonly impersonatedBy?: string | null | undefined
}

export function fixtureSession(overrides: FixtureSession): Session {
  const userId = overrides.userId
  const expiresAt = new Date('2099-01-01T00:00:00.000Z')
  // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- a stand-in for the plugin-inferred `Session`, carrying exactly the fields this app's gates read; every field below exists on the real shape with the same type, so the assertion cannot hide a wrong read
  return {
    user: {
      id: userId,
      name: 'Fixture User',
      email: overrides.email ?? `${userId}@example.com`,
      emailVerified: overrides.emailVerified ?? true,
      locale: null,
      timeZone: null,
      role: 'user',
      twoFactorEnabled: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z')
    },
    session: {
      id: `ses_${userId}`,
      token: `tok_${userId}`,
      userId,
      expiresAt,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ipAddress: null,
      userAgent: null,
      activeOrganizationId: null,
      impersonatedBy: overrides.impersonatedBy ?? null
    }
  } as Session
}
