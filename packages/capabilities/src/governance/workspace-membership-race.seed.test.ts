import { expect, it } from '@effect/vitest'
import { SeedSeatSyncPublisher } from '@b2b-saas-starter/billing/seat-sync'
import { Effect, Layer, Ref, Result } from 'effect'
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

for (const operation of ['demote', 'remove', 'leave']) {
  it.effect(`Seed preserves an owner across interleaved ${operation}`, () =>
    Effect.gen(function* () {
      const a = demoUserIdentity
      const b = { ...a, id: 'other-owner' }
      const roster = yield* makeSeedRoster([a, b])
      const directory = yield* AssistantDirectory
      yield* Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        function change(actor: typeof a, target: typeof a) {
          return Effect.gen(function* () {
            if (operation === 'leave') {
              return yield* membership.leave
            }
            if (operation === 'remove') {
              return yield* membership.removeMember({ userId: target.id })
            }
            return yield* membership.changeRole({ userId: target.id, role: 'member' })
          }).pipe(
            Effect.provideService(WorkspaceContext, {
              workspace: seedWorkspaceRecord,
              actor: {
                userId: actor.id,
                role: actor.role,
                systemRole: actor.systemRole,
                banned: actor.banned
              },
              actorType: 'user'
            })
          )
        }
        const results = yield* Effect.all(
          [change(a, b).pipe(Effect.result), change(b, a).pipe(Effect.result)],
          { concurrency: 'unbounded' }
        )
        expect(
          (yield* Ref.get(roster)).filter((member) => member.role === 'owner')
        ).toHaveLength(1)
        expect(results.filter(Result.isFailure)).toHaveLength(1)
      }).pipe(
        Effect.provide(
          SeedWorkspaceMembership(roster, seedWorkspaceRecord).pipe(
            Layer.provide([
              Layer.succeed(AssistantDirectory, {
                ...directory,
                invalidateAccess: () => Effect.yieldNow
              }),
              SeedSeatSyncPublisher,
              SeedWebhookPublisher
            ])
          )
        )
      )
    }).pipe(Effect.provide(SeedAssistantDirectory))
  )
}
