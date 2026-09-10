import { Effect, Stream } from 'effect'
import { type HttpClientResponse } from 'effect/unstable/http'

/** Stop pulling after a bounded prefix, including when the receiver streams forever. */
export const readWebhookResponse = Effect.fn('Webhooks.readResponse')(function* (
  response: HttpClientResponse.HttpClientResponse
) {
  const limit = 2048
  const chunks = yield* response.stream.pipe(
    Stream.filter((chunk) => chunk.length > 0),
    Stream.mapAccum(
      () => 0,
      (read, chunk) => {
        const bytes = chunk.slice(0, Math.max(0, limit + 1 - read))
        const next = read + bytes.length
        return [next, [{ bytes, full: next > limit }]]
      }
    ),
    Stream.takeUntil((chunk) => chunk.full),
    Stream.runCollect,
    Effect.timeout('2 seconds')
  )
  const bytes = new Uint8Array(
    chunks.reduce((size, chunk) => size + chunk.bytes.length, 0)
  )
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk.bytes, offset)
    offset += chunk.bytes.length
  }
  const text = new TextDecoder().decode(bytes.slice(0, limit))
  if (bytes.length > limit) {
    return `${text}… [truncated]`
  }
  return text
})
