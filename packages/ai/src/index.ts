import { type Writable } from '@b2b-saas-starter/config/writable'
import { hasValue, type ProviderEnvOf } from '@b2b-saas-starter/env/server'
import { failureMessage } from '@b2b-saas-starter/failure'
import { Context, Effect, Layer, Schema } from 'effect'
import { LanguageModel, Model, Prompt } from 'effect/unstable/ai'

import { MockAssistantModel } from './mock.ts'
import { type OpenAIConfig, makeOpenAIModel } from './openai.ts'
import { type WorkersAIBinding, makeWorkersAIModel } from './workers-ai.ts'

// The starter assistant on Effect's provider-agnostic `LanguageModel`
// (ADR 0008, 0071). This module holds the contract — the prompt/reply
// schemas and the `AssistantService` tag — plus the one `ask` implementation
// and the env-driven provider selection. The providers themselves are
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
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000))
})
export type AssistantPrompt = typeof AssistantPrompt.Type

export const AssistantReply = Schema.Struct({
  answer: Schema.String,
  provider: AssistantProvider,
  modelId: Schema.String,
  usedTools: Schema.Array(Schema.String)
})
export type AssistantReply = typeof AssistantReply.Type

export type AssistantInterface = {
  readonly ask: (
    prompt: AssistantPrompt
  ) => Effect.Effect<AssistantReply, AssistantUnavailable>
}

export class AssistantService extends Context.Service<
  AssistantService,
  AssistantInterface
>()('@b2b-saas-starter/ai/AssistantService') {}

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
      // The provider names in context are ours — but they cross a context
      // boundary as plain strings, so the reply's literal-union field is
      // guarded here rather than trusted.
      if (!isAssistantProvider(providerName)) {
        return yield* new AssistantUnavailable({
          reason: `unknown assistant provider: ${providerName}`
        })
      }
      const response = yield* model
        .generateText({
          prompt: Prompt.make([
            {
              role: 'system',
              content: `You are the B2B SaaS Starter assistant for workspace ${prompt.workspaceSlug}.`
            },
            { role: 'user', content: prompt.question }
          ]),
          toolChoice: 'none'
        })
        .pipe(
          Effect.mapError(
            (error) => new AssistantUnavailable({ reason: failureMessage(error) })
          )
        )
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

// --- Selection -------------------------------------------------------------------

/**
 * The assistant's slice of the worker env. Keys are `Pick`ed from
 * `ServerEnv` so the schema stays the single source of truth, and each is
 * `| undefined` so a caller may pass the whole worker env through — an
 * explicitly-undefined key is legal here and means exactly what an absent one
 * means: unconfigured. (Same shape as `EmailDispatcherEnv` in
 * `packages/email`.) A worker env may also deliver `null` for a
 * present-but-null binding; every read below is a truthiness check, so null
 * reads as unconfigured too.
 */
export type ProviderEnv = ProviderEnvOf<
  'WORKERS_AI_ENABLED' | 'OPENAI_API_KEY' | 'OPENAI_BASE_URL' | 'OPENAI_MODEL_ID'
> & {
  readonly AI?: WorkersAIBinding | undefined
}

/**
 * The one place that decides which provider a deployment configured.
 * `selectModel` builds the `Model` layer for the choice (a `LanguageModel`
 * plus its `ProviderName` / `ModelName` stamps), `selectAssistantLayer`
 * composes it under `AssistantLive`, and `isAssistantConfigured` asks whether
 * the choice is a real provider — so the condition ("Workers AI with its
 * binding, or an OpenAI key") is stated once and the UI's "not enabled" copy
 * can never disagree with the ask path.
 */
type ProviderChoice =
  | { readonly provider: 'workers-ai'; readonly binding: WorkersAIBinding }
  | { readonly provider: 'openai-compatible'; readonly config: OpenAIConfig }
  | { readonly provider: 'mock' }

function selectProvider(env: ProviderEnv): ProviderChoice {
  if (env.WORKERS_AI_ENABLED === 'true' && env.AI) {
    return { provider: 'workers-ai', binding: env.AI }
  }
  if (hasValue(env.OPENAI_API_KEY)) {
    // Assigned only when set so the layer's own defaults (api.openai.com,
    // gpt-4o-mini) still apply for absent vars.
    const config: Writable<OpenAIConfig> = { apiKey: env.OPENAI_API_KEY }
    if (hasValue(env.OPENAI_BASE_URL)) {
      config.baseUrl = env.OPENAI_BASE_URL
    }
    if (hasValue(env.OPENAI_MODEL_ID)) {
      config.modelId = env.OPENAI_MODEL_ID
    }
    return { provider: 'openai-compatible', config }
  }
  return { provider: 'mock' }
}

function selectModel(
  env: ProviderEnv
): Layer.Layer<LanguageModel.LanguageModel | Model.ProviderName | Model.ModelName> {
  const choice = selectProvider(env)
  switch (choice.provider) {
    case 'workers-ai': {
      return makeWorkersAIModel(choice.binding)
    }
    case 'openai-compatible': {
      return makeOpenAIModel(choice.config)
    }
    case 'mock': {
      return MockAssistantModel
    }
  }
}

/** The assistant wired to whichever model the env selected — the mock when nothing is. */
export function selectAssistantLayer(env: ProviderEnv): Layer.Layer<AssistantService> {
  return AssistantLive.pipe(Layer.provide(selectModel(env)))
}

/** `AssistantLive` on the mock model — the layer an unconfigured env selects. */
export const MockAssistantLayer: Layer.Layer<AssistantService> = AssistantLive.pipe(
  Layer.provide(MockAssistantModel)
)

/** Whether a real provider is configured — the mock does not count. */
export function isAssistantConfigured(env: ProviderEnv): boolean {
  return selectProvider(env).provider !== 'mock'
}
