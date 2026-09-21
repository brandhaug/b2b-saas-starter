import { failureMessage } from '@b2b-saas-starter/failure'
import { Effect, Layer, Schema, Stream } from 'effect'
import { AiError, LanguageModel, Model, type Response } from 'effect/unstable/ai'
import { type ChatMessage, plainChat } from './text-model.ts'
import { providerStreamError, providerTextStream } from './provider-stream.ts'

// The Cloudflare-first provider: a `LanguageModel` over the Workers AI
// binding. Stateless asks retain their prompt shape; conversation streams send
// role-preserving messages. Stream usage and finish reasons remain unknown when
// the binding does not provide them. Cancelling its reader stops local consumption.

const PROVIDER = 'workers-ai'

export type WorkersAIBinding = {
  readonly run: (
    model: string,
    input: {
      readonly prompt?: string
      readonly messages?: ReadonlyArray<ChatMessage>
      readonly stream?: boolean
      readonly max_tokens?: number
    }
  ) => Promise<
    | { readonly response?: string; readonly finish_reason?: string }
    | ReadableStream<Uint8Array>
    | null
  >
}

const decodeWorkersAnswer = Schema.decodeUnknownEffect(
  Schema.Struct({
    response: Schema.optionalKey(Schema.String),
    finish_reason: Schema.optionalKey(
      Schema.Literals(['stop', 'length', 'content_filter'])
    )
  })
)

/** One `AiError` for this adapter's `generateText` hook, with the module stamped. */
function workersAiError(reason: AiError.AiErrorReason) {
  return AiError.make({ module: PROVIDER, method: 'generateText', reason })
}

/** The binding takes one raw string: the message texts, blank ones dropped. */
function flatPrompt(messages: ReadonlyArray<ChatMessage>): string {
  const parts: Array<string> = []
  for (const message of messages) {
    if (message.content !== '') {
      parts.push(message.content)
    }
  }
  return parts.join('\n\n')
}

/**
 * A `LanguageModel` over the Workers AI binding. Which model answers is a
 * layer decision — this factory only wires the binding into the shared
 * text-only policy.
 */
export function makeWorkersAIModel(
  binding: WorkersAIBinding,
  modelId = '@cf/meta/llama-3.1-8b-instruct',
  maxOutputTokens = 4096
) {
  function generateText(options: LanguageModel.ProviderOptions) {
    return Effect.gen(function* () {
      const plain = plainChat(options)
      if ('reason' in plain) {
        return yield* workersAiError(plain.reason)
      }
      const raw = yield* Effect.tryPromise({
        try: () => {
          if (plain.messages.some((message) => message.role === 'assistant')) {
            return binding.run(modelId, {
              messages: plain.messages,
              max_tokens: maxOutputTokens
            })
          }
          return binding.run(modelId, {
            prompt: flatPrompt(plain.messages),
            max_tokens: maxOutputTokens
          })
        },
        catch: (cause) =>
          workersAiError(
            new AiError.UnknownError({ description: failureMessage(cause) })
          )
      })
      const result = yield* decodeWorkersAnswer(raw).pipe(
        Effect.mapError(() =>
          workersAiError(
            new AiError.InvalidOutputError({ description: 'missing response text' })
          )
        )
      )
      if (!result.response) {
        return yield* workersAiError(
          new AiError.InvalidOutputError({ description: 'missing response text' })
        )
      }
      if (result.finish_reason !== undefined && result.finish_reason !== 'stop') {
        return yield* workersAiError(
          new AiError.InvalidOutputError({
            description: `Assistant answer is incomplete: ${result.finish_reason}.`
          })
        )
      }
      const parts: Array<Response.PartEncoded> = [
        { type: 'text', text: result.response },
        {
          type: 'finish',
          reason: result.finish_reason ?? 'unknown',
          usage: { inputTokens: {}, outputTokens: {} }
        }
      ]
      return parts
    })
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
        const result = yield* Effect.tryPromise({
          try: () =>
            binding.run(modelId, {
              messages: plain.messages,
              stream: true,
              max_tokens: maxOutputTokens
            }),
          catch: () => providerStreamError(PROVIDER, 'Workers AI streaming failed.')
        })
        if (!(result instanceof ReadableStream)) {
          return yield* providerStreamError(
            PROVIDER,
            'Workers AI did not return a response stream.'
          )
        }
        return providerTextStream(result, PROVIDER, modelId)
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
