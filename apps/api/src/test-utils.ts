import { Effect, Schema, Stream } from 'effect'
import { Sse } from 'effect/encoding'
import { expect } from 'vite-plus/test'

const decodeJsonObject = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.JsonObject)
)

/**
 * Shared helpers for the API worker's protocol-driving tests. Imported by
 * `*.test.ts` only — nothing in the worker itself reaches for this module.
 */

/** Decode one JSON-RPC response, allowing SSE notifications before it. */
export function jsonBody<S extends Schema.Top>(response: Response, schema: S) {
  return Effect.gen(function* () {
    const text = yield* Effect.promise(() => response.text())
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text)
    }
    const responses = yield* Stream.make(text).pipe(
      Stream.pipeThroughChannel(Sse.decode()),
      Stream.mapEffect((event) => decodeJsonObject(event.data)),
      Stream.filter(
        (message) => 'id' in message && ('result' in message || 'error' in message)
      ),
      Stream.runCollect
    )
    expect(responses).toHaveLength(1)
    return yield* Schema.decodeUnknownEffect(schema)(responses[0])
  })
}

/**
 * The streamable-HTTP MCP session a stock client opens against the worker:
 * one `initialize` exchange (which mints the `mcp-session-id` the transport
 * requires on every later request), then JSON-RPC request/response over
 * per-request POSTs carrying the session and protocol-version headers. Plain
 * promise chains, not Effect: this is wire driving, not behavior under test.
 */
export function mcpClient(
  handler: (request: Request) => Promise<Response>,
  authorization: string,
  origin = 'https://api.test'
) {
  let nextId = 0
  let sessionId: string | undefined

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the client writes raw JSON-RPC envelopes; it is the wire format's encoder, and the server under test is the decoder
  function send(method: string, payload: unknown): Promise<Response> {
    const headers = new Headers({
      authorization,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    })
    if (sessionId !== undefined) {
      headers.set('mcp-session-id', sessionId)
      headers.set('mcp-protocol-version', '2025-11-25')
    }
    return handler(
      new Request(`${origin}/mcp`, {
        method: 'POST',
        headers,
        // oxlint-disable-next-line effect/noGlobals -- the client is the wire format's encoder
        body: JSON.stringify(payload)
      })
    )
  }

  return {
    initialize() {
      nextId += 1
      return send('initialize', {
        jsonrpc: '2.0',
        id: nextId,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      }).then((response) => {
        const issued = response.headers.get('mcp-session-id')
        if (response.status !== 200 || issued === null) {
          // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- a failed initialize fails the test through the promise rejection; there is no caller left to model an error channel for
          throw new Error(
            `initialize failed: ${response.status} ${issued ?? 'no session id'}`
          )
        }
        sessionId = issued
        return { sessionId: issued }
      })
    },
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- raw JSON-RPC params, encoded onto the wire one line below
    rpc(method: string, params?: unknown) {
      nextId += 1
      if (params === undefined) {
        return send(method, { jsonrpc: '2.0', id: nextId, method })
      }
      return send(method, { jsonrpc: '2.0', id: nextId, method, params })
    },
    notify(method: string) {
      return send(method, { jsonrpc: '2.0', method })
    }
  }
}
