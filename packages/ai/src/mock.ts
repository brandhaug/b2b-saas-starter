import { Effect, Layer, Stream } from 'effect'
import { AiError, LanguageModel, Model, type Response } from 'effect/unstable/ai'
import { plainChat } from './text-model.ts'

// The honest no-provider model: it echoes the question and names the env vars
// that would enable a real provider. It holds to the same text-only
// acceptance policy as the real adapters, so `AssistantLive` cannot tell it
// apart.

const PROVIDER = 'mock'

function mockError(reason: AiError.AiErrorReason) {
  return AiError.make({ module: PROVIDER, method: 'generateText', reason })
}

export const MockAssistantModel = Model.make(
  PROVIDER,
  'starter-mock',
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (options) =>
        Effect.gen(function* () {
          const plain = plainChat(options)
          if ('reason' in plain) {
            return yield* mockError(plain.reason)
          }
          const question =
            plain.messages.findLast((message) => message.role === 'user')?.content ?? ''
          const parts: Array<Response.PartEncoded> = [
            {
              type: 'text',
              text: `Mock assistant: "${question}". Configure WORKERS_AI_ENABLED=true or OPENAI_API_KEY to enable a real provider.`
            },
            {
              type: 'finish',
              reason: 'stop',
              usage: { inputTokens: {}, outputTokens: {} }
            }
          ]
          return parts
        }),
      streamText: (options) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const plain = plainChat(options)
            if ('reason' in plain) {
              return yield* mockError(plain.reason)
            }
            const question =
              plain.messages.findLast((message) => message.role === 'user')?.content ??
              ''
            return Stream.fromIterable([
              { type: 'text-start', id: 'answer' },
              {
                type: 'text-delta',
                id: 'answer',
                delta: `Demo assistant: "${question}". This isolated conversation uses synthetic data. Approval and replay remain explicit application actions.`
              },
              { type: 'text-end', id: 'answer' },
              {
                type: 'finish',
                reason: 'stop',
                usage: { inputTokens: {}, outputTokens: {} }
              }
            ] satisfies Array<Response.StreamPartEncoded>)
          })
        )
    })
  )
)
