import { failureMessage } from '@b2b-saas-starter/failure'
import { Context, Effect, Layer, Option, Schema } from 'effect'

import { type Writable } from '@b2b-saas-starter/config/writable'
import { hasValue, type ProviderEnvOf } from '@b2b-saas-starter/env/server'

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

export const MockAssistantLayer = Layer.succeed(AssistantService)({
  ask: (prompt) =>
    Effect.succeed(
      AssistantReply.make({
        answer: `Mock assistant: "${prompt.question}" for workspace ${prompt.workspaceSlug}. Configure WORKERS_AI_ENABLED=true or OPENAI_API_KEY to enable a real provider.`,
        provider: 'mock',
        modelId: 'starter-mock',
        usedTools: []
      })
    )
})

export type WorkersAIBinding = {
  readonly run: (
    model: string,
    input: { readonly prompt: string }
  ) => Promise<{ readonly response?: string }>
}

export function makeWorkersAILayer(
  binding: WorkersAIBinding,
  modelId = '@cf/meta/llama-3.1-8b-instruct'
) {
  return Layer.succeed(AssistantService)({
    ask: (prompt) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            binding.run(modelId, {
              prompt: `Workspace: ${prompt.workspaceSlug}\nQuestion: ${prompt.question}\nAnswer:`
            }),
          catch: (cause) =>
            new AssistantUnavailable({ reason: `workers-ai: ${failureMessage(cause)}` })
        })
        if (!result.response) {
          return yield* Effect.fail(
            new AssistantUnavailable({ reason: 'workers-ai: missing response' })
          )
        }
        return AssistantReply.make({
          answer: result.response,
          provider: 'workers-ai',
          modelId,
          usedTools: []
        })
      })
  })
}

export type OpenAIConfig = {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly modelId?: string
}

/**
 * The config is built via {@link Writable} by assignment so an unset var
 * leaves its key absent rather than set it to `undefined`, so the layer's own
 * defaults still apply.
 */

const OpenAIChatRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(['system', 'user']),
      content: Schema.String
    })
  )
})

/** Schema JSON codec for the request body — no hand-rolled `JSON.stringify`. */
const encodeChatRequest = Schema.encodeSync(Schema.fromJsonString(OpenAIChatRequest))

const OpenAIChatResponse = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({
        content: Schema.String.check(Schema.isMinLength(1))
      })
    })
  ).check(Schema.isMinLength(1))
})

const decodeOpenAIChatResponse = Schema.decodeUnknownOption(OpenAIChatResponse)

/**
 * The single platform adapter in this package: one outbound HTTP POST against
 * an OpenAI-compatible endpoint. `packages/ai` deliberately depends on `effect`
 * only, so there is no `@effect/platform` HttpClient to route through; the
 * global `fetch` is confined to this one function and every caller wraps it in
 * `Effect.tryPromise` with a tagged `AssistantUnavailable` failure.
 */
function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal
) {
  // This package depends on `effect` only — there is no @effect/platform HttpClient to
  // route through — and the whole outbound boundary is this one call, wrapped by
  // `Effect.tryPromise` with a tagged `AssistantUnavailable` failure at every caller.
  // oxlint-disable-next-line effect/noGlobals -- raw fetch is the platform transport here
  return fetch(url, { method: 'POST', headers, body, signal })
}

export function makeOpenAILayer(config: OpenAIConfig) {
  return Layer.succeed(AssistantService)({
    ask: (prompt) =>
      Effect.gen(function* () {
        const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
        const modelId = config.modelId ?? 'gpt-4o-mini'
        const response = yield* Effect.tryPromise({
          try: (signal) =>
            postJson(
              `${baseUrl}/chat/completions`,
              {
                authorization: `Bearer ${config.apiKey}`,
                'content-type': 'application/json'
              },
              encodeChatRequest({
                model: modelId,
                messages: [
                  {
                    role: 'system',
                    content: `You are the B2B SaaS Starter assistant for workspace ${prompt.workspaceSlug}.`
                  },
                  { role: 'user', content: prompt.question }
                ]
              }),
              signal
            ),
          catch: (cause) =>
            new AssistantUnavailable({ reason: `openai: ${failureMessage(cause)}` })
        })
        if (!response.ok) {
          return yield* Effect.fail(
            new AssistantUnavailable({ reason: `openai: status ${response.status}` })
          )
        }
        const raw: unknown = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (cause) =>
            new AssistantUnavailable({ reason: `openai: ${failureMessage(cause)}` })
        })
        const body = decodeOpenAIChatResponse(raw)
        if (Option.isNone(body)) {
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
        return AssistantReply.make({
          answer: firstChoice.message.content,
          provider: 'openai-compatible',
          modelId,
          usedTools: []
        })
      })
  })
}

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
 * `selectAssistantLayer` builds the layer for the choice and
 * `isAssistantConfigured` asks whether the choice is a real provider, so the
 * condition ("Workers AI with its binding, or an OpenAI key") is stated once
 * and the UI's "not enabled" copy can never disagree with the ask path.
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

export function selectAssistantLayer(env: ProviderEnv): Layer.Layer<AssistantService> {
  const choice = selectProvider(env)
  switch (choice.provider) {
    case 'workers-ai': {
      return makeWorkersAILayer(choice.binding)
    }
    case 'openai-compatible': {
      return makeOpenAILayer(choice.config)
    }
    case 'mock': {
      return MockAssistantLayer
    }
  }
}

/** Whether a real provider is configured — the mock does not count. */
export function isAssistantConfigured(env: ProviderEnv): boolean {
  return selectProvider(env).provider !== 'mock'
}
