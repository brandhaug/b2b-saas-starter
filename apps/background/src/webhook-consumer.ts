import { bytesToHex } from '@b2b-saas-starter/capabilities/crypto'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import {
  backoffSeconds,
  planDeliveryAttempt
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { validateWebhookUrl } from '@b2b-saas-starter/capabilities/developer-platform/webhook-url'
import {
  WebhookQueueMessage,
  type WebhookQueueBinding
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { type ServerEnv } from '@b2b-saas-starter/env/server'
import {
  currentTraceId,
  makeOtlpLayer,
  parentSpanFromHeaders,
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
import { computeWebhookSignature, signatureHeaderValue } from './webhook-signing.ts'

// Bindings plus optional env. The same shape `ApiEnv` describes for apps/api.
export type Env = Partial<ServerEnv> & {
  readonly DB?: D1Database
  // The producer port, not workers-types' `Queue`: this worker only forwards
  // the binding to `starterEnv`, and every other worker declares it the same
  // way, so one structural shape describes the queue across all three.
  readonly WEBHOOK_QUEUE?: WebhookQueueBinding
}

/** Wire shape of queue messages — the schema is shared with the producer. */
export type WebhookMessage = typeof WebhookQueueMessage.Type

/**
 * One compiled codec for the three boundary decodes below: both consumers and
 * the trace-continuation helper read the same untrusted queue body.
 */
const decodeWebhookQueueMessage = Schema.decodeUnknownResult(WebhookQueueMessage)

/**
 * Structural subset of a Cloudflare queue `Message`: the untrusted body plus
 * the attempt count and the message id. Both consumers take the envelope
 * rather than a bare body so the boundary decode stays inside the wide-event
 * scope that reports a malformed message, and tests can hand them a plain
 * object. The id anchors the delivery id (see `deliveryIdFor`).
 */
export type WebhookQueueEnvelope = {
  readonly id?: string | undefined
  readonly body: unknown
  readonly attempts: number
}

export type DeliveryOutcome = 'ack' | 'retry'

/**
 * The delivery row id for one queue message. Derived deterministically from
 * the queue's message id, so every redelivery of the same message signs and
 * persists the *same* `deliveryId` — a receiver deduplicating on it collapses
 * retries, and a crash between POST and persist cannot fork identities. The
 * random fallback only covers envelopes without an id (never produced by a
 * real queue), keeping the minting path testable in isolation.
 */
function deliveryIdFor(envelope: WebhookQueueEnvelope): Effect.Effect<string> {
  if (envelope.id !== undefined && envelope.id.length > 0) {
    return Effect.succeed(`whd_${envelope.id}`)
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
 * The envelope-decode preamble both consumers share: decode at the boundary,
 * and on a malformed body annotate `skipReason: 'malformed_message'` on the
 * wide event with the consumer's own outcome and yield nothing — there is no
 * trusted endpointId for a delivery row, so the message is acked.
 */
function decodeEnvelope(
  envelope: WebhookQueueEnvelope,
  outcome: string
): Effect.Effect<WebhookMessage | undefined, never, Scope.Scope> {
  return Effect.gen(function* () {
    const decoded = decodeWebhookQueueMessage(envelope.body)
    if (Result.isFailure(decoded)) {
      yield* Effect.annotateLogsScoped({ outcome, skipReason: 'malformed_message' })
      return
    }
    return decoded.success
  })
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
 * The upstream trace to continue, if the producer stamped one on the message.
 * The body is untrusted here, so it goes through the same boundary decode the
 * consumers use; an undecodable message simply starts its own trace.
 */
function queueParentSpan(envelope: WebhookQueueEnvelope) {
  const decoded = decodeWebhookQueueMessage(envelope.body)
  return Result.match(decoded, {
    onFailure: () => undefined,
    onSuccess: (message) => parentSpanFromHeaders({ traceparent: message.traceparent })
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
  envelope: WebhookQueueEnvelope,
  traceId: string
): Effect.Effect<
  DeliveryOutcome,
  CapabilityUnavailable,
  WebhookEndpoints | HttpClient.HttpClient | Scope.Scope
> {
  return Effect.gen(function* () {
    // Queue payloads are `unknown` at runtime — decode at the boundary. A
    // malformed message is terminal (redelivery can never fix its shape), but
    // there is no trusted endpointId to attach a delivery row to, so it is
    // recorded on the wide event only and acked — mirroring how permanent
    // delivery failures ack instead of retrying forever.
    const message = yield* decodeEnvelope(envelope, 'failed_permanent')
    if (!message) {
      return 'ack' satisfies DeliveryOutcome
    }
    const attempts = envelope.attempts
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
      return 'ack' satisfies DeliveryOutcome
    }
    const deliveryId = yield* deliveryIdFor(envelope)
    const now = yield* DateTime.now
    const timestamp = Math.floor(DateTime.toEpochMillis(now) / 1000)
    const body = encodeDeliveryBody({
      deliveryId,
      eventType: message.eventType,
      payload: message.payload
    })
    const signature = yield* computeWebhookSignature(
      target.signingSecret,
      timestamp,
      body
    )
    const client = yield* HttpClient.HttpClient
    const responseResult = yield* Effect.result(
      client
        .post(target.url, {
          headers: {
            'content-type': 'application/json',
            'user-agent': 'b2b-saas-starter-webhooks/0.1',
            'x-b2b-starter-event': message.eventType,
            'x-b2b-starter-timestamp': String(timestamp),
            'x-b2b-starter-signature': signatureHeaderValue(timestamp, signature),
            [TRACE_HEADER]: traceId
          },
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
      nextAttemptAt: plan.nextAttemptAt
    })
    yield* Effect.annotateLogsScoped({ outcome: plan.status, responseStatus })
    return plan.outcome satisfies DeliveryOutcome
  })
}

function deliverWebhook(
  envelope: WebhookQueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome, never, HttpClient.HttpClient> {
  // endpointId/eventType land on the wide event via `Effect.annotateLogsScoped` after the
  // boundary decode in `processWebhookMessage` — the raw body is untrusted
  // here, so the envelope carries only the attempt count.
  return withTriggerScope(
    {
      service: 'background',
      event: 'webhook_delivery',
      parent: queueParentSpan(envelope),
      spanKind: 'consumer',
      env,
      metadata: { attempts: envelope.attempts }
    },
    // The `x-trace-id` forwarded to the receiver is this scope's OTel trace id,
    // so the header a receiver quotes back resolves in the trace backend too.
    Effect.gen(function* () {
      const traceId = yield* currentTraceId
      return yield* processWebhookMessage(envelope, traceId)
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
  envelope: WebhookQueueEnvelope
): Effect.Effect<void, CapabilityUnavailable, WebhookEndpoints | Scope.Scope> {
  return Effect.gen(function* () {
    // Same boundary decode as `processWebhookMessage`: a malformed dead letter
    // has no trusted endpointId for a delivery row, so log-and-ack only.
    const message = yield* decodeEnvelope(envelope, 'dead_lettered')
    if (!message) {
      return
    }
    yield* annotateMessageFields(message)
    const webhooks = yield* WebhookEndpoints
    yield* webhooks.recordTerminalDeliveryAttempt({
      endpointId: message.endpointId,
      workspaceId: message.workspaceId,
      eventType: message.eventType,
      attempts: envelope.attempts,
      status: 'dead_lettered'
    })
    yield* Effect.annotateLogsScoped({ outcome: 'dead_lettered' })
  })
}

/**
 * Dead-letter consumer entry: wraps `processDeadLetterMessage` with the real
 * capabilities layer and a wide event so operators can see (and replay)
 * exhausted deliveries.
 */
function recordDeadLetter(
  envelope: WebhookQueueEnvelope,
  env: Env
): Effect.Effect<void> {
  const program = processDeadLetterMessage(envelope).pipe(
    Effect.provide(selectCapabilitiesLayer(starterEnv(env)))
  )
  return withTriggerScope(
    {
      service: 'background',
      event: 'webhook_dead_letter',
      env,
      parent: queueParentSpan(envelope),
      spanKind: 'consumer',
      metadata: { attempts: envelope.attempts }
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
export function consumeBatch<R>(
  env: Env,
  batch: MessageBatch<unknown>,
  perMessage: (message: Message<unknown>) => Effect.Effect<DeliveryOutcome, never, R>
): Promise<void> {
  return runInvocation(
    env,
    // The batch loop adds no requirements of its own. `perMessage`'s residual
    // requirement R is at most `HttpClient` (the delivery consumer — the DLQ
    // caller needs nothing), which the isolate runtime's FetchHttpClient
    // provides, so the loop is safe to view through the runner's contract.
    // SAFETY: R ⊆ HttpClient by the only two call sites; the runtime provides
    // FetchHttpClient isolate-level (see `staticRuntime` above).
    // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion -- see SAFETY above
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
    ) as Effect.Effect<void, never, HttpClient.HttpClient>
  )
}

export { deliverWebhook, recordDeadLetter }
