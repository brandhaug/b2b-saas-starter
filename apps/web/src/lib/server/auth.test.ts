import { describe, expect, it } from 'vite-plus/test'
import { toRouteSession } from './auth'

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
        twoFactorEnabled: false
      }
    } satisfies Parameters<typeof toRouteSession>[0])

    expect(routeSession.impersonatedBy).toBe('usr_admin')
    expect(routeSession.user.role).toBe('')
  })
})
