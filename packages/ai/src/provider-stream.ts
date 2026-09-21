import { Effect, Schema, Stream } from 'effect'
import { AiError, type Response } from 'effect/unstable/ai'
import { Sse } from 'effect/unstable/encoding'

const TokenCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Usage = Schema.Struct({
  prompt_tokens: Schema.optionalKey(TokenCount),
  completion_tokens: Schema.optionalKey(TokenCount),
  total_tokens: Schema.optionalKey(TokenCount)
})
const Delta = Schema.Struct({
  role: Schema.optionalKey(Schema.Literal('assistant')),
  content: Schema.optionalKey(Schema.NullOr(Schema.String))
})
const Chunk = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  choices: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        delta: Schema.Unknown,
        finish_reason: Schema.optionalKey(
          Schema.NullOr(Schema.Literals(['stop', 'length', 'content_filter']))
        )
      })
    ).check(Schema.isMaxLength(1))
  ),
  response: Schema.optionalKey(Schema.String),
  usage: Schema.optionalKey(Schema.NullOr(Usage)),
  error: Schema.optionalKey(Schema.Unknown)
})

const decodeChunk = Schema.decodeUnknownEffect(Schema.fromJsonString(Chunk))
const decodeDelta = Schema.decodeUnknownEffect(Delta)

export function providerStreamError(provider: string, description: string) {
  return AiError.make({
    module: provider,
    method: 'streamText',
    reason: new AiError.InvalidOutputError({ description })
  })
}

/** Decode both providers' SSE text protocol without retaining raw diagnostics. */
export function providerTextStream(
  body: ReadableStream<Uint8Array>,
  provider: string,
  modelId: string,
  requestId?: string
): Stream.Stream<Response.StreamPartEncoded, AiError.AiError> {
  return Stream.unwrap(
    Effect.sync(() => {
      let reason: Response.FinishReason = 'unknown'
      let usage: Response.FinishPartEncoded['usage'] = {
        inputTokens: {},
        outputTokens: {}
      }
      let done = false
      let ended = false
      const chunks = Stream.fromReadableStream({
        evaluate: () => body,
        onError: () =>
          providerStreamError(provider, 'Provider stream transport failed.')
      }).pipe(
        Stream.decodeText(),
        Stream.pipeThroughChannel(Sse.decode({ maxEventSize: 131_072 })),
        Stream.mapError(() =>
          providerStreamError(provider, 'Provider stream framing is invalid.')
        ),
        Stream.mapEffect(
          Effect.fn('AssistantProvider.decodeChunk')(function* (event) {
            if (event.data === '[DONE]') {
              done = true
              return []
            }
            if (done) {
              return yield* providerStreamError(
                provider,
                'Provider sent data after completion.'
              )
            }
            const chunk = yield* decodeChunk(event.data).pipe(
              Effect.mapError(() =>
                providerStreamError(
                  provider,
                  'Provider sent an unsupported response part.'
                )
              )
            )
            if (chunk.error !== undefined || event.event === 'error') {
              return yield* providerStreamError(
                provider,
                'Provider reported a generation failure.'
              )
            }
            const parts: Array<Response.StreamPartEncoded> = []
            if (chunk.id !== undefined || chunk.model !== undefined) {
              parts.push({
                type: 'response-metadata',
                id: requestId ?? chunk.id,
                modelId: chunk.model ?? modelId
              })
            }
            if (chunk.usage !== undefined && chunk.usage !== null) {
              usage = {
                inputTokens: { total: chunk.usage.prompt_tokens },
                outputTokens: { total: chunk.usage.completion_tokens }
              }
            }
            if (chunk.response !== undefined) {
              if (ended) {
                return yield* providerStreamError(
                  provider,
                  'Provider sent text after the finish reason.'
                )
              }
              parts.push({ type: 'text-delta', id: 'answer', delta: chunk.response })
            }
            const choice = chunk.choices?.[0]
            if (choice !== undefined) {
              const delta = yield* decodeDelta(choice.delta, {
                onExcessProperty: 'error'
              }).pipe(
                Effect.mapError(() =>
                  providerStreamError(
                    provider,
                    'Provider sent unsupported non-text content.'
                  )
                )
              )
              if (
                delta.content !== undefined &&
                delta.content !== null &&
                delta.content !== ''
              ) {
                if (ended) {
                  return yield* providerStreamError(
                    provider,
                    'Provider sent text after the finish reason.'
                  )
                }
                parts.push({ type: 'text-delta', id: 'answer', delta: delta.content })
              }
              if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
                let nextReason: Response.FinishReason
                if (choice.finish_reason === 'content_filter') {
                  nextReason = 'content-filter'
                } else {
                  nextReason = choice.finish_reason
                }
                if (
                  ended &&
                  (nextReason !== reason ||
                    chunk.usage === undefined ||
                    chunk.usage === null)
                ) {
                  return yield* providerStreamError(
                    provider,
                    'Provider sent a conflicting or unsupported terminal update.'
                  )
                }
                // Workers AI's compatible endpoint repeats the terminal reason with cumulative usage.
                ended = true
                reason = nextReason
              }
            }
            if (
              chunk.response === undefined &&
              chunk.choices === undefined &&
              chunk.usage === undefined &&
              chunk.model === undefined &&
              chunk.id === undefined
            ) {
              return yield* providerStreamError(
                provider,
                'Provider sent an unknown response shape.'
              )
            }
            return parts
          })
        ),
        Stream.flatMap(Stream.fromIterable)
      )
      const finish = Stream.unwrap(
        Effect.suspend(() => {
          if (!done) {
            return Effect.fail(
              providerStreamError(provider, 'Provider stream ended without completion.')
            )
          }
          return Effect.succeed(
            Stream.fromIterable([
              { type: 'text-end', id: 'answer' },
              { type: 'finish', reason, usage }
            ] satisfies Array<Response.StreamPartEncoded>)
          )
        })
      )
      return Stream.fromIterable([
        { type: 'response-metadata', modelId, id: requestId },
        { type: 'text-start', id: 'answer' }
      ] satisfies Array<Response.StreamPartEncoded>).pipe(
        Stream.concat(chunks),
        Stream.concat(finish)
      )
    })
  )
}
