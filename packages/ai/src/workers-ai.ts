import { failureMessage } from '@b2b-saas-starter/failure'
import { Effect, Layer } from 'effect'
import { AiError, LanguageModel, Model, type Response } from 'effect/unstable/ai'
import { type ChatMessage, plainChat, unsupportedStream } from './text-model.ts'

// The Cloudflare-first provider: a `LanguageModel` over the Workers AI
// binding, which takes one raw prompt string and returns bare text. The
// binding reports no finish reason or token usage, so the finish part claims
// only `stop` with empty usage.

const PROVIDER = 'workers-ai'

export type WorkersAIBinding = {
  readonly run: (
    model: string,
    input: { readonly prompt: string }
  ) => Promise<{ readonly response?: string }>
}

/** One `AiError` for this adapter's `generateText` hook, with the module stamped. */
function workersAiError(reason: AiError.AiErrorReason) {
  return AiError.make({ module: PROVIDER, method: 'generateText', reason })
}

/** The binding takes one raw string: the message texts, blank ones dropped. */
function flatPrompt(messages: ReadonlyArray<ChatMessage>): string {
  const chunks: Array<string> = []
  for (const message of messages) {
    if (message.content !== '') {
      chunks.push(message.content)
    }
  }
  return chunks.join('\n\n')
}

/**
 * A `LanguageModel` over the Workers AI binding. Which model answers is a
 * layer decision — this factory only wires the binding into the shared
 * text-only policy.
 */
export function makeWorkersAIModel(
  binding: WorkersAIBinding,
  modelId = '@cf/meta/llama-3.1-8b-instruct'
) {
  function generateText(options: LanguageModel.ProviderOptions) {
    return Effect.gen(function* () {
      const plain = plainChat(options)
      if ('reason' in plain) {
        return yield* workersAiError(plain.reason)
      }
      const result = yield* Effect.tryPromise({
        try: () => binding.run(modelId, { prompt: flatPrompt(plain.messages) }),
        catch: (cause) =>
          workersAiError(
            new AiError.UnknownError({ description: failureMessage(cause) })
          )
      })
      if (!result.response) {
        return yield* workersAiError(
          new AiError.InvalidOutputError({ description: 'missing response text' })
        )
      }
      const parts: Array<Response.PartEncoded> = [
        { type: 'text', text: result.response },
        {
          type: 'finish',
          reason: 'stop',
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
