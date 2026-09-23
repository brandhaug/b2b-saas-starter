import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type WorkspaceContext } from '../workspace-context.ts'
import {
  WebhookInvestigationTasks,
  type WebhookInvestigationTask,
  type WebhookInvestigationTaskRejected
} from './webhook-investigation-tasks.ts'

const encodeEvidence = Schema.encodeSync(Schema.fromJsonString(Schema.Json))
type TaskEvidence = {
  readonly taskId: string
  readonly sourceId: string
  readonly observedAt: string
  readonly text: string
}

export class AssistantTaskEvidence extends Context.Service<
  AssistantTaskEvidence,
  {
    readonly read: (
      taskId: string
    ) => Effect.Effect<
      TaskEvidence | null,
      CapabilityUnavailable | WebhookInvestigationTaskRejected,
      WorkspaceContext
    >
  }
>()('@b2b-saas-starter/capabilities/AssistantTaskEvidence') {}

/** Both compositions disclose the same bounded, sanitized task projection. */
export const taskEvidence = Effect.fn('AssistantTaskEvidence.project')(function* (
  task: WebhookInvestigationTask
) {
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
  return { taskId: task.id, sourceId: task.sourceDeliveryId, observedAt, text }
})

/** The reference application shares the same task instance used by mutations. */
export const AssistantTaskEvidenceLayer = Layer.effect(AssistantTaskEvidence)(
  Effect.gen(function* () {
    const tasks = yield* WebhookInvestigationTasks
    return AssistantTaskEvidence.of({
      read: Effect.fn('AssistantTaskEvidence.read')(function* (taskId) {
        const task = yield* tasks
          .get({ taskId })
          .pipe(
            Effect.catchTag('WebhookInvestigationTaskNotFound', () =>
              Effect.succeed(null)
            )
          )
        if (task === null) {
          return null
        }
        return yield* taskEvidence(task)
      })
    })
  })
)

/** Call only after webhook read authorization; absent task IDs need no lookup. */
export const assistantTaskEvidence = Effect.fn('AssistantConversation.taskEvidence')(
  function* (taskId: string | null) {
    if (taskId === null) {
      return null
    }
    return yield* (yield* AssistantTaskEvidence).read(taskId)
  }
)
