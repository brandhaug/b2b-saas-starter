// oxlint-disable effect/noAsyncFunction -- these callbacks exercise Better Auth's Promise-shaped hook port against the real D1 adapter.

import { type DrizzleDatabase } from './ports.ts'
import {
  auditEvents,
  notifications,
  user,
  workspaceInvitations,
  workspaceMembers,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { Effect, Result, type Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Auth } from './index.ts'
import {
  buildAuthLayer,
  enableTotp,
  provisionAuthD1,
  signUpSession,
  type AuthService,
  type ProvisionedAuthD1
} from './test-auth-layer.ts'

// The organization plugin is only observable through a real database: its
// `modelName` overrides, its `additionalFields`, and its role table all resolve
// inside Better Auth and reach D1 as SQL. Asserting the options object instead
// would pass even if no endpoint ever found a table, so this suite drives
// `Auth.api` against a local D1 (workerd) with every committed migration
// applied.

let db: DrizzleDatabase
let provisioned: ProvisionedAuthD1
let authLayer: Layer.Layer<AuthService>

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- the hook is the port: layer() suites expose no live tester for a real-clock suite, and a memoized fixture could not dispose its workerd process
    Effect.runPromise(
      Effect.gen(function* () {
        provisioned = yield* Effect.promise(() => provisionAuthD1())
        db = provisioned.db
        authLayer = buildAuthLayer(db)
      })
    ),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process
afterAll(() => provisioned.dispose())

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.provide(effect, authLayer)
}

/** The plugin needs an existing user to own the workspace it creates. */
function seedUser(id: string, email: string) {
  return Effect.promise(() => db.insert(user).values({ id, email, name: email }).run())
}

describe('organization plugin', () => {
  it.live('creates a workspace through the remapped organization model', () =>
    run(
      Effect.gen(function* () {
        yield* seedUser('usr_acme_owner', 'owner@acme.test')
        const auth = yield* Auth.Tag

        const created = yield* auth.api.createOrganization({
          body: { name: 'Acme', slug: 'acme', userId: 'usr_acme_owner' }
        })

        expect(created.slug).toBe('acme')

        const rows = yield* Effect.promise(() =>
          db.select().from(workspaces).where(eq(workspaces.slug, 'acme'))
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.name).toBe('Acme')
      })
    )
  )

  it.live('carries planId and updatedAt as organization additional fields', () =>
    run(
      Effect.gen(function* () {
        yield* seedUser('usr_plan_owner', 'owner@plan.test')
        const auth = yield* Auth.Tag

        const created = yield* auth.api.createOrganization({
          body: { name: 'Plan Co', slug: 'plan-co', userId: 'usr_plan_owner' }
        })

        // A column the plugin does not declare is stripped from every endpoint
        // response, so reading these back proves they are declared, not merely
        // defaulted by SQLite.
        expect(created.planId).toBe('starter')
        expect(created.updatedAt).toBeInstanceOf(Date)
      })
    )
  )

  it.live('creates an invitation through the remapped invitation model', () =>
    run(
      Effect.gen(function* () {
        const { headers } = yield* signUpSession('inviter@invite.test')
        const auth = yield* Auth.Tag

        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Invite Co', slug: 'invite-co' },
          headers
        })
        const invitation = yield* auth.api.createInvitation({
          body: {
            email: 'newcomer@invite.test',
            role: 'member',
            organizationId: workspace.id
          },
          headers
        })

        expect(invitation.email).toBe('newcomer@invite.test')

        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.email, 'newcomer@invite.test'))
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.status).toBe('pending')
        expect(rows[0]?.workspaceId).toBe(workspace.id)
      })
    )
  )

  it.live('answers hasPermission from the starter statement set', () =>
    run(
      Effect.gen(function* () {
        const { headers } = yield* signUpSession('owner@perm.test')
        const auth = yield* Auth.Tag

        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Perm Co', slug: 'perm-co' },
          headers
        })
        // `apiToken` is a starter resource. The plugin's own statement set has
        // no such resource, so a true answer can only come from packages/authz.
        const result = yield* auth.api.hasPermission({
          body: {
            organizationId: workspace.id,
            permissions: { apiToken: ['create'] }
          },
          headers
        })

        expect(result.success).toBe(true)
      })
    )
  )

  // The two below guard configuration that is correct today; they exist to fail
  // if it is changed, not because they drove it.

  it.live('keeps the plugin default statements working under the starter roles', () =>
    run(
      Effect.gen(function* () {
        const owner = yield* signUpSession('owner@roles.test')
        const member = yield* signUpSession('member@roles.test')
        const auth = yield* Auth.Tag

        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Roles Co', slug: 'roles-co' },
          headers: owner.headers
        })
        yield* auth.api.addMember({
          body: {
            userId: member.userId,
            organizationId: workspace.id,
            role: 'member'
          }
        })

        const ownerUpdates = yield* auth.api.hasPermission({
          body: {
            organizationId: workspace.id,
            permissions: { organization: ['update'] }
          },
          headers: owner.headers
        })
        const memberUpdates = yield* auth.api.hasPermission({
          body: {
            organizationId: workspace.id,
            permissions: { organization: ['update'] }
          },
          headers: member.headers
        })
        const memberReadsNotifications = yield* auth.api.hasPermission({
          body: {
            organizationId: workspace.id,
            permissions: { notification: ['read'] }
          },
          headers: member.headers
        })

        // `organization:update` is the plugin's own statement — a custom role
        // table that dropped it would break the plugin's endpoints, not just a
        // starter permission. `notification:read` is the starter's, and only
        // `memberRole` grants it. Together they prove the two sets merged
        // rather than one replacing the other.
        expect(ownerUpdates.success).toBe(true)
        expect(memberUpdates.success).toBe(false)
        expect(memberReadsNotifications.success).toBe(true)
      })
    )
  )

  it.live('exposes no team endpoints', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        // Read from `instance`, not the effectful `api`: the latter is a Proxy
        // that answers every property, so it can never disprove one.
        const endpoints = Object.keys(auth.instance.api)

        expect(endpoints).toContain('createOrganization')
        expect(endpoints).not.toContain('createTeam')
        expect(endpoints).not.toContain('setActiveTeam')
      })
    )
  )
})

describe('admin account deletion', () => {
  it.live('runs supplied cleanup hooks before the admin hard delete', () => {
    const deletedEvent = 'audit_admin_delete'
    const hookedLayer = buildAuthLayer(db, {
      userDeleteHooks: {
        beforeDelete: async (deletedUser) => {
          await db
            .delete(workspaceMembers)
            .where(eq(workspaceMembers.userId, deletedUser.id))
            .run()
          await db
            .delete(notifications)
            .where(eq(notifications.userId, deletedUser.id))
            .run()
          await db
            .update(auditEvents)
            .set({ actorUserId: null, metadata: {} })
            .where(eq(auditEvents.actorUserId, deletedUser.id))
            .run()
          await db
            .update(auditEvents)
            .set({ metadata: {} })
            .where(eq(auditEvents.id, 'audit_other_delete'))
            .run()
        },
        afterDelete: async (deletedUser) => {
          await db
            .insert(auditEvents)
            .values({
              id: deletedEvent,
              workspaceId: null,
              actorUserId: null,
              actorType: 'user',
              eventType: 'account.deleted',
              targetType: 'user',
              targetId: deletedUser.id,
              metadata: { workspacesLeft: 1, workspacesDeleted: 0 },
              createdAt: '2026-09-07T00:00:01.000Z'
            })
            .run()
        }
      }
    })
    return Effect.provide(
      Effect.gen(function* () {
        const admin = yield* signUpSession('admin-delete@starter.test')
        const target = yield* signUpSession('target-delete@starter.test')
        const auth = yield* Auth.Tag

        yield* Effect.promise(() =>
          db.update(user).set({ role: 'admin' }).where(eq(user.id, admin.userId)).run()
        )
        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Shared Delete Lab', slug: 'shared-delete-lab' },
          headers: admin.headers
        })
        yield* auth.api.addMember({
          body: {
            userId: target.userId,
            organizationId: workspace.id,
            role: 'member'
          }
        })
        yield* Effect.promise(() =>
          db
            .insert(notifications)
            .values({
              id: 'notification_target_delete',
              workspaceId: workspace.id,
              userId: target.userId,
              kind: 'announcement',
              title: 'Private',
              message: 'Private',
              createdAt: '2026-09-07T00:00:00.000Z'
            })
            .run()
        )
        yield* Effect.promise(() =>
          db
            .insert(auditEvents)
            .values([
              {
                id: 'audit_target_delete',
                workspaceId: workspace.id,
                actorUserId: target.userId,
                actorType: 'user',
                eventType: 'target.private',
                targetType: 'user',
                targetId: target.userId,
                metadata: { email: 'target-delete@starter.test' },
                createdAt: '2026-09-07T00:00:00.000Z'
              },
              {
                id: 'audit_other_delete',
                workspaceId: workspace.id,
                actorUserId: admin.userId,
                actorType: 'user',
                eventType: 'other.private',
                targetType: 'user',
                targetId: target.userId,
                metadata: { email: 'target-delete@starter.test' },
                createdAt: '2026-09-07T00:00:00.000Z'
              }
            ])
            .run()
        )

        const result = yield* Effect.result(
          auth.api.removeUser({
            body: { userId: target.userId },
            headers: admin.headers
          })
        )
        expect(Result.isSuccess(result)).toBe(true)

        const remainingMembership = yield* Effect.promise(() =>
          db
            .select()
            .from(workspaceMembers)
            .where(eq(workspaceMembers.userId, target.userId))
        )
        const remainingWorkspace = yield* Effect.promise(() =>
          db.select().from(workspaces).where(eq(workspaces.id, workspace.id))
        )
        const remainingNotifications = yield* Effect.promise(() =>
          db.select().from(notifications).where(eq(notifications.userId, target.userId))
        )
        const retainedAudit = yield* Effect.promise(() =>
          db.select().from(auditEvents).where(eq(auditEvents.id, 'audit_other_delete'))
        )
        const deletedAudit = yield* Effect.promise(() =>
          db.select().from(auditEvents).where(eq(auditEvents.id, deletedEvent))
        )

        expect(remainingMembership).toHaveLength(0)
        expect(remainingWorkspace).toHaveLength(1)
        expect(remainingNotifications).toHaveLength(0)
        expect(retainedAudit[0]?.metadata).toEqual({})
        expect(deletedAudit[0]?.metadata).toEqual({
          workspacesLeft: 1,
          workspacesDeleted: 0
        })
      }),
      hookedLayer
    )
  })
})

describe('two-factor plugin', () => {
  it.live('enables TOTP, verifies it, and flips twoFactorEnabled on the user', () =>
    run(
      Effect.gen(function* () {
        const session = yield* signUpSession('totp@twofactor.test')

        // The shared ceremony runs the account panel's flow — enable, then the
        // first verified code, which flips `twoFactorEnabled` and rotates the
        // session token (the response body is the one-time reveal).
        const { response } = yield* enableTotp(session)
        expect(response.totpURI).toContain('otpauth://totp/')
        expect(response.backupCodes.length).toBeGreaterThan(0)

        const rows = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.id, session.userId))
        )
        expect(rows[0]?.twoFactorEnabled).toBe(true)
      })
    )
  )
})
