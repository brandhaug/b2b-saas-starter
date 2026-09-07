import { user, workspaces } from '@b2b-saas-starter/db/schema'
import { Database, RawD1 } from '@b2b-saas-starter/db/service'
import { and, eq, sql } from 'drizzle-orm'
import { DateTime, Effect, Layer, Match } from 'effect'
import { orUnavailable } from '../internal/unavailable.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { commitAuditedTransition } from './audited-mutation.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import {
  WorkspaceSuspended,
  WorkspaceSuspensionService,
  WorkspaceSuspensionUnauthorized,
  type WorkspaceSuspension
} from './workspace-suspension.ts'
import {
  suspensionNotice,
  validateSuspensionTransition
} from './workspace-suspension.internal.ts'

function toState(row: typeof workspaces.$inferSelect): WorkspaceSuspension {
  return {
    workspaceId: row.id,
    status: row.suspensionStatus,
    customerExplanation: row.suspensionCustomerExplanation,
    changedAt: row.suspensionChangedAt,
    changedByUserId: row.suspensionChangedByUserId
  }
}

const unavailable = orUnavailable('workspace-suspension')

export const LiveWorkspaceSuspension: Layer.Layer<
  WorkspaceSuspensionService,
  never,
  Database | RawD1 | AuditEventLog | NotificationFeed
> = Layer.effect(WorkspaceSuspensionService)(
  Effect.gen(function* () {
    const db = yield* Database
    const d1 = yield* RawD1
    const audit = yield* AuditEventLog
    const feed = yield* NotificationFeed

    const get = Effect.fn('WorkspaceSuspension.get')(function* (workspaceId: string) {
      const rows = yield* unavailable(
        db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
      )
      const row = rows[0]
      if (row === undefined) {
        return yield* new WorkspaceSuspended({ workspaceId })
      }
      return toState(row)
    })

    return WorkspaceSuspensionService.of({
      list: unavailable(
        db.select().from(workspaces).orderBy(workspaces.name, workspaces.id)
      ).pipe(
        Effect.map((rows) =>
          rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            name: row.name,
            suspension: toState(row)
          }))
        )
      ),
      get,
      requireAllowed: Effect.fn('WorkspaceSuspension.requireAllowed')(
        function* (workspaceId, operation) {
          const state = yield* get(workspaceId)
          if (state.status === 'suspended' && operation === 'product') {
            return yield* new WorkspaceSuspended({ workspaceId })
          }
        }
      ),
      transition: Effect.fn('WorkspaceSuspension.transition')(function* (input) {
        const reason = yield* validateSuspensionTransition(input)
        const administrators = yield* unavailable(
          db
            .select({ role: user.role })
            .from(user)
            .where(eq(user.id, input.actor.userId))
            .limit(1)
        )
        if (administrators[0]?.role !== 'admin') {
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

        const changedAt = DateTime.formatIso(yield* DateTime.now)
        const transitionId = yield* newCapabilityId('susp')
        const next: WorkspaceSuspension = {
          workspaceId: input.workspaceId,
          status: target,
          customerExplanation: Match.value(target).pipe(
            Match.when('suspended', () => reason.customerExplanation),
            Match.orElse(() => null)
          ),
          changedAt,
          changedByUserId: input.actor.userId
        }
        const write = db
          .update(workspaces)
          .set({
            suspensionStatus: target,
            suspensionInternalReason: reason.internalReason,
            suspensionCustomerExplanation: next.customerExplanation,
            suspensionChangedAt: changedAt,
            suspensionTransitionId: transitionId,
            suspensionChangedByUserId: input.actor.userId
          })
          .where(
            and(
              eq(workspaces.id, input.workspaceId),
              eq(workspaces.suspensionStatus, current.status)
            )
          )
        const wonTransition = sql`EXISTS (SELECT 1 FROM workspaces WHERE id = ${input.workspaceId} AND suspensionTransitionId = ${transitionId})`
        const notice = yield* feed.prepareWorkspaceOwners(
          suspensionNotice(next),
          wonTransition
        )
        const auditStatement = yield* audit.prepareRecord(
          {
            workspaceId: input.workspaceId,
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
            targetId: input.workspaceId,
            metadata: { customerExplanation: next.customerExplanation }
          },
          wonTransition
        )

        // The conditional audit and state change commit together. Read the
        // batch's change count before another transition can replace this one.
        const changed = yield* commitAuditedTransition(write, [
          auditStatement,
          ...notice.writes
        ]).pipe(Effect.provideService(RawD1, d1), unavailable)
        if (!changed) {
          return yield* get(input.workspaceId)
        }
        yield* notice.publish
        return next
      })
    })
  })
)
