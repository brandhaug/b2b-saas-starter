import { type Writable } from '@b2b-saas-starter/config/writable'
import { hasValue, type ProviderEnvOf } from '@b2b-saas-starter/env/server'
import { failureMessage } from '@b2b-saas-starter/failure'
import { Context, Effect, Layer, Option, Schema, Stream } from 'effect'
import {
  AiError,
  IdGenerator,
  LanguageModel,
  Model,
  Prompt,
  type Response
} from 'effect/unstable/ai'

// The starter assistant, on Effect's provider-agnostic `LanguageModel`
// (ADR 0008, 0071). There is one `ask` implementation — `AssistantLive`
// below — which builds a normalized prompt and calls `generateText`; which
// model answers is a layer decision, never a branch inside the behavior.
// Each provider is a `LanguageModel` adapter built with `LanguageModel.make`
// and wrapped in `Model.make`, which stamps `ProviderName` and `ModelName`
// beside the model it provides, so the reply's `provider` / `modelId` fields
// come from the same context as the model that answered.

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
 * the HTTP contract declares.
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
        usedTools: response.toolCalls.map(
          (call: { readonly name: string }) => call.name
        )
      })
    })

    return AssistantService.of({ ask })
  })
)

// --- Prompt flattening -------------------------------------------------------
// The adapters below speak plain text: `AssistantLive` builds a system
// message plus a user message with text parts only, so these helpers describe
// exactly the prompt shape this package itself produces; anything richer (a
// file part, a tool message) is refused by the adapters through
// `unsupportedPromptPart` instead of being silently dropped.

function textOf(parts: ReadonlyArray<Prompt.Part>): string {
  return parts
    .filter((part): part is Prompt.TextPart => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

/** The text of one prompt message: system content as-is, part content flattened. */
function messageText(message: Prompt.Message): string {
  switch (message.role) {
    case 'system': {
      return message.content
    }
    case 'assistant': {
      return textOf(message.content)
    }
    case 'user': {
      return textOf(message.content)
    }
    case 'tool': {
      return ''
    }
  }
}

/** The last user message's text — the question `AssistantLive` appends. */
function lastUserQuestion(prompt: Prompt.Prompt): string {
  const last = prompt.content.findLast(
    (message): message is Prompt.UserMessage => message.role === 'user'
  )
  if (last === undefined) {
    return ''
  }
  return textOf(last.content)
}

/**
 * The first part these adapters cannot send, if any. `undefined` means the
 * prompt is plain text throughout.
 */
function unsupportedPromptPart(prompt: Prompt.Prompt): string | undefined {
  for (const message of prompt.content) {
    if (message.role === 'assistant' || message.role === 'user') {
      for (const part of message.content) {
        if (part.type !== 'text') {
          return part.type
        }
      }
    }
  }
  return undefined
}

// --- LanguageModel plumbing --------------------------------------------------

/**
 * `LanguageModel.make` builds its service on the `IdGenerator` service; the
 * default generator is provided once here so every adapter below carries it.
 */
function languageModelLayer(model: Effect.Effect<LanguageModel.Service>) {
  return Layer.effect(LanguageModel.LanguageModel)(
    Effect.provideService(
      IdGenerator.IdGenerator,
      IdGenerator.defaultIdGenerator
    )(model)
  )
}

/**
 * Every adapter here answers with one complete response. Streaming is refused
 * with a typed `AiError` — visible at the call site, not a silent
 * approximation — until an adapter implements it.
 */
function unsupportedStream(module: string) {
  return () =>
    Stream.fail(
      AiError.make({
        module,
        method: 'streamText',
        reason: new AiError.InvalidRequestError({
          description: `${module} adapter does not support streaming`
        })
      })
    )
}

// --- Workers AI ----------------------------------------------------------------

export type WorkersAIBinding = {
  readonly run: (
    model: string,
    input: { readonly prompt: string }
  ) => Promise<{ readonly response?: string }>
}

/** The Workers AI prompt is one raw string: the messages, flattened, blank lines dropped. */
function flattenPrompt(prompt: Prompt.Prompt): string {
  const chunks: Array<string> = []
  for (const message of prompt.content) {
    const chunk = messageText(message)
    if (chunk !== '') {
      chunks.push(chunk)
    }
  }
  return chunks.join('\n\n')
}

/** One `AiError` for this provider's `generateText` hook, with the module stamped. */
function workersAiError(reason: AiError.AiErrorReason) {
  return AiError.make({ module: 'workers-ai', method: 'generateText', reason })
}

/**
 * A `LanguageModel` over the Workers AI binding — the Cloudflare-first
 * provider. The binding reports no finish reason or token usage, so the
 * finish part claims only `stop` with empty usage.
 */
export function makeWorkersAIModel(
  binding: WorkersAIBinding,
  modelId = '@cf/meta/llama-3.1-8b-instruct'
) {
  function generateText(options: LanguageModel.ProviderOptions) {
    return Effect.gen(function* () {
      const unsupported = unsupportedPromptPart(options.prompt)
      if (unsupported !== undefined) {
        return yield* workersAiError(
          new AiError.InvalidUserInputError({
            description: `workers-ai adapter sends text only, got a '${unsupported}' part`
          })
        )
      }
      const result = yield* Effect.tryPromise({
        try: () => binding.run(modelId, { prompt: flattenPrompt(options.prompt) }),
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
    'workers-ai',
    modelId,
    languageModelLayer(
      LanguageModel.make({
        generateText,
        streamText: unsupportedStream('workers-ai')
      })
    )
  )
}

// --- OpenAI-compatible ---------------------------------------------------------

export type OpenAIConfig = {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly modelId?: string
}

type ChatMessage = {
  readonly role: 'system' | 'user'
  readonly content: string
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
      }),
      finish_reason: Schema.optional(OpenAIFinishReason)
    })
  ).check(Schema.isMinLength(1))
})

const decodeOpenAIChatResponse = Schema.decodeUnknownOption(OpenAIChatResponse)

/**
 * The single platform adapter in this package: one outbound HTTP POST against
 * an OpenAI-compatible endpoint. `packages/ai` deliberately depends on `effect`
 * only, so there is no `@effect/platform` HttpClient to route through; the
 * global `fetch` is confined to this one function and every caller wraps
 * it with a typed `AiError` failure.
 */
function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal
) {
  // This package depends on `effect` only — there is no @effect/platform HttpClient to
  // route through — and the whole outbound boundary is this one call, wrapped by
  // `Effect.tryPromise` with a typed `AiError` failure at every caller.
  // oxlint-disable-next-line effect/noGlobals -- raw fetch is the platform transport here
  return fetch(url, { method: 'POST', headers, body, signal })
}

/** The chat messages this adapter can send: system and user, text only. */
function chatMessages(prompt: Prompt.Prompt): Array<ChatMessage> {
  const messages: Array<ChatMessage> = []
  for (const message of prompt.content) {
    if (message.role === 'system' || message.role === 'user') {
      messages.push({ role: message.role, content: messageText(message) })
    }
  }
  return messages
}

/** One `AiError` for this provider's `generateText` hook, with the module stamped. */
function openaiCompatibleError(reason: AiError.AiErrorReason) {
  return AiError.make({
    module: 'openai-compatible',
    method: 'generateText',
    reason
  })
}

/**
 * A `LanguageModel` over any OpenAI-compatible `/chat/completions` endpoint.
 * Config resolution happens once, here, so `ask` never re-reads defaults.
 */
export function makeOpenAIModel(config: OpenAIConfig) {
  const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
  const modelId = config.modelId ?? 'gpt-4o-mini'
  const chatUrl = `${baseUrl}/chat/completions`
  const headers = {
    authorization: `Bearer ${config.apiKey}`,
    'content-type': 'application/json'
  }

  function generateText(options: LanguageModel.ProviderOptions) {
    return Effect.gen(function* () {
      const unsupported = unsupportedPromptPart(options.prompt)
      if (unsupported !== undefined) {
        return yield* openaiCompatibleError(
          new AiError.InvalidUserInputError({
            description: `openai-compatible adapter sends text only, got a '${unsupported}' part`
          })
        )
      }
      if (options.tools.length > 0) {
        return yield* openaiCompatibleError(
          new AiError.InvalidRequestError({
            description: 'openai-compatible adapter carries no tools yet'
          })
        )
      }
      if (options.responseFormat.type === 'json') {
        return yield* openaiCompatibleError(
          new AiError.UnsupportedSchemaError({
            description: 'openai-compatible adapter answers text only'
          })
        )
      }
      const messages = chatMessages(options.prompt)
      if (messages.length !== options.prompt.content.length) {
        return yield* openaiCompatibleError(
          new AiError.InvalidUserInputError({
            description: 'openai-compatible adapter sends system and user messages only'
          })
        )
      }
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          postJson(
            chatUrl,
            headers,
            encodeChatRequest({ model: modelId, messages }),
            signal
          ),
        catch: (cause) =>
          openaiCompatibleError(
            new AiError.NetworkError({
              reason: 'TransportError',
              request: { method: 'POST', url: chatUrl, urlParams: [], headers },
              description: failureMessage(cause)
            })
          )
      })
      if (!response.ok) {
        return yield* openaiCompatibleError(
          AiError.reasonFromHttpStatus({
            status: response.status,
            description: `status ${response.status}`
          })
        )
      }
      const raw: unknown = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          openaiCompatibleError(
            new AiError.InvalidOutputError({ description: failureMessage(cause) })
          )
      })
      const body = decodeOpenAIChatResponse(raw)
      if (Option.isNone(body)) {
        return yield* openaiCompatibleError(
          new AiError.InvalidOutputError({
            description: 'response body does not match the chat shape'
          })
        )
      }
      const first = body.value.choices[0]
      if (first === undefined) {
        return yield* openaiCompatibleError(
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
    'openai-compatible',
    modelId,
    languageModelLayer(
      LanguageModel.make({
        generateText,
        streamText: unsupportedStream('openai-compatible')
      })
    )
  )
}

// --- Mock ----------------------------------------------------------------------

/**
 * The honest no-provider model: it echoes the question and names the env vars
 * that would enable a real provider. It satisfies the same `LanguageModel`
 * contract as the real adapters, so `AssistantLive` cannot tell it apart.
 */
export const MockAssistantModel = Model.make(
  'mock',
  'starter-mock',
  languageModelLayer(
    LanguageModel.make({
      generateText: (options) =>
        Effect.succeed([
          {
            type: 'text',
            text: `Mock assistant: "${lastUserQuestion(options.prompt)}". Configure WORKERS_AI_ENABLED=true or OPENAI_API_KEY to enable a real provider.`
          },
          {
            type: 'finish',
            reason: 'stop',
            usage: { inputTokens: {}, outputTokens: {} }
          }
        ]),
      streamText: unsupportedStream('mock')
    })
  )
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
