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
export function jsonBody<S extends Schema.Top>(
  response: Response,
  schema: S
): Effect.Effect<S['Type'], Schema.ParseError, S['DecodingServices']> {
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
