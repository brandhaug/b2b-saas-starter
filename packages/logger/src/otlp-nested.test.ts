// Capture the real SDK's HTTP output, including its promise-native gzip transport.
// oxlint-disable effect/noAsyncFunction, effect/noGlobals, starter/no-run-promise-in-tests
import { Effect } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { expect, it, vi } from 'vite-plus/test'
import { makeOtlpLayer } from './otlp.ts'
import { WideEventLoggerLive, withRequestScope } from './wide-event.ts'

async function requestBody(init: RequestInit | undefined): Promise<string> {
  const response = new Response(init?.body)
  if (new Headers(init?.headers).get('content-encoding') === 'gzip' && response.body) {
    return new Response(
      response.body.pipeThrough(new DecompressionStream('gzip'))
    ).text()
  }
  return response.text()
}

it('exports one-level web child facts in OTLP logs and trace events without child secrets', async () => {
  const secret = 'NESTED_PRIVATE_SENTINEL'
  const facts = {
    actorUserId: 'usr_child',
    workspaceId: 'ws_child',
    plan: 'pro',
    event: 'workspace.read',
    status: 'ok',
    count: 2,
    authenticated: true
  }
  const nested = [
    {
      ...facts,
      message: secret,
      authorization: secret,
      workspaceSlug: secret,
      url: `https://private.example/${secret}`,
      cause: { message: secret },
      nested: [{ actorUserId: secret }],
      recipientUserId: { value: secret },
      tokenId: [secret],
      operation: `https://private.example/${secret}`
    },
    { event: 'workspace.update', status: 'error', actorUserId: 'usr_other' },
    secret,
    null,
    42,
    [facts],
    { event: undefined, message: secret }
  ]
  const payloads: Array<{ url: string; body: string }> = []
  const output = vi.spyOn(console, 'log').mockImplementation(() => {})
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    let url: string
    if (input instanceof Request) {
      url = input.url
    } else {
      url = input.toString()
    }
    payloads.push({
      url,
      body: await requestBody(init)
    })
    return new Response('{}')
  })
  try {
    await Effect.runPromise(
      withRequestScope(
        { service: 'web', event: 'web.request' },
        Effect.annotateLogsScoped({ nested, arbitrary: nested })
      ).pipe(
        Effect.provide(
          makeOtlpLayer('web', {
            OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example'
          }),
          { local: true }
        ),
        Effect.provide(WideEventLoggerLive),
        Effect.provideService(FetchHttpClient.Fetch, fetch)
      )
    )
    const attributes = expect.arrayContaining([
      {
        key: 'nested',
        value: {
          arrayValue: {
            values: [
              {
                kvlistValue: {
                  values: [
                    { key: 'actorUserId', value: { stringValue: 'usr_child' } },
                    { key: 'workspaceId', value: { stringValue: 'ws_child' } },
                    { key: 'plan', value: { stringValue: 'pro' } },
                    { key: 'event', value: { stringValue: 'workspace.read' } },
                    { key: 'status', value: { stringValue: 'ok' } },
                    { key: 'count', value: { intValue: 2 } },
                    { key: 'authenticated', value: { boolValue: true } }
                  ]
                }
              },
              {
                kvlistValue: {
                  values: [
                    { key: 'event', value: { stringValue: 'workspace.update' } },
                    { key: 'status', value: { stringValue: 'error' } },
                    { key: 'actorUserId', value: { stringValue: 'usr_other' } }
                  ]
                }
              }
            ]
          }
        }
      }
    ])
    const logs = payloads.filter((entry) => entry.url.endsWith('/v1/logs'))
    const traces = payloads.filter((entry) => entry.url.endsWith('/v1/traces'))
    expect(logs).toHaveLength(1)
    expect(traces).toHaveLength(1)
    expect(JSON.parse(logs[0]?.body ?? '')).toMatchObject({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [{ body: { stringValue: 'web.request' }, attributes }]
            }
          ]
        }
      ]
    })
    expect(JSON.parse(traces[0]?.body ?? '')).toMatchObject({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [{ events: [{ name: 'web.request', attributes }] }]
            }
          ]
        }
      ]
    })
    const emitted = payloads.map((entry) => entry.body).join(',')
    expect(emitted).not.toContain(secret)
    for (const key of [
      'arbitrary',
      'message',
      'authorization',
      'workspaceSlug',
      'url',
      'cause',
      'recipientUserId',
      'tokenId',
      'operation'
    ]) {
      expect(emitted).not.toContain(`"key":"${key}"`)
    }
  } finally {
    output.mockRestore()
  }
})
