import { Context, Effect, Layer, Schema } from 'effect'

export class AssistantUnavailable extends Schema.TaggedErrorClass<AssistantUnavailable>()(
  'AssistantUnavailable',
  {
    reason: Schema.String
  }
) {}

export const AssistantProvider = Schema.Literals([
  'workers-ai',
  'openai-compatible',
  'mock'
])
export type AssistantProvider = typeof AssistantProvider.Type

export const AssistantPrompt = Schema.Struct({
  workspaceSlug: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000))
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
      Effect.tryPromise({
        try: async () => {
          const result = await binding.run(modelId, {
            prompt: `Workspace: ${prompt.workspaceSlug}\nQuestion: ${prompt.question}\nAnswer:`
          })
          if (!result.response) {
            throw new Error('missing response')
          }
          return {
            answer: result.response,
            provider: 'workers-ai' as const,
            modelId,
            usedTools: []
          }
        },
        catch: (cause) =>
          new AssistantUnavailable({ reason: `workers-ai: ${String(cause)}` })
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

export const makeOpenAILayer = (config: OpenAIConfig) =>
  Layer.succeed(AssistantService)({
    ask: (prompt) =>
      Effect.gen(function* () {
        const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
        const modelId = config.modelId ?? 'gpt-4o-mini'
        const raw = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                authorization: `Bearer ${config.apiKey}`,
                'content-type': 'application/json'
              },
              body: JSON.stringify({
                model: modelId,
                messages: [
                  {
                    role: 'system',
                    content: `You are the B2B SaaS Starter assistant for workspace ${prompt.workspaceSlug}.`
                  },
                  { role: 'user', content: prompt.question }
                ]
              })
            })
            if (!response.ok) throw new Error(`openai status ${response.status}`)
            return (await response.json()) as unknown
          },
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
    return makeOpenAILayer({
      apiKey: env.OPENAI_API_KEY,
      ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}),
      ...(env.OPENAI_MODEL_ID ? { modelId: env.OPENAI_MODEL_ID } : {})
    })
  }
  return MockAssistantLayer
}

export const isAssistantConfigured = (env: ProviderEnv): boolean =>
  Boolean((env.WORKERS_AI_ENABLED === 'true' && env.AI) || env.OPENAI_API_KEY)
