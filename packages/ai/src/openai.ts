import { failureMessage } from '@b2b-saas-starter/failure'
import { Effect, Layer, Option, Redacted, Schema } from 'effect'
import { AiError, LanguageModel, Model, type Response } from 'effect/unstable/ai'
import { ChatMessage, plainChat, unsupportedStream } from './text-model.ts'

// The single platform adapter: any OpenAI-compatible `/chat/completions`
// endpoint, called with one outbound POST. Config resolution happens once,
// here at model construction, so `generateText` never re-reads defaults.

const PROVIDER = 'openai-compatible'

export type OpenAIConfig = {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly modelId?: string
}

const OpenAIFinishReason = Schema.Literals(['stop', 'length', 'content_filter'])

/** Only OpenAI's `content_filter` differs from the response part's spelling. */
function finishReason(
  reason: typeof OpenAIFinishReason.Type | undefined
): Response.FinishPartEncoded['reason'] {
  if (reason === 'content_filter') {
    return 'content-filter'
  }
  if (reason === undefined) {
    return 'stop'
  }
  return reason
}

const OpenAIChatRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(ChatMessage)
})

/** Schema JSON codec for the request body — no hand-rolled `JSON.stringify`. */
const encodeChatRequest = Schema.encodeSync(Schema.fromJsonString(OpenAIChatRequest))

const OpenAIChatResponse = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({
        content: Schema.String.check(Schema.isMinLength(1))
      }),
      finish_reason: Schema.optional(OpenAIFinishReason)
    })
  ).check(Schema.isMinLength(1))
})

const decodeOpenAIChatResponse = Schema.decodeUnknownOption(OpenAIChatResponse)

/**
 * The whole outbound boundary of this package is this one call, wrapped by
 * `Effect.tryPromise` with a typed `AiError` failure at every caller.
 * `packages/ai` deliberately depends on `effect` only, so there is no
 * `@effect/platform` HttpClient to route through; the global `fetch` is
 * confined to this one function.
 */
function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal
) {
  // oxlint-disable-next-line effect/noGlobals -- raw fetch is the platform transport here
  return fetch(url, { method: 'POST', headers, body, signal })
}

/** One `AiError` for this adapter's `generateText` hook, with the module stamped. */
function openAiError(reason: AiError.AiErrorReason) {
  return AiError.make({ module: PROVIDER, method: 'generateText', reason })
}

export function makeOpenAIModel(config: OpenAIConfig) {
  const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
  const modelId = config.modelId ?? 'gpt-4o-mini'
  const chatUrl = `${baseUrl}/chat/completions`
  const headers = {
    authorization: `Bearer ${config.apiKey}`,
    'content-type': 'application/json'
  }
  // The error report carries the same headers with the credential redacted —
  // the request schema's `Redacted` arm exists for exactly this.
  const reportedHeaders = {
    authorization: Redacted.make(config.apiKey),
    'content-type': 'application/json'
  }

  function generateText(options: LanguageModel.ProviderOptions) {
    return Effect.gen(function* () {
      const plain = plainChat(options)
      if ('reason' in plain) {
        return yield* openAiError(plain.reason)
      }
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          postJson(
            chatUrl,
            headers,
            encodeChatRequest({ model: modelId, messages: plain.messages }),
            signal
          ),
        catch: (cause) =>
          openAiError(
            new AiError.NetworkError({
              reason: 'TransportError',
              request: {
                method: 'POST',
                url: chatUrl,
                urlParams: [],
                headers: reportedHeaders
              },
              description: failureMessage(cause)
            })
          )
      })
      if (!response.ok) {
        return yield* openAiError(
          AiError.reasonFromHttpStatus({
            status: response.status,
            description: `status ${response.status}`
          })
        )
      }
      const raw: unknown = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          openAiError(
            new AiError.InvalidOutputError({ description: failureMessage(cause) })
          )
      })
      const body = decodeOpenAIChatResponse(raw)
      if (Option.isNone(body)) {
        return yield* openAiError(
          new AiError.InvalidOutputError({
            description: 'response body does not match the chat shape'
          })
        )
      }
      const first = body.value.choices[0]
      if (first === undefined) {
        return yield* openAiError(
          new AiError.InvalidOutputError({
            description: 'response body carries no choice'
          })
        )
      }
      const parts: Array<Response.PartEncoded> = [
        { type: 'text', text: first.message.content },
        {
          type: 'finish',
          reason: finishReason(first.finish_reason),
          usage: { inputTokens: {}, outputTokens: {} }
        }
      ]
      return parts
    })
  }

  return Model.make(
    PROVIDER,
    modelId,
    Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText,
        streamText: unsupportedStream(PROVIDER)
      })
    )
  )
}
