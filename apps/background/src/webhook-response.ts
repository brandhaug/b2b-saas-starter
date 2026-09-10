import { Effect, Stream } from 'effect'
import { type HttpClientResponse } from 'effect/unstable/http'

/** Stop pulling after a bounded prefix, including when the receiver streams forever. */
export const readWebhookResponse = Effect.fn('Webhooks.readResponse')(function* (
  response: HttpClientResponse.HttpClientResponse
) {
  const limit = 2048
  const text = yield* response.stream.pipe(
    Stream.decodeText(),
    Stream.scan('', (read, chunk) => read + chunk),
    Stream.takeUntil((read) => read.length > limit),
    // The scan already carries every prefix, so the fold keeps the last one.
    Stream.runFold(
      () => '',
      (_previous, read) => read
    ),
    Effect.timeout('2 seconds')
  )
  if (text.length > limit) {
    return `${text.slice(0, limit)}… [truncated]`
  }
  return text
})
