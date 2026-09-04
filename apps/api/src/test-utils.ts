import { Effect, Schema } from 'effect'

/**
 * Shared helpers for the API worker's protocol-driving tests. Imported by
 * `*.test.ts` only — nothing in the worker itself reaches for this module.
 */

/**
 * Decodes a response body at the boundary, unwrapping SSE framing first: the
 * streamable-HTTP protocol may answer a single request with an SSE body, so
 * the `data:` frame comes off before decoding. Same decode-at-the-boundary
 * idea as `index.test.ts`.
 */
export function jsonBody<S extends Schema.Top>(response: Response, schema: S) {
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
      // oxlint-disable-next-line effect/noGlobals -- decoding the wire format these tests assert on
      return Effect.try(() => JSON.parse(raw))
    }),
    // A decode failure fails the test through runPromise's rejection; there
    // is no caller that could recover from a malformed protocol response.
    Effect.flatMap((raw) => Schema.decodeUnknownEffect(schema)(raw))
  )
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
  authorization: string
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
      new Request('https://api.test/mcp', {
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
