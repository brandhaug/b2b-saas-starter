import { DateTime, Effect, Layer, Match, Ref, Semaphore } from 'effect'
import { AuditEventLog } from './audit-event-log.ts'
import {
  WorkspaceSuspended,
  WorkspaceSuspensionUnauthorized,
  WorkspaceSuspensionService,
  type WorkspaceSuspension
} from './workspace-suspension.ts'
import { type SystemUserAccount } from './platform-user-admin.ts'
import { type Workspace } from './workspace-identity.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import {
  suspensionNotice,
  validateSuspensionTransition
} from './workspace-suspension.internal.ts'

export function SeedWorkspaceSuspension(options: {
  readonly workspace: Workspace
  readonly systemUsers: ReadonlyArray<SystemUserAccount>
  readonly initial?: WorkspaceSuspension | undefined
}): Layer.Layer<WorkspaceSuspensionService, never, AuditEventLog | NotificationFeed> {
  return Layer.effect(WorkspaceSuspensionService)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const feed = yield* NotificationFeed
      const lock = yield* Semaphore.make(1)
      const state = yield* Ref.make<WorkspaceSuspension>(
        options.initial ?? {
          workspaceId: options.workspace.id,
          status: 'active',
          customerExplanation: null,
          changedAt: null,
          changedByUserId: null
        }
      )
      const get = Effect.fn('WorkspaceSuspension.get')(function* (workspaceId: string) {
        const current = yield* Ref.get(state)
        if (current.workspaceId !== workspaceId) {
          return yield* new WorkspaceSuspended({ workspaceId })
        }
        return current
      })
      return WorkspaceSuspensionService.of({
        list: Effect.map(Ref.get(state), (current) => [
          {
            id: options.workspace.id,
            slug: options.workspace.slug,
            name: options.workspace.name,
            suspension: current
          }
        ]),
        get,
        requireAllowed: Effect.fn('WorkspaceSuspension.requireAllowed')(
          function* (workspaceId, operation) {
            const current = yield* get(workspaceId)
            if (current.status === 'suspended' && operation === 'product') {
              return yield* new WorkspaceSuspended({ workspaceId })
            }
          }
        ),
        transition: Effect.fn('WorkspaceSuspension.transition')(
          function* (input) {
            const reason = yield* validateSuspensionTransition(input)
            const admin = options.systemUsers.find(
              (user) => user.id === input.actor.userId
            )
            if (admin?.systemRole !== 'admin') {
              return yield* new WorkspaceSuspensionUnauthorized()
            }
            const current = yield* get(input.workspaceId)
            const target = Match.value(input.action).pipe(
              Match.when('suspend', (): WorkspaceSuspension['status'] => 'suspended'),
              Match.orElse((): WorkspaceSuspension['status'] => 'active')
            )
            if (current.status === target) {
              return current
            }
            const next: WorkspaceSuspension = {
              workspaceId: current.workspaceId,
              status: target,
              customerExplanation: Match.value(target).pipe(
                Match.when('suspended', () => reason.customerExplanation),
                Match.orElse(() => null)
              ),
              changedAt: DateTime.formatIso(yield* DateTime.now),
              changedByUserId: input.actor.userId
            }
            const notice = yield* feed.prepareWorkspaceOwners(suspensionNotice(next))
            yield* audit.record({
              workspaceId: next.workspaceId,
              actorUserId: input.actor.userId,
              actorType: 'user',
              eventType: Match.value(target).pipe(
                Match.when(
                  'suspended',
                  (): 'workspace.suspended' => 'workspace.suspended'
                ),
                Match.orElse((): 'workspace.unsuspended' => 'workspace.unsuspended')
              ),
              targetType: 'workspace',
              targetId: next.workspaceId,
              metadata: { customerExplanation: next.customerExplanation }
            })
            yield* Ref.set(state, next)
            yield* notice.publish
            return next
          },
          lock.withPermits(1),
          Effect.uninterruptible
        )
      })
    })
  )
}
