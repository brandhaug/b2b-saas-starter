import { Effect, Schema } from 'effect'
import { ChatMessage } from './text-model.ts'
import { assistantInstructions } from './assistant-instructions.ts'

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory
export class ConversationInputRejected extends Schema.TaggedError<ConversationInputRejected>()(
  'ConversationInputRejected',
  {
    reason: Schema.Literals([
      'input_invalid',
      'current_context_budget',
      'history_invalid'
    ])
  }
) {}

export const ConversationEvidence = Schema.Struct({
  taskId: Schema.String,
  sourceId: Schema.String,
  observedAt: Schema.String,
  text: Schema.String.check(Schema.isMaxLength(6000))
})
export type ConversationEvidence = Schema.Schema.Type<typeof ConversationEvidence>

const failureDescriptions = {
  output_limit: 'reached its output limit',
  provider: 'could not complete because the model provider failed',
  stopped: 'was stopped explicitly',
  interrupted: 'was interrupted before completion'
}

const FailureObservation = Schema.Struct({
  questionId: Schema.String.check(Schema.isMaxLength(128)),
  attemptId: Schema.String.check(Schema.isMaxLength(128)),
  reason: Schema.Literals(['output_limit', 'provider', 'stopped', 'interrupted'])
})

/** History contains one authorized successful answer per completed question. */
export const ConversationPrompt = Schema.Struct({
  workspaceSlug: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  evidence: Schema.optionalKey(ConversationEvidence),
  failureObservations: Schema.optionalKey(
    Schema.Array(FailureObservation).check(Schema.isMaxLength(3))
  ),
  history: Schema.Array(
    Schema.Struct({
      questionId: Schema.String,
      question: Schema.String,
      answer: Schema.String,
      evidence: Schema.optionalKey(ConversationEvidence)
    })
  )
})
export type ConversationPrompt = Schema.Schema.Type<typeof ConversationPrompt>

const PositiveTokens = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(2_000_000)
)
export const ConversationModelLimits = Schema.Struct({
  maxInputTokens: PositiveTokens,
  maxOutputTokens: PositiveTokens,
  providerContextTokens: PositiveTokens,
  providerOutputTokens: PositiveTokens
})
export type ConversationModelLimits = Schema.Schema.Type<typeof ConversationModelLimits>

export const PreparedConversationPrompt = Schema.Struct({
  messages: Schema.Array(ChatMessage),
  omittedExchanges: Schema.Int,
  estimatedInputTokens: Schema.Int,
  maxOutputTokens: Schema.Int
})
export type PreparedConversationPrompt = Schema.Schema.Type<
  typeof PreparedConversationPrompt
>

function evidenceMessage(
  evidence: ConversationEvidence,
  observation: 'Historical' | 'Current'
): ChatMessage {
  return {
    role: 'user',
    content: `${observation} task observation. Task: ${evidence.taskId}. Source: ${evidence.sourceId}. Observed at: ${evidence.observedAt}.\n${evidence.text}`
  }
}

// One token per UTF-8 byte plus framing is a conservative ceiling for the
// supported byte-level tokenizers. It deliberately omits more history than a
// provider-specific tokenizer, without guessing the usual characters/token ratio.
function tokenCeiling(messages: ReadonlyArray<ChatMessage>): number {
  const encoder = new TextEncoder()
  return (
    32 +
    messages.reduce(
      (total, message) => total + encoder.encode(message.content).length + 32,
      0
    )
  )
}

const decodePrompt = Schema.decodeUnknownEffect(ConversationPrompt)

export const prepareConversationContext = Effect.fn('ConversationModel.prepareContext')(
  function* (input: ConversationPrompt, limits: ConversationModelLimits) {
    const prompt = yield* decodePrompt(input).pipe(
      Effect.mapError(
        () =>
          new ConversationInputRejected({
            reason: 'input_invalid'
          })
      )
    )
    const maxOutputTokens = Math.min(
      limits.maxOutputTokens,
      limits.providerOutputTokens
    )
    const inputBudget = Math.min(
      limits.maxInputTokens,
      limits.providerContextTokens - maxOutputTokens
    )
    const system: ChatMessage = {
      role: 'system',
      content: assistantInstructions(prompt.workspaceSlug)
    }
    const current: Array<ChatMessage> = []
    if (prompt.evidence !== undefined) {
      current.push(evidenceMessage(prompt.evidence, 'Current'))
    }
    current.push({ role: 'user', content: prompt.question })
    if (tokenCeiling([system, ...current]) > inputBudget) {
      return yield* new ConversationInputRejected({
        reason: 'current_context_budget'
      })
    }
    // These observations carry no failed answer text or task evidence. Prefer the
    // newest failures, and never reject the current question to fit optional context.
    for (const failure of (prompt.failureObservations ?? []).toReversed()) {
      const observation: ChatMessage = {
        role: 'user',
        content: `Application observation: Answer attempt ${failure.attemptId} for question ${failure.questionId} ${failureDescriptions[failure.reason]}. This is a historical failure, not a completed answer. Do not infer further causes.`
      }
      if (tokenCeiling([system, observation, ...current]) > inputBudget) {
        break
      }
      current.unshift(observation)
    }
    const selected: Array<ReadonlyArray<ChatMessage>> = []
    let tokens = tokenCeiling([system, ...current])
    const seen = new Set<string>()
    let omittedExchanges = 0
    for (const exchange of prompt.history.toReversed()) {
      if (seen.has(exchange.questionId)) {
        return yield* new ConversationInputRejected({
          reason: 'history_invalid'
        })
      }
      seen.add(exchange.questionId)
      const messages: Array<ChatMessage> = []
      if (exchange.evidence !== undefined) {
        messages.push(evidenceMessage(exchange.evidence, 'Historical'))
      }
      messages.push(
        { role: 'user', content: exchange.question },
        { role: 'assistant', content: exchange.answer }
      )
      const cost = tokenCeiling(messages) - 32
      if (omittedExchanges > 0 || tokens + cost > inputBudget) {
        omittedExchanges += 1
      } else {
        selected.unshift(messages)
        tokens += cost
      }
    }
    return PreparedConversationPrompt.make({
      messages: [system, ...selected.flat(), ...current],
      omittedExchanges,
      estimatedInputTokens: tokens,
      maxOutputTokens
    })
  }
)
