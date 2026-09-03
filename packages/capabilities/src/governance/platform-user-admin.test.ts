import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { ImpersonationForbidden } from '../errors.ts'
import { SeedLayer } from '../layers.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import {
  demoMemberIdentity,
  demoUserIdentity,
  seedWorkspaceRecord
} from '../seed-fixture.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import {
  IMPERSONATION_FORBIDDEN_ACTIONS,
  PlatformUserAdmin,
  refuseWhileImpersonating
} from './platform-user-admin.ts'

/**
 * The forbidden-actions guard (ADR 0054) is pure and shared by both adapters
 * and the app's request boundary, so it is tested once, here, and not again
 * per adapter. The contract cases in `platform-user-admin.contract.ts` cover
 * start/stop against Seed and Live.
 */
describe('refuseWhileImpersonating', () => {
  it.effect('lets an ordinary session through for every action', () =>
    Effect.gen(function* () {
      for (const action of IMPERSONATION_FORBIDDEN_ACTIONS) {
        yield* refuseWhileImpersonating({ impersonatedBy: null }, action)
        yield* refuseWhileImpersonating({ impersonatedBy: undefined }, action)
        yield* refuseWhileImpersonating({}, action)
      }
    })
  )

  it.effect('refuses every forbidden action for an impersonation session', () =>
    Effect.gen(function* () {
      for (const action of IMPERSONATION_FORBIDDEN_ACTIONS) {
        const error = yield* Effect.flip(
          refuseWhileImpersonating({ impersonatedBy: 'usr_admin' }, action)
        )
        expect(error).toBeInstanceOf(ImpersonationForbidden)
        expect(error.action).toBe(action)
      }
    })
  )

  it('names exactly the account actions the ADRs forbid', () => {
    expect([...IMPERSONATION_FORBIDDEN_ACTIONS]).toEqual([
      'change_password',
      'change_two_factor',
      // Passkeys join with ADR 0056: an enrolled credential survives the
      // impersonation ending, so it is a persistence channel like a password.
      'change_passkey',
      'change_email',
      'delete_account'
    ])
  })
})

describe('seed impersonation side effects', () => {
  it.effect(
    'notifies the impersonated user in their workspace feed, and nobody else',
    () =>
      Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        yield* admin.startImpersonation({
          userId: demoMemberIdentity.id,
          actorUserId: demoUserIdentity.id
        })
        const feed = yield* NotificationFeed

        const asTarget = yield* feed.list.pipe(
          Effect.provide(
            testWorkspaceContext(seedWorkspaceRecord, {
              userId: demoMemberIdentity.id,
              role: 'member',
              systemRole: 'user'
            })
          )
        )
        const notice = asTarget.find(
          (n) => n.title === 'A System Admin accessed your account'
        )
        expect(notice?.read).toBe(false)
        expect(notice?.message).toContain(demoUserIdentity.name)

        const asAdmin = yield* feed.list.pipe(
          Effect.provide(
            testWorkspaceContext(seedWorkspaceRecord, {
              userId: demoUserIdentity.id,
              role: 'owner',
              systemRole: 'admin'
            })
          )
        )
        // The fixture already carries one seeded notice for `usr_dev`; the admin
        // must see neither that nor the one just written.
        expect(
          asAdmin.some((n) => n.title === 'A System Admin accessed your account')
        ).toBe(false)
      }).pipe(Effect.provide(Layer.fresh(SeedLayer)))
  )

  it.effect('refuses an admin impersonating themself', () =>
    Effect.gen(function* () {
      const admin = yield* PlatformUserAdmin
      const error = yield* Effect.flip(
        admin.startImpersonation({
          userId: demoUserIdentity.id,
          actorUserId: demoUserIdentity.id
        })
      )
      expect(error._tag).toBe('UserAdminRejected')
    }).pipe(Effect.provide(SeedLayer))
  )

  it.effect('refuses stopping a session that was never started', () =>
    Effect.gen(function* () {
      const admin = yield* PlatformUserAdmin
      const error = yield* Effect.flip(
        admin.stopImpersonation({
          userId: demoMemberIdentity.id,
          actorUserId: demoUserIdentity.id
        })
      )
      expect(error._tag).toBe('UserAdminRejected')
    }).pipe(Effect.provide(Layer.fresh(SeedLayer)))
  )
})
