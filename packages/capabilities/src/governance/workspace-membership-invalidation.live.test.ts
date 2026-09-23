import { expect, layer } from '@effect/vitest'
import { Database } from '@b2b-saas-starter/db/service'
import {
  workspaceMembers,
  workspaces,
  personalDataExports,
  session
} from '@b2b-saas-starter/db/schema'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { eq } from 'drizzle-orm'
import { DateTime, Effect, Layer } from 'effect'
import { AssistantDirectory } from '../assistant/directory.ts'
import {
  fakeMemberBinding,
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { WorkspaceMembership } from './workspace-membership.ts'
import { LiveWorkspaceMembership } from './workspace-membership.live.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'membership access invalidation',
  (it) => {
    for (const { failureAt, errorTag, beforeRevision, afterRevision, archives } of [
      {
        failureAt: 'invalidation',
        errorTag: 'CapabilityUnavailable',
        beforeRevision: 0,
        afterRevision: 2,
        archives: 1
      },
      {
        failureAt: 'plugin',
        errorTag: 'MembershipChangeRejected',
        beforeRevision: 1,
        afterRevision: 3,
        archives: 0
      }
    ]) {
      for (const operation of ['changeRole', 'removeMember', 'leave']) {
        it.effect(
          `${operation} preserves membership on ${failureAt} failure and retries with invalidated access`,
          () =>
            Effect.gen(function* () {
              const db = yield* Database
              let expectedRole: string | undefined
              if (operation === 'changeRole') {
                expectedRole = 'admin'
              }
              const workspaceId = `${failureAt}-${operation}`
              yield* db
                .insert(workspaces)
                .values({ id: workspaceId, slug: workspaceId, name: workspaceId })
              yield* db.insert(workspaceMembers).values([
                {
                  id: `${workspaceId}-owner`,
                  workspaceId,
                  userId: 'usr_owner',
                  role: 'owner'
                },
                {
                  id: `${workspaceId}-bob`,
                  workspaceId,
                  userId: 'usr_bob',
                  role: 'owner'
                }
              ])
              yield* db.insert(session).values({
                id: workspaceId,
                userId: 'usr_owner',
                token: workspaceId,
                expiresAt: DateTime.toDate(DateTime.makeUnsafe('2099-01-01T00:00:00Z'))
              })
              yield* db.insert(personalDataExports).values({
                id: workspaceId,
                userId: 'usr_owner',
                sessionId: workspaceId,
                archive: '{}',
                createdAt: '2026-09-23T00:00:00Z',
                expiresAt: '2099-01-01T00:00:00Z'
              })
              const notifications: Array<ReadonlyArray<string>> = []
              const fake = fakeMemberBinding(db)
              const calls = fake.calls
              let refusePlugin = failureAt === 'plugin'
              function refuseOnce(write: () => Promise<void>): Promise<void> {
                if (refusePlugin) {
                  refusePlugin = false
                  return Promise.reject(
                    Object.assign(new Error('concurrent plugin refusal'), {
                      statusCode: 409
                    })
                  )
                }
                return write()
              }
              const binding = {
                changeRole: (input: Parameters<typeof fake.binding.changeRole>[0]) =>
                  refuseOnce(() => fake.binding.changeRole(input)),
                removeMember: (
                  input: Parameters<typeof fake.binding.removeMember>[0]
                ) => refuseOnce(() => fake.binding.removeMember(input)),
                leave: (input: Parameters<typeof fake.binding.leave>[0]) =>
                  refuseOnce(() => fake.binding.leave(input))
              }
              yield* inWorkspace(
                workspaceId,
                Effect.gen(function* () {
                  const directory = yield* AssistantDirectory
                  const room = yield* directory.create({
                    id: `${workspaceId}-room`,
                    workspaceId,
                    creatorUserId: 'usr_owner'
                  })
                  let fail = failureAt === 'invalidation'
                  const controlled = AssistantDirectory.of({
                    ...directory,
                    invalidateAccess: (scope, options) =>
                      Effect.suspend(() => {
                        if (fail) {
                          fail = false
                          return Effect.fail(
                            new CapabilityUnavailable({
                              capability: 'assistant-directory',
                              reason: 'injected_storage_failure'
                            })
                          )
                        }
                        return directory.invalidateAccess(scope, options)
                      })
                  })
                  yield* Effect.gen(function* () {
                    const membership = yield* WorkspaceMembership
                    const change = Effect.gen(function* () {
                      if (operation === 'leave') {
                        return yield* membership.leave
                      }
                      if (operation === 'removeMember') {
                        return yield* membership.removeMember({ userId: 'usr_owner' })
                      }
                      return yield* membership.changeRole({
                        userId: 'usr_owner',
                        role: 'admin'
                      })
                    })
                    const failure = yield* Effect.flip(change)
                    expect(failure._tag).toBe(errorTag)
                    expect(calls).toEqual([])
                    expect(notifications).toHaveLength(beforeRevision)
                    expect(
                      (yield* membership.listMembers).find(
                        (member) => member.id === 'usr_owner'
                      )?.role
                    ).toBe('owner')
                    expect(yield* directory.get(room.id)).toMatchObject({
                      policyRevision: beforeRevision,
                      runAccessRevision: beforeRevision
                    })
                    expect(
                      yield* db
                        .select()
                        .from(personalDataExports)
                        .where(eq(personalDataExports.id, workspaceId))
                    ).toHaveLength(archives)
                    yield* change
                    expect(calls).toHaveLength(1)
                    expect(notifications.at(-1)).toEqual([room.id])
                    expect(
                      (yield* membership.listMembers).find(
                        (member) => member.id === 'usr_owner'
                      )?.role
                    ).toBe(expectedRole)
                    expect(yield* directory.get(room.id)).toMatchObject({
                      policyRevision: afterRevision,
                      runAccessRevision: afterRevision
                    })
                    expect(
                      yield* db
                        .select()
                        .from(personalDataExports)
                        .where(eq(personalDataExports.id, workspaceId))
                    ).toEqual([])
                    if (operation === 'changeRole') {
                      yield* change
                      expect(calls).toHaveLength(1)
                      expect(yield* directory.get(room.id)).toMatchObject({
                        policyRevision: afterRevision,
                        runAccessRevision: afterRevision
                      })
                    }
                  }).pipe(
                    Effect.provide(
                      LiveWorkspaceMembership(binding).pipe(
                        Layer.provide(Layer.succeed(AssistantDirectory, controlled))
                      )
                    )
                  )
                }),
                { userId: 'usr_owner' },
                {
                  memberBinding: binding,
                  assistantInvalidation: (addresses) => {
                    notifications.push(addresses.map((address) => address.id))
                    return Promise.resolve()
                  }
                }
              )
            })
        )
      }
    }
  }
)
