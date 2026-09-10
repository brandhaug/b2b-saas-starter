import { user, workspaces } from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { and, eq, sql } from 'drizzle-orm'
import { DateTime, Effect, Layer, Match } from 'effect'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { newCapabilityId } from '../internal/ids.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { auditedMutations } from './audited-mutation.ts'
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
    const audit = yield* AuditEventLog
    const feed = yield* NotificationFeed
    const auditedMutation = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })

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
        const notice = yield* feed.prepareWorkspaceOwners(suspensionNotice(next), {
          sql: wonTransition,
          holds: Effect.succeed(true)
        })
        // The state change, its audit row, and the owners' notifications
        // commit in one batch, each conditional on this request being the one
        // that won the transition.
        const changed = yield* auditedMutation({
          matched: Effect.succeed(true),
          auditEvent: {
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
          write: () => write,
          transition: { condition: wonTransition, alongside: notice.writes }
        })
        if (!changed) {
          return yield* get(input.workspaceId)
        }
        yield* notice.commit
        yield* notice.publish
        return next
      })
    })
  })
)
