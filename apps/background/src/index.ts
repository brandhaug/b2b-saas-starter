import { Effect, Layer, ManagedRuntime, Result } from 'effect'
import { FetchHttpClient, HttpBody, HttpClient } from 'effect/unstable/http'
import {
  CatalogRefreshHistory,
  selectCapabilitiesLayer,
  StarterModuleCatalog,
  WebhookEndpoints
} from '@b2b-saas-starter/capabilities'
import {
  annotateWide,
  newTraceId,
  readWideEventEnvironment,
  TRACE_HEADER,
  WideEventLoggerLive,
  withRequestScope
} from '@b2b-saas-starter/logger'

type Env = {
  readonly DB?: D1Database
  readonly WEBHOOK_QUEUE?: Queue
}

type WebhookMessage = {
  readonly endpointId: string
  readonly eventType: string
  readonly payload: unknown
}

type DeliveryOutcome = 'ack' | 'retry'

const StaticLayer = Layer.mergeAll(FetchHttpClient.layer, WideEventLoggerLive)
const staticRuntime = ManagedRuntime.make(StaticLayer)

const bytesToHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )

const signPayload = (secret: string, payload: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    return bytesToHex(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    )
  })

const refreshCatalog = (
  env: Env
): Effect.Effect<void, never, HttpClient.HttpClient> => {
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  const program = Effect.gen(function* () {
    const catalog = yield* StarterModuleCatalog
    const history = yield* CatalogRefreshHistory
    const modules = yield* catalog.listAllModules
    yield* history.recordRun({
      label: new Date(startedAt).toUTCString(),
      status: 'ok',
      modules: modules.length,
      durationMs: Date.now() - startedMs,
      startedAt
    })
    yield* annotateWide({ moduleCount: modules.length })
  }).pipe(Effect.provide(selectCapabilitiesLayer(env)))

  return withRequestScope(
    {
      service: 'background',
      event: 'catalog_refresh',
      environment: readWideEventEnvironment(env),
      metadata: { source: env.DB ? 'live' : 'seed' }
    },
    program
  )
}

const deliverWebhook = (
  message: WebhookMessage,
  attempts: number,
  env: Env
): Effect.Effect<DeliveryOutcome, never, HttpClient.HttpClient> => {
  const traceId = newTraceId()
  const program = Effect.gen(function* () {
    const webhooks = yield* WebhookEndpoints
    const target = yield* webhooks.getDispatchTarget(message.endpointId)
    if (!target) {
      yield* annotateWide({ outcome: 'skipped', skipReason: 'disabled' })
      return 'ack' as const
    }
    yield* annotateWide({ endpointUrl: target.url })
    const body = JSON.stringify({
      eventType: message.eventType,
      payload: message.payload
    })
    const signature = yield* signPayload(target.signingSecret, body)
    const client = yield* HttpClient.HttpClient
    const responseResult = yield* Effect.result(
      client.post(target.url, {
        headers: {
          'content-type': 'application/json',
          'user-agent': 'b2b-saas-starter-webhooks/0.1',
          'x-b2b-starter-event': message.eventType,
          'x-b2b-starter-signature': `sha256=${signature}`,
          [TRACE_HEADER]: traceId
        },
        body: HttpBody.text(body, 'application/json')
      })
    )
    const responseStatus = Result.isSuccess(responseResult)
      ? responseResult.success.status
      : 0
    const delivered =
      Result.isSuccess(responseResult) && responseStatus >= 200 && responseStatus < 300
    yield* webhooks.recordDeliveryAttempt({
      endpointId: target.id,
      eventType: message.eventType,
      status: delivered ? 'delivered' : 'failed',
      attempts,
      responseStatus,
      nextAttemptAt: delivered
        ? null
        : new Date(Date.now() + Math.min(attempts, 6) * 60_000).toISOString()
    })
    yield* annotateWide({
      outcome: delivered ? 'delivered' : 'failed',
      responseStatus
    })
    return delivered ? ('ack' as const) : ('retry' as const)
  }).pipe(Effect.provide(selectCapabilitiesLayer(env)))

  return withRequestScope(
    {
      service: 'background',
      event: 'webhook_delivery',
      traceId,
      environment: readWideEventEnvironment(env),
      metadata: {
        endpointId: message.endpointId,
        eventType: message.eventType,
        attempts
      }
    },
    program
  ).pipe(Effect.catchCause(() => Effect.succeed('retry' as const)))
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await staticRuntime.runPromise(refreshCatalog(env))
  },

  async queue(batch: MessageBatch<WebhookMessage>, env: Env): Promise<void> {
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

const backoffSeconds = (attempts: number): number => Math.min(attempts, 6) * 30
