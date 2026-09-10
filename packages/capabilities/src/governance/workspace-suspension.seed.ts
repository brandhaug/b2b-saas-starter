import { sql } from 'drizzle-orm'
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
import { newCapabilityId } from '../internal/ids.ts'
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
      // The id of the transition that last won a workspace — Live's
      // `workspaces.suspensionTransitionId` column, held in memory.
      const transitions = yield* Ref.make<ReadonlyMap<string, string>>(new Map())
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
          return (
            known
              // `(name, id)` — the same `ORDER BY` Live's operator list uses.
              // Insertion order would put the operator console's rows in
              // whatever sequence the fixture happened to be built in.
              // Codepoint comparison, not `localeCompare`: SQLite's default
              // TEXT collation is BINARY, and a locale-aware sort would
              // disagree with it on the first accented workspace name.
              .toSorted((left, right) => {
                if (left.name !== right.name) {
                  if (left.name < right.name) {
                    return -1
                  }
                  return 1
                }
                if (left.id === right.id) {
                  return 0
                }
                if (left.id < right.id) {
                  return -1
                }
                return 1
              })
              .map((workspace) => ({
                id: workspace.id,
                slug: workspace.slug,
                name: workspace.name,
                suspension: current.get(workspace.id) ?? active(workspace.id)
              }))
          )
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
            // Same lost-transition guard as Live: the state write only lands
            // if this request's transition is still the one on the row, and
            // the owners' notifications are conditional on the same answer.
            // A loser reads the winner's projection back instead of
            // overwriting it.
            const transitionId = yield* newCapabilityId('susp')
            const notice = yield* feed.prepareWorkspaceOwners(suspensionNotice(next), {
              // Seed has no SQL to gate; the fixture answers `holds`.
              sql: sql`1 = 1`,
              holds: Effect.map(
                Ref.get(transitions),
                (stamps) => stamps.get(next.workspaceId) === transitionId
              )
            })
            const wonTransition = yield* Ref.modify(
              state,
              (
                states
              ): readonly [boolean, ReadonlyMap<string, WorkspaceSuspension>] => {
                if (
                  (states.get(next.workspaceId) ?? active(next.workspaceId)).status !==
                  current.status
                ) {
                  return [false, states]
                }
                return [true, new Map(states).set(next.workspaceId, next)]
              }
            )
            if (!wonTransition) {
              return yield* get(input.workspaceId)
            }
            yield* Ref.update(transitions, (stamps) =>
              new Map(stamps).set(next.workspaceId, transitionId)
            )
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
            yield* notice.commit
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
