import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fixtureSession } from '@/test/fixture-session'
import { listSystemUsersHandler, loadAdminAuditEventsHandler } from './admin.effects'
import type * as AuthModule from './auth'
import type * as AuthenticationModule from '@b2b-saas-starter/capabilities/governance/strong-authentication'

const actor = vi.hoisted(() => ({ role: 'admin', qualified: false, signedIn: true }))

vi.mock('./auth', async (importOriginal) => {
  const original = await importOriginal<typeof AuthModule>()
  return {
    ...original,
    requireRequestSession: async () => {
      if (!actor.signedIn) {
        throw new original.UnauthorizedError()
      }
      const session = fixtureSession({ userId: 'usr_global_admin' })
      return { ...session, user: { ...session.user, role: actor.role } }
    }
  }
})

// Keep the real capability runner and its failure serialization. Weak sessions
// use the actual fail-closed Seed authentication service. Only the explicitly
// qualified fixture supplies proof, for one exact user/session pair.
vi.mock(
  '@b2b-saas-starter/capabilities/governance/strong-authentication',
  async (importOriginal) => {
    const actual = await importOriginal<typeof AuthenticationModule>()
    const { Effect, Layer } = await import('effect')
    const weak = actual.SeedStrongAuthentication()
    return {
      ...actual,
      SeedStrongAuthentication: () =>
        Layer.succeed(actual.StrongAuthentication)({
          status: (input) =>
            Effect.flatMap(actual.StrongAuthentication, (service) =>
              service.status(input)
            ).pipe(Effect.provide(weak)),
          requireRecent: (input) =>
            Effect.flatMap(actual.StrongAuthentication, (service) =>
              service.requireRecent(input)
            ).pipe(Effect.provide(weak)),
          require: (input) => {
            if (
              actor.qualified &&
              input.userId === 'usr_global_admin' &&
              input.sessionId === 'ses_usr_global_admin'
            ) {
              return Effect.void
            }
            return Effect.flatMap(actual.StrongAuthentication, (service) =>
              service.require(input)
            ).pipe(Effect.provide(weak))
          }
        })
    }
  }
)

beforeEach(() => {
  Object.assign(actor, { role: 'admin', qualified: false, signedIn: true })
})

describe('direct admin reads', () => {
  it('a system-admin role without strong session proof cannot read users or global audit', async () => {
    await expect(listSystemUsersHandler()).rejects.toMatchObject({
      code: 'strong_authentication_required'
    })
    await expect(loadAdminAuditEventsHandler()).rejects.toMatchObject({
      code: 'strong_authentication_required'
    })
  })

  it('strong authentication does not grant system-admin authority', async () => {
    actor.qualified = true
    actor.role = 'user'
    await expect(listSystemUsersHandler()).rejects.toMatchObject({
      name: 'UnauthorizedError'
    })
    await expect(loadAdminAuditEventsHandler()).rejects.toMatchObject({
      name: 'UnauthorizedError'
    })
  })

  it('qualified system admins can read the actual platform users and global audit', async () => {
    actor.qualified = true
    const users = await listSystemUsersHandler()
    expect(users).toContainEqual(
      expect.objectContaining({ id: 'usr_demo', role: 'admin' })
    )
    const events = await loadAdminAuditEventsHandler()
    expect(events).toContainEqual(
      expect.objectContaining({
        id: 'aud_admin',
        eventType: 'system_admin.user_role_changed'
      })
    )
  })

  it('missing sessions cannot invoke either read directly', async () => {
    actor.signedIn = false
    await expect(listSystemUsersHandler()).rejects.toMatchObject({
      name: 'UnauthorizedError'
    })
    await expect(loadAdminAuditEventsHandler()).rejects.toMatchObject({
      name: 'UnauthorizedError'
    })
  })
})
