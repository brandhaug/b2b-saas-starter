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

function active(workspaceId: string): WorkspaceSuspension {
  return {
    workspaceId,
    status: 'active',
    customerExplanation: null,
    changedAt: null,
    changedByUserId: null
  }
}

export function SeedWorkspaceSuspension(options: {
  readonly workspace: Workspace
  readonly catalog?: Ref.Ref<ReadonlyArray<Workspace>> | undefined
  readonly systemUsers: ReadonlyArray<SystemUserAccount>
  readonly initial?: WorkspaceSuspension | undefined
}): Layer.Layer<WorkspaceSuspensionService, never, AuditEventLog | NotificationFeed> {
  return Layer.effect(WorkspaceSuspensionService)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const feed = yield* NotificationFeed
      const lock = yield* Semaphore.make(1)
      const catalog =
        options.catalog ??
        (yield* Ref.make<ReadonlyArray<Workspace>>([options.workspace]))
      const initial = new Map<string, WorkspaceSuspension>()
      if (options.initial) {
        initial.set(options.initial.workspaceId, options.initial)
      }
      const state = yield* Ref.make<ReadonlyMap<string, WorkspaceSuspension>>(initial)
      const get = Effect.fn('WorkspaceSuspension.get')(function* (workspaceId: string) {
        const known = yield* Ref.get(catalog)
        if (!known.some((workspace) => workspace.id === workspaceId)) {
          return yield* new WorkspaceSuspended({ workspaceId })
        }
        const current = yield* Ref.get(state)
        return current.get(workspaceId) ?? active(workspaceId)
      })
      return WorkspaceSuspensionService.of({
        list: Effect.gen(function* () {
          const known = yield* Ref.get(catalog)
          const current = yield* Ref.get(state)
          return known.map((workspace) => ({
            id: workspace.id,
            slug: workspace.slug,
            name: workspace.name,
            suspension: current.get(workspace.id) ?? active(workspace.id)
          }))
        }),
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
            yield* Ref.update(state, (states) =>
              new Map(states).set(next.workspaceId, next)
            )
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
