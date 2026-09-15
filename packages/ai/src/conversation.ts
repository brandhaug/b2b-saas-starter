import { Context, Effect, Layer, Schema, Stream } from 'effect'
import { LanguageModel, Model, Prompt, Response } from 'effect/unstable/ai'
import { selectProvider, type ProviderEnv } from './provider-selection.ts'
import {
  ConversationModelLimits,
  type ConversationPrompt,
  type PreparedConversationPrompt,
  type ConversationInputRejected,
  prepareConversationContext
} from './conversation-context.ts'
import { makeOpenAIModel } from './openai.ts'
import { makeWorkersAIModel } from './workers-ai.ts'
import { MockAssistantModel } from './mock.ts'

export {
  type PreparedConversationPrompt,
  type ConversationPrompt,
  type ConversationModelLimits
} from './conversation-context.ts'

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory
export class ConversationModelUnavailable extends Schema.TaggedError<ConversationModelUnavailable>()(
  'ConversationModelUnavailable',
  { reason: Schema.Literals(['unconfigured', 'configuration']), message: Schema.String }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory
export class ConversationModelFailure extends Schema.TaggedError<ConversationModelFailure>()(
  'ConversationModelFailure',
  {
    reason: Schema.Literals(['provider', 'unsupported', 'output-limit', 'incomplete']),
    message: Schema.String
  }
) {}

export const ConversationModelEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('metadata'),
    provider: Schema.Literals(['workers-ai', 'openai-compatible', 'mock']),
    modelId: Schema.String,
    providerRequestId: Schema.optional(Schema.String)
  }),
  Schema.Struct({ type: Schema.Literal('text-delta'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('finish'),
    reason: Response.FinishReason,
    inputTokens: Schema.optional(Schema.Int),
    outputTokens: Schema.optional(Schema.Int)
  })
])
export type ConversationModelEvent = typeof ConversationModelEvent.Type

export class ConversationModel extends Context.Service<
  ConversationModel,
  {
    readonly prepare: (
      input: ConversationPrompt
    ) => Effect.Effect<
      PreparedConversationPrompt,
      ConversationModelUnavailable | ConversationInputRejected
    >
    readonly stream: (
      input: PreparedConversationPrompt
    ) => Stream.Stream<ConversationModelEvent, ConversationModelFailure>
  }
>()('@b2b-saas-starter/ai/ConversationModel') {}

const decodeMetadata = Schema.decodeUnknownEffect(ConversationModelEvent.members[0])
const decodeLimits = Schema.decodeUnknownResult(ConversationModelLimits)

function unavailable(reason: ConversationModelUnavailable['reason'], message: string) {
  return new ConversationModelUnavailable({ reason, message })
}
function failed(reason: ConversationModelFailure['reason'], message: string) {
  return new ConversationModelFailure({ reason, message })
}

function modelPrompt(input: PreparedConversationPrompt) {
  return Prompt.make(
    input.messages.map((message) => {
      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: [{ type: 'text', text: message.content }]
        } satisfies Prompt.AssistantMessageEncoded
      }
      return message
    })
  )
}

function unavailableLayer(
  error: ConversationModelUnavailable
): Layer.Layer<ConversationModel> {
  return Layer.succeed(
    ConversationModel,
    ConversationModel.of({
      prepare: Effect.fn('ConversationModel.prepare')(() => Effect.fail(error)),
      stream: () => Stream.fail(failed('provider', 'Model generation is unavailable.'))
    })
  )
}

function conversationLayer(limits: ConversationModelLimits) {
  return Layer.effect(
    ConversationModel,
    Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel
      const provider = yield* Model.ProviderName
      const modelId = yield* Model.ModelName
      const prepare = Effect.fn('ConversationModel.prepare')(
        (input: ConversationPrompt) => prepareConversationContext(input, limits)
      )
      function stream(
        input: PreparedConversationPrompt
      ): Stream.Stream<ConversationModelEvent, ConversationModelFailure> {
        return Stream.unwrap(
          Effect.gen(function* () {
            const metadata = yield* decodeMetadata({
              type: 'metadata',
              provider,
              modelId
            }).pipe(
              Effect.mapError(() =>
                failed('unsupported', 'The selected model provider is unsupported.')
              )
            )
            let finished = false
            let outputBytes = 0
            const events = model
              .streamText({
                prompt: modelPrompt(input),
                toolChoice: 'none'
              })
              .pipe(
                Stream.mapError(() =>
                  failed(
                    'provider',
                    'The provider interrupted the answer. Retry to start a new attempt.'
                  )
                ),
                Stream.flatMap(
                  (
                    part
                  ): Stream.Stream<
                    ConversationModelEvent,
                    ConversationModelFailure
                  > => {
                    if (finished) {
                      return Stream.fail(
                        failed(
                          'unsupported',
                          'The model emitted content after completion.'
                        )
                      )
                    }
                    switch (part.type) {
                      case 'text-start':
                      case 'text-end': {
                        return Stream.empty
                      }
                      case 'text-delta': {
                        outputBytes += new TextEncoder().encode(part.delta).length
                        // Bound malicious or broken compatible endpoints separately from token accounting.
                        if (outputBytes > input.maxOutputTokens * 256) {
                          return Stream.fail(
                            failed(
                              'unsupported',
                              'The provider exceeded the response byte safety limit.'
                            )
                          )
                        }
                        return Stream.succeed({ type: 'text-delta', text: part.delta })
                      }
                      case 'response-metadata': {
                        return Stream.succeed({
                          ...metadata,
                          modelId: part.modelId ?? modelId,
                          providerRequestId: part.id
                        })
                      }
                      case 'finish': {
                        finished = true
                        const event: ConversationModelEvent = {
                          type: 'finish',
                          reason: part.reason,
                          inputTokens: part.usage.inputTokens.total,
                          outputTokens: part.usage.outputTokens.total
                        }
                        const end = Stream.succeed(event)
                        if (
                          part.reason === 'length' ||
                          (part.usage.outputTokens.total !== undefined &&
                            part.usage.outputTokens.total >= input.maxOutputTokens)
                        ) {
                          return end.pipe(
                            Stream.concat(
                              Stream.fail(
                                failed(
                                  'output-limit',
                                  'The answer reached its output limit.'
                                )
                              )
                            )
                          )
                        }
                        if (part.reason !== 'stop' && part.reason !== 'unknown') {
                          return end.pipe(
                            Stream.concat(
                              Stream.fail(
                                failed(
                                  'incomplete',
                                  'The provider could not complete the answer.'
                                )
                              )
                            )
                          )
                        }
                        return end
                      }
                      case 'error':
                      case 'file':
                      case 'reasoning-delta':
                      case 'reasoning-end':
                      case 'reasoning-start':
                      case 'source':
                      case 'tool-approval-request':
                      case 'tool-params-delta':
                      case 'tool-params-end':
                      case 'tool-params-start': {
                        return Stream.fail(
                          failed(
                            'unsupported',
                            `The model emitted an unsupported ${part.type} part.`
                          )
                        )
                      }
                    }
                    return Stream.fail(
                      failed('unsupported', 'The model emitted an unknown part.')
                    )
                  }
                )
              )
            return Stream.succeed<ConversationModelEvent>(metadata).pipe(
              Stream.concat(events),
              Stream.concat(
                Stream.unwrap(
                  Effect.suspend(() => {
                    if (finished) {
                      return Effect.succeed(Stream.empty)
                    }
                    return Effect.fail(
                      failed('incomplete', 'The model ended without a finish event.')
                    )
                  })
                )
              )
            )
          })
        )
      }
      return ConversationModel.of({ prepare, stream })
    })
  )
}

/** Custom compatible endpoints must declare their own provider ceilings. */
export function selectConversationModelLayer(
  env: ProviderEnv,
  overrides: Partial<ConversationModelLimits> = {}
): Layer.Layer<ConversationModel> {
  const choice = selectProvider(env)
  if (choice.provider === 'mock') {
    return unavailableLayer(
      unavailable(
        'unconfigured',
        'Configure WORKERS_AI_ENABLED with an AI binding or OPENAI_API_KEY to enable saved answers.'
      )
    )
  }
  let defaults = { providerContextTokens: 128_000, providerOutputTokens: 16_384 }
  if (choice.provider === 'workers-ai') {
    defaults = { providerContextTokens: 32_000, providerOutputTokens: 4096 }
  }
  let knownLimits = true
  if (choice.provider === 'openai-compatible') {
    const customModel =
      choice.config.modelId !== undefined && choice.config.modelId !== 'gpt-4o-mini'
    const customEndpoint =
      choice.config.baseUrl !== undefined &&
      choice.config.baseUrl !== 'https://api.openai.com/v1'
    knownLimits = !customModel && !customEndpoint
    if (
      (customModel || customEndpoint) &&
      (overrides.providerContextTokens === undefined ||
        overrides.providerOutputTokens === undefined)
    ) {
      return unavailableLayer(
        unavailable(
          'configuration',
          'Configure provider context and output token limits for this compatible model.'
        )
      )
    }
  }
  const decoded = decodeLimits({
    maxInputTokens: 64_000,
    maxOutputTokens: 16_000,
    ...defaults,
    ...overrides
  })
  if (decoded._tag === 'Failure') {
    return unavailableLayer(
      unavailable('configuration', 'Model token limits must be positive integers.')
    )
  }
  let limits = decoded.success
  if (knownLimits) {
    limits = {
      ...limits,
      providerContextTokens: Math.min(
        limits.providerContextTokens,
        defaults.providerContextTokens
      ),
      providerOutputTokens: Math.min(
        limits.providerOutputTokens,
        defaults.providerOutputTokens
      )
    }
  }
  const maxOutputTokens = Math.min(limits.maxOutputTokens, limits.providerOutputTokens)
  if (limits.providerContextTokens <= maxOutputTokens) {
    return unavailableLayer(
      unavailable(
        'configuration',
        'The provider context window must leave capacity for input after reserving output.'
      )
    )
  }
  if (choice.provider === 'workers-ai') {
    return conversationLayer(limits).pipe(
      Layer.provide(
        makeWorkersAIModel(
          choice.binding,
          '@cf/meta/llama-3.1-8b-instruct-fp8',
          maxOutputTokens
        )
      )
    )
  }
  return conversationLayer(limits).pipe(
    Layer.provide(makeOpenAIModel({ ...choice.config, maxOutputTokens }))
  )
}

/** Explicit synthetic generation for the isolated demo and tests. */
export const MockConversationModelLayer: Layer.Layer<ConversationModel> =
  conversationLayer({
    maxInputTokens: 64_000,
    maxOutputTokens: 16_000,
    providerContextTokens: 128_000,
    providerOutputTokens: 16_384
  }).pipe(Layer.provide(MockAssistantModel))
