import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { describe, expect, test } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'
import { PAGED_TOOL_INPUT, mcpDiscoveryDocument } from './mcp.ts'
import { mirroredRestPath, readOperations } from './operations.ts'
import { jsonBody, mcpClient } from './test-utils.ts'

/**
 * There is no MCP tool table left to mirror: the discovery document and the
 * protocol's own tools are both projected from the shared operation table row
 * by row. What is still worth asserting is that the projection is what ships
 * — one tool per workspace read, in contract order — so a hand-added tool,
 * which would resurrect a surface REST never advertised, has nowhere to hide.
 */
describe('mcp ↔ rest operation mirror', () => {
  test('discovery advertises exactly the shared read operations, in order', () => {
    expect(mcpDiscoveryDocument().tools.map((tool) => tool.name)).toEqual(
      readOperations().map((op) => op.toolName)
    )
  })

  test('every advertised tool names the REST operation it mirrors', () => {
    for (const [index, operation] of readOperations().entries()) {
      const tool = mcpDiscoveryDocument().tools[index]
      expect(tool?.description).toContain(
        `Mirrors GET /${mirroredRestPath(operation.path)}.`
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
      // Decoded, not asserted: the advertised input is JSON Schema generated
      // from the registered Effect schema.
      const { properties } = decodeAdvertisedInput(tool?.inputSchema)
      if (operation.param === undefined) {
        if (operation.paged) {
          // ADR 0057: list tools take the same optional cursor/limit the REST
          // route accepts.
          expect(properties.cursor).toBeDefined()
          expect(properties.limit).toBeDefined()
        } else {
          expect(properties).toEqual({})
        }
      } else {
        // The one parameterized read takes exactly its declared path
        // parameter, nothing else.
        expect(Object.keys(properties)).toEqual(['endpointId'])
      }
    }
  })

  test('the paged tool input names the same paging vocabulary as the REST query', () => {
    // `ListPageQuery` (packages/api) owns this vocabulary for REST — optional
    // `cursor` string, optional `limit` number (ADR 0057). Pinning the Effect
    // schema's advertised shape here keeps the two surfaces from drifting on
    // field names, types, or optionality; the one known behavioral edge (an
    // undecodable `limit`) is documented on both declarations.
    const { schema } = Schema.toJsonSchemaDocument(PAGED_TOOL_INPUT)
    expect(schema.properties).toEqual({
      cursor: { type: 'string' },
      limit: { type: 'number' }
    })
    expect(schema.required).toBeUndefined()
  })
})

/**
 * The MCP protocol surface at `POST /mcp`, driven as a stock streamable-HTTP
 * client would drive it: initialize once (the transport mints a session),
 * ack it, then one JSON-RPC message per POST with a bearer token and the
 * session's headers.
 *
 * The authz rows matter as much as the happy paths — every tool re-checks its
 * own permission against the token's scopes inside the tool handler, so a
 * scope-to-permission drift flips a `tools/call` result without ever touching
 * the HTTP status code. Response bodies are decoded through schemas at the
 * boundary rather than cast, mirroring `index.test.ts`.
 */

/** One web handler for the whole file: the transport's sessions live in it. */
const handler = buildWebHandler({}).handler

const bearer = {
  authorization: `Bearer ${SEED_API_TOKEN}`,
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream'
}

const encodeJsonBody = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

function send(request: Request): Effect.Effect<Response> {
  return Effect.promise(() => handler(request))
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
const InitializeResult = Schema.Struct({
  protocolVersion: Schema.Literal('2025-11-25'),
  serverInfo: Schema.Struct({ name: Schema.String })
})

// The JSON-Schema side of the paging-input equivalence with the contract's
// `ListPageQuery` is asserted in the operation-mirror describe above; the
// SSE-unwrap decode itself lives in `test-utils.ts`.

/** The contract's tagged-error body: `{ _tag, ...fields }`, as REST serves it. */
const GuardFailureBody = Schema.Struct({
  _tag: Schema.String,
  message: Schema.String
})

describe('POST /mcp protocol', () => {
  test('a session-initialized client lists tools and calls them', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = mcpClient(handler, bearer.authorization)
        yield* Effect.promise(() => client.initialize())

        const listed = yield* Effect.promise(() => client.rpc('tools/list', {}))
        expect(listed.status).toBe(200)
        const body = yield* jsonBody(listed, Ok(ToolListResult))
        // `tools/list` and the discovery document are both projected from the
        // shared operation table, so both surfaces answer with one list.
        expect(body.result.tools.map((tool) => tool.name)).toEqual(
          readOperations().map((op) => op.toolName)
        )
        expect(mcpDiscoveryDocument().tools).toHaveLength(readOperations().length)

        const called = yield* Effect.promise(() =>
          client.rpc('tools/call', {
            name: 'list_notifications',
            arguments: {}
          })
        )
        expect(called.status).toBe(200)
        const result = yield* jsonBody(called, Ok(CallToolResult))
        expect(result.result.isError).not.toBe(true)
        expect(result.result.content[0]?.text).toContain('not_email')
      })
    ))

  test('initialize answers an unknown offered revision with the served one', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = mcpClient(handler, bearer.authorization)
        const res = yield* Effect.promise(() =>
          client.rpc('initialize', {
            protocolVersion: '2026-07-28',
            capabilities: {},
            clientInfo: { name: 'client-from-the-future', version: '1.0.0' }
          })
        )
        expect(res.status).toBe(200)
        const body = yield* jsonBody(res, Ok(InitializeResult))
        expect(body.result.serverInfo.name).toBe('b2b-saas-starter-mcp')
      })
    ))

  test('a request without a session is refused, not served statelessly', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(
          new Request('https://api.test/mcp', {
            method: 'POST',
            headers: bearer,
            body: encodeJsonBody({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
          })
        )
        // The transport is sessionful: only initialize opens a session, and
        // everything else must carry the one it minted.
        expect(res.status).toBe(400)
      })
    ))

  test('tools/call list_notifications honors the paging input like REST', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = mcpClient(handler, bearer.authorization)
        yield* Effect.promise(() => client.initialize())
        const res = yield* Effect.promise(() =>
          client.rpc('tools/call', {
            name: 'list_notifications',
            arguments: { limit: 2, cursor: 'not-a-cursor' }
          })
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
        const client = mcpClient(handler, bearer.authorization)
        yield* Effect.promise(() => client.initialize())
        const res = yield* Effect.promise(() =>
          client.rpc('resources/read', { uri: 'workspace://overview' })
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
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream'
            },
            body: encodeJsonBody({ jsonrpc: '2.0', id: 1, method: 'initialize' })
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
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream'
            },
            body: encodeJsonBody({ jsonrpc: '2.0', id: 1, method: 'initialize' })
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
        // The transport carries the protocol error in a well-formed JSON-RPC
        // body rather than an HTTP error status.
        expect(res.status).toBe(200)
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
        const client = mcpClient(handler, bearer.authorization)
        yield* Effect.promise(() => client.initialize())
        const res = yield* Effect.promise(() =>
          client.notify('notifications/initialized')
        )
        expect(res.status).toBe(202)
      })
    ))
})
