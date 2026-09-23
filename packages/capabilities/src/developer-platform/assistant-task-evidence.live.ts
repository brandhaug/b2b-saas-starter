import { Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import { Database } from '@b2b-saas-starter/db/service'
import {
  webhookDeliveries,
  webhookEndpoints,
  webhookInvestigationTasks
} from '@b2b-saas-starter/db/schema'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { WorkspaceContext } from '../workspace-context.ts'
import { AssistantTaskEvidence, taskEvidence } from './assistant-task-evidence.ts'
import {
  investigationReplayOutcome,
  WebhookInvestigationTask
} from './webhook-investigation-tasks.ts'

const unavailable = orUnavailable('webhook-investigation-tasks')
const decodeTask = Schema.decodeUnknownEffect(WebhookInvestigationTask)

/** The conversation host reads task evidence without constructing replay writers or billing. */
export const LiveAssistantTaskEvidence = Layer.effect(AssistantTaskEvidence)(
  Effect.gen(function* () {
    const db = yield* Database
    return AssistantTaskEvidence.of({
      read: Effect.fn('AssistantTaskEvidence.read')(function* (taskId) {
        const ctx = yield* WorkspaceContext
        const [row] = yield* unavailable(
          db
            .select()
            .from(webhookInvestigationTasks)
            .where(
              and(
                eq(webhookInvestigationTasks.id, taskId),
                eq(webhookInvestigationTasks.workspaceId, ctx.workspace.id)
              )
            )
            .limit(1)
        )
        if (row === undefined) {
          return null
        }
        let outcome: WebhookInvestigationTask['outcome'] = null
        if (row.replayDeliveryId !== null) {
          const [delivery] = yield* unavailable(
            db
              .select({ status: webhookDeliveries.status })
              .from(webhookDeliveries)
              .innerJoin(
                webhookEndpoints,
                eq(webhookEndpoints.id, webhookDeliveries.endpointId)
              )
              .where(
                and(
                  eq(webhookDeliveries.id, row.replayDeliveryId),
                  eq(webhookEndpoints.workspaceId, ctx.workspace.id)
                )
              )
              .limit(1)
          )
          outcome = investigationReplayOutcome(delivery?.status ?? null)
        }
        const task = yield* unavailable(
          decodeTask({
            ...row.record,
            id: row.id,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            status: row.status,
            replayDeliveryId: row.replayDeliveryId,
            outcome
          })
        )
        return yield* taskEvidence(task)
      })
    })
  })
)
