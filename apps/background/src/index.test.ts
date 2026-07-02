import { describe, expect, it } from 'vitest'
import { Effect, Layer, type Scope } from 'effect'
import {
  HttpClient,
  HttpClientResponse,
  type HttpClientRequest
} from 'effect/unstable/http'
import {
  validateWebhookUrl,
  WebhookEndpoints,
  type WebhookDeliveryAttemptInput
} from '@b2b-saas-starter/capabilities'
import {
  backoffSeconds,
  classifyResponseStatus,
  computeWebhookSignature,
  processWebhookMessage,
  signatureHeaderValue,
  type WebhookMessage
} from './index.ts'

describe('backoffSeconds', () => {
  it('backs off linearly at 30s per attempt', () => {
    expect(backoffSeconds(1)).toBe(30)
    expect(backoffSeconds(2)).toBe(60)
    expect(backoffSeconds(6)).toBe(180)
  })

  it('caps at 180s beyond six attempts', () => {
    expect(backoffSeconds(7)).toBe(180)
    expect(backoffSeconds(100)).toBe(180)
  })
})

describe('classifyResponseStatus', () => {
  it('acks 2xx as delivered', () => {
    expect(classifyResponseStatus(200)).toBe('delivered')
    expect(classifyResponseStatus(204)).toBe('delivered')
  })

  it('treats permanent 4xx as terminal (ack, no retry)', () => {
    expect(classifyResponseStatus(400)).toBe('terminal')
    expect(classifyResponseStatus(404)).toBe('terminal')
    expect(classifyResponseStatus(410)).toBe('terminal')
  })

  it('retries 408 and 429', () => {
    expect(classifyResponseStatus(408)).toBe('retry')
    expect(classifyResponseStatus(429)).toBe('retry')
  })

  it('retries 5xx and no-response failures', () => {
    expect(classifyResponseStatus(500)).toBe('retry')
    expect(classifyResponseStatus(503)).toBe('retry')
    expect(classifyResponseStatus(0)).toBe('retry')
  })
})

describe('webhook signature', () => {
  it('matches the fixed HMAC-SHA256 vector over "<timestamp>.<body>"', async () => {
    const secret = 'whsec_test'
    const timestamp = 1700000000
    const body =
      '{"deliveryId":"whd_test","eventType":"demo.event","payload":{"hello":"world"}}'
    const signature = await computeWebhookSignature(secret, timestamp, body)
    expect(signature).toBe(
      '869b9de1fa743616d6143977e0a770f55f7cfd874cba33d935c1bfb5b481f9b2'
    )
    expect(signatureHeaderValue(timestamp, signature)).toBe(
      't=1700000000,sha256=869b9de1fa743616d6143977e0a770f55f7cfd874cba33d935c1bfb5b481f9b2'
    )
  })
})

describe('processWebhookMessage', () => {
  const message: WebhookMessage = {
    endpointId: 'wh_1',
    eventType: 'api_token.created',
    payload: { hello: 'world' }
  }

  const target = {
    id: 'wh_1',
    url: 'https://example.com/hook',
    signingSecret: 'whsec_test'
  }

  const stubEndpoints = (
    dispatchTarget: typeof target | null,
    recorded: WebhookDeliveryAttemptInput[]
  ): Layer.Layer<WebhookEndpoints> =>
    Layer.succeed(WebhookEndpoints)({
      list: Effect.die('unused in delivery tests'),
      create: () => Effect.die('unused in delivery tests'),
      disable: () => Effect.die('unused in delivery tests'),
      rotateSecret: () => Effect.die('unused in delivery tests'),
      getDispatchTarget: () => Effect.succeed(dispatchTarget),
      recordDeliveryAttempt: (input) =>
        Effect.sync(() => {
          recorded.push(input)
        })
    })

  const stubHttp = (
    status: number,
    captured: { request?: HttpClientRequest.HttpClientRequest }
  ): Layer.Layer<HttpClient.HttpClient> =>
    Layer.succeed(HttpClient.HttpClient)(
      HttpClient.make((request) => {
        captured.request = request
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response(null, { status }))
        )
      })
    )

  const run = (
    dispatchTarget: typeof target | null,
    status: number,
    attempts = 1,
    input: unknown = message
  ) => {
    const recorded: WebhookDeliveryAttemptInput[] = []
    const captured: { request?: HttpClientRequest.HttpClientRequest } = {}
    const effect = processWebhookMessage(input, attempts, 'trace-test').pipe(
      Effect.provide(
        Layer.mergeAll(
          stubEndpoints(dispatchTarget, recorded),
          stubHttp(status, captured)
        )
      )
    ) as Effect.Effect<'ack' | 'retry', never, Scope.Scope>
    return Effect.runPromise(Effect.scoped(effect)).then((outcome) => ({
      outcome,
      recorded,
      captured
    }))
  }

  it('delivers on 2xx, signs the request, and persists a delivered row', async () => {
    const { outcome, recorded, captured } = await run(target, 200)
    expect(outcome).toBe('ack')
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      endpointId: 'wh_1',
      eventType: 'api_token.created',
      status: 'delivered',
      responseStatus: 200,
      nextAttemptAt: null
    })
    const headers: Record<string, string | undefined> = captured.request?.headers ?? {}
    expect(headers['x-b2b-starter-event']).toBe('api_token.created')
    expect(headers['x-b2b-starter-signature']).toMatch(/^t=\d+,sha256=[0-9a-f]{64}$/)
    expect(headers['x-trace-id']).toBe('trace-test')
  })

  it('retries on 5xx and persists the backoff-aligned next attempt', async () => {
    const { outcome, recorded } = await run(target, 500, 2)
    expect(outcome).toBe('retry')
    expect(recorded[0]).toMatchObject({ status: 'failed', responseStatus: 500 })
    expect(recorded[0]?.nextAttemptAt).toBeTruthy()
  })

  it('acks a non-retryable 4xx as failed_permanent', async () => {
    const { outcome, recorded } = await run(target, 404)
    expect(outcome).toBe('ack')
    expect(recorded[0]).toMatchObject({
      status: 'failed_permanent',
      responseStatus: 404,
      nextAttemptAt: null
    })
  })

  it('acks a disabled endpoint without recording an attempt', async () => {
    const { outcome, recorded, captured } = await run(null, 200)
    expect(outcome).toBe('ack')
    expect(recorded).toHaveLength(0)
    expect(captured.request).toBeUndefined()
  })

  it('acks a malformed queue message without dispatching or recording', async () => {
    const { outcome, recorded, captured } = await run(target, 200, 1, {
      endpointId: 42,
      payload: {}
    })
    expect(outcome).toBe('ack')
    expect(recorded).toHaveLength(0)
    expect(captured.request).toBeUndefined()
  })

  it('acks an SSRF-invalid target as failed_permanent without dispatching', async () => {
    const { outcome, recorded, captured } = await run(
      { ...target, url: 'https://127.0.0.1/hook' },
      200
    )
    expect(outcome).toBe('ack')
    expect(recorded[0]).toMatchObject({
      status: 'failed_permanent',
      responseStatus: null
    })
    expect(captured.request).toBeUndefined()
  })
})

describe('validateWebhookUrl (dispatch-time SSRF guard)', () => {
  it('accepts public https URLs', () => {
    expect(validateWebhookUrl('https://example.com/hooks')).toEqual({ valid: true })
    expect(validateWebhookUrl('https://hooks.example.com:8443/a?b=c')).toEqual({
      valid: true
    })
  })

  it('rejects non-https schemes', () => {
    expect(validateWebhookUrl('http://example.com/hooks').valid).toBe(false)
    expect(validateWebhookUrl('ftp://example.com').valid).toBe(false)
    expect(validateWebhookUrl('not a url').valid).toBe(false)
  })

  it('rejects credentials in the URL', () => {
    expect(validateWebhookUrl('https://user:pass@example.com/hooks').valid).toBe(false)
  })

  it('rejects private, loopback, and link-local IP literals', () => {
    for (const url of [
      'https://10.0.0.1/hooks',
      'https://172.16.0.1/hooks',
      'https://192.168.1.5/hooks',
      'https://127.0.0.1/hooks',
      'https://169.254.169.254/latest/meta-data',
      'https://0.0.0.0/hooks',
      'https://[::1]/hooks',
      'https://[fc00::1]/hooks',
      'https://[fd12:3456::1]/hooks',
      'https://[fe80::1]/hooks'
    ]) {
      expect(validateWebhookUrl(url).valid, url).toBe(false)
    }
  })

  it('rejects localhost and single-label hostnames', () => {
    expect(validateWebhookUrl('https://localhost/hooks').valid).toBe(false)
    expect(validateWebhookUrl('https://internal/hooks').valid).toBe(false)
  })
})
