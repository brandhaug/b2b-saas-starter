import { Effect, Layer, ManagedRuntime, Result, Schema, type Scope } from 'effect'
import { FetchHttpClient, HttpBody, HttpClient } from 'effect/unstable/http'
import {
  runCatalogRefresh,
  selectCapabilitiesLayer,
  validateWebhookUrl,
  WebhookEndpoints,
  WebhookQueueMessage,
  type CapabilityUnavailable,
  type StarterEnv
} from '@b2b-saas-starter/capabilities'
import { makeStarterEnvModuleConfig } from '@b2b-saas-starter/env'
import {
  annotateWide,
  newTraceId,
  TRACE_HEADER,
  WideEventLoggerLive,
  withTriggerScope
} from '@b2b-saas-starter/logger'

type Env = {
  readonly DB?: D1Database
  readonly WEBHOOK_QUEUE?: Queue
}

// Module-aware env validation (ADR 0035).
const starterEnv = (env: Env): StarterEnv => ({
  DB: env.DB,
  WEBHOOK_QUEUE: env.WEBHOOK_QUEUE,
  moduleConfig: makeStarterEnvModuleConfig(env)
})

/** Wire shape of queue messages — the schema is shared with the producer. */
export type WebhookMessage = typeof WebhookQueueMessage.Type

export type DeliveryOutcome = 'ack' | 'retry'

/** Queue name of the dead-letter consumer branch (see wrangler.jsonc). */
const DEAD_LETTER_QUEUE = 'b2b-saas-starter-webhooks-dlq'

const StaticLayer = Layer.mergeAll(FetchHttpClient.layer, WideEventLoggerLive)
const staticRuntime = ManagedRuntime.make(StaticLayer)

/**
 * Redelivery backoff. Also used to derive the persisted `nextAttemptAt` so
 * the delivery row matches when Cloudflare will actually retry.
 */
export const backoffSeconds = (attempts: number): number => Math.min(attempts, 6) * 30

export type DeliveryDecision = 'delivered' | 'retry' | 'terminal'

/**
 * Ack/retry/terminal decision per response status. `0` means no HTTP response
 * (network error or timeout) and is retryable. 4xx responses are permanent
 * failures except 408 (request timeout) and 429 (rate limited).
 */
export const classifyResponseStatus = (status: number): DeliveryDecision => {
  if (status >= 200 && status < 300) return 'delivered'
  if (status === 408 || status === 429) return 'retry'
  if (status >= 400 && status < 500) return 'terminal'
  return 'retry'
}

const bytesToHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )

/**
 * Stripe-style signature: HMAC-SHA256 over `"<timestamp>.<body>"` with the
 * endpoint's plaintext signing secret, hex-encoded. Signing the timestamp
 * makes captured deliveries non-replayable once the receiver enforces a
 * tolerance window.
 */
export const computeWebhookSignature = async (
  secret: string,
  timestamp: number,
  body: string
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return bytesToHex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${body}`)
    )
  )
}

/** Value of the `x-b2b-starter-signature` header. */
export const signatureHeaderValue = (timestamp: number, signatureHex: string): string =>
  `t=${timestamp},sha256=${signatureHex}`

const newDeliveryId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `whd_${Date.now()}_${bytesToHex(bytes.buffer)}`
}

const refreshCatalog = (env: Env): Effect.Effect<void, CapabilityUnavailable> => {
  // `runCatalogRefresh` owns the "no refresh run goes unrecorded" sequence
  // (capture outcome, record ok/failed row with real duration, re-raise); this
  // handler only adds the env-selected layer and the wide-event scope.
  const program = runCatalogRefresh.pipe(
    Effect.tap((moduleCount) => annotateWide({ moduleCount })),
    Effect.tapError(() => annotateWide({ outcome: 'failed' })),
    Effect.asVoid,
    Effect.provide(selectCapabilitiesLayer(starterEnv(env)))
  )

  return withTriggerScope(
    {
      service: 'background',
      event: 'catalog_refresh',
      env,
      metadata: { source: env.DB ? 'live' : 'seed' }
    },
    program
  )
}

/**
 * Delivers one webhook message: resolve the dispatch target, re-check the
 * SSRF guard, sign, POST, persist the attempt row, and decide ack/retry.
 * Capability and HTTP requirements stay open so tests inject stub
 * `WebhookEndpoints` / `HttpClient` layers; the queue handler wraps this with
 * the real layers and the wide-event scope (`deliverWebhook`).
 */
export const processWebhookMessage = (
  input: unknown,
  attempts: number,
  traceId: string
): Effect.Effect<
  DeliveryOutcome,
  CapabilityUnavailable,
  WebhookEndpoints | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    // Queue payloads are `unknown` at runtime — decode at the boundary. A
    // malformed message is terminal (redelivery can never fix its shape), but
    // there is no trusted endpointId to attach a delivery row to, so it is
    // recorded on the wide event only and acked — mirroring how permanent
    // delivery failures ack instead of retrying forever.
    const decoded = Schema.decodeUnknownResult(WebhookQueueMessage)(input)
    if (Result.isFailure(decoded)) {
      yield* annotateWide({
        outcome: 'failed_permanent',
        skipReason: 'malformed_message'
      })
      return 'ack' as const
    }
    const message = decoded.success
    yield* annotateWide({
      endpointId: message.endpointId,
      eventType: message.eventType
    })
    const webhooks = yield* WebhookEndpoints
    const target = yield* webhooks.getDispatchTarget(message.endpointId)
    if (!target) {
      yield* annotateWide({ outcome: 'skipped', skipReason: 'disabled' })
      return 'ack' as const
    }
    yield* annotateWide({ endpointUrl: target.url })
    // Re-check the destination at dispatch time — an endpoint created before
    // the guard existed (or edited in the DB) must not let the worker reach
    // internal targets. DNS-rebinding protection is out of scope for the
    // starter (see validateWebhookUrl).
    const urlCheck = validateWebhookUrl(target.url)
    if (!urlCheck.valid) {
      yield* webhooks.recordDeliveryAttempt({
        id: newDeliveryId(),
        endpointId: target.id,
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
      return 'ack' as const
    }
    const deliveryId = newDeliveryId()
    const timestamp = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({
      deliveryId,
      eventType: message.eventType,
      payload: message.payload
    })
    const signature = yield* Effect.promise(() =>
      computeWebhookSignature(target.signingSecret, timestamp, body)
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
    const responseStatus = Result.isSuccess(responseResult)
      ? responseResult.success.status
      : 0
    const decision = classifyResponseStatus(responseStatus)
    const status =
      decision === 'delivered'
        ? ('delivered' as const)
        : decision === 'terminal'
          ? ('failed_permanent' as const)
          : ('failed' as const)
    yield* webhooks.recordDeliveryAttempt({
      id: deliveryId,
      endpointId: target.id,
      eventType: message.eventType,
      status,
      attempts,
      responseStatus: responseStatus === 0 ? null : responseStatus,
      nextAttemptAt:
        decision === 'retry'
          ? new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString()
          : null
    })
    yield* annotateWide({ outcome: status, responseStatus })
    return decision === 'retry' ? ('retry' as const) : ('ack' as const)
  })

const deliverWebhook = (
  message: unknown,
  attempts: number,
  env: Env
): Effect.Effect<DeliveryOutcome, never, HttpClient.HttpClient> => {
  const traceId = newTraceId()
  // endpointId/eventType land on the wide event via `annotateWide` after the
  // boundary decode in `processWebhookMessage` — the raw body is untrusted
  // here, so the envelope carries only the attempt count.
  return withTriggerScope(
    {
      service: 'background',
      event: 'webhook_delivery',
      traceId,
      env,
      metadata: { attempts }
    },
    processWebhookMessage(message, attempts, traceId).pipe(
      Effect.provide(selectCapabilitiesLayer(starterEnv(env)))
    )
  ).pipe(Effect.catchCause(() => Effect.succeed('retry' as const)))
}

/**
 * Dead-letter consumer: the message exhausted `maxRetries` on the primary
 * queue. Record a terminal `dead_lettered` delivery row and emit a wide event
 * so operators can see (and replay) exhausted deliveries.
 */
const recordDeadLetter = (
  input: unknown,
  attempts: number,
  env: Env
): Effect.Effect<void> => {
  const program = Effect.gen(function* () {
    // Same boundary decode as `processWebhookMessage`: a malformed dead letter
    // has no trusted endpointId for a delivery row, so log-and-ack only.
    const decoded = Schema.decodeUnknownResult(WebhookQueueMessage)(input)
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
      eventType: message.eventType
    })
    const webhooks = yield* WebhookEndpoints
    yield* webhooks.recordDeliveryAttempt({
      id: newDeliveryId(),
      endpointId: message.endpointId,
      eventType: message.eventType,
      status: 'dead_lettered',
      attempts,
      responseStatus: null,
      nextAttemptAt: null
    })
    yield* annotateWide({ outcome: 'dead_lettered' })
  }).pipe(Effect.provide(selectCapabilitiesLayer(starterEnv(env))))

  return withTriggerScope(
    {
      service: 'background',
      event: 'webhook_dead_letter',
      env,
      metadata: { attempts }
    },
    program
    // Always ack dead letters — failing here would loop the DLQ.
  ).pipe(Effect.catchCause(() => Effect.void))
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await staticRuntime.runPromise(refreshCatalog(env))
  },

  // Queue message bodies are untyped at runtime; `processWebhookMessage` and
  // `recordDeadLetter` decode them at their boundary.
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    if (batch.queue === DEAD_LETTER_QUEUE) {
      await Promise.all(
        batch.messages.map(async (message) => {
          await staticRuntime.runPromise(
            recordDeadLetter(message.body, message.attempts, env)
          )
          message.ack()
        })
      )
      return
    }
    await Promise.all(
      batch.messages.map(async (message) => {
        const outcome = await staticRuntime.runPromise(
          deliverWebhook(message.body, message.attempts, env)
        )
        if (outcome === 'ack') {
          message.ack()
        } else {
          message.retry({ delaySeconds: backoffSeconds(message.attempts) })
        }
      })
    )
  }
}
