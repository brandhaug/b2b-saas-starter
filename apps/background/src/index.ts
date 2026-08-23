import {
  annotateWide,
  currentTraceId,
  makeOtlpLayer,
  parentSpanFromHeaders,
  TRACE_HEADER,
  WideEventLoggerLive,
  withTriggerScope
} from '@b2b-saas-starter/logger'
import {
  selectCapabilitiesLayer,
  type StarterEnv
} from '@b2b-saas-starter/capabilities/src/runtime.ts'
import { validateWebhookUrl } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-url.ts'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import {
  WebhookQueueMessage,
  type WebhookQueueBinding
} from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-publisher.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/src/errors.ts'
import { type ServerEnv } from '@b2b-saas-starter/env/src/server.ts'
import {
  Clock,
  DateTime,
  Duration,
  Effect,
  Layer,
  ManagedRuntime,
  Result,
  Schema,
  type Scope
} from 'effect'
import { FetchHttpClient, HttpBody, HttpClient } from 'effect/unstable/http'

// Bindings plus optional env. The same shape `ApiEnv` describes for apps/api.
type Env = Partial<ServerEnv> & {
  readonly DB?: D1Database
  // The producer port, not workers-types' `Queue`: this worker only forwards
  // the binding to `starterEnv`, and every other worker declares it the same
  // way, so one structural shape describes the queue across all three.
  readonly WEBHOOK_QUEUE?: WebhookQueueBinding
}

function starterEnv(env: Env): StarterEnv {
  return {
    DB: env.DB,
    WEBHOOK_QUEUE: env.WEBHOOK_QUEUE
  }
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
 * the attempt count. Both consumers take the envelope rather than a bare body
 * so the boundary decode stays inside the wide-event scope that reports a
 * malformed message, and tests can hand them a plain object.
 */
export type WebhookQueueEnvelope = {
  readonly body: unknown
  readonly attempts: number
}

export type DeliveryOutcome = 'ack' | 'retry'

/** Queue name of the dead-letter consumer branch (see wrangler.jsonc). */
const DEAD_LETTER_QUEUE = 'b2b-saas-starter-webhooks-dlq'

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
function runInvocation<A, E>(
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
 * Redelivery backoff. Also used to derive the persisted `nextAttemptAt` so
 * the delivery row matches when Cloudflare will actually retry.
 */
export function backoffSeconds(attempts: number): number {
  return Math.min(attempts, 6) * 30
}

export type DeliveryDecision = 'delivered' | 'retry' | 'terminal'

/**
 * Ack/retry/terminal decision per response status. `0` means no HTTP response
 * (network error or timeout) and is retryable. 4xx responses are permanent
 * failures except 408 (request timeout) and 429 (rate limited).
 */
export function classifyResponseStatus(status: number): DeliveryDecision {
  if (status >= 200 && status < 300) return 'delivered'
  if (status === 408 || status === 429) return 'retry'
  if (status >= 400 && status < 500) return 'terminal'
  return 'retry'
}

/** Persisted `webhookDeliveries.status` for a dispatch decision. */
function deliveryStatus(
  decision: DeliveryDecision
): 'delivered' | 'failed_permanent' | 'failed' {
  if (decision === 'delivered') return 'delivered'
  if (decision === 'terminal') return 'failed_permanent'
  return 'failed'
}

/** Queue action for a dispatch decision: only a retryable failure goes back. */
function deliveryOutcome(decision: DeliveryDecision): DeliveryOutcome {
  if (decision === 'retry') return 'retry'
  return 'ack'
}

/** `0` stands for "no HTTP response at all", which is persisted as null. */
function recordedResponseStatus(status: number): number | null {
  if (status === 0) return null
  return status
}

/**
 * Persisted schedule for the next attempt, derived from the same backoff the
 * queue retry uses. Terminal outcomes have no next attempt.
 */
function nextAttemptAt(
  decision: DeliveryDecision,
  now: DateTime.Utc,
  attempts: number
): string | null {
  if (decision === 'retry') {
    return DateTime.formatIso(
      DateTime.addDuration(now, Duration.seconds(backoffSeconds(attempts)))
    )
  }
  return null
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

/**
 * Stripe-style signature: HMAC-SHA256 over `"<timestamp>.<body>"` with the
 * endpoint's plaintext signing secret, hex-encoded. Signing the timestamp
 * makes captured deliveries non-replayable once the receiver enforces a
 * tolerance window.
 */
export const computeWebhookSignature = Effect.fn('Webhooks.computeSignature')(
  function* (secret: string, timestamp: number, body: string) {
    const key = yield* Effect.promise(() =>
      crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
    )
    const signed = yield* Effect.promise(() =>
      crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`))
    )
    return bytesToHex(signed)
  }
)

/** Value of the `x-b2b-starter-signature` header. */
export function signatureHeaderValue(timestamp: number, signatureHex: string): string {
  return `t=${timestamp},sha256=${signatureHex}`
}

/**
 * Delivery row id. The timestamp comes from `Clock` so the worker's notion of
 * now stays swappable in tests; the random suffix comes from the Workers Web
 * Crypto global, which is this runtime's only entropy source.
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
    const decoded = decodeWebhookQueueMessage(envelope.body)
    if (Result.isFailure(decoded)) {
      yield* annotateWide({
        outcome: 'failed_permanent',
        skipReason: 'malformed_message'
      })
      return 'ack' satisfies DeliveryOutcome
    }
    const message = decoded.success
    const attempts = envelope.attempts
    yield* annotateWide({
      endpointId: message.endpointId,
      workspaceId: message.workspaceId,
      eventType: message.eventType
    })
    const webhooks = yield* WebhookEndpoints
    // The workspace ID from the message is verified inside the capability:
    // a cross-workspace mismatch resolves null, same as a disabled or deleted
    // endpoint, so no signing secret leaves the workspace that enqueued it.
    const target = yield* webhooks.getDispatchTarget(
      message.endpointId,
      message.workspaceId
    )
    if (!target) {
      yield* annotateWide({ outcome: 'skipped', skipReason: 'not_dispatchable' })
      return 'ack' satisfies DeliveryOutcome
    }
    yield* annotateWide({ endpointUrl: target.url })
    // Re-check the destination at dispatch time — an endpoint created before
    // the guard existed (or edited in the DB) must not let the worker reach
    // internal targets. DNS-rebinding protection is out of scope for the
    // starter (see validateWebhookUrl).
    const urlCheck = validateWebhookUrl(target.url)
    if (!urlCheck.valid) {
      yield* webhooks.recordDeliveryAttempt({
        id: yield* newDeliveryId,
        endpointId: target.id,
        workspaceId: message.workspaceId,
        eventType: message.eventType,
        status: 'failed_permanent',
        attempts,
        responseStatus: null,
        nextAttemptAt: null
      })
      yield* annotateWide({
        outcome: 'failed_permanent',
        skipReason: `invalid_url: ${urlCheck.reason}`
      })
      return 'ack' satisfies DeliveryOutcome
    }
    const deliveryId = yield* newDeliveryId
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
    const decision = classifyResponseStatus(responseStatus)
    const status = deliveryStatus(decision)
    yield* webhooks.recordDeliveryAttempt({
      id: deliveryId,
      endpointId: target.id,
      // Terminal statuses batch an audit event with the attempt row inside
      // the capability; the workspace id scopes it to the endpoint's owner.
      workspaceId: message.workspaceId,
      eventType: message.eventType,
      status,
      attempts,
      responseStatus: recordedResponseStatus(responseStatus),
      nextAttemptAt: nextAttemptAt(decision, now, attempts)
    })
    yield* annotateWide({ outcome: status, responseStatus })
    return deliveryOutcome(decision)
  })
}

function deliverWebhook(
  envelope: WebhookQueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome, never, HttpClient.HttpClient> {
  // endpointId/eventType land on the wide event via `annotateWide` after the
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
    const decoded = decodeWebhookQueueMessage(envelope.body)
    if (Result.isFailure(decoded)) {
      yield* annotateWide({
        outcome: 'dead_lettered',
        skipReason: 'malformed_message'
      })
      return
    }
    const message = decoded.success
    yield* annotateWide({
      endpointId: message.endpointId,
      workspaceId: message.workspaceId,
      eventType: message.eventType
    })
    const webhooks = yield* WebhookEndpoints
    yield* webhooks.recordDeliveryAttempt({
      id: yield* newDeliveryId,
      endpointId: message.endpointId,
      workspaceId: message.workspaceId,
      eventType: message.eventType,
      status: 'dead_lettered',
      attempts: envelope.attempts,
      responseStatus: null,
      nextAttemptAt: null
    })
    yield* annotateWide({ outcome: 'dead_lettered' })
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

export default {
  // The handler is not `async`: the Workers runtime awaits the promise it
  // returns, and there is nothing to await before returning it.

  // Queue message bodies are untyped at runtime; `processWebhookMessage` and
  // `processDeadLetterMessage` decode the envelope at their boundary. The batch
  // runs concurrently as one Effect instead of a raw `Promise.all`.
  queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    if (batch.queue === DEAD_LETTER_QUEUE) {
      return runInvocation(
        env,
        Effect.forEach(
          batch.messages,
          (message) =>
            recordDeadLetter(message, env).pipe(
              Effect.tap(() => Effect.sync(() => message.ack()))
            ),
          { concurrency: 'unbounded', discard: true }
        )
      )
    }
    return runInvocation(
      env,
      Effect.forEach(
        batch.messages,
        (message) =>
          deliverWebhook(message, env).pipe(
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
}
