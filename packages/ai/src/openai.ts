import { Effect, Layer, Option, Schema, Stream } from 'effect'
import { AiError, LanguageModel, Model, type Response } from 'effect/ai'
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse
} from 'effect/http'
import { type ChatMessage, plainChat } from './text-model.ts'
import { providerStreamError, providerTextStream } from './provider-stream.ts'

// The single platform adapter: any OpenAI-compatible `/chat/completions`
// endpoint, called with one outbound POST. Config resolution happens once,
// here at model construction, so `generateText` never re-reads defaults.

const PROVIDER = 'openai-compatible'

export type OpenAIConfig = {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly modelId?: string
  readonly maxOutputTokens?: number
}

type ChatRequest = {
  readonly model: string
  readonly messages: ReadonlyArray<ChatMessage>
  readonly max_tokens: number
  readonly stream?: true
  readonly stream_options?: { readonly include_usage: true }
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
    return 'unknown'
  }
  return reason
}

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

  // Keep the bounded text-only compatible protocol. The official openai v6 SDK
  // supports Workers, but its SSE decoder would replace our strict framing and
  // unsupported-part checks; using its raw response still needs this decoder.
  const request = Effect.fn('OpenAI.request')(
    function* (payload: ChatRequest) {
      const client = yield* HttpClient.HttpClient
      return yield* HttpClient.withScope(client).execute(
        HttpClientRequest.post(chatUrl, { headers }).pipe(
          HttpClientRequest.setBody(
            // oxlint-disable-next-line effect/noGlobals -- selected outbound wire fields
            HttpBody.raw(JSON.stringify(payload), { contentType: 'application/json' })
          )
        )
      )
    },
    Effect.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(
          // Resolve the platform transport per invocation, including test overrides.
          Layer.sync(FetchHttpClient.Fetch, () => globalThis.fetch)
        )
      )
    ),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' })
  )

  function generateText(options: LanguageModel.ProviderOptions) {
    return Effect.gen(function* () {
      const plain = plainChat(options)
      if ('reason' in plain) {
        return yield* openAiError(plain.reason)
      }
      const response = yield* request({
        model: modelId,
        messages: plain.messages,
        max_tokens: config.maxOutputTokens ?? 4096
      }).pipe(
        Effect.mapError(() =>
          openAiError(
            new AiError.NetworkError({
              reason: 'TransportError',
              method: 'POST',
              url: '',
              description: 'Provider connection failed.'
            })
          )
        )
      )
      if (response.status < 200 || response.status >= 300) {
        return yield* openAiError(
          AiError.reasonFromHttpStatus({
            status: response.status,
            description: `status ${response.status}`
          })
        )
      }
      const raw: unknown = yield* response.json.pipe(
        Effect.mapError(() =>
          openAiError(
            new AiError.InvalidOutputError({
              description: 'Provider response is invalid.'
            })
          )
        )
      )
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
    }).pipe(Effect.scoped)
  }

  function streamText(options: LanguageModel.ProviderOptions) {
    return Stream.unwrap(
      Effect.gen(function* () {
        const plain = plainChat(options)
        if ('reason' in plain) {
          return yield* AiError.make({
            module: PROVIDER,
            method: 'streamText',
            reason: plain.reason
          })
        }
        const response = yield* request({
          model: modelId,
          messages: plain.messages,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: config.maxOutputTokens ?? 16_000
        }).pipe(
          Effect.mapError(() =>
            providerStreamError(PROVIDER, 'Provider connection failed.')
          )
        )
        const web = HttpClientResponse.toWeb(response)
        if (
          response.status < 200 ||
          response.status >= 300 ||
          Option.isNone(web) ||
          web.value.body === null
        ) {
          return yield* providerStreamError(
            PROVIDER,
            `Provider refused streaming with status ${response.status}.`
          )
        }
        return providerTextStream(
          web.value.body,
          PROVIDER,
          modelId,
          response.headers['x-request-id']
        )
      })
    )
  }

  return Model.make(
    PROVIDER,
    modelId,
    Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText,
        streamText
      })
    )
  )
}
