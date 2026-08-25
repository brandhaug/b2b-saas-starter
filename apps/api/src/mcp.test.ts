import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { describe, expect, test } from 'vitest'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'
import { mcpDiscoveryDocument, mcpTools } from './mcp.ts'
import { readOperations } from './operations.ts'

/**
 * The MCP tool table must stay a projection of the shared operation table:
 * one tool per workspace read, same permission. A hand-added tool would
 * resurrect a surface REST never advertised; this fails until it is either
 * derived again or deliberately given a row of its own.
 */
describe('mcp ↔ rest operation mirror', () => {
  test('tools are exactly the shared read operations, in order', () => {
    expect(mcpTools.map((tool) => tool.descriptor.name)).toEqual(
      readOperations().map((op) => op.toolName)
    )
    expect(mcpTools.map((tool) => tool.permission)).toEqual(
      readOperations().map((op) => op.permission)
    )
  })

  test('discovery advertises exactly those tools', () => {
    const doc = mcpDiscoveryDocument()
    expect(doc.tools.map((tool) => tool.name)).toEqual(
      readOperations().map((op) => op.toolName)
    )
  })
})

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

/**
 * The server runs strict stateless-only (`legacy: 'reject'`), so requests
 * must speak the 2026-07-28 modern protocol revision, exactly what a stock
 * MCP SDK v2 client sends:
 *
 * - a per-request `_meta` envelope naming the protocol version and the
 *   client capabilities (no session, no handshake), and
 * - the reserved cross-check headers: `Mcp-Method` always, plus `Mcp-Name`
 *   whenever the params carry a `name`/`uri`.
 */
const MODERN_PROTOCOL_VERSION = '2026-07-28'

// oxlint-disable eslint/no-underscore-dangle -- `_meta` is the protocol's own reserved key
const MODERN_ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientCapabilities': {}
}
// oxlint-enable eslint/no-underscore-dangle

type RpcHeaders = {
  authorization: string
  'content-type': string
  'mcp-method': string
  'mcp-name'?: string
}

function rpc(method: string, params?: Json, name?: string): Request {
  nextId += 1
  const envelopeParams: Record<string, Json> = {}
  if (params !== undefined) Object.assign(envelopeParams, params)
  // oxlint-disable-next-line eslint/no-underscore-dangle -- protocol-reserved key
  envelopeParams._meta = MODERN_ENVELOPE
  const envelope: JsonRpcWireRequest = {
    jsonrpc: '2.0',
    id: nextId,
    method,
    params: envelopeParams
  }
  const headers: RpcHeaders = {
    authorization: bearer.authorization,
    'content-type': bearer['content-type'],
    'mcp-method': method
  }
  // The handler rejects a modern request whose Mcp-Name header disagrees
  // with (or is missing next to) params.name / params.uri.
  if (name !== undefined) headers['mcp-name'] = name
  return new Request('https://api.test/mcp', {
    method: 'POST',
    headers,
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

const RpcErrorBody = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: Schema.NullOr(Schema.Unknown),
  error: Schema.Struct({ code: Schema.Number, message: Schema.String })
})

describe('POST /mcp protocol', () => {
  test('the modern era has no handshake: an initialize is answered method-not-found', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        // Identity, version, and capabilities travel with every request's
        // envelope — there is nothing for an initialize to negotiate.
        const res = yield* send(
          rpc('initialize', {
            protocolVersion: MODERN_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'stock-client', version: '1.0.0' }
          })
        )
        // The SDK maps the modern method-not-found to an HTTP 404 carrying
        // the JSON-RPC error.
        expect(res.status).toBe(404)
        const body = yield* jsonBody(res, RpcErrorBody)
        expect(body.error.code).toBe(-32_601)
      })
    ))

  test('a legacy-style initialize without the envelope claim is rejected', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        // Strict stateless-only posture: the 2025-era handshake gets the
        // unsupported-protocol-version error naming what the endpoint serves,
        // so a legacy client learns the answer from the rejection alone.
        const res = yield* send(
          new Request('https://api.test/mcp', {
            method: 'POST',
            headers: bearer,
            body: encodeJsonBody({
              jsonrpc: '2.0',
              id: 99,
              method: 'initialize',
              params: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'legacy-client', version: '1.0.0' }
              }
            })
          })
        )
        expect(res.status).toBe(400)
        const body = yield* jsonBody(res, RpcErrorBody)
        expect(body.error.code).toBe(-32_022)
        expect(body.error.message).toContain('2025-11-25')
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
          rpc(
            'tools/call',
            { name: 'list_notifications', arguments: {} },
            'list_notifications'
          )
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
        const res = yield* send(
          rpc('resources/read', { uri: 'workspace://overview' }, 'workspace://overview')
        )
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
