import { bytesToHex } from '@b2b-saas-starter/capabilities/crypto'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import {
  backoffSeconds,
  planDeliveryAttempt,
  truncateResponseBody
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { validateWebhookUrl } from '@b2b-saas-starter/capabilities/developer-platform/webhook-url'
import {
  WebhookQueueMessage,
  type WebhookQueueBinding
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import {
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { type NotificationEmailQueueBinding } from '@b2b-saas-starter/capabilities/notifications/notification-email-queue'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { type SendEmailBinding } from '@b2b-saas-starter/email'
import { type ServerEnv } from '@b2b-saas-starter/env/server'
import {
  currentTraceId,
  makeOtlpLayer,
  TRACE_HEADER,
  WideEventLoggerLive,
  withTriggerScope
} from '@b2b-saas-starter/logger'
import {
  Clock,
  DateTime,
  Effect,
  Layer,
  ManagedRuntime,
  Result,
  Schema,
  type Scope
} from 'effect'
import { FetchHttpClient, HttpBody, HttpClient } from 'effect/unstable/http'
import {
  queueDelivery,
  queueParentSpan as sharedQueueParentSpan,
  type DeliveryOutcome,
  type QueueDelivery,
  type QueueEnvelope
} from './queue-consumer.ts'
import { computeWebhookSignature, signatureHeaderValue } from './webhook-signing.ts'

// Bindings plus optional env. The same shape `ApiEnv` describes for apps/api.
export type Env = Partial<ServerEnv> & {
  readonly DB?: D1Database
  // The producer port, not workers-types' `Queue`: this worker only forwards
  // the binding to `starterEnv`, and every other worker declares it the same
  // way, so one structural shape describes the queue across all three.
  readonly WEBHOOK_QUEUE?: WebhookQueueBinding
  // Workspace export (ADR 0055): the job queue this worker consumes and the
  // bucket it writes archives to. Both absent when `WORKSPACE_EXPORT_BUCKET`
  // was unset at deploy time; the capability then reports unavailable.
  readonly WORKSPACE_EXPORT_QUEUE?: WorkspaceExportQueueBinding
  readonly WORKSPACE_EXPORT_BUCKET?: WorkspaceExportBucketBinding
  // Producer port for instant notification emails — this worker both consumes
  // the queue and produces onto it (webhook deliveries that gave up create a
  // Notification). Absent, Notifications persist and no instant email goes out.
  readonly NOTIFICATION_EMAIL_QUEUE?: NotificationEmailQueueBinding
  // Cloudflare Email send binding, for the notification emails. Absent, the
  // dispatcher logs instead of sending (CLAUDE.md rule 3).
  readonly EMAIL?: SendEmailBinding
}

/** Wire shape of queue messages — the schema is shared with the producer. */
export type WebhookMessage = typeof WebhookQueueMessage.Type

const decodeWebhookQueueMessage = Schema.decodeUnknownResult(WebhookQueueMessage)

/**
 * The webhook queue's boundary decode: platform fields plus the message, or
 * the terminal `malformed` outcome. One line because everything it used to
 * hand-copy is the shared queue-consumer vocabulary.
 */
export function readQueueDelivery(
  envelope: QueueEnvelope
): QueueDelivery<WebhookMessage> {
  return queueDelivery(envelope, decodeWebhookQueueMessage(envelope.body))
}

/**
/**
 * The delivery row id for one queue message. Prefers the `deliveryId` an
 * operator dispatch (replay, test send) stamped on the message — that row
 * already exists as `pending` and the consumer's attempts resolve *it* — and
 * otherwise derives deterministically from the queue's message id, so every
 * redelivery of the same message signs and persists the *same* `deliveryId` —
 * a receiver deduplicating on it collapses retries, and a crash between POST
 * and persist cannot fork identities. The random fallback only covers
 * envelopes without an id (never produced by a real queue), keeping the
 * minting path testable in isolation.
 */
function deliveryIdFor(delivery: QueueDelivery<WebhookMessage>): Effect.Effect<string> {
  if (delivery.kind === 'message' && delivery.message.deliveryId !== undefined) {
    return Effect.succeed(delivery.message.deliveryId)
  }
  if (delivery.id !== undefined && delivery.id.length > 0) {
    return Effect.succeed(`whd_${delivery.id}`)
  }
  return newDeliveryId
}
  if (delivery.id !== undefined && delivery.id.length > 0) {
    return Effect.succeed(`whd_${delivery.id}`)
  }
  return newDeliveryId
}

/**
 * Fallback id minting. The timestamp comes from `Clock` so the worker's notion
 * of now stays swappable in tests; the random suffix comes from the Workers
 * Web Crypto global, which is this runtime's only entropy source.
 */
const newDeliveryId: Effect.Effect<string> = Effect.gen(function* () {
  const millis = yield* Clock.currentTimeMillis
  // oxlint-disable-next-line effect/noGlobals -- Platform edge: Workers Web Crypto. Effect's `Crypto` service has no Cloudflare Workers layer, and building one here would only wrap this same global.
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `whd_${millis}_${bytesToHex(bytes.buffer)}`
})

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
 * instant-email fan-out starts for the kind (ADR 0055). Best-effort — a feed
 * outage must not turn a settled delivery into a retry loop.
 */
function notifyDeliveryGaveUp(
  message: WebhookMessage,
  endpointUrl: string | null,
  status: 'failed_permanent' | 'dead_lettered'
): Effect.Effect<void, never, NotificationFeed> {
  return Effect.gen(function* () {
    const feed = yield* NotificationFeed
    let detail = `${message.eventType} was not delivered after retries.`
    if (status === 'failed_permanent') {
      detail = `${message.eventType} was rejected and will not be retried.`
    }
    const target = endpointUrl ?? `endpoint ${message.endpointId}`
    yield* feed.create({
      workspaceId: message.workspaceId,
      userId: null,
      kind: 'webhook.delivery_failed',
      title: 'Webhook delivery failed',
      message: `${target}: ${detail}`
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
function annotateMessageFields(message: WebhookMessage) {
  return Effect.annotateLogsScoped({
    endpointId: message.endpointId,
    workspaceId: message.workspaceId,
    eventType: message.eventType
  })
}

// One fetch client and one logger set per isolate: neither performs I/O on
// behalf of a single invocation, so both are safe to memoize for the isolate's
// life — and cheaper than rebuilding them per queue batch or cron tick.
const staticRuntime = ManagedRuntime.make(
  Layer.mergeAll(FetchHttpClient.layer, WideEventLoggerLive)
)

/**
 * Runs one worker invocation. The exporter half of observability is the part
 * that must be per invocation: `local: true` builds it fresh so the OTLP
 * exporters flush before the handler's promise settles — a Worker may not
 * perform I/O on behalf of an invocation that already ended, so a per-isolate
 * exporter would go silent after its first flush (see `makeOtlpLayer`). It is
 * provided inside `staticRuntime`, so the console loggers are already in
 * context when the OTLP layer merges with them.
 */
export function runInvocation<A, E>(
  env: Env,
  effect: Effect.Effect<A, E, HttpClient.HttpClient>
) {
  return staticRuntime.runPromise(
    Effect.provide(effect, makeOtlpLayer('background', env), { local: true })
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
  delivery: QueueDelivery<WebhookMessage>,
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
    // The workspace ID from the message is verified inside the capability:
    // a cross-workspace mismatch resolves null, same as a disabled or deleted
    // endpoint, so no signing secret leaves the workspace that enqueued it.
    const target = yield* webhooks.getDispatchTarget(
      message.endpointId,
      message.workspaceId
    )
    if (!target) {
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
      // Never-dispatched terminal row: the capability owns the id, timestamp,
      // and the batched audit event.
      yield* webhooks.recordTerminalDeliveryAttempt({
        endpointId: target.id,
        workspaceId: message.workspaceId,
        eventType: message.eventType,
        attempts,
        status: 'failed_permanent'
      })
      yield* Effect.annotateLogsScoped({
        outcome: 'failed_permanent',
        skipReason: `invalid_url: ${urlCheck.reason}`
      })
      yield* notifyDeliveryGaveUp(message, target.url, 'failed_permanent')
      return 'ack' satisfies DeliveryOutcome
    }
    const deliveryId = yield* deliveryIdFor(delivery)
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
      computeWebhookSignature(secret, timestamp, body)
    )
    const requestHeaders = {
      'content-type': 'application/json',
      'user-agent': 'b2b-saas-starter-webhooks/0.1',
      'x-b2b-starter-event': message.eventType,
      'x-b2b-starter-timestamp': String(timestamp),
      'x-b2b-starter-signature': signatureHeaderValue(timestamp, signatures),
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
      const text = yield* Effect.result(responseResult.success.text)
      if (Result.isSuccess(text)) {
        responseBody = truncateResponseBody(text.success)
      }
    }
    // The dispatch half of the delivery state machine lives below the
    // capability interface: classification, persisted status, and the
    // backoff-aligned retry schedule all come from the capability.
    const plan = planDeliveryAttempt(responseStatus, attempts, now)
    yield* webhooks.recordDeliveryAttempt({
      id: deliveryId,
      endpointId: target.id,
      // Terminal statuses batch an audit event with the attempt row inside
      // the capability; the workspace id scopes it to the endpoint's owner.
      workspaceId: message.workspaceId,
      eventType: message.eventType,
      status: plan.status,
      attempts,
      responseStatus: plan.responseStatus,
      nextAttemptAt: plan.nextAttemptAt,
      // Operator evidence columns: what was sent and what came back, so the
      // deliveries drawer can replay or diagnose without re-deriving it.
      payload: message.payload,
      requestHeaders,
      responseBody
    })
    yield* Effect.annotateLogsScoped({ outcome: plan.status, responseStatus })
    if (plan.status === 'failed_permanent') {
      yield* notifyDeliveryGaveUp(message, target.url, 'failed_permanent')
    }
    return plan.outcome satisfies DeliveryOutcome
  })
}

function deliverWebhook(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome, never, HttpClient.HttpClient> {
  // The one boundary decode per delivery: the trace continuation and the
  // consumer read the same result. endpointId/eventType land on the wide event
  // via `Effect.annotateLogsScoped` inside the scope, so the envelope metadata
  // carries only the attempt count.
  const delivery = readQueueDelivery(envelope)
  return withTriggerScope(
    {
      service: 'background',
      event: 'webhook_delivery',
      parent: sharedQueueParentSpan(delivery),
      spanKind: 'consumer',
      env,
      metadata: { attempts: delivery.attempts }
    },
    // The `x-trace-id` forwarded to the receiver is this scope's OTel trace id,
    // so the header a receiver quotes back resolves in the trace backend too.
    Effect.gen(function* () {
      const traceId = yield* currentTraceId
      return yield* processWebhookMessage(delivery, traceId)
    }).pipe(Effect.provide(selectCapabilitiesLayer(starterEnv(env))))
    // `_cause` is deliberately unused: the wide event above already logged the
    // failure cause on exit, and the queue needs an outcome, not an exception.
  ).pipe(Effect.catchCause((_cause) => Effect.succeed<DeliveryOutcome>('retry')))
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
  delivery: QueueDelivery<WebhookMessage>
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
    yield* webhooks.recordTerminalDeliveryAttempt({
      endpointId: message.endpointId,
      workspaceId: message.workspaceId,
      eventType: message.eventType,
      attempts: delivery.attempts,
      status: 'dead_lettered'
    })
    yield* Effect.annotateLogsScoped({ outcome: 'dead_lettered' })
    yield* notifyDeliveryGaveUp(message, null, 'dead_lettered')
  })
}

/**
 * Dead-letter consumer entry: wraps `processDeadLetterMessage` with the real
 * capabilities layer and a wide event so operators can see (and replay)
 * exhausted deliveries.
 */
function recordDeadLetter(envelope: QueueEnvelope, env: Env): Effect.Effect<void> {
  const delivery = readQueueDelivery(envelope)
  const program = processDeadLetterMessage(delivery).pipe(
    Effect.provide(selectCapabilitiesLayer(starterEnv(env)))
  )
  return withTriggerScope(
    {
      service: 'background',
      event: 'webhook_dead_letter',
      env,
      parent: sharedQueueParentSpan(delivery),
      spanKind: 'consumer',
      metadata: { attempts: delivery.attempts }
    },
    program
    // Always ack dead letters — failing here would loop the DLQ.
  ).pipe(Effect.catchCause((_cause) => Effect.void))
}

/**
 * One batch loop for both consumers: run `perMessage` over each message
 * concurrently, then ack or retry (`backoffSeconds(attempts)` delay) per its
 * outcome. The dead-letter caller maps every outcome to `'ack'` — failing a
 * DLQ message would loop the DLQ.
 */
export function consumeBatch(
  env: Env,
  batch: MessageBatch<unknown>,
  perMessage: (
    message: Message<unknown>
  ) => Effect.Effect<DeliveryOutcome, never, HttpClient.HttpClient>
): Promise<void> {
  return runInvocation(
    env,
    // The batch loop adds no requirements of its own, so the loop's context is
    // `perMessage`'s: `HttpClient`, which the isolate runtime's
    // FetchHttpClient provides. The DLQ caller, needing nothing, still fits —
    // an `Effect<_, _, never>` is an `Effect<_, _, HttpClient>`.
    Effect.forEach(
      batch.messages,
      (message) =>
        perMessage(message).pipe(
          Effect.flatMap((outcome) =>
            Effect.sync(() => {
              if (outcome === 'ack') {
                message.ack()
              } else {
                message.retry({ delaySeconds: backoffSeconds(message.attempts) })
              }
            })
          )
        ),
      { concurrency: 'unbounded', discard: true }
    )
  )
}

export { deliverWebhook, recordDeadLetter }
