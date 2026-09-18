import { failureMessage } from '@b2b-saas-starter/failure'
import { Context, Effect, Layer, Schema } from 'effect'
import { LanguageModel, Model, Prompt } from 'effect/unstable/ai'

import { assistantInstructions } from './assistant-instructions.ts'
import { MockAssistantModel } from './mock.ts'
import { selectModel, type ProviderEnv } from './provider-selection.ts'
export { isAssistantConfigured, type ProviderEnv } from './provider-selection.ts'

// The starter assistant on Effect's provider-agnostic `LanguageModel`
// (ADR 0008). This module holds the contract — the prompt/reply
// schemas and the `AssistantService` tag — plus the one `ask` implementation
// and the stateless layer composition. Provider selection lives in provider-selection.ts. The providers themselves are
// `LanguageModel` adapters, one module each: `workers-ai.ts` (the Cloudflare
// binding), `openai.ts` (any OpenAI-compatible chat endpoint), and `mock.ts`
// (the honest no-provider model), all sharing the text-only acceptance
// policy in `text-model.ts`. Which model answers is a layer decision, never
// a branch inside the behavior: each adapter is wrapped in `Model.make`,
// which stamps `ProviderName` and `ModelName` beside the model it provides,
// so the reply's `provider` / `modelId` fields come from the same context as
// the model that answered.

// The provider factories stay part of the package's surface: a deployment
// wires a custom combination the env selector does not know about.
export { type OpenAIConfig, makeOpenAIModel } from './openai.ts'
export { type WorkersAIBinding, makeWorkersAIModel } from './workers-ai.ts'

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class AssistantUnavailable extends Schema.TaggedError<AssistantUnavailable>()(
  'AssistantUnavailable',
  {
    reason: Schema.String
  },
  { httpApiStatus: 503 }
) {}

export const AssistantProvider = Schema.Literals([
  'workers-ai',
  'openai-compatible',
  'mock'
])
export type AssistantProvider = typeof AssistantProvider.Type

export const AssistantPrompt = Schema.Struct({
  workspaceSlug: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  evidence: Schema.optional(Schema.String.check(Schema.isMaxLength(6000)))
})
export type AssistantPrompt = typeof AssistantPrompt.Type

export const AssistantReply = Schema.Struct({
  answer: Schema.String,
  provider: AssistantProvider,
  modelId: Schema.String,
  usedTools: Schema.Array(Schema.String)
})
export type AssistantReply = typeof AssistantReply.Type

type AssistantInterface = {
  readonly ask: (
    prompt: AssistantPrompt
  ) => Effect.Effect<AssistantReply, AssistantUnavailable>
}

export class AssistantService extends Context.Service<
  AssistantService,
  AssistantInterface
>()('@b2b-saas-starter/ai/AssistantService') {}

const decodeAssistantPrompt = Schema.decodeUnknownEffect(AssistantPrompt)

const isAssistantProvider = Schema.is(AssistantProvider)

/**
 * The one `ask` implementation. `AiError` is the adapters' error channel;
 * this is the one boundary that maps it — into the `AssistantUnavailable`
 * the HTTP contract declares. Tools are off (`toolChoice: 'none'` and every
 * adapter refuses them), so `usedTools` is honestly empty until they land.
 */
export const AssistantLive = Layer.effect(AssistantService)(
  Effect.gen(function* () {
    const model = yield* LanguageModel.LanguageModel
    const providerName = yield* Model.ProviderName
    const modelId = yield* Model.ModelName

    const ask = Effect.fn('AssistantService.ask')(function* (prompt: AssistantPrompt) {
      yield* decodeAssistantPrompt(prompt).pipe(
        Effect.mapError(
          () =>
            new AssistantUnavailable({
              reason: 'Assistant input exceeds the supported bounds.'
            })
        )
      )
      // The provider names in context are ours — but they cross a context
      // boundary as plain strings, so the reply's literal-union field is
      // guarded here rather than trusted.
      if (!isAssistantProvider(providerName)) {
        return yield* new AssistantUnavailable({
          reason: `unknown assistant provider: ${providerName}`
        })
      }
      const messages: Array<{
        readonly role: 'system' | 'user'
        readonly content: string
      }> = [
        {
          role: 'system',
          content: assistantInstructions(prompt.workspaceSlug)
        }
      ]
      if (prompt.evidence !== undefined) {
        messages.push({ role: 'user', content: prompt.evidence })
      }
      messages.push({ role: 'user', content: prompt.question })
      const response = yield* model
        .generateText({
          prompt: Prompt.make(messages),
          toolChoice: 'none'
        })
        .pipe(
          Effect.mapError(
            (error) => new AssistantUnavailable({ reason: failureMessage(error) })
          ),
          Effect.timeoutOrElse({
            duration: '60 seconds',
            orElse: () =>
              Effect.fail(
                new AssistantUnavailable({
                  reason: 'Assistant inference deadline exceeded.'
                })
              )
          })
        )
      if (response.finishReason !== 'stop' && response.finishReason !== 'unknown') {
        return yield* new AssistantUnavailable({
          reason: `Assistant answer is incomplete: ${response.finishReason}.`
        })
      }
      return AssistantReply.make({
        answer: response.text,
        provider: providerName,
        modelId,
        usedTools: []
      })
    })

    return AssistantService.of({ ask })
  })
)

/** The assistant wired to whichever model the env selected — the mock when nothing is. */
export function selectAssistantLayer(env: ProviderEnv): Layer.Layer<AssistantService> {
  return AssistantLive.pipe(Layer.provide(selectModel(env)))
}

/** `AssistantLive` on the mock model — the layer an unconfigured env selects. */
export const MockAssistantLayer: Layer.Layer<AssistantService> = AssistantLive.pipe(
  Layer.provide(MockAssistantModel)
)

export {
  ConversationModel,
  ConversationModelEvent,
  ConversationModelFailure,
  ConversationModelUnavailable,
  selectConversationModelLayer,
  MockConversationModelLayer
} from './conversation.ts'
export {
  ConversationEvidence,
  ConversationPrompt,
  PreparedConversationPrompt,
  ConversationModelLimits,
  ConversationInputRejected
} from './conversation-context.ts'
