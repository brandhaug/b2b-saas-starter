import { type DateTime, Effect } from 'effect'

import { NotificationFeed } from '../notifications/notification-feed.ts'
import { WebhookEndpoints, type RecordedWebhookAttempt } from './webhook-endpoints.ts'
import {
  failureLadderNotification,
  type FailureLadderAction,
  planDeliveryAttempt,
  type WebhookDeliveryStatus
} from './webhook-delivery-plan.ts'
import { type WebhookQueueMessage } from './webhook-publisher.ts'

type WebhookAttemptCompletion = {
  readonly status: WebhookDeliveryStatus
  readonly outcome: 'ack' | 'retry'
}

const notifyPermanentFailure = Effect.fn(
  'WebhookAttemptCompletion.notifyPermanentFailure'
)(
  function* (message: WebhookQueueMessage, endpointUrl: string) {
    const feed = yield* NotificationFeed
    yield* feed.create({
      workspaceId: message.workspaceId,
      userId: null,
      kind: 'webhook.delivery_failed',
      title: 'Webhook delivery failed',
      message: `${endpointUrl}: ${message.eventType} was rejected and will not be retried.`,
      event: {
        type: 'webhook.permanent',
        endpointUrl,
        eventType: message.eventType
      }
    })
  },
  Effect.catchCause((cause) =>
    Effect.logError('notification_create_failed', cause).pipe(
      Effect.annotateLogs({ notificationCreate: 'failed' })
    )
  )
)

const notifyFailureLadder = Effect.fn('WebhookAttemptCompletion.notifyFailureLadder')(
  function* (input: {
    readonly failureAction: FailureLadderAction
    readonly workspaceId: string
    readonly url: string | null
    readonly consecutiveFailures: number
  }) {
    yield* Effect.annotateLogsScoped({ consecutiveFailures: input.consecutiveFailures })
    if (input.failureAction === 'silent') {
      return
    }
    const feed = yield* NotificationFeed
    yield* feed.notifyWorkspaceOwners({
      workspaceId: input.workspaceId,
      kind: 'webhook.delivery_failed',
      ...failureLadderNotification({
        url: input.url,
        consecutiveFailures: input.consecutiveFailures
      })
    })
  },
  Effect.catchCause((cause) =>
    Effect.logError('failure_ladder_notification_failed', cause).pipe(
      Effect.annotateLogs({ notificationCreate: 'failed' })
    )
  )
)

const reactToAcceptedObservation = Effect.fn(
  'WebhookAttemptCompletion.reactToAcceptedObservation'
)(function* (input: {
  readonly message: WebhookQueueMessage
  readonly endpointUrl: string | null
  readonly recorded: RecordedWebhookAttempt
}) {
  if (input.endpointUrl !== null && input.recorded.status === 'failed_permanent') {
    yield* notifyPermanentFailure(input.message, input.endpointUrl)
  }
  yield* notifyFailureLadder({
    workspaceId: input.message.workspaceId,
    url: input.endpointUrl,
    failureAction: input.recorded.failureAction,
    consecutiveFailures: input.recorded.consecutiveFailures
  })
})

type HttpObservationInput = {
  readonly message: WebhookQueueMessage
  readonly endpointUrl: string
  readonly responseStatus: number
  readonly attempts: number
  readonly finishedAt: DateTime.Utc
  readonly durationMs: number
  readonly failureReason: string | null
  readonly requestHeaders: Record<string, string>
  readonly responseBody: string | null
}

/** Late and duplicate observations follow the persisted summary and never repeat warnings. */
export const completeWebhookHttpObservation = Effect.fn(
  'WebhookAttemptCompletion.completeHttpObservation'
)(function* (input: HttpObservationInput) {
  const webhooks = yield* WebhookEndpoints
  const plan = planDeliveryAttempt(
    input.responseStatus,
    input.attempts,
    input.finishedAt
  )
  const recorded = yield* webhooks.recordDeliveryAttempt({
    id: input.message.deliveryId,
    endpointId: input.message.endpointId,
    workspaceId: input.message.workspaceId,
    eventType: input.message.eventType,
    status: plan.status,
    attempts: input.attempts,
    durationMs: input.durationMs,
    failureReason: input.failureReason,
    responseStatus: plan.responseStatus,
    nextAttemptAt: plan.nextAttemptAt,
    payload: input.message.payload,
    requestHeaders: input.requestHeaders,
    responseBody: input.responseBody
  })
  if (recorded.recorded) {
    yield* reactToAcceptedObservation({
      message: input.message,
      endpointUrl: input.endpointUrl,
      recorded
    })
  }
  if (recorded.status === 'failed') {
    return {
      status: recorded.status,
      outcome: 'retry'
    } satisfies WebhookAttemptCompletion
  }
  return { status: recorded.status, outcome: 'ack' } satisfies WebhookAttemptCompletion
})

type TerminalObservationInput = {
  readonly message: WebhookQueueMessage
  readonly attempts: number
  readonly status: 'failed_permanent' | 'dead_lettered'
  readonly failureReason: string
  readonly endpointUrl: string | null
}

/** Dead-letter broadcasts stay in persistence. A null URL retains its owner-warning wording. */
export const completeWebhookTerminalObservation = Effect.fn(
  'WebhookAttemptCompletion.completeTerminalObservation'
)(function* (input: TerminalObservationInput) {
  const webhooks = yield* WebhookEndpoints
  const recorded = yield* webhooks.recordTerminalDeliveryAttempt({
    deliveryId: input.message.deliveryId,
    endpointId: input.message.endpointId,
    workspaceId: input.message.workspaceId,
    eventType: input.message.eventType,
    attempts: input.attempts,
    status: input.status,
    failureReason: input.failureReason,
    payload: input.message.payload
  })
  if (recorded.recorded) {
    yield* reactToAcceptedObservation({
      message: input.message,
      endpointUrl: input.endpointUrl,
      recorded
    })
  }
  return { status: recorded.status, outcome: 'ack' } satisfies WebhookAttemptCompletion
})
