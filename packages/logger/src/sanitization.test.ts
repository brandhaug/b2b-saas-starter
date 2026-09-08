// Exercise serialized vendor outputs with real SDKs; fetch/transport are the capture boundaries.
// Effect runtime bridges the promise-native fetch and Sentry transport under test.
// oxlint-disable effect/noAsyncFunction, effect/noGlobals, starter/no-run-promise-in-tests
import { CloudflareClient, Scope, linkedErrorsIntegration } from '@sentry/cloudflare'
import { Effect, Metric } from 'effect'
import { HttpClient, FetchHttpClient } from 'effect/unstable/http'
import { describe, expect, it, vi } from 'vite-plus/test'
import { withHttpInvocation } from './invocation.ts'
import { WideEventLoggerLive, withRequestScope } from './wide-event.ts'
import { makeSentryOptions, wireWideEventProviders } from './providers.ts'

async function requestBody(init: RequestInit | undefined): Promise<string> {
  const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer())
  if (new Headers(init?.headers).get('content-encoding') === 'gzip') {
    const stream = new Response(bytes).body
    if (stream) {
      return new Response(stream.pipeThrough(new DecompressionStream('gzip'))).text()
    }
  }
  return new TextDecoder().decode(bytes)
}

const secret = 'SENSITIVE_SENTINEL_9'
const traceId = '0af7651916cd43dd8448eb211c80319c'
const sensitive = {
  authorization: `Bearer ${secret}`,
  cookie: `session=${secret}`,
  password: secret,
  providerSecret: secret,
  accessToken: secret,
  signedUrl: `https://example.com/file?signature=${secret}`,
  email: `${secret}@example.com`,
  customerContent: secret
}

function nestedFailure() {
  return new Error(`provider rejected ${secret}`, {
    cause: new Error(JSON.stringify(sensitive), { cause: sensitive })
  })
}

describe('AC-9 telemetry output policy', () => {
  it('AC-9.1/2/3 removes nested exceptions and annotation content from console and all OTLP signals', async () => {
    const consoleLines: Array<string> = []
    const payloads: Array<{ url: string; body: string }> = []
    const output = vi
      .spyOn(console, 'log')
      .mockImplementation((line: string) => consoleLines.push(line))
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      let url: string
      if (input instanceof Request) {
        url = input.url
      } else {
        url = input.toString()
      }
      if (url.startsWith('https://provider.example')) {
        throw nestedFailure()
      }
      payloads.push({ url, body: await requestBody(init) })
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    try {
      await Effect.runPromise(
        Effect.exit(
          withHttpInvocation(
            {
              service: 'api',
              event: 'request.export',
              request: new Request(
                `https://app.example/export/${secret}?token=${secret}`,
                {
                  headers: {
                    authorization: sensitive.authorization,
                    cookie: sensitive.cookie,
                    traceparent: `00-${traceId}-b7ad6b7169203331-01`
                  }
                }
              ),
              env: {
                OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example',
                OTEL_EXPORTER_OTLP_HEADERS: `authorization=Bearer collector-credential`
              },
              metadata: sensitive
            },
            Effect.gen(function* () {
              yield* Effect.annotateLogsScoped({
                workspaceId: 'ws_1',
                ...sensitive,
                nested: [
                  {
                    event: 'capability.export',
                    status: 'error',
                    cause: sensitive,
                    ...sensitive
                  }
                ]
              })
              yield* Metric.update(
                Metric.withAttributes(Metric.counter('provider.failures'), sensitive),
                1
              )
              yield* HttpClient.get(
                `https://provider.example/path?token=${secret}`
              ).pipe(
                Effect.provide(FetchHttpClient.layer),
                Effect.withSpan('capability.export')
              )
            })
          )
        ).pipe(Effect.provide(WideEventLoggerLive))
      )
      expect(consoleLines).toHaveLength(1)
      expect(consoleLines.join(',')).not.toContain(secret)
      expect(consoleLines.join(',')).toContain('ws_1')
      expect(consoleLines.join(',')).toContain('capability.export')
      expect(consoleLines.join(',')).toContain('request.export')
      expect(consoleLines.join(',')).toContain(traceId)
      expect(
        payloads.map((payload) => new URL(payload.url).pathname).toSorted()
      ).toEqual(['/v1/logs', '/v1/metrics', '/v1/traces'])
      const emitted = payloads.map((payload) => payload.body).join(',')
      expect(emitted).not.toContain(secret)
      expect(emitted).not.toContain('collector-credential')
      expect(emitted).toContain(traceId)
      expect(emitted).toContain('HttpClientError')
      expect(emitted).toContain('capability.export')
      expect(emitted).toContain('duration.ms')
      expect(emitted).toContain('request.export')
    } finally {
      output.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('AC-9.1/2/3 sanitizes actual Sentry envelopes including SDK context and nested exceptions', async () => {
    const envelopes: Array<string> = []
    const client = new CloudflareClient({
      ...makeSentryOptions('api', { SENTRY_DSN: 'https://public@sentry.example/1' }),
      integrations: [linkedErrorsIntegration()],
      stackParser: () => [
        { filename: `https://example.com/${secret}`, context_line: secret }
      ],
      transport: () => ({
        send: (envelope) => {
          envelopes.push(JSON.stringify(envelope))
          return Promise.resolve({ statusCode: 200 })
        },
        flush: () => Promise.resolve(true)
      })
    })
    client.init()
    const scope = new Scope()
    scope.setUser({ email: `${secret}@example.com`, ip_address: secret, id: secret })
    scope.setExtras({
      ...sensitive,
      workspaceId: 'ws_1',
      evidenceId: 'evidence-1',
      queue: 'starter-webhooks-dlq',
      attempts: 4,
      nested: sensitive
    })
    scope.setContext('trace', { trace_id: traceId, span_id: 'b7ad6b7169203331' })
    scope.setContext('customer', sensitive)
    client.captureException(nestedFailure(), {}, scope)
    client.captureEvent(
      {
        request: {
          url: sensitive.signedUrl,
          headers: { authorization: sensitive.authorization },
          data: sensitive
        },
        breadcrumbs: [{ message: secret, data: sensitive }],
        exception: {
          values: [
            {
              type: 'ProviderFailure',
              value: secret,
              stacktrace: {
                frames: [
                  {
                    filename: sensitive.signedUrl,
                    vars: sensitive,
                    context_line: secret
                  }
                ]
              }
            }
          ]
        }
      },
      {},
      scope
    )
    await client.flush(2000)
    client.dispose()
    expect(envelopes).toHaveLength(2)
    expect(envelopes.join(',')).not.toContain(secret)
    expect(envelopes.join(',')).toContain('ProviderFailure')
    expect(envelopes.join(',')).toContain(traceId)
    expect(envelopes.join(',')).toContain('ws_1')
    expect(envelopes.join(',')).toContain('evidence-1')
    expect(envelopes.join(',')).toContain('starter-webhooks-dlq')
  })

  it('AC-9.3/4 leaves unconfigured providers inert and bounds configured PostHog payloads', async () => {
    const payloads: Array<string> = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      payloads.push(await requestBody(init))
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    try {
      wireWideEventProviders({})
      await Effect.runPromise(
        Effect.exit(
          withRequestScope(
            { service: 'api', event: 'provider.failure' },
            Effect.fail(nestedFailure())
          )
        ).pipe(Effect.provide(WideEventLoggerLive))
      )
      expect(fetch).not.toHaveBeenCalled()
      wireWideEventProviders({
        POSTHOG_KEY: 'project-key',
        POSTHOG_HOST: 'https://analytics.example'
      })
      await Effect.runPromise(
        Effect.exit(
          withRequestScope(
            { service: 'api', event: 'provider.failure', traceId, metadata: sensitive },
            Effect.fail(nestedFailure())
          )
        ).pipe(Effect.provide(WideEventLoggerLive))
      )
      expect(payloads.length).toBeGreaterThan(0)
      expect(payloads.join(',')).not.toContain(secret)
      expect(payloads.join(',')).toContain(traceId)
      expect(payloads.join(',')).toContain('provider.failure')
    } finally {
      wireWideEventProviders({})
      vi.unstubAllGlobals()
    }
  })
})
