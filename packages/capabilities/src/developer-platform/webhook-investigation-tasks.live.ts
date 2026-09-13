import { and, desc, eq, sql } from 'drizzle-orm'
import { DateTime, Effect, Layer, Schema } from 'effect'
import { webhookInvestigationTasks } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { newCapabilityId } from '../internal/ids.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  investigationTransition,
  makeInvestigationTasks,
  WebhookInvestigationTask,
  WebhookInvestigationTasks
} from './webhook-investigation-tasks.ts'

const unavailable = orUnavailable('webhook-investigation-tasks')
const decodeTask = Schema.decodeUnknownEffect(WebhookInvestigationTask)

export const LiveWebhookInvestigationTasks = Layer.effect(WebhookInvestigationTasks)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog
    const mutate = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })
    function decode(row: typeof webhookInvestigationTasks.$inferSelect) {
      return unavailable(
        decodeTask({
          ...row.record,
          id: row.id,
          createdAt: row.createdAt,
          status: row.status,
          replayDeliveryId: row.replayDeliveryId,
          outcome: null,
          updatedAt: row.updatedAt
        })
      )
    }
    return yield* makeInvestigationTasks({
      get: Effect.fn('InvestigationTaskStore.get')(function* (workspaceId, taskId) {
        const rows = yield* unavailable(
          db
            .select()
            .from(webhookInvestigationTasks)
            .where(
              and(
                eq(webhookInvestigationTasks.id, taskId),
                eq(webhookInvestigationTasks.workspaceId, workspaceId)
              )
            )
            .limit(1)
        )
        if (rows[0] === undefined) {
          return null
        }
        return yield* decode(rows[0])
      }),
      list: Effect.fn('InvestigationTaskStore.list')(function* (workspaceId) {
        const rows = yield* unavailable(
          db
            .select()
            .from(webhookInvestigationTasks)
            .where(eq(webhookInvestigationTasks.workspaceId, workspaceId))
            .orderBy(
              desc(webhookInvestigationTasks.createdAt),
              desc(webhookInvestigationTasks.id)
            )
            .limit(30)
        )
        return yield* Effect.forEach(rows, decode)
      }),
      insert: Effect.fn('InvestigationTaskStore.insert')(function* (task) {
        const ctx = yield* WorkspaceContext
        yield* mutate({
          matched: Effect.succeed(true),
          auditEvent: {
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
            actorType: ctx.actorType,
            eventType: 'assistant_task.created',
            targetType: 'assistant_task',
            targetId: task.id,
            metadata: { sourceDeliveryId: task.sourceDeliveryId }
          },
          write: () => [
            db.insert(webhookInvestigationTasks).values({
              id: task.id,
              workspaceId: ctx.workspace.id,
              status: task.status,
              record: {
                sourceDeliveryId: task.sourceDeliveryId,
                requestedBy: task.requestedBy,
                question: task.question,
                diagnosis: task.diagnosis,
                evidence: {
                  ...task.evidence,
                  attempts: task.evidence.attempts.map((attempt) => ({ ...attempt }))
                }
              },
              createdAt: task.createdAt,
              updatedAt: task.updatedAt
            })
          ]
        })
      }),
      transition: Effect.fn('InvestigationTaskStore.transition')(
        function* (task, status) {
          const ctx = yield* WorkspaceContext
          const transitionId = yield* newCapabilityId('transition')
          const updatedAt = DateTime.formatIso(yield* DateTime.now)
          const change = investigationTransition(task.id, status)
          return yield* mutate({
            matched: Effect.succeed(true),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              actorType: ctx.actorType,
              eventType: change.eventType,
              targetType: 'assistant_task',
              targetId: task.id,
              metadata: { sourceDeliveryId: task.sourceDeliveryId }
            },
            write: () => [
              db
                .update(webhookInvestigationTasks)
                .set({
                  status,
                  transitionId,
                  updatedAt,
                  replayDeliveryId: change.replayDeliveryId
                })
                .where(
                  and(
                    eq(webhookInvestigationTasks.id, task.id),
                    eq(webhookInvestigationTasks.workspaceId, ctx.workspace.id),
                    eq(webhookInvestigationTasks.status, 'proposed')
                  )
                )
            ],
            transition: {
              condition: sql`exists (select 1 from ${webhookInvestigationTasks} where ${webhookInvestigationTasks.id} = ${task.id} and ${webhookInvestigationTasks.workspaceId} = ${ctx.workspace.id} and ${webhookInvestigationTasks.transitionId} = ${transitionId})`,
              alongside: []
            }
          })
        }
      )
    })
  })
)
