import { expect, it } from '@effect/vitest'
import { SeedSeatSyncPublisher } from '@b2b-saas-starter/billing/seat-sync'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Effect, Layer } from 'effect'
import { AssistantDirectory } from '../assistant/directory.ts'
import { SeedAssistantDirectory } from '../assistant/directory.seed.ts'
import { SeedWebhookPublisher } from '../developer-platform/webhook-publisher.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { demoUserIdentity, seedWorkspaceRecord } from './workspace-identity.seed.ts'
import {
  makeSeedRoster,
  SeedWorkspaceMembership,
  WorkspaceMembership
} from './workspace-membership.ts'

for (const operation of ['changeRole', 'removeMember', 'leave']) {
  it.effect(
    `Seed ${operation} retries invalidation without changing membership or filing evidence early`,
    () =>
      Effect.gen(function* () {
        let expectedRole: string | undefined
        if (operation === 'changeRole') {
          expectedRole = 'admin'
        }
        const roster = yield* makeSeedRoster([
          demoUserIdentity,
          { ...demoUserIdentity, id: 'other-owner' }
        ])
        const directory = yield* AssistantDirectory
        const room = yield* directory.create({
          id: 'room',
          workspaceId: seedWorkspaceRecord.id,
          creatorUserId: demoUserIdentity.id
        })
        let fail = true
        const evidence: Array<string> = []
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
              return yield* membership.removeMember({ userId: demoUserIdentity.id })
            }
            return yield* membership.changeRole({
              userId: demoUserIdentity.id,
              role: 'admin'
            })
          })
          expect(yield* Effect.flip(change)).toBeInstanceOf(CapabilityUnavailable)
          expect(
            (yield* membership.listMembers).find(
              (member) => member.id === demoUserIdentity.id
            )?.role
          ).toBe('owner')
          expect(evidence).toEqual([])
          expect(yield* directory.get(room.id)).toMatchObject({
            policyRevision: 0,
            runAccessRevision: 0
          })
          yield* change
          expect(
            (yield* membership.listMembers).find(
              (member) => member.id === demoUserIdentity.id
            )?.role
          ).toBe(expectedRole)
          expect(evidence).toEqual(['workspace_access_removed'])
          expect(yield* directory.get(room.id)).toMatchObject({
            policyRevision: 1,
            runAccessRevision: 1
          })
        }).pipe(
          Effect.provide(
            SeedWorkspaceMembership(roster, seedWorkspaceRecord, {
              append: (record) => {
                evidence.push(record.kind)
                return Promise.resolve()
              },
              reportGap: () => Promise.resolve()
            }).pipe(
              Layer.provide([
                Layer.succeed(AssistantDirectory, controlled),
                SeedSeatSyncPublisher,
                SeedWebhookPublisher
              ])
            )
          ),
          Effect.provideService(WorkspaceContext, {
            workspace: seedWorkspaceRecord,
            actor: { userId: demoUserIdentity.id, role: 'owner', systemRole: 'admin' },
            actorType: 'user'
          })
        )
      }).pipe(Effect.provide(SeedAssistantDirectory))
  )
}
