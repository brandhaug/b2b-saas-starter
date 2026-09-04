import {
  apiTokens,
  auditEvents,
  user,
  workspaceMembers,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { Database, layerFromD1 } from '@b2b-saas-starter/db/service'
import { Effect, Layer } from 'effect'
import { describe, expect, layer } from '@effect/vitest'
import { eq } from 'drizzle-orm'

import {
  AccountLifecycle,
  type AccountDeletionPlan,
  type AccountLifecycleBinding
} from './account-lifecycle.ts'
import { accountLifecycleContractCases } from './account-lifecycle.contract.ts'
import { CapabilityUnavailable } from '../errors.ts'
import { makeLiveCapabilitiesLayer, type CapabilityServices } from '../layers.ts'
import { type StarterEnv } from '../runtime.ts'
import {
  fakeAccountLifecycleBinding,
  LIVE_SUITE_TIMEOUT,
  TestD1,
  TestDatabase
} from '../testing/live-harness.ts'

/** The only credential the fake's delete endpoint accepts. */
const DELETE_PASSWORD = 'correct-horse-battery-staple'

/**
 * The after-hook reads the plan the before-hook left behind. A missing plan
 * means the hook sequence was violated, and that is a store failure, not a
 * silent empty record.
 */
function readHandoffPlan(plan: AccountDeletionPlan | undefined) {
  if (plan === undefined) {
    return Effect.fail(
      new CapabilityUnavailable({
        capability: 'account-lifecycle',
        reason: 'no_plan_handoff'
      })
    )
  }
  return Effect.succeed(plan)
}

/**
 * The account-lifecycle services over the test D1, with no `WorkspaceContext`
 * — the same shape `runCapabilities` provides in the app, because every
 * account-lifecycle method is identity-keyed.
 */
function accountLifecycleLayer(
  d1: NonNullable<StarterEnv['DB']>,
  binding?: AccountLifecycleBinding
): Layer.Layer<CapabilityServices> {
  return makeLiveCapabilitiesLayer({ accountLifecycleBinding: binding }).pipe(
    Layer.provide(layerFromD1(d1))
  )
}

// The idempotent fixture state for the shared contract: one workspace whose
// only owner is `usr_stuck_owner`, with an admin and a plain member alongside.
// `onConflictDoNothing` keeps the per-case re-runs harmless; the refusal cases
// mutate nothing, so the state stays exact across the whole describe.
const contractState = Effect.gen(function* () {
  const db = yield* Database
  yield* db
    .insert(user)
    .values([
      { id: 'usr_stuck_owner', email: 'stuck@live.test', name: 'Stuck Owner' },
      { id: 'usr_second_admin', email: 'second@live.test', name: 'Second Admin' },
      { id: 'usr_planner', email: 'planner@live.test', name: 'Planner' }
    ])
    .onConflictDoNothing()
  yield* db
    .insert(workspaces)
    .values({ id: 'wrk_stuck', slug: 'stuck-lab', name: 'Stuck Lab' })
    .onConflictDoNothing()
  yield* db
    .insert(workspaceMembers)
    .values([
      {
        id: 'mem_stuck_owner',
        workspaceId: 'wrk_stuck',
        userId: 'usr_stuck_owner',
        role: 'owner'
      },
      {
        id: 'mem_second_admin',
        workspaceId: 'wrk_stuck',
        userId: 'usr_second_admin',
        role: 'admin'
      },
      {
        id: 'mem_planner',
        workspaceId: 'wrk_stuck',
        userId: 'usr_planner',
        role: 'member'
      }
    ])
    .onConflictDoNothing()
})

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('live account lifecycle', (it) => {
  // The Seed half of this same list runs in index.test.ts against an
  // equivalent roster.
  describe('live account lifecycle contract', () => {
    const cases = accountLifecycleContractCases(
      {
        stuckOwner: 'usr_stuck_owner',
        planner: 'usr_planner',
        password: DELETE_PASSWORD,
        wrongPassword: ''
      },
      expect
    )
    for (const contractCase of cases) {
      it.effect(contractCase.name, () =>
        Effect.gen(function* () {
          const d1 = yield* TestD1
          yield* contractState
          const { binding } = fakeAccountLifecycleBinding(yield* Database, {
            userId: 'usr_planner',
            password: DELETE_PASSWORD
          })
          yield* contractCase.assert.pipe(
            Effect.provide(accountLifecycleLayer(d1, binding))
          )
        })
      )
    }
  })

  // The mixed happy path replays the store's exact sequence — password
  // check, the app's before-delete hook (`prepareDeletion`), the user-row
  // delete, the after-delete hook (`recordDeleted` receiving the plan the
  // before-hook produced, as the app hands it across).
  it.effect(
    'leaves shared workspaces, deletes sole-member ones, detaches the rows that would block the delete',
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        const d1 = yield* TestD1
        yield* db.insert(user).values([
          { id: 'usr_mixed', email: 'mixed@live.test', name: 'Mixed Owner' },
          { id: 'usr_co_owner', email: 'co-owner@live.test', name: 'Co Owner' }
        ])
        yield* db.insert(workspaces).values([
          { id: 'wrk_mixed_solo', slug: 'mixed-solo', name: 'Mixed Solo' },
          { id: 'wrk_mixed_shared', slug: 'mixed-shared', name: 'Mixed Shared' }
        ])
        yield* db.insert(workspaceMembers).values([
          {
            id: 'mem_mixed_solo',
            workspaceId: 'wrk_mixed_solo',
            userId: 'usr_mixed',
            role: 'owner'
          },
          {
            id: 'mem_mixed_shared',
            workspaceId: 'wrk_mixed_shared',
            userId: 'usr_mixed',
            role: 'owner'
          },
          {
            id: 'mem_co_owner',
            workspaceId: 'wrk_mixed_shared',
            userId: 'usr_co_owner',
            role: 'owner'
          }
        ])
        // Rows the delete must detach: an audit event and an API token that
        // reference the user through restricting foreign keys.
        yield* db.insert(auditEvents).values([
          {
            id: 'aud_mixed_owned',
            workspaceId: 'wrk_mixed_shared',
            actorUserId: 'usr_mixed',
            eventType: 'workspace_member.added',
            targetType: 'workspace_member',
            targetId: 'usr_co_owner',
            metadata: {},
            createdAt: '2026-07-03T09:00:00.000Z'
          }
        ])
        yield* db.insert(apiTokens).values({
          id: 'tok_mixed_created',
          workspaceId: 'wrk_mixed_shared',
          name: 'Mixed Token',
          tokenPrefix: 'bsk_live_mixed',
          tokenHash: 'hash_mixed_created',
          scopes: ['read'],
          createdByUserId: 'usr_mixed',
          createdAt: '2026-07-03T09:00:00.000Z'
        })

        // The hook handoff: the plan the before-hook computes is what the
        // after-hook records, exactly as the app's `databaseHooks` wiring
        // passes it across (keyed by request there, by closure here).
        let hookPlan: AccountDeletionPlan | undefined
        const { binding, calls } = fakeAccountLifecycleBinding(db, {
          userId: 'usr_mixed',
          password: DELETE_PASSWORD,
          beforeDelete: (userId) =>
            Effect.runPromise(
              Effect.flatMap(AccountLifecycle, (lifecycle) =>
                lifecycle.prepareDeletion(userId)
              ).pipe(
                Effect.provide(accountLifecycleLayer(d1, binding)),
                Effect.tap((plan) =>
                  Effect.sync(() => {
                    hookPlan = plan
                  })
                ),
                Effect.asVoid
              )
            ),
          afterDelete: (userId) =>
            Effect.runPromise(
              Effect.flatMap(AccountLifecycle, (lifecycle) =>
                Effect.flatMap(readHandoffPlan(hookPlan), (plan) =>
                  lifecycle.recordDeleted({ userId, plan })
                )
              ).pipe(Effect.provide(accountLifecycleLayer(d1, binding)))
            )
        })

        const executed = yield* Effect.flatMap(AccountLifecycle, (lifecycle) =>
          lifecycle.deleteAccount({
            userId: 'usr_mixed',
            password: DELETE_PASSWORD
          })
        ).pipe(Effect.provide(accountLifecycleLayer(d1, binding)))

        // The plan `deleteAccount` resolves with is the one the hooks ran,
        // and the binding calls arrive in the plan's order: leave, delete,
        // then the verified account delete itself.
        expect(hookPlan).toEqual(executed)
        expect(executed.steps.map((step) => step.action).toSorted()).toEqual([
          'delete_workspace',
          'leave'
        ])
        expect(calls).toEqual([
          { password: DELETE_PASSWORD },
          { workspaceId: 'wrk_mixed_shared', memberId: 'mem_mixed_shared' },
          { workspaceId: 'wrk_mixed_solo' }
        ])

        // The sole-member workspace is gone; the shared one survives.
        const solo = yield* Effect.flatMap(Database, (database) =>
          database.select().from(workspaces).where(eq(workspaces.id, 'wrk_mixed_solo'))
        )
        expect(solo).toHaveLength(0)
        const shared = yield* Effect.flatMap(Database, (database) =>
          database
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, 'wrk_mixed_shared'))
        )
        expect(shared).toHaveLength(1)

        // The restricting references were detached, not deleted.
        const detachedAudit = yield* Effect.flatMap(Database, (database) =>
          database
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.id, 'aud_mixed_owned'))
        )
        expect(detachedAudit[0]?.actorUserId).toBeNull()
        const detachedToken = yield* Effect.flatMap(Database, (database) =>
          database.select().from(apiTokens).where(eq(apiTokens.id, 'tok_mixed_created'))
        )
        expect(detachedToken[0]?.createdByUserId).toBeNull()

        // The account row itself is gone (the fake's store half), and the
        // `account.deleted` event survived it, actorless.
        const account = yield* Effect.flatMap(Database, (database) =>
          database.select().from(user).where(eq(user.id, 'usr_mixed'))
        )
        expect(account).toHaveLength(0)
        const deletedEvents = yield* Effect.flatMap(Database, (database) =>
          database
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.eventType, 'account.deleted'))
        )
        const deleted = deletedEvents.find((row) => row.targetId === 'usr_mixed')
        expect(deleted?.actorUserId).toBeNull()
        expect(deleted?.metadata).toEqual({
          workspacesLeft: 1,
          workspacesDeleted: 1
        })
      })
  )

  it.effect('fails as unavailable when no binding is configured', () =>
    Effect.gen(function* () {
      yield* contractState
      const d1 = yield* TestD1
      const error = yield* Effect.flip(
        Effect.flatMap(AccountLifecycle, (lifecycle) =>
          lifecycle.deleteAccount({
            userId: 'usr_planner',
            password: DELETE_PASSWORD
          })
        ).pipe(Effect.provide(accountLifecycleLayer(d1)))
      )
      expect(error).toBeInstanceOf(CapabilityUnavailable)
      expect(error instanceof CapabilityUnavailable && error.reason).toBe(
        'no_account_lifecycle_binding'
      )
    })
  )

  // The plan gate reads even when the write half is unbound — the
  // provider-light posture the other binding-backed capabilities take.
  it.effect('plans with no binding configured', () =>
    Effect.gen(function* () {
      yield* contractState
      const d1 = yield* TestD1
      const plan = yield* Effect.flatMap(AccountLifecycle, (lifecycle) =>
        lifecycle.planDeletion('usr_stuck_owner')
      ).pipe(Effect.provide(accountLifecycleLayer(d1)))
      expect(plan.canDelete).toBe(false)
      expect(plan.steps[0]?.action).toBe('blocked_sole_owner')
    })
  )
})
