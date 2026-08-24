import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { describe, expect, test } from 'vitest'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'
import { MCP_SERVER_NAME, mcpDiscoveryDocument, mcpTools } from './mcp.ts'

/**
 * The MCP protocol surface at `POST /mcp`, driven as a stock streamable-HTTP
 * client would drive it: one JSON-RPC message per POST with a bearer token.
 *
 * The authz rows matter as much as the happy paths — every tool re-checks its
 * own permission against the token's scopes inside the SDK callback, so a
 * scope-to-permission drift flips a `tools/call` result without ever touching
 * the HTTP status code. Response bodies are decoded through schemas at the
 * boundary rather than cast, mirroring `index.test.ts`.
 */

const bearer = {
  authorization: `Bearer ${SEED_API_TOKEN}`,
  'content-type': 'application/json'
}

let nextId = 0

const encodeJsonBody = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

type Json = typeof Schema.Json.Type
type JsonRpcWireRequest = {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Json
}

function rpc(method: string, params?: Json): Request {
  nextId += 1
  const envelope: JsonRpcWireRequest = { jsonrpc: '2.0', id: nextId, method }
  if (params !== undefined) envelope.params = params
  return new Request('https://api.test/mcp', {
    method: 'POST',
    headers: bearer,
    body: encodeJsonBody(envelope)
  })
}

function send(request: Request): Effect.Effect<Response> {
  return Effect.promise(() => buildWebHandler({}).handler(request))
}

/** A success envelope carrying a specific result shape; `.error` must be absent. */
function Ok<Result extends Schema.Top>(result: Result) {
  return Schema.Struct({
    jsonrpc: Schema.Literal('2.0'),
    id: Schema.Unknown,
    result
  })
}

const InitializeResult = Schema.Struct({
  serverInfo: Schema.Struct({ name: Schema.String }),
  capabilities: Schema.Record(Schema.String, Schema.Unknown)
})
const ToolListResult = Schema.Struct({
  tools: Schema.Array(Schema.Struct({ name: Schema.String }))
})
const CallToolResult = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
  isError: Schema.optional(Schema.Boolean)
})
const ResourceReadResult = Schema.Struct({
  contents: Schema.Array(Schema.Struct({ uri: Schema.String, text: Schema.String }))
})

// Same decode-at-the-boundary idea as `index.test.ts`, plus SSE handling:
// the streamable-HTTP protocol may answer a single request with an SSE body,
// so unwrap the `data:` frame before decoding.
function jsonBody<S extends Schema.Top>(
  response: Response,
  schema: S
): Effect.Effect<S['Type'], never, S['DecodingServices']> {
  return Effect.promise(() => response.text()).pipe(
    Effect.flatMap((text) => {
      // oxlint-disable-next-line effect/noTernary, effect/noGlobals -- tests unwrap the protocol's SSE framing before decoding; there is no Effect codec for SSE frames
      const raw = response.headers.get('content-type')?.includes('text/event-stream')
        ? text
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trim())
            .join('\n')
        : text
      // oxlint-disable-next-line effect/noGlobals -- see above: decoding the wire format this test asserts on
      return Effect.try(() => JSON.parse(raw))
    }),
    Effect.flatMap((raw) => Schema.decodeUnknownEffect(schema)(raw)),
    Effect.orDie
  )
}

describe('POST /mcp protocol', () => {
  test('a stock initialize handshake answers server info and capabilities', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(
          rpc('initialize', {
            protocolVersion: '2026-07-28',
            capabilities: {},
            clientInfo: { name: 'stock-client', version: '1.0.0' }
          })
        )
        expect(res.status).toBe(200)
        const body = yield* jsonBody(res, Ok(InitializeResult))
        expect(body.result.serverInfo.name).toBe(MCP_SERVER_NAME)
        expect(Object.keys(body.result.capabilities)).toEqual(
          expect.arrayContaining(['tools', 'resources'])
        )
      })
    ))

  test('tools/list advertises exactly the registered read tools', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(rpc('tools/list', {}))
        expect(res.status).toBe(200)
        const body = yield* jsonBody(res, Ok(ToolListResult))
        // The discovery document derives from the same descriptor table the
        // SDK server registers from, so both surfaces answer with one list.
        expect(body.result.tools.map((tool) => tool.name)).toEqual(
          mcpTools.map((tool) => tool.descriptor.name)
        )
        expect(mcpDiscoveryDocument().tools).toHaveLength(mcpTools.length)
      })
    ))

  test('tools/call list_notifications returns the seed feed content', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(
          rpc('tools/call', { name: 'list_notifications', arguments: {} })
        )
        expect(res.status).toBe(200)
        const body = yield* jsonBody(res, Ok(CallToolResult))
        expect(body.result.isError).not.toBe(true)
        expect(body.result.content[0]?.text).toContain('not_email')
      })
    ))

  test('resources/read serves the workspace overview resource', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(rpc('resources/read', { uri: 'workspace://overview' }))
        expect(res.status).toBe(200)
        const body = yield* jsonBody(res, Ok(ResourceReadResult))
        expect(body.result.contents[0]?.uri).toBe('workspace://overview')
        expect(body.result.contents[0]?.text).toContain('starter-lab')
      })
    ))

  test('POST /mcp requires a bearer token', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(
          new Request('https://api.test/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: encodeJsonBody({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
          })
        )
        expect(res.status).toBe(401)
      })
    ))

  test('an unknown token is an authentication failure, not a denial', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(
          new Request('https://api.test/mcp', {
            method: 'POST',
            headers: {
              authorization: 'Bearer bsk_live_bogus',
              'content-type': 'application/json'
            },
            body: encodeJsonBody({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
          })
        )
        expect(res.status).toBe(401)
      })
    ))

  test('malformed JSON is a JSON-RPC parse error, not a crash', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(
          new Request('https://api.test/mcp', {
            method: 'POST',
            headers: bearer,
            body: '{not json'
          })
        )
        expect(res.status).toBe(400)
        const body = yield* jsonBody(
          res,
          Schema.Struct({
            jsonrpc: Schema.Literal('2.0'),
            id: Schema.NullOr(Schema.Unknown),
            error: Schema.Struct({ code: Schema.Number })
          })
        )
        expect(body.error.code).toBe(-32_700)
      })
    ))

  test('a notification is accepted with no reply body', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(
          new Request('https://api.test/mcp', {
            method: 'POST',
            headers: bearer,
            body: encodeJsonBody({
              jsonrpc: '2.0',
              method: 'notifications/initialized'
            })
          })
        )
        expect(res.status).toBe(202)
      })
    ))
})
