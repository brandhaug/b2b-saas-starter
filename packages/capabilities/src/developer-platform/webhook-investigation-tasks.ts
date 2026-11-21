import {
  WebhookDeliveryId,
  WebhookEndpointId,
  type WorkspaceId
} from '@b2b-saas-starter/db/ids'
import {
  webhookInvestigationTaskStatuses,
  type WebhookInvestigationTaskStatus
} from '@b2b-saas-starter/db/enums'
import { Context, DateTime, Effect, Schema } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { newCapabilityId } from '../internal/ids.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  deadLetteredDeliveryStatus,
  deliveredDeliveryStatus,
  isDispatchableDeliveryStatus
} from './webhook-delivery-plan.ts'
import { WebhookDeliveries } from './webhook-deliveries.ts'

/**
 * The owner of the `webhook_investigation_tasks.status` machine (ADR 0077).
 * A task is born `proposed` (a dead-lettered source worth replaying) or
 * `completed` (a finding that needs no operator action); only a proposal
 * moves — approval claims it for one stable replay identity, cancellation
 * retires it. An approved task never re-enters storage: its replay outcome
 * is projected on read from the replay delivery (`investigationReplayOutcome`),
 * which is the delivery owner's vocabulary, not a stored task status.
 *
 * SQL mirrors that must stay in step, named rather than edited:
 * - the `webhook_investigation_tasks.status` column constraint restates the
 *   vocabulary below (schema in `packages/db`, migration
 *   `20260912202956_fresh_wild_pack`).
 * - the Live transition claim and the Seed claim guard pin the source row
 *   to `proposedInvestigationTaskStatus` — the only status a stored
 *   transition may leave.
 */

// The stored `webhook_investigation_tasks.status` vocabulary lives in the db
// enums leaf; re-exported here for existing consumers of this module.
export type { WebhookInvestigationTaskStatus }

/** The only status a stored task transition may claim from. */
export const proposedInvestigationTaskStatus: WebhookInvestigationTaskStatus =
  'proposed'

/** The status an approval claims; its replay may already be in flight. */
export const approvedInvestigationTaskStatus: WebhookInvestigationTaskStatus =
  'approved'

/** The outcomes that can move a stored task row. */
export type InvestigationTaskTransition =
  | { readonly kind: 'approve' }
  | { readonly kind: 'cancel' }

/**
 * The declared transition map: the status each operator outcome produces
 * from each stored status. `null` refuses the outcome — `completed` is
 * terminal, a cancelled task is never approved, and an approved task can no
 * longer be cancelled (its replay may already be in flight). Repeating the
 * outcome a task already holds re-enters it idempotently: an approved task
 * reuses its retained replay identity, and a cancelled one stays cancelled.
 */
const investigationTaskTransitions = {
  proposed: { approve: 'approved', cancel: 'cancelled' },
  approved: { approve: 'approved', cancel: null },
  cancelled: { approve: null, cancel: 'cancelled' },
  completed: { approve: null, cancel: null }
} as const satisfies Record<
  WebhookInvestigationTaskStatus,
  Record<InvestigationTaskTransition['kind'], WebhookInvestigationTaskStatus | null>
>

/** Applies one operator outcome; `null` refuses the transition. */
export function nextInvestigationTaskStatus(
  status: WebhookInvestigationTaskStatus,
  transition: InvestigationTaskTransition
): WebhookInvestigationTaskStatus | null {
  return investigationTaskTransitions[status][transition.kind]
}

/**
 * The status a store writes when it claims a proposal for one outcome. Both
 * stores claim from `proposedInvestigationTaskStatus` alone, where every
 * outcome is legal.
 */
export function claimedInvestigationTaskStatus(
  transition: InvestigationTaskTransition
): WebhookInvestigationTaskStatus {
  return investigationTaskTransitions.proposed[transition.kind]
}

/**
 * The status a new task is born with: only a dead-lettered source proposes
 * a replay; every other diagnosis is a `completed` finding.
 */
export function initialInvestigationTaskStatus(
  diagnosis: WebhookInvestigationTask['diagnosis']
): WebhookInvestigationTaskStatus {
  if (diagnosis === 'receiver_unavailable') {
    return 'proposed'
  }
  return 'completed'
}

const AttemptEvidence = Schema.Struct({
  id: Schema.String,
  attemptedAt: Schema.String,
  responseStatus: Schema.NullOr(Schema.Finite),
  status: Schema.String
})

export const WebhookInvestigationTask = Schema.Struct({
  id: Schema.String,
  sourceDeliveryId: WebhookDeliveryId,
  requestedBy: Schema.NullOr(Schema.String),
  question: Schema.String,
  status: Schema.Literals(webhookInvestigationTaskStatuses),
  diagnosis: Schema.Literals([
    'retrying',
    'delivered',
    'receiver_unavailable',
    'receiver_rejected',
    'endpoint_disabled',
    'unknown'
  ]),
  evidence: Schema.Struct({
    endpointId: WebhookEndpointId,
    endpointUrl: Schema.String,
    eventType: Schema.String,
    deliveryStatus: Schema.String,
    lastResponseStatus: Schema.NullOr(Schema.Finite),
    attempts: Schema.Array(AttemptEvidence)
  }),
  replayDeliveryId: Schema.NullOr(WebhookDeliveryId),
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
      readonly deliveryId: WebhookDeliveryId
      readonly question: string
    }) => Effect.Effect<WebhookInvestigationTask, TaskError, WorkspaceContext>
    readonly get: (
      input: TaskId
    ) => Effect.Effect<WebhookInvestigationTask, TaskError, WorkspaceContext>
    readonly list: Effect.Effect<
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
    workspaceId: WorkspaceId,
    taskId: string
  ) => Effect.Effect<WebhookInvestigationTask | null, CapabilityUnavailable>
  readonly list: (
    workspaceId: WorkspaceId
  ) => Effect.Effect<ReadonlyArray<WebhookInvestigationTask>, CapabilityUnavailable>
  readonly insert: (
    task: WebhookInvestigationTask
  ) => Effect.Effect<void, CapabilityUnavailable, WorkspaceContext>
  /** Claims a proposal for one outcome; `false` when it is no longer proposed. */
  readonly transition: (
    task: WebhookInvestigationTask,
    transition: InvestigationTaskTransition
  ) => Effect.Effect<boolean, CapabilityUnavailable, WorkspaceContext>
}

/**
 * A replay's current delivery status is the authority for its task
 * outcome, read through the delivery owner's vocabulary: a dispatchable
 * delivery (still pending or retrying) keeps the outcome `pending`, a
 * delivered one settles it, and every terminal failure fails it. Retained
 * evidence missing entirely yields `unavailable`.
 */
export function investigationReplayOutcome(
  status: string | null
): WebhookInvestigationTask['outcome'] {
  if (status === null) {
    return 'unavailable'
  }
  if (status === deliveredDeliveryStatus) {
    return 'delivered'
  }
  if (isDispatchableDeliveryStatus(status)) {
    return 'pending'
  }
  return 'failed'
}

/** Why a task refused cancellation: an approved replay may be in flight. */
function cancellationRefused(status: WebhookInvestigationTaskStatus) {
  if (status === approvedInvestigationTaskStatus) {
    return new WebhookInvestigationTaskRejected({ reason: 'already_approved' })
  }
  return new WebhookInvestigationTaskRejected({ reason: 'not_proposed' })
}

export function makeInvestigationTasks(store: InvestigationTaskStore) {
  return Effect.gen(function* () {
    const webhooks = yield* WebhookDeliveries
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
      deliveryId: WebhookDeliveryId
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
          Effect.map(({ delivery }) => investigationReplayOutcome(delivery.status)),
          Effect.catchTag('WebhookDeliveryNotFound', () =>
            Effect.succeed<WebhookInvestigationTask['outcome']>('unavailable')
          )
        )
      return { ...task, outcome: result }
    })
    const create = Effect.fn('WebhookInvestigationTasks.create')(function* (input: {
      readonly deliveryId: WebhookDeliveryId
      readonly question: string
    }) {
      const ctx = yield* WorkspaceContext
      const { delivery, endpoint, attempts } = yield* inspect(input.deliveryId)
      let diagnosis: WebhookInvestigationTask['diagnosis'] = 'unknown'
      if (delivery.status === deliveredDeliveryStatus) {
        diagnosis = 'delivered'
      } else if (isDispatchableDeliveryStatus(delivery.status)) {
        diagnosis = 'retrying'
      } else if (!endpoint.enabled) {
        diagnosis = 'endpoint_disabled'
      } else if (
        delivery.responseStatus !== null &&
        delivery.responseStatus >= 400 &&
        delivery.responseStatus < 500
      ) {
        diagnosis = 'receiver_rejected'
      } else if (delivery.status === deadLetteredDeliveryStatus) {
        diagnosis = 'receiver_unavailable'
      }
      const now = DateTime.formatIso(yield* DateTime.now)
      const status = initialInvestigationTaskStatus(diagnosis)
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
    const list = Effect.gen(function* () {
      const ctx = yield* WorkspaceContext
      return yield* Effect.forEach(yield* store.list(ctx.workspace.id), project, {
        concurrency: 4
      })
    }).pipe(Effect.withSpan('WebhookInvestigationTasks.list'))
    const approve = Effect.fn('WebhookInvestigationTasks.approve')(function* (
      input: TaskId
    ) {
      const transition = { kind: 'approve' } as const
      let task = yield* read(input.taskId)
      // The machine refuses approval from every status but proposed and
      // already-approved (the map's only legal `approve` sources).
      if (nextInvestigationTaskStatus(task.status, transition) === null) {
        return yield* new WebhookInvestigationTaskRejected({ reason: 'not_proposed' })
      }
      if (task.status === proposedInvestigationTaskStatus) {
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
        yield* store.transition(task, transition)
        task = yield* read(task.id)
        if (task.status !== claimedInvestigationTaskStatus(transition)) {
          return yield* new WebhookInvestigationTaskRejected({ reason: 'not_proposed' })
        }
      }
      yield* webhooks
        .replayDelivery({
          deliveryId: task.sourceDeliveryId,
          replayDeliveryId: WebhookDeliveryId.make(`replay_${task.id}`),
          expectedEndpointUrl: task.evidence.endpointUrl,
          expectedStatus: deadLetteredDeliveryStatus
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
      const transition = { kind: 'cancel' } as const
      const task = yield* read(input.taskId)
      if (nextInvestigationTaskStatus(task.status, transition) === null) {
        return yield* cancellationRefused(task.status)
      }
      // A repeat cancellation is already settled; only a proposal is claimed.
      if (task.status !== proposedInvestigationTaskStatus) {
        return task
      }
      yield* store.transition(task, transition)
      // A concurrent cancellation that won the claim still leaves the
      // requested outcome; a concurrent approval does not.
      const result = yield* read(task.id)
      if (result.status !== claimedInvestigationTaskStatus(transition)) {
        return yield* cancellationRefused(result.status)
      }
      return result
    })
    return WebhookInvestigationTasks.of({ create, get, list, approve, cancel })
  })
}

/** The stored side effects of claiming a proposal for one outcome. */
export function investigationTransition(
  taskId: string,
  transition: InvestigationTaskTransition
) {
  const status = claimedInvestigationTaskStatus(transition)
  if (transition.kind === 'approve') {
    return {
      status,
      replayDeliveryId: WebhookDeliveryId.make(`replay_${taskId}`),
      eventType: 'assistant_task.approved'
    } satisfies InvestigationClaim
  }
  return {
    status,
    replayDeliveryId: null,
    eventType: 'assistant_task.cancelled'
  } satisfies InvestigationClaim
}

type InvestigationClaim = {
  readonly status: WebhookInvestigationTaskStatus
  readonly replayDeliveryId: WebhookDeliveryId | null
  readonly eventType: 'assistant_task.approved' | 'assistant_task.cancelled'
}
