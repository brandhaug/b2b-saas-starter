import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { describe, expect, test } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'
import { mcpDiscoveryDocument } from './mcp.ts'
import { readOperations } from './operations.ts'

/**
 * There is no MCP tool table left to mirror: `GET /mcp` and the SDK server are
 * both projected from the shared operation table row by row. What is still
 * worth asserting is that the projection is what ships — one tool per
 * workspace read, in contract order — so a hand-added tool, which would
 * resurrect a surface REST never advertised, has nowhere to hide.
 */
describe('mcp ↔ rest operation mirror', () => {
  test('discovery advertises exactly the shared read operations, in order', () => {
    expect(mcpDiscoveryDocument().tools.map((tool) => tool.name)).toEqual(
      readOperations().map((op) => op.toolName)
    )
  })

  test('every advertised tool names the REST operation it mirrors', () => {
    for (const [index, tool] of mcpDiscoveryDocument().tools.entries()) {
      expect(tool.description).toContain(
        `Mirrors GET /workspaces/{slug}/${readOperations()[index]?.path}.`
      )
    }
  })

  test('list tools advertise the paging input; non-list tools take none', () => {
    const AdvertisedInput = Schema.Struct({
      properties: Schema.Record(Schema.String, Schema.Unknown)
    })
    const decodeAdvertisedInput = Schema.decodeUnknownSync(AdvertisedInput)
    const byName = new Map(
      mcpDiscoveryDocument().tools.map((tool) => [tool.name, tool])
    )
    for (const operation of readOperations()) {
      const tool = byName.get(operation.toolName)
      expect(tool).toBeDefined()
      // Decoded, not asserted: the advertised input is JSON Schema the SDK
      // generated from zod.
      const { properties } = decodeAdvertisedInput(tool?.inputSchema)
      if (operation.paged) {
        // ADR 0057: list tools take the same optional cursor/limit the REST
        // route accepts.
        expect(properties.cursor).toBeDefined()
        expect(properties.limit).toBeDefined()
      } else {
        expect(properties).toEqual({})
      }
    }
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

const MODERN_ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientCapabilities': {}
}

type RpcHeaders = {
  authorization: string
  'content-type': string
  'mcp-method': string
  'mcp-name'?: string
}

function rpc(method: string, params?: Json, name?: string): Request {
  nextId += 1
  const envelopeParams: Record<string, Json> = {}
  if (params !== undefined) {
    Object.assign(envelopeParams, params)
  }
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
  if (name !== undefined) {
    headers['mcp-name'] = name
  }
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
      // oxlint-disable-next-line effect/noTernary -- tests unwrap the protocol's SSE framing before decoding; there is no Effect codec for SSE frames
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

/** The contract's tagged-error body: `{ _tag, ...fields }`, as REST serves it. */
const GuardFailureBody = Schema.Struct({
  _tag: Schema.String,
  message: Schema.String
})

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
        // `tools/list` and the discovery document are both projected from the
        // shared operation table, so both surfaces answer with one list.
        expect(body.result.tools.map((tool) => tool.name)).toEqual(
          readOperations().map((op) => op.toolName)
        )
        expect(mcpDiscoveryDocument().tools).toHaveLength(readOperations().length)
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

  test('tools/call list_notifications honors the paging input like REST', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(
          rpc(
            'tools/call',
            {
              name: 'list_notifications',
              arguments: { limit: 2, cursor: 'not-a-cursor' }
            },
            'list_notifications'
          )
        )
        expect(res.status).toBe(200)
        const body = yield* jsonBody(res, Ok(CallToolResult))
        expect(body.result.isError).not.toBe(true)
        // An undecodable cursor addresses no position — the empty page the
        // REST route serves for the same input.
        expect(body.result.content[0]?.text).toContain('[]')
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

  test('POST /mcp requires a bearer token, and rejects it the way REST does', () =>
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
        // A guard failure is not a JSON-RPC failure: the request never reached
        // the protocol. It is encoded from the contract's own error schema —
        // status from the `httpApiStatus` annotation, body from the schema —
        // so this route answers a rejected request exactly as a REST route
        // does. Asserted against the REST answer rather than a literal, so the
        // two cannot drift apart silently.
        const rest = yield* send(
          new Request('https://api.test/workspaces/acme/members')
        )
        expect(rest.status).toBe(res.status)
        expect(yield* jsonBody(res, GuardFailureBody)).toEqual(
          yield* jsonBody(rest, GuardFailureBody)
        )
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
