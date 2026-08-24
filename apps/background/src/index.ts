import {
  Billing,
  verifyStripeSignature
} from '@b2b-saas-starter/capabilities/src/billing/billing.ts'
import {
  annotateWide,
  currentTraceId,
  makeOtlpLayer,
  parentSpanFromHeaders,
  TRACE_HEADER,
  WideEventLoggerLive,
  withTriggerScope
} from '@b2b-saas-starter/logger'
import { bytesToHex } from '@b2b-saas-starter/capabilities/src/crypto.ts'
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
      yield* annotateWide({ outcome, skipReason: 'malformed_message' })
      return
    }
    return decoded.success
  })
}

/** Fields every consumer stamps onto its wide event once decoded. */
function annotateMessageFields(message: WebhookMessage) {
  return annotateWide({
    endpointId: message.endpointId,
    workspaceId: message.workspaceId,
    eventType: message.eventType
  })
}

/**
 * A terminal delivery row: no HTTP response to record and no next attempt.
 * Shared by the invalid-URL branch of `processWebhookMessage` and
 * `processDeadLetterMessage`.
 */
function terminalAttemptRow(input: {
  readonly deliveryId: string
  readonly endpointId: string
  readonly message: WebhookMessage
  readonly attempts: number
  readonly status: 'failed_permanent' | 'dead_lettered'
}) {
  return {
    id: input.deliveryId,
    endpointId: input.endpointId,
    workspaceId: input.message.workspaceId,
    eventType: input.message.eventType,
    status: input.status,
    attempts: input.attempts,
    responseStatus: null,
    nextAttemptAt: null
  }
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
    if (!message) return 'ack' satisfies DeliveryOutcome
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
      yield* webhooks.recordDeliveryAttempt(
        terminalAttemptRow({
          deliveryId: yield* newDeliveryId,
          endpointId: target.id,
          message,
          attempts,
          status: 'failed_permanent'
        })
      )
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
    const message = yield* decodeEnvelope(envelope, 'dead_lettered')
    if (!message) return
    yield* annotateMessageFields(message)
    const webhooks = yield* WebhookEndpoints
    yield* webhooks.recordDeliveryAttempt(
      terminalAttemptRow({
        deliveryId: yield* newDeliveryId,
        endpointId: message.endpointId,
        message,
        attempts: envelope.attempts,
        status: 'dead_lettered'
      })
    )
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

/**
 * The subset of a Stripe event body this worker understands. Everything else
 * decodes fine and is ignored — an unknown event type is not an error, the
 * same leniency the webhook delivery reader applies.
 */
export const StripeEventBody = Schema.Struct({
  type: Schema.String,
  data: Schema.Struct({
    object: Schema.Struct({
      client_reference_id: Schema.optionalKey(Schema.String),
      metadata: Schema.optionalKey(
        Schema.Struct({
          workspaceId: Schema.optionalKey(Schema.String),
          planId: Schema.optionalKey(Schema.String)
        })
      )
    })
  })
})
// One codec for the raw-body boundary: JSON parse and shape decode in one
// total step, so malformed input is a `Result` failure rather than a throw.
const decodeStripeEvent = Schema.decodeUnknownResult(
  Schema.fromJsonString(StripeEventBody)
)

/**
 * Core of the Stripe webhook: map the event onto a plan change and hand it to
 * the billing capability, which updates `workspaces.planId` and writes the
 * matching audit event atomically. Exported with requirements open for tests,
 * like `processWebhookMessage`.
 */
export function processStripeEvent(
  payload: string
): Effect.Effect<void, never, Billing | Scope.Scope> {
  return Effect.gen(function* () {
    const decoded = decodeStripeEvent(payload)
    if (Result.isFailure(decoded)) {
      yield* annotateWide({ outcome: 'skipped', skipReason: 'unexpected_shape' })
      return
    }
    const event = decoded.success
    const object = event.data.object
    const metadata = object.metadata ?? {}
    const workspaceId = metadata.workspaceId ?? object.client_reference_id
    yield* annotateWide({ stripeEventType: event.type })
    if (event.type === 'checkout.session.completed') {
      if (!workspaceId || !metadata.planId) {
        yield* annotateWide({
          outcome: 'skipped',
          skipReason: 'missing_workspace_or_plan'
        })
        return
      }
      const billing = yield* Billing
      const applied = yield* billing.applyProviderEvent({
        workspaceId,
        planId: metadata.planId,
        detail: { source: 'checkout.session.completed' }
      })
      if (applied) {
        yield* annotateWide({ outcome: 'applied' })
      } else {
        yield* annotateWide({ outcome: 'unknown_workspace' })
      }
      return
    }
    if (event.type === 'customer.subscription.deleted') {
      if (!workspaceId) {
        yield* annotateWide({
          outcome: 'skipped',
          skipReason: 'missing_workspace'
        })
        return
      }
      const billing = yield* Billing
      const applied = yield* billing.applyProviderEvent({
        workspaceId,
        planId: 'starter',
        detail: { source: 'customer.subscription.deleted' }
      })
      if (applied) {
        yield* annotateWide({ outcome: 'applied' })
      } else {
        yield* annotateWide({ outcome: 'unknown_workspace' })
      }
      return
    }
    yield* annotateWide({ outcome: 'ignored', reason: 'unhandled_event_type' })
  }).pipe(Effect.catchCause((_cause) => Effect.void))
}

/**
 * Entry wrapper for the Stripe webhook: provides the real capabilities layer
 * and a wide event so operators can see every inbound provider event, then
 * swallows failures — Stripe retries on non-2xx, which the fetch handler
 * returns from the rejection branch.
 */
function handleStripeWebhook(
  payload: string,
  env: Env
): Effect.Effect<void, never, HttpClient.HttpClient> {
  const program = processStripeEvent(payload).pipe(
    Effect.provide(selectCapabilitiesLayer(starterEnv(env)))
  )
  return withTriggerScope(
    {
      service: 'background',
      event: 'stripe_webhook',
      env,
      spanKind: 'consumer'
    },
    program
    // The handler answers 500 on rejection so Stripe schedules a redelivery.
  ).pipe(Effect.catchCause((_cause) => Effect.void))
}

export default {
  // The handler is not `async`: the Workers runtime awaits the promise it
  // returns, and there is nothing to await before returning it.

  // Inbound Stripe webhooks (see docs/integrations/stripe-billing.mdx). The
  // route verifies Stripe's signature scheme against `STRIPE_WEBHOOK_SECRET`
  // and applies subscription changes to `workspaces.planId` through the
  // billing capability — unset env degrades to a 503, never to an unverified
  // state change.
  // oxlint-disable-next-line effect/noAsyncFunction -- the Workers fetch handler contract is a plain async function; this is the platform adapter boundary
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname !== '/webhooks/stripe') {
      return new Response('Not found', { status: 404 })
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    const secret = env.STRIPE_WEBHOOK_SECRET
    if (secret === undefined || secret.length === 0) {
      return Response.json({ error: 'billing_not_configured' }, { status: 503 })
    }
    // oxlint-disable-next-line effect/noAsyncFunction -- reading the raw body and verifying the HMAC are the handler's two awaits, both total here
    const payload = await request.text()
    // oxlint-disable-next-line effect/noAsyncFunction -- see above
    const valid = await verifyStripeSignature({
      secret,
      payload,
      header: request.headers.get('stripe-signature')
    })
    if (!valid) {
      return Response.json({ error: 'invalid_signature' }, { status: 400 })
    }
    return runInvocation(env, handleStripeWebhook(payload, env)).then(
      () => new Response(null, { status: 200 }),
      () => Response.json({ error: 'processing_failed' }, { status: 500 })
    )
  },

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
