import { type Session } from '@b2b-saas-starter/auth'
import { Effect } from 'effect'

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
 * vi.mock('./auth', async (importOriginal) =>
 *   fixtureAuthModule(await importOriginal<typeof AuthModule>(), actor)
 * )
 * ```
 *
 * `fixtureAuthModule` answers BOTH session gates — the Promise-returning
 * `requireRequestSession` a handler awaits and the Effect-returning
 * `requireRequestSessionEffect` the authorization enforcement point yields —
 * so a test cannot answer one and leave the other reading the real cookie
 * jar (which has none, making every permission check an expired session).
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

/**
 * The `./auth` module a handler test mocks: the real module's other exports
 * (`toRouteSession`, `UnauthorizedError`, the route gates), with both session
 * gates answering the fixture identity `actor` currently names. Pass the
 * mutable hoisted actor, not a session: the id is read per call, so a test
 * flips `actor.userId` between cases.
 *
 * Pass `{}` as `actual` for a test that needs nothing else from the module.
 */
export function fixtureAuthModule<Actual extends object>(
  actual: Actual,
  actor: FixtureSession
): Actual & {
  readonly requireRequestSession: () => Promise<Session>
  readonly requireRequestSessionEffect: () => Effect.Effect<Session>
} {
  return {
    ...actual,
    requireRequestSession: async () => fixtureSession(actor),
    requireRequestSessionEffect: () => Effect.succeed(fixtureSession(actor))
  }
}
