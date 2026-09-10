import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vite-plus/test'
import { requireRequestSessionEffect, toRouteSession, UnauthorizedError } from './auth'

/**
 * The projection is what every gated route serializes into its client
 * payload (`beforeLoad` context), so this test is the guard that keeps it
 * narrow: session tokens, IP addresses, user agents and expiry timestamps
 * must never ride the SSR payload again.
 */
describe('toRouteSession', () => {
  it('carries only the projected user fields', () => {
    // SAFETY: the literal is the full `Session` shape the gate reads; every
    // field beyond the projection exists precisely so this test can prove
    // they are dropped.
    const routeSession = toRouteSession({
      session: {
        id: 'ses_1',
        token: 'tok_secret',
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        userId: 'usr_1',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0'
      },
      user: {
        id: 'usr_1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        name: 'Demo',
        banned: false,
        email: 'demo@starter.local',
        emailVerified: true,
        locale: null,
        timeZone: null,
        role: 'admin',
        twoFactorEnabled: false
      }
    } satisfies Parameters<typeof toRouteSession>[0])

    expect(routeSession.user).toEqual({
      id: 'usr_1',
      name: 'Demo',
      email: 'demo@starter.local',
      emailVerified: true,
      role: 'admin',
      twoFactorEnabled: false
    })
    expect(routeSession.impersonatedBy).toBeNull()
    expect(Object.keys(routeSession)).toEqual(['user', 'impersonatedBy'])
    expect(JSON.stringify(routeSession)).not.toContain('tok_secret')
    expect(JSON.stringify(routeSession)).not.toContain('203.0.113.7')
    expect(JSON.stringify(routeSession)).not.toContain('Mozilla')
  })

  it('carries the impersonating admin for an impersonation session', () => {
    const routeSession = toRouteSession({
      session: {
        id: 'ses_2',
        token: 'tok_secret',
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        userId: 'usr_2',
        expiresAt: new Date('2026-08-01T01:00:00Z'),
        impersonatedBy: 'usr_admin'
      },
      user: {
        id: 'usr_2',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        name: 'Member',
        banned: false,
        email: 'member@starter.local',
        emailVerified: true,
        locale: null,
        timeZone: null,
        twoFactorEnabled: false
      }
    } satisfies Parameters<typeof toRouteSession>[0])

    expect(routeSession.impersonatedBy).toBe('usr_admin')
    expect(routeSession.user.role).toBe('')
  })
})

/**
 * The server-fn gate on the Effect error channel. Without an ambient request
 * there is no cookie jar to read, which is the expired-session case as far as
 * every caller is concerned: the gate must FAIL, not die — a defect would
 * skip `catchTag`, and the request's wide event would report a crash instead
 * of a session that ran out.
 */
/** The gate under its own runtime: the assertion is about the Exit's channel. */
function runExit() {
  // oxlint-disable-next-line starter/no-run-promise-in-tests -- the Exit is the assertion; `it.effect` would hide the channel this test is about
  return Effect.runPromiseExit(requireRequestSessionEffect())
}

describe('requireRequestSessionEffect', () => {
  it('fails with the typed unauthorized error rather than a defect', async () => {
    const exit = await runExit()
    if (!Exit.isFailure(exit)) {
      throw new Error('a session-less request must not resolve a session')
    }
    const caught = await runExit().then((settled) =>
      Exit.isFailure(settled) ? Cause.squash(settled.cause) : settled.value
    )
    if (!(caught instanceof UnauthorizedError)) {
      throw new Error('the gate must answer its own typed failure')
    }
    expect(caught.code).toBe('unauthorized')
    // The message is a server-side diagnostic; the client rebuilds the error
    // from `code` and `details` (`lib/ui-error.ts`), so those are the contract.
    expect(caught.details).toEqual({})
  })
})
