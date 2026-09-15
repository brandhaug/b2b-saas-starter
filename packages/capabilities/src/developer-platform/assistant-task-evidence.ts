import { DateTime, Effect, Schema } from 'effect'
import { WebhookInvestigationTasks } from './webhook-investigation-tasks.ts'

const encodeEvidence = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

/** Call only after webhook read authorization; destination and response bodies never enter chat. */
export const assistantTaskEvidence = Effect.fn('AssistantConversation.taskEvidence')(
  function* (taskId: string | null) {
    if (taskId === null) {
      return null
    }
    const tasks = yield* WebhookInvestigationTasks
    const task = yield* tasks
      .get({ taskId })
      .pipe(
        Effect.catchTag('WebhookInvestigationTaskNotFound', () => Effect.succeed(null))
      )
    if (task === null) {
      return null
    }
    const observedAt = DateTime.formatIso(yield* DateTime.now)
    const text = encodeEvidence({
      diagnosis: task.diagnosis,
      status: task.status,
      outcome: task.outcome,
      eventType: task.evidence.eventType,
      deliveryStatus: task.evidence.deliveryStatus,
      lastResponseStatus: task.evidence.lastResponseStatus,
      attempts: task.evidence.attempts.slice(-10)
    })
    return { taskId, sourceId: task.sourceDeliveryId, observedAt, text }
  }
)
