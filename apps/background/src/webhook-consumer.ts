import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import {
  type FailureLadderAction,
  failureLadderNotification,
  planDeliveryAttempt,
  WEBHOOK_USER_AGENT
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { validateWebhookUrl } from '@b2b-saas-starter/capabilities/developer-platform/webhook-url'
import { WebhookQueueMessage } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { currentTraceId, TRACE_HEADER } from '@b2b-saas-starter/logger'
import { DateTime, Effect, Result, Schema, type Scope } from 'effect'
import { HttpBody, HttpClient } from 'effect/unstable/http'

import { webhookDlqConsumerSettings } from '../../../infra/bindings.ts'
import {
  consumerInvocation,
  type DeliveryOutcome,
  type Env,
  readDelivery,
  type QueueDelivery,
  type QueueEnvelope
} from './queue-consumer.ts'
import { computeWebhookSignature, signatureHeaderValue } from './webhook-signing.ts'
import { readWebhookResponse } from './webhook-response.ts'

/** Body of a delivery POST, encoded through a JSON codec rather than a
 * hand-rolled `JSON.stringify`: the signature is computed over exactly the
 * bytes this codec produces. */
const WebhookDeliveryBody = Schema.Struct({
  deliveryId: Schema.String,
  eventType: WebhookQueueMessage.fields.eventType,
  payload: WebhookQueueMessage.fields.payload
})
const encodeDeliveryBody = Schema.encodeSync(Schema.fromJsonString(WebhookDeliveryBody))

/**
 * How a malformed body is reported: the consumer's own terminal outcome plus
 * the reason, on the wide event the scope is already holding. Nothing else is
 * recorded — there is no trusted endpointId for a delivery row.
 */
function annotateMalformed(outcome: string): Effect.Effect<void, never, Scope.Scope> {
  return Effect.annotateLogsScoped({ outcome, skipReason: 'malformed_message' })
}

/**
 * The user-facing half of a delivery that gave up: one workspace-broadcast
 * Notification of kind `webhook.delivery_failed`, beside the audit event the
 * capability already batched with the terminal row. This is where the feed's
 * instant-email fan-out starts for the kind (ADR 0061). Best-effort — a feed
 * outage must not turn a settled delivery into a retry loop.
 */
function notifyPermanentFailure(
  message: WebhookQueueMessage,
  endpointUrl: string
): Effect.Effect<void, never, NotificationFeed> {
  return Effect.gen(function* () {
    const feed = yield* NotificationFeed
    const detail = `${message.eventType} was rejected and will not be retried.`
    yield* feed.create({
      workspaceId: message.workspaceId,
      userId: null,
      kind: 'webhook.delivery_failed',
      title: 'Webhook delivery failed',
      message: `${endpointUrl}: ${detail}`,
      event: {
        type: 'webhook.permanent',
        endpointUrl,
        eventType: message.eventType
      }
    })
  }).pipe(
    // The cause goes on the log record whole; the wide event keeps the flag.
    Effect.catchCause((cause) =>
      Effect.logError('notification_create_failed', cause).pipe(
        Effect.annotateLogs({ notificationCreate: 'failed' })
      )
    )
  )
}

/** Fields every consumer stamps onto its wide event once decoded. */
function annotateMessageFields(message: WebhookQueueMessage) {
  return Effect.annotateLogsScoped({
    endpointId: message.endpointId,
    workspaceId: message.workspaceId,
    eventType: message.eventType
  })
}

/**
 * The user-facing half of a failure-ladder rung (ADR 0062 addendum): one
 * owner-targeted Notification of the existing `webhook.delivery_failed` kind,
 * its copy owned by `failureLadderNotification`. The ladder deliberately
 * rides the existing webhook kind — one preference knob for webhook failure
 * notices, one email template — instead of minting a second vocabulary entry
 * beside it. This is where the feed's email fan-out starts for the kind.
 * Best-effort — a feed outage must not fail an attempt whose row already
 * recorded.
 */
function notifyFailureLadder(input: {
  readonly failureAction: FailureLadderAction
  readonly workspaceId: string
  readonly url: string | null
  readonly consecutiveFailures: number
}): Effect.Effect<void, never, NotificationFeed | Scope.Scope> {
  return Effect.gen(function* () {
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
  }).pipe(
    // The cause goes on the log record whole; the wide event keeps the flag.
    Effect.catchCause((cause) =>
      Effect.logError('failure_ladder_notification_failed', cause).pipe(
        Effect.annotateLogs({ notificationCreate: 'failed' })
      )
    )
  )
}

/**
 * Delivers one webhook message: resolve the dispatch target, re-check the
 * SSRF guard, sign, POST, persist the attempt row, and decide ack/retry.
 * Capability and HTTP requirements stay open so tests inject stub
 * `WebhookEndpoints` / `HttpClient` layers; the queue handler wraps this with
 * the real layers and the wide-event scope (`deliverWebhook`).
 */
export function processWebhookMessage(
  delivery: QueueDelivery<WebhookQueueMessage>,
  traceId: string
): Effect.Effect<
  DeliveryOutcome,
  CapabilityUnavailable,
  WebhookEndpoints | NotificationFeed | HttpClient.HttpClient | Scope.Scope
> {
  return Effect.gen(function* () {
    // A malformed body is terminal — mirroring how permanent delivery failures
    // ack instead of retrying forever — and there is nothing to dispatch.
    if (delivery.kind === 'malformed') {
      yield* annotateMalformed('failed_permanent')
      return 'ack' satisfies DeliveryOutcome
    }
    const message = delivery.message
    const attempts = delivery.attempts
    yield* annotateMessageFields(message)
    const webhooks = yield* WebhookEndpoints
    // The delivery id the queue message owns — derived before anything can go
    // terminal, so a never-dispatched row still resolves this message's
    // identity (one row per message, even when it dies pre-dispatch).
    const deliveryId = message.deliveryId
    // The workspace ID from the message is verified inside the capability:
    // a cross-workspace mismatch resolves null, same as a disabled or deleted
    // endpoint, so no signing secret leaves the workspace that enqueued it.
    const target = yield* webhooks.getDispatchTarget(
      message.endpointId,
      message.workspaceId
    )
    if (!target) {
      yield* webhooks.recordTerminalDeliveryAttempt({
        deliveryId,
        endpointId: message.endpointId,
        workspaceId: message.workspaceId,
        eventType: message.eventType,
        attempts,
        status: 'failed_permanent',
        failureReason: 'Endpoint is disabled or no longer available',
        payload: message.payload
      })
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: 'not_dispatchable'
      })
      return 'ack' satisfies DeliveryOutcome
    }
    yield* Effect.annotateLogsScoped({ endpointUrl: target.url })
    // Re-check the destination at dispatch time — an endpoint created before
    // the guard existed (or edited in the DB) must not let the worker reach
    // internal targets. DNS-rebinding protection is out of scope for the
    // starter (see validateWebhookUrl).
    const urlCheck = validateWebhookUrl(target.url)
    if (!urlCheck.valid) {
      // Never-dispatched terminal row: resolves this message's delivery id and
      // records the payload, so the row stays replayable once the URL is fixed.
      const recorded = yield* webhooks.recordTerminalDeliveryAttempt({
        deliveryId,
        endpointId: target.id,
        workspaceId: message.workspaceId,
        eventType: message.eventType,
        attempts,
        status: 'failed_permanent',
        failureReason: `Destination refused: ${urlCheck.reason}`,
        payload: message.payload
      })
      yield* Effect.annotateLogsScoped({
        outcome: 'failed_permanent',
        skipReason: `invalid_url: ${urlCheck.reason}`
      })
      if (!recorded.recorded) {
        return 'ack' satisfies DeliveryOutcome
      }
      yield* notifyPermanentFailure(message, target.url)
      // A refused URL is a failed attempt like any other — the ladder climbs.
      yield* notifyFailureLadder({
        workspaceId: message.workspaceId,
        url: target.url,
        failureAction: recorded.failureAction,
        consecutiveFailures: recorded.consecutiveFailures
      })
      return 'ack' satisfies DeliveryOutcome
    }
    const now = yield* DateTime.now
    const timestamp = Math.floor(DateTime.toEpochMillis(now) / 1000)
    const body = encodeDeliveryBody({
      deliveryId,
      eventType: message.eventType,
      payload: message.payload
    })
    // One signature per active signing secret: the current one, plus the
    // rotated-out one while its 24h grace window is open (the receiver may
    // still hold it). The header lists them all; receivers try each.
    const signatures = yield* Effect.forEach(target.signingSecrets, (secret) =>
      computeWebhookSignature(secret, deliveryId, timestamp, body)
    )
    const requestHeaders = {
      'content-type': 'application/json',
      'user-agent': WEBHOOK_USER_AGENT,
      'webhook-id': deliveryId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signatureHeaderValue(signatures),
      [TRACE_HEADER]: traceId
    }
    const client = yield* HttpClient.HttpClient
    const responseResult = yield* Effect.result(
      client
        .post(target.url, {
          headers: requestHeaders,
          body: HttpBody.text(body, 'application/json')
        })
        // A hung receiver must not stall the batch; timeout surfaces as a
        // failure Result (responseStatus 0) and is retried.
        .pipe(Effect.timeout('10 seconds'))
    )
    const responseStatus = Result.match(responseResult, {
      onSuccess: (response) => response.status,
      onFailure: () => 0
    })
    // Operator evidence from the latest attempt: the response body is read
    // truncated (a receiver's error page is the thing an operator reads), or
    // null when there was no response at all. A body read failure degrades to
    // null — the row still records the attempt.
    let responseBody: string | null = null
    if (Result.isSuccess(responseResult)) {
      const text = yield* Effect.result(readWebhookResponse(responseResult.success))
      if (Result.isSuccess(text)) {
        responseBody = text.success
      }
    }
    // The dispatch half of the delivery state machine lives below the
    // capability interface: classification, persisted status, and the
    // backoff-aligned retry schedule all come from the capability.
    const finishedAt = yield* DateTime.now
    const durationMs = Math.max(
      0,
      DateTime.toEpochMillis(finishedAt) - DateTime.toEpochMillis(now)
    )
    let failureReason: string | null = null
    if (Result.isFailure(responseResult)) {
      failureReason = 'Network request failed'
      if (responseResult.failure._tag === 'TimeoutError') {
        failureReason = 'Request timed out'
      }
    } else if (responseStatus < 200 || responseStatus >= 300) {
      failureReason = `Receiver returned HTTP ${responseStatus}`
    }
    const plan = planDeliveryAttempt(responseStatus, attempts, finishedAt)
    const recorded = yield* webhooks.recordDeliveryAttempt({
      id: deliveryId,
      endpointId: target.id,
      // Terminal statuses batch an audit event with the attempt row inside
      // the capability; the workspace id scopes it to the endpoint's owner.
      workspaceId: message.workspaceId,
      eventType: message.eventType,
      status: plan.status,
      attempts,
      durationMs,
      failureReason,
      responseStatus: plan.responseStatus,
      nextAttemptAt: plan.nextAttemptAt,
      // Operator evidence columns: what was sent and what came back, so the
      // deliveries drawer can replay or diagnose without re-deriving it.
      payload: message.payload,
      requestHeaders,
      responseBody
    })
    yield* Effect.annotateLogsScoped({ outcome: plan.status, responseStatus })
    if (!recorded.recorded) {
      if (recorded.status === 'failed') {
        return 'retry' satisfies DeliveryOutcome
      }
      return 'ack' satisfies DeliveryOutcome
    }
    if (plan.status === 'failed_permanent') {
      yield* notifyPermanentFailure(message, target.url)
    }
    // The failure ladder reacts to the streak the attempt left: warnings at
    // the rungs, the auto-disable at the threshold (ADR 0062 addendum).
    yield* notifyFailureLadder({
      workspaceId: message.workspaceId,
      url: target.url,
      failureAction: recorded.failureAction,
      consecutiveFailures: recorded.consecutiveFailures
    })
    return plan.outcome satisfies DeliveryOutcome
  })
}

function deliverWebhook(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome, never, HttpClient.HttpClient> {
  // The one boundary decode per delivery: the trace continuation and the
  // consumer read the same result. endpointId/eventType land on the wide event
  // via `Effect.annotateLogsScoped` inside the scope; the entry's metadata
  // carries the attempt count.
  const delivery = readDelivery(WebhookQueueMessage, envelope)
  return consumerInvocation(env, {
    event: 'webhook_delivery',
    delivery,
    onFailure: 'retry',
    // The `x-trace-id` forwarded to the receiver is this scope's OTel trace id,
    // so the header a receiver quotes back resolves in the trace backend too.
    program: Effect.gen(function* () {
      const traceId = yield* currentTraceId
      return yield* processWebhookMessage(delivery, traceId)
    }).pipe(Effect.provide(selectCapabilitiesLayer(starterEnv(env))))
  })
}

/**
 * Core of the dead-letter consumer: the message exhausted `maxRetries` on the
 * primary queue, so record a terminal `dead_lettered` delivery row (the
 * capability batches the matching audit event with it). Exported with the
 * `WebhookEndpoints` requirement left open for tests, like
 * `processWebhookMessage`; `recordDeadLetter` wraps it with the real layers
 * and the wide-event scope.
 */
export function processDeadLetterMessage(
  delivery: QueueDelivery<WebhookQueueMessage>
): Effect.Effect<
  void,
  CapabilityUnavailable,
  WebhookEndpoints | NotificationFeed | Scope.Scope
> {
  return Effect.gen(function* () {
    // Same terminal outcome as `processWebhookMessage`: a malformed dead letter
    // has no trusted endpointId for a delivery row, so log-and-ack only.
    if (delivery.kind === 'malformed') {
      yield* annotateMalformed('dead_lettered')
      return
    }
    const message = delivery.message
    yield* annotateMessageFields(message)
    const webhooks = yield* WebhookEndpoints
    // The same row id the message's attempts resolved on the primary queue —
    // the exhausted row goes terminal in place instead of forking a second
    // row, and its recorded payload keeps it replayable.
    const deliveryId = message.deliveryId
    const recorded = yield* webhooks.recordTerminalDeliveryAttempt({
      deliveryId,
      endpointId: message.endpointId,
      workspaceId: message.workspaceId,
      eventType: message.eventType,
      attempts: delivery.attempts,
      status: 'dead_lettered',
      failureReason: 'Queue retries exhausted',
      payload: message.payload
    })
    yield* Effect.annotateLogsScoped({ outcome: 'dead_lettered' })
    if (!recorded.recorded) {
      return
    }
    // Persistence decides whether terminal bookkeeping advances the streak.
    yield* notifyFailureLadder({
      workspaceId: message.workspaceId,
      url: null,
      failureAction: recorded.failureAction,
      consecutiveFailures: recorded.consecutiveFailures
    })
  })
}

/**
 * Dead-letter consumer entry: wraps `processDeadLetterMessage` with the real
 * capabilities layer and a wide event so operators can see (and replay)
 * exhausted deliveries.
 *
 * DLQ durability: the terminal `dead_lettered` row — and the audit event
 * batched with it — is the only durable evidence that a message gave up, so
 * the write's one failure channel folds into a bounded retry instead of an
 * ack: a one-off D1 blip must not erase the evidence forever. The bound is
 * the DLQ consumer's own `maxRetries`; past it the message is acknowledged
 * anyway with the loss on the wide event. Loop safety stands either way —
 * this handler never throws, so a DLQ message can never crash the batch.
 */
function recordDeadLetter(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome> {
  const delivery = readDelivery(WebhookQueueMessage, envelope)
  const program: Effect.Effect<DeliveryOutcome, never, Scope.Scope> =
    processDeadLetterMessage(delivery).pipe(
      Effect.provide(selectCapabilitiesLayer(starterEnv(env))),
      // `as<'ack'>(...)`, not `satisfies`: under pipe inference the naked type
      // parameter widens the satisfies-checked literal to `string`.
      Effect.as<'ack'>('ack'),
      Effect.catchTag(
        'CapabilityUnavailable',
        (): Effect.Effect<DeliveryOutcome, never, Scope.Scope> => {
          if (delivery.attempts < webhookDlqConsumerSettings.maxRetries) {
            return Effect.annotateLogsScoped({
              outcome: 'retry',
              skipReason: 'terminal_write_failed'
            }).pipe(Effect.as<'retry'>('retry'))
          }
          return Effect.annotateLogsScoped({
            outcome: 'dead_lettered',
            skipReason: 'terminal_write_failed'
          }).pipe(Effect.as<'ack'>('ack'))
        }
      )
    )
  return consumerInvocation(env, {
    event: 'webhook_dead_letter',
    delivery,
    onFailure: 'ack',
    program
  })
}

export { deliverWebhook, recordDeadLetter }
