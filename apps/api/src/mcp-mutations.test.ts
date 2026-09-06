import {
  SEED_API_TOKEN,
  SEED_READONLY_API_TOKEN
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'
import { jsonBody, mcpClient } from './test-utils.ts'

const allow = { limit: () => Promise.resolve({ success: true }) }
const env = { RATE_LIMITER_MCP: allow, RATE_LIMITER_REST_WRITE: allow }

const envelope = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    content: Schema.Array(
      Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })
    )
  })
})
const record = Schema.Struct({ id: Schema.String })
const createdToken = Schema.Struct({
  id: Schema.String,
  token: Schema.String,
  scopes: Schema.Array(Schema.String)
})
const queued = Schema.Struct({
  status: Schema.Literal('queued'),
  deliveryId: Schema.String
})
const secret = Schema.Struct({ signingSecret: Schema.String })
const link = Schema.Struct({ url: Schema.String, expiresAt: Schema.String })

function call(
  client: ReturnType<typeof mcpClient>,
  name: string,
  args: Schema.Json = {}
) {
  return Effect.promise(() => client.rpc('tools/call', { name, arguments: args })).pipe(
    Effect.flatMap((response) => jsonBody(response, Schema.Json)),
    Effect.flatMap((body) => {
      expect(body).toHaveProperty('result')
      return Schema.decodeUnknownEffect(envelope)(body)
    }),
    Effect.map((body) => body.result)
  )
}
function success<S extends Schema.Top>(
  client: ReturnType<typeof mcpClient>,
  name: string,
  args: Schema.Json,
  schema: S
) {
  return call(client, name, args).pipe(
    Effect.flatMap((result) => {
      expect(result.isError).not.toBe(true)
      expect(result.content).toHaveLength(1)
      return Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(
        result.content[0]?.text
      )
    })
  )
}

// Independent expectations: these names and payloads are not derived from the catalog.
const writes = [
  { name: 'create_api_token', args: { name: 'CI', scopes: ['read'] } },
  {
    name: 'replace_api_token',
    args: { tokenId: 'foreign-token', scopes: ['read'], overlapSeconds: 0 }
  },
  { name: 'delete_api_token', args: { tokenId: 'foreign-token' } },
  {
    name: 'create_webhook',
    args: { url: 'https://hooks.example.com/test', events: ['api_token.created'] }
  },
  { name: 'update_webhook', args: { endpointId: 'foreign-endpoint', enabled: false } },
  { name: 'delete_webhook', args: { endpointId: 'foreign-endpoint' } },
  { name: 'rotate_webhook_secret', args: { endpointId: 'foreign-endpoint' } },
  { name: 'send_webhook_test_event', args: { endpointId: 'foreign-endpoint' } },
  { name: 'replay_webhook_delivery', args: { deliveryId: 'foreign-delivery' } },
  { name: 'request_workspace_export', args: {} },
  { name: 'get_workspace_export_download_link', args: { exportId: 'foreign-export' } }
] satisfies ReadonlyArray<{ name: string; args: Schema.Json }>

describe('MCP workspace mutations over streamable HTTP', () => {
  it.effect('advertises all eleven typed tools with honest annotations', () =>
    Effect.gen(function* () {
      const client = mcpClient(buildWebHandler(env).handler, `Bearer ${SEED_API_TOKEN}`)
      yield* Effect.promise(() => client.initialize())
      const response = yield* Effect.promise(() => client.rpc('tools/list'))
      const body = yield* jsonBody(
        response,
        Schema.Struct({
          result: Schema.Struct({
            tools: Schema.Array(
              Schema.Struct({
                name: Schema.String,
                inputSchema: Schema.Struct({ type: Schema.Literal('object') }),
                annotations: Schema.Struct({
                  readOnlyHint: Schema.Boolean,
                  destructiveHint: Schema.Boolean,
                  idempotentHint: Schema.Boolean,
                  openWorldHint: Schema.Boolean
                })
              })
            )
          })
        })
      )
      for (const write of writes) {
        const tool = body.result.tools.find(
          (candidate) => candidate.name === write.name
        )
        expect(tool).toBeDefined()
        expect(tool?.annotations.readOnlyHint).toBe(false)
        expect(tool?.annotations.openWorldHint).toBe(true)
        expect(tool?.annotations.idempotentHint).toBe(write.name === 'delete_api_token')
        expect(tool?.annotations.destructiveHint).toBe(
          [
            'replace_api_token',
            'delete_api_token',
            'update_webhook',
            'delete_webhook',
            'rotate_webhook_secret'
          ].includes(write.name)
        )
      }
    })
  )

  it.effect(
    'read credentials are denied before any mutation, including absent IDs',
    () =>
      Effect.gen(function* () {
        const handler = buildWebHandler(env).handler
        const admin = mcpClient(handler, `Bearer ${SEED_API_TOKEN}`)
        const reader = mcpClient(handler, `Bearer ${SEED_READONLY_API_TOKEN}`)
        yield* Effect.promise(() => admin.initialize())
        yield* Effect.promise(() => reader.initialize())
        const before = yield* call(admin, 'list_audit_events')
        const tokens = yield* call(admin, 'list_api_tokens')
        for (const write of writes) {
          const result = yield* call(reader, write.name, write.args)
          expect(result.isError).toBe(true)
          expect(result.content[0]?.text).toContain('denied: insufficient_permission')
        }
        expect(yield* call(admin, 'list_audit_events')).toEqual(before)
        expect(yield* call(admin, 'list_api_tokens')).toEqual(tokens)
      })
  )

  it.effect(
    'executes all eleven mutations and exposes each permitted secret once',
    () =>
      Effect.gen(function* () {
        const handler = buildWebHandler(env).handler
        const client = mcpClient(handler, `Bearer ${SEED_API_TOKEN}`)
        yield* Effect.promise(() => client.initialize())
        const token = yield* success(
          client,
          'create_api_token',
          { name: 'MCP CI', scopes: ['read'] },
          createdToken
        )
        expect(token.scopes).toEqual(['read'])
        expect(token.token).toMatch(/^bsk_/)
        const newReader = mcpClient(handler, `Bearer ${token.token}`)
        yield* Effect.promise(() => newReader.initialize())
        expect(
          (yield* call(newReader, 'create_api_token', {
            name: 'escalation',
            scopes: ['admin']
          })).isError
        ).toBe(true)
        const replacement = yield* success(
          client,
          'replace_api_token',
          {
            tokenId: token.id,
            scopes: ['read'],
            overlapSeconds: 0
          },
          createdToken
        )
        expect(replacement.token).not.toBe(token.token)
        expect(
          (yield* Effect.promise(() =>
            newReader.rpc('tools/call', { name: 'list_api_tokens' })
          )).status
        ).toBe(401)
        const replacementReader = mcpClient(handler, `Bearer ${replacement.token}`)
        yield* Effect.promise(() => replacementReader.initialize())
        expect((yield* call(replacementReader, 'list_api_tokens')).isError).not.toBe(
          true
        )
        expect(
          (yield* call(client, 'replace_api_token', {
            tokenId: replacement.id,
            scopes: ['admin'],
            overlapSeconds: 0
          })).isError
        ).toBe(true)
        expect(
          (yield* call(client, 'replace_api_token', {
            tokenId: 'foreign-token',
            scopes: ['read'],
            overlapSeconds: 0
          })).isError
        ).toBe(true)
        const webhook = yield* success(
          client,
          'create_webhook',
          { url: 'https://hooks.example.com/mcp', events: ['api_token.created'] },
          record
        )
        const rotated = yield* success(
          client,
          'rotate_webhook_secret',
          { endpointId: webhook.id },
          secret
        )
        expect(rotated.signingSecret.length).toBeGreaterThan(10)
        const test = yield* success(
          client,
          'send_webhook_test_event',
          { endpointId: webhook.id },
          queued
        )
        expect(test.deliveryId).toBeTruthy()
        const replay = yield* success(
          client,
          'replay_webhook_delivery',
          { deliveryId: 'whd_seed_failed' },
          queued
        )
        expect(replay.deliveryId).not.toBe('whd_seed_failed')
        yield* success(
          client,
          'update_webhook',
          { endpointId: webhook.id, enabled: false },
          Schema.Struct({ enabled: Schema.Literal(false) })
        )
        expect(
          (yield* call(client, 'send_webhook_test_event', { endpointId: webhook.id }))
            .isError
        ).toBe(true)
        yield* success(
          client,
          'delete_webhook',
          { endpointId: webhook.id },
          Schema.Struct({ status: Schema.Literal('deleted') })
        )
        expect(
          (yield* call(client, 'rotate_webhook_secret', { endpointId: webhook.id }))
            .content[0]?.text
        ).toContain('not found')
        const exported = yield* success(client, 'request_workspace_export', {}, record)
        const download = yield* success(
          client,
          'get_workspace_export_download_link',
          { exportId: exported.id },
          link
        )
        expect(new URL(download.url).origin).toBe('https://api.test')
        expect(
          (yield* Effect.promise(() => handler(new Request(download.url)))).status
        ).toBe(200)
        yield* success(
          client,
          'delete_api_token',
          { tokenId: replacement.id },
          Schema.Struct({ status: Schema.Literal('revoked') })
        )
        const revoked = yield* Effect.promise(() =>
          replacementReader.rpc('tools/call', { name: 'list_api_tokens' })
        )
        expect(revoked.status).toBe(401)
        const audit = yield* call(client, 'list_audit_events')
        expect(audit.content[0]?.text).toContain('api_token')
        expect(audit.content[0]?.text).not.toContain(token.token)
        expect(audit.content[0]?.text).not.toContain(replacement.token)
        expect(audit.content[0]?.text).not.toContain(rotated.signingSecret)
        expect(audit.content[0]?.text).not.toContain(download.url)
      })
  )

  it.effect(
    'preserves typed refusals and checks the write bucket before side effects',
    () =>
      Effect.gen(function* () {
        const handler = buildWebHandler(env).handler
        const client = mcpClient(handler, `Bearer ${SEED_API_TOKEN}`)
        yield* Effect.promise(() => client.initialize())
        for (const write of writes.filter(
          (candidate) =>
            candidate.name.includes('webhook') &&
            !['create_webhook', 'delete_api_token'].includes(candidate.name)
        )) {
          const failure = yield* call(client, write.name, write.args)
          expect(failure.isError).toBe(true)
          expect(failure.content[0]?.text).toContain('not found')
        }
        expect(
          (yield* call(client, 'get_workspace_export_download_link', {
            exportId: 'foreign-export'
          })).content[0]?.text
        ).toBe('workspace export not downloadable')
        expect(
          (yield* call(client, 'create_webhook', {
            url: 'http://127.0.0.1/internal',
            events: ['api_token.created']
          })).content[0]?.text
        ).toBe('invalid webhook URL')
        const limited = mcpClient(
          buildWebHandler({
            ...env,
            RATE_LIMITER_REST_WRITE: {
              limit: () => Promise.resolve({ success: false })
            }
          }).handler,
          `Bearer ${SEED_API_TOKEN}`
        )
        yield* Effect.promise(() => limited.initialize())
        const before = yield* call(limited, 'list_audit_events')
        expect(
          (yield* call(limited, 'create_api_token', {
            name: 'limited',
            scopes: ['read']
          })).content[0]?.text
        ).toBe('write rate limit exceeded')
        expect(yield* call(limited, 'list_audit_events')).toEqual(before)
      })
  )
})

it.effect('export links use each invocation origin on the same worker', () =>
  Effect.gen(function* () {
    const handler = buildWebHandler(env).handler
    for (const origin of ['https://first.example', 'https://second.example']) {
      const client = mcpClient(handler, `Bearer ${SEED_API_TOKEN}`, origin)
      yield* Effect.promise(() => client.initialize())
      const download = yield* success(
        client,
        'get_workspace_export_download_link',
        { exportId: 'exp_seed_ready' },
        link
      )
      expect(new URL(download.url).origin).toBe(origin)
    }
  })
)

it.effect('malformed write JSON is rejected without changing the audit trail', () =>
  Effect.gen(function* () {
    const client = mcpClient(buildWebHandler(env).handler, `Bearer ${SEED_API_TOKEN}`)
    yield* Effect.promise(() => client.initialize())
    const before = yield* call(client, 'list_audit_events')
    for (const [name, args] of [
      ['create_api_token', { name: 'bad', scopes: ['superadmin'] }],
      ['create_webhook', { url: 'https://valid.example', events: [] }],
      ['update_webhook', { endpointId: 'wh_release', enabled: 'false' }],
      ['rotate_webhook_secret', {}],
      ['get_workspace_export_download_link', { exportId: 123 }]
    ] satisfies ReadonlyArray<[string, Schema.Json]>) {
      const refusal = yield* call(client, name, args)
      expect(refusal.isError).toBe(true)
      expect(refusal.content[0]?.text).not.toContain(
        'tool failed; see the API worker logs'
      )
    }
    expect(yield* call(client, 'list_audit_events')).toEqual(before)
  })
)

it.effect(
  'REST and MCP writes consume the same limiter and denied tools also consume it',
  () =>
    Effect.gen(function* () {
      let remaining = 2
      const keys: Array<string> = []
      const rawHandler = buildWebHandler({
        ...env,
        RATE_LIMITER_REST_WRITE: {
          limit: ({ key }) => {
            keys.push(key)
            remaining -= 1
            return Promise.resolve({ success: remaining >= 0 })
          }
        }
      }).handler
      function handler(request: Request) {
        const headers = new Headers(request.headers)
        headers.set('cf-connecting-ip', '198.51.100.42')
        return rawHandler(new Request(request, { headers }))
      }
      const client = mcpClient(handler, `Bearer ${SEED_READONLY_API_TOKEN}`)
      yield* Effect.promise(() => client.initialize())
      const rest = yield* Effect.promise(() =>
        handler(
          new Request('https://api.test/workspaces/starter-lab/api-tokens/missing', {
            method: 'DELETE',
            headers: { authorization: `Bearer ${SEED_READONLY_API_TOKEN}` }
          })
        )
      )
      expect(rest.status).toBe(403)
      expect(
        (yield* call(client, 'delete_api_token', { tokenId: 'missing' })).content[0]
          ?.text
      ).toContain('denied: insufficient_permission')
      expect(
        (yield* call(client, 'delete_api_token', { tokenId: 'missing' })).content[0]
          ?.text
      ).toBe('write rate limit exceeded')
      expect(keys).toHaveLength(3)
      expect(new Set(keys).size).toBe(1)
    })
)
