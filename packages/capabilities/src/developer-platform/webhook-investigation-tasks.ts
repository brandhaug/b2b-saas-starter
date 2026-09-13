import { Context, DateTime, Effect, Schema } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { newCapabilityId } from '../internal/ids.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { WebhookEndpoints } from './webhook-endpoints.ts'

const AttemptEvidence = Schema.Struct({
  id: Schema.String,
  attemptedAt: Schema.String,
  responseStatus: Schema.NullOr(Schema.Number),
  status: Schema.String
})

export const WebhookInvestigationTask = Schema.Struct({
  id: Schema.String,
  sourceDeliveryId: Schema.String,
  requestedBy: Schema.NullOr(Schema.String),
  question: Schema.String,
  status: Schema.Literals(['proposed', 'approved', 'cancelled', 'completed']),
  diagnosis: Schema.Literals([
    'retrying',
    'delivered',
    'receiver_unavailable',
    'receiver_rejected',
    'endpoint_disabled',
    'unknown'
  ]),
  evidence: Schema.Struct({
    endpointId: Schema.String,
    endpointUrl: Schema.String,
    eventType: Schema.String,
    deliveryStatus: Schema.String,
    lastResponseStatus: Schema.NullOr(Schema.Number),
    attempts: Schema.Array(AttemptEvidence)
  }),
  replayDeliveryId: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(
    Schema.Literals(['pending', 'delivered', 'failed', 'unavailable'])
  ),
  createdAt: Schema.String,
  updatedAt: Schema.String
})
export type WebhookInvestigationTask = typeof WebhookInvestigationTask.Type

// oxlint-disable-next-line unicorn/throw-new-error -- Effect Schema.TaggedError is a curried class factory.
export class WebhookInvestigationTaskNotFound extends Schema.TaggedError<WebhookInvestigationTaskNotFound>()(
  'WebhookInvestigationTaskNotFound',
  { taskId: Schema.String },
  { httpApiStatus: 404 }
) {}
// oxlint-disable-next-line unicorn/throw-new-error -- Effect Schema.TaggedError is a curried class factory.
export class WebhookInvestigationTaskRejected extends Schema.TaggedError<WebhookInvestigationTaskRejected>()(
  'WebhookInvestigationTaskRejected',
  {
    reason: Schema.Literals([
      'source_unavailable',
      'proposal_changed',
      'not_proposed',
      'already_approved'
    ])
  },
  { httpApiStatus: 409 }
) {}

type TaskId = { readonly taskId: string }
type TaskError =
  | CapabilityUnavailable
  | WebhookInvestigationTaskNotFound
  | WebhookInvestigationTaskRejected
export class WebhookInvestigationTasks extends Context.Service<
  WebhookInvestigationTasks,
  {
    readonly create: (input: {
      readonly deliveryId: string
      readonly question: string
    }) => Effect.Effect<WebhookInvestigationTask, TaskError, WorkspaceContext>
    readonly get: (
      input: TaskId
    ) => Effect.Effect<WebhookInvestigationTask, TaskError, WorkspaceContext>
    readonly list: () => Effect.Effect<
      ReadonlyArray<WebhookInvestigationTask>,
      TaskError,
      WorkspaceContext
    >
    readonly approve: (
      input: TaskId
    ) => Effect.Effect<WebhookInvestigationTask, TaskError, WorkspaceContext>
    readonly cancel: (
      input: TaskId
    ) => Effect.Effect<WebhookInvestigationTask, TaskError, WorkspaceContext>
  }
>()('@b2b-saas-starter/capabilities/WebhookInvestigationTasks') {}

/** The two persistence adapters share all investigation and replay behavior. */
export type InvestigationTaskStore = {
  readonly get: (
    workspaceId: string,
    taskId: string
  ) => Effect.Effect<WebhookInvestigationTask | null, CapabilityUnavailable>
  readonly list: (
    workspaceId: string
  ) => Effect.Effect<ReadonlyArray<WebhookInvestigationTask>, CapabilityUnavailable>
  readonly insert: (
    task: WebhookInvestigationTask
  ) => Effect.Effect<void, CapabilityUnavailable, WorkspaceContext>
  readonly transition: (
    task: WebhookInvestigationTask,
    status: 'approved' | 'cancelled'
  ) => Effect.Effect<boolean, CapabilityUnavailable, WorkspaceContext>
}

export function makeInvestigationTasks(store: InvestigationTaskStore) {
  return Effect.gen(function* () {
    const webhooks = yield* WebhookEndpoints
    const read = Effect.fn('WebhookInvestigationTasks.read')(function* (
      taskId: string
    ) {
      const ctx = yield* WorkspaceContext
      const task = yield* store.get(ctx.workspace.id, taskId)
      if (task === null) {
        return yield* new WebhookInvestigationTaskNotFound({ taskId })
      }
      return task
    })
    const inspect = Effect.fn('WebhookInvestigationTasks.inspect')(function* (
      deliveryId: string
    ) {
      return yield* webhooks
        .inspectDelivery({ deliveryId })
        .pipe(
          Effect.catchTag('WebhookDeliveryNotFound', () =>
            Effect.fail(
              new WebhookInvestigationTaskRejected({ reason: 'source_unavailable' })
            )
          )
        )
    })
    const project = Effect.fn('WebhookInvestigationTasks.project')(function* (
      task: WebhookInvestigationTask
    ) {
      if (task.replayDeliveryId === null) {
        return task
      }
      const result = yield* webhooks
        .inspectDelivery({ deliveryId: task.replayDeliveryId })
        .pipe(
          Effect.map(({ delivery }): WebhookInvestigationTask['outcome'] => {
            if (delivery.status === 'delivered') {
              return 'delivered'
            }
            if (delivery.status === 'pending' || delivery.status === 'failed') {
              return 'pending'
            }
            return 'failed'
          }),
          Effect.catchTag('WebhookDeliveryNotFound', () =>
            Effect.succeed<WebhookInvestigationTask['outcome']>('unavailable')
          )
        )
      return { ...task, outcome: result }
    })
    const create = Effect.fn('WebhookInvestigationTasks.create')(function* (input: {
      readonly deliveryId: string
      readonly question: string
    }) {
      const ctx = yield* WorkspaceContext
      const { delivery, endpoint, attempts } = yield* inspect(input.deliveryId)
      let diagnosis: WebhookInvestigationTask['diagnosis'] = 'unknown'
      if (delivery.status === 'delivered') {
        diagnosis = 'delivered'
      } else if (delivery.status === 'pending' || delivery.status === 'failed') {
        diagnosis = 'retrying'
      } else if (!endpoint.enabled) {
        diagnosis = 'endpoint_disabled'
      } else if (
        delivery.responseStatus !== null &&
        delivery.responseStatus >= 400 &&
        delivery.responseStatus < 500
      ) {
        diagnosis = 'receiver_rejected'
      } else if (delivery.status === 'dead_lettered') {
        diagnosis = 'receiver_unavailable'
      }
      const now = DateTime.formatIso(yield* DateTime.now)
      let status: WebhookInvestigationTask['status'] = 'completed'
      if (diagnosis === 'receiver_unavailable') {
        status = 'proposed'
      }
      const task: WebhookInvestigationTask = {
        id: yield* newCapabilityId('task'),
        sourceDeliveryId: delivery.id,
        requestedBy: ctx.actor?.userId ?? null,
        question: input.question,
        status,
        diagnosis,
        evidence: {
          endpointId: endpoint.id,
          endpointUrl: endpoint.url,
          eventType: delivery.eventType,
          deliveryStatus: delivery.status,
          lastResponseStatus: delivery.responseStatus,
          attempts: attempts
            .toSorted(
              (a, b) =>
                b.attemptedAt.localeCompare(a.attemptedAt) || b.id.localeCompare(a.id)
            )
            .slice(0, 10)
            .map((attempt) => ({
              id: attempt.id,
              attemptedAt: attempt.attemptedAt,
              responseStatus: attempt.responseStatus,
              status: attempt.status
            }))
        },
        replayDeliveryId: null,
        outcome: null,
        createdAt: now,
        updatedAt: now
      }
      yield* store.insert(task)
      return task
    })
    const get = Effect.fn('WebhookInvestigationTasks.get')(function* (input: TaskId) {
      return yield* project(yield* read(input.taskId))
    })
    const list = Effect.fn('WebhookInvestigationTasks.list')(function* () {
      const ctx = yield* WorkspaceContext
      return yield* Effect.forEach(yield* store.list(ctx.workspace.id), project, {
        concurrency: 4
      })
    })
    const approve = Effect.fn('WebhookInvestigationTasks.approve')(function* (
      input: TaskId
    ) {
      let task = yield* read(input.taskId)
      if (task.status !== 'proposed' && task.status !== 'approved') {
        return yield* new WebhookInvestigationTaskRejected({ reason: 'not_proposed' })
      }
      if (task.status === 'proposed') {
        const { endpoint, delivery } = yield* inspect(task.sourceDeliveryId)
        if (
          endpoint.url !== task.evidence.endpointUrl ||
          !endpoint.enabled ||
          delivery.status !== task.evidence.deliveryStatus
        ) {
          return yield* new WebhookInvestigationTaskRejected({
            reason: 'proposal_changed'
          })
        }
        yield* store.transition(task, 'approved')
        task = yield* read(task.id)
        if (task.status !== 'approved') {
          return yield* new WebhookInvestigationTaskRejected({ reason: 'not_proposed' })
        }
      }
      yield* webhooks
        .replayDelivery({
          deliveryId: task.sourceDeliveryId,
          replayDeliveryId: `replay_${task.id}`,
          expectedEndpointUrl: task.evidence.endpointUrl,
          expectedStatus: 'dead_lettered'
        })
        .pipe(
          Effect.catchTags({
            WebhookDeliveryNotFound: () =>
              Effect.fail(
                new WebhookInvestigationTaskRejected({ reason: 'source_unavailable' })
              ),
            WebhookDispatchRejected: () =>
              Effect.fail(
                new WebhookInvestigationTaskRejected({ reason: 'proposal_changed' })
              )
          })
        )
      return yield* project(task)
    })
    const cancel = Effect.fn('WebhookInvestigationTasks.cancel')(function* (
      input: TaskId
    ) {
      const task = yield* read(input.taskId)
      if (task.status === 'approved') {
        return yield* new WebhookInvestigationTaskRejected({
          reason: 'already_approved'
        })
      }
      if (task.status === 'proposed') {
        yield* store.transition(task, 'cancelled')
      }
      const result = yield* read(task.id)
      if (result.status === 'approved') {
        return yield* new WebhookInvestigationTaskRejected({
          reason: 'already_approved'
        })
      }
      return result
    })
    return WebhookInvestigationTasks.of({ create, get, list, approve, cancel })
  })
}

export function investigationTransition(
  taskId: string,
  status: 'approved' | 'cancelled'
) {
  if (status === 'approved') {
    return {
      replayDeliveryId: `replay_${taskId}`,
      eventType: 'assistant_task.approved'
    } satisfies {
      replayDeliveryId: string | null
      eventType: 'assistant_task.approved' | 'assistant_task.cancelled'
    }
  }
  return { replayDeliveryId: null, eventType: 'assistant_task.cancelled' } satisfies {
    replayDeliveryId: string | null
    eventType: 'assistant_task.approved' | 'assistant_task.cancelled'
  }
}
