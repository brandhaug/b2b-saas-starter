import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { WEBHOOK_USER_AGENT } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import {
  completeWebhookHttpObservation,
  completeWebhookTerminalObservation
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-attempt-completion'
import { validateWebhookUrl } from '@b2b-saas-starter/capabilities/developer-platform/webhook-url'
import { WebhookQueueMessage } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { type NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { currentTraceId, TRACE_HEADER } from '@b2b-saas-starter/logger'
import { DateTime, Effect, Result, Schema, type Scope } from 'effect'
import { HttpBody, HttpClient } from 'effect/unstable/http'

import { webhookDlqConsumerSettings } from '@b2b-saas-starter/infra'
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

/** Fields every consumer stamps onto its wide event once decoded. */
function annotateMessageFields(message: WebhookQueueMessage) {
  return Effect.annotateLogsScoped({
    endpointId: message.endpointId,
    workspaceId: message.workspaceId,
    eventType: message.eventType
  })
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
  | WebhookEndpoints
  | NotificationFeed
  | WorkspaceSuspensionService
  | HttpClient.HttpClient
  | Scope.Scope
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
    if (
      yield* webhooks.isDeliverySettled({
        deliveryId,
        endpointId: message.endpointId,
        workspaceId: message.workspaceId
      })
    ) {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: 'delivery_settled'
      })
      return 'ack' satisfies DeliveryOutcome
    }
    // The workspace ID from the message is verified inside the capability:
    // a cross-workspace mismatch resolves null, same as a disabled or deleted
    // endpoint, so no signing secret leaves the workspace that enqueued it.
    const target = yield* webhooks.getDispatchTarget(
      message.endpointId,
      message.workspaceId,
      message.deliveryId
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
    // The queue carries routing hints, not authoritative event contents. The
    // pending row resolved above is the producer's durable identity and
    // payload; use it for signing and persistence so a tampered body cannot
    // be sent to a valid endpoint.
    const trustedMessage = {
      ...message,
      eventType: target.eventType,
      payload: target.payload
    } satisfies WebhookQueueMessage
    // A message queued before an administrative suspension must settle as a
    // terminal refusal. Leaving it in the queue would retry forever, and
    // replaying it on reactivation would violate the suspension boundary.
    const suspension = yield* WorkspaceSuspensionService
    {
      const allowed = yield* Effect.result(
        suspension.requireAllowed(message.workspaceId, 'product')
      )
      if (Result.isFailure(allowed)) {
        if (allowed.failure._tag === 'WorkspaceSuspended') {
          yield* webhooks.recordTerminalDeliveryAttempt({
            deliveryId,
            endpointId: target.id,
            workspaceId: message.workspaceId,
            eventType: trustedMessage.eventType,
            attempts,
            status: 'failed_permanent',
            failureReason: 'workspace_suspended',
            payload: trustedMessage.payload
          })
          yield* Effect.annotateLogsScoped({
            outcome: 'skipped',
            skipReason: 'workspace_suspended'
          })
          return 'ack' satisfies DeliveryOutcome
        }
        return yield* Effect.fail(allowed.failure)
      }
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
      yield* completeWebhookTerminalObservation({
        message: trustedMessage,
        endpointUrl: target.url,
        attempts,
        status: 'failed_permanent',
        failureReason: `Destination refused: ${urlCheck.reason}`
      })
      yield* Effect.annotateLogsScoped({
        outcome: 'failed_permanent',
        skipReason: `invalid_url: ${urlCheck.reason}`
      })
      return 'ack' satisfies DeliveryOutcome
    }
    const now = yield* DateTime.now
    const timestamp = Math.floor(DateTime.toEpochMillis(now) / 1000)
    const body = encodeDeliveryBody({
      deliveryId,
      eventType: trustedMessage.eventType,
      payload: trustedMessage.payload
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
    const recorded = yield* completeWebhookHttpObservation({
      message: trustedMessage,
      endpointUrl: target.url,
      responseStatus,
      attempts,
      finishedAt,
      durationMs,
      failureReason,
      requestHeaders,
      responseBody
    })
    yield* Effect.annotateLogsScoped({ outcome: recorded.status, responseStatus })
    return recorded.outcome satisfies DeliveryOutcome
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
    // The same row id the message's attempts resolved on the primary queue —
    // the exhausted row goes terminal in place instead of forking a second
    // row, and its recorded payload keeps it replayable.
    yield* completeWebhookTerminalObservation({
      message,
      attempts: delivery.attempts,
      status: 'dead_lettered',
      failureReason: 'Queue retries exhausted',
      endpointUrl: null
    })
    yield* Effect.annotateLogsScoped({ outcome: 'dead_lettered' })
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
