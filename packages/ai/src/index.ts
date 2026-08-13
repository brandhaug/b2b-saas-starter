import { Context, Effect, Layer, Schema } from 'effect'

export class AssistantUnavailable extends Schema.TaggedErrorClass<AssistantUnavailable>()(
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

export type AssistantShape = {
  readonly ask: (
    prompt: AssistantPrompt
  ) => Effect.Effect<AssistantReply, AssistantUnavailable>
}

export class AssistantService extends Context.Service<
  AssistantService,
  AssistantShape
>()('@b2b-saas-starter/ai/AssistantService') {}

export const MockAssistantLayer = Layer.succeed(AssistantService)({
  ask: (prompt) =>
    Effect.succeed({
      answer: `Mock assistant: "${prompt.question}" for workspace ${prompt.workspaceSlug}. Configure WORKERS_AI_ENABLED=true or OPENAI_API_KEY to enable a real provider.`,
      provider: 'mock' as const,
      modelId: 'starter-mock',
      usedTools: []
    })
})

export type WorkersAIBinding = {
  readonly run: (
    model: string,
    input: { readonly prompt: string }
  ) => Promise<{ readonly response?: string }>
}

export const makeWorkersAILayer = (
  binding: WorkersAIBinding,
  modelId = '@cf/meta/llama-3.1-8b-instruct'
) =>
  Layer.succeed(AssistantService)({
    ask: (prompt) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            binding.run(modelId, {
              prompt: `Workspace: ${prompt.workspaceSlug}\nQuestion: ${prompt.question}\nAnswer:`
            }),
          catch: (cause) =>
            new AssistantUnavailable({ reason: `workers-ai: ${String(cause)}` })
        })
        if (!result.response) {
          return yield* Effect.fail(
            new AssistantUnavailable({ reason: 'workers-ai: missing response' })
          )
        }
        return {
          answer: result.response,
          provider: 'workers-ai' as const,
          modelId,
          usedTools: []
        }
      })
  })

export type OpenAIConfig = {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly modelId?: string
}

const OpenAIChatResponse = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({
        content: Schema.String.check(Schema.isMinLength(1))
      })
    })
  ).check(Schema.isMinLength(1))
})

/**
 * The single platform adapter in this package: one outbound HTTP POST against
 * an OpenAI-compatible endpoint. `packages/ai` deliberately depends on `effect`
 * only, so there is no `@effect/platform` HttpClient to route through; the
 * global `fetch` is confined to this one function and every caller wraps it in
 * `Effect.tryPromise` with a tagged `AssistantUnavailable` failure.
 */
const postJson = (url: string, headers: Record<string, string>, body: string) =>
  fetch(url, { method: 'POST', headers, body })

export const makeOpenAILayer = (config: OpenAIConfig) =>
  Layer.succeed(AssistantService)({
    ask: (prompt) =>
      Effect.gen(function* () {
        const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
        const modelId = config.modelId ?? 'gpt-4o-mini'
        const response = yield* Effect.tryPromise({
          try: () =>
            postJson(
              `${baseUrl}/chat/completions`,
              {
                authorization: `Bearer ${config.apiKey}`,
                'content-type': 'application/json'
              },
              JSON.stringify({
                model: modelId,
                messages: [
                  {
                    role: 'system',
                    content: `You are the B2B SaaS Starter assistant for workspace ${prompt.workspaceSlug}.`
                  },
                  { role: 'user', content: prompt.question }
                ]
              })
            ),
          catch: (cause) =>
            new AssistantUnavailable({ reason: `openai: ${String(cause)}` })
        })
        if (!response.ok) {
          return yield* Effect.fail(
            new AssistantUnavailable({ reason: `openai: status ${response.status}` })
          )
        }
        const raw: unknown = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (cause) =>
            new AssistantUnavailable({ reason: `openai: ${String(cause)}` })
        })
        const body = Schema.decodeUnknownOption(OpenAIChatResponse)(raw)
        if (body._tag === 'None') {
          return yield* Effect.fail(
            new AssistantUnavailable({ reason: 'openai response: invalid shape' })
          )
        }
        const firstChoice = body.value.choices[0]
        if (!firstChoice) {
          return yield* Effect.fail(
            new AssistantUnavailable({ reason: 'openai response: missing choice' })
          )
        }
        return {
          answer: firstChoice.message.content,
          provider: 'openai-compatible' as const,
          modelId,
          usedTools: []
        }
      })
  })

export type ProviderEnv = {
  readonly WORKERS_AI_ENABLED?: string
  readonly OPENAI_API_KEY?: string
  readonly OPENAI_BASE_URL?: string
  readonly OPENAI_MODEL_ID?: string
  readonly AI?: WorkersAIBinding
}

export const selectAssistantLayer = (
  env: ProviderEnv
): Layer.Layer<AssistantService> => {
  if (env.WORKERS_AI_ENABLED === 'true' && env.AI) {
    return makeWorkersAILayer(env.AI)
  }
  if (env.OPENAI_API_KEY) {
    // Assigned only when set so the layer's own defaults (api.openai.com,
    // gpt-4o-mini) still apply for absent vars.
    const config: { apiKey: string; baseUrl?: string; modelId?: string } = {
      apiKey: env.OPENAI_API_KEY
    }
    if (env.OPENAI_BASE_URL) config.baseUrl = env.OPENAI_BASE_URL
    if (env.OPENAI_MODEL_ID) config.modelId = env.OPENAI_MODEL_ID
    return makeOpenAILayer(config)
  }
  return MockAssistantLayer
}

export const isAssistantConfigured = (env: ProviderEnv): boolean =>
  Boolean((env.WORKERS_AI_ENABLED === 'true' && env.AI) || env.OPENAI_API_KEY)
