import { Effect, Schema } from 'effect'

export const ConversationStatus = Schema.Literals([
  'Accepted',
  'Running',
  'Completed',
  'Interrupted',
  'Stopped'
])
export type ConversationStatus = typeof ConversationStatus.Type

export const ConversationQuestion = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  text: Schema.String,
  taskId: Schema.NullOr(Schema.String)
})
export type ConversationQuestion = typeof ConversationQuestion.Type

export const ConversationAttempt = Schema.Struct({
  id: Schema.String,
  questionId: Schema.String,
  createdAt: Schema.String,
  deadline: Schema.Number,
  status: ConversationStatus,
  reason: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  modelId: Schema.NullOr(Schema.String),
  providerRequestId: Schema.NullOr(Schema.String),
  finishReason: Schema.NullOr(Schema.String),
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  omittedExchanges: Schema.Number,
  evidence: Schema.NullOr(
    Schema.Struct({
      taskId: Schema.String,
      sourceId: Schema.String,
      observedAt: Schema.String,
      text: Schema.String
    })
  )
})
export type ConversationAttempt = typeof ConversationAttempt.Type

export const ConversationAnswer = Schema.Struct({
  ...ConversationAttempt.fields,
  text: Schema.String
})
export type ConversationAnswer = typeof ConversationAnswer.Type

export const ConversationExchange = Schema.Struct({
  question: ConversationQuestion,
  attempts: Schema.Array(ConversationAnswer)
})
export type ConversationExchange = typeof ConversationExchange.Type

export const ConversationPage = Schema.Struct({
  items: Schema.Array(ConversationExchange),
  nextCursor: Schema.NullOr(Schema.String),
  policyRevision: Schema.Number
})

/** The same chronological page and attempt projection serves stored and seeded history. */
export function conversationHistoryPage(input: {
  readonly questions: ReadonlyArray<ConversationQuestion>
  readonly attempts: ReadonlyArray<ConversationAttempt>
  readonly text: (attemptId: string) => string
  readonly cursor: string | null
  readonly full: boolean
  readonly policyRevision: number
}): typeof ConversationPage.Type {
  const newest = input.questions.toReversed()
  let cursorIndex = -1
  if (input.cursor !== null) {
    cursorIndex = newest.findIndex((question) => question.id === input.cursor)
  }
  let start = cursorIndex + 1
  if (input.cursor !== null && cursorIndex === -1) {
    start = newest.length
  }
  const selected = newest.slice(start, start + 30)
  let page = input.questions
  if (!input.full) {
    page = selected.toReversed()
  }
  let nextCursor: string | null = null
  if (!input.full && start + page.length < input.questions.length) {
    nextCursor = selected.at(-1)?.id ?? null
  }
  return {
    items: page.map((question) => ({
      question,
      attempts: input.attempts.flatMap((attempt) => {
        if (attempt.questionId !== question.id) {
          return []
        }
        return [{ ...attempt, text: input.text(attempt.id) }]
      })
    })),
    nextCursor,
    policyRevision: input.policyRevision
  }
}

export const ConversationSend = Schema.Struct({
  idempotencyKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  taskId: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
  )
})
export type ConversationSend = typeof ConversationSend.Type

export const ConversationRetry = Schema.Struct({
  idempotencyKey: ConversationSend.fields.idempotencyKey,
  attemptId: Schema.String
})
export type ConversationRetry = typeof ConversationRetry.Type

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory
export class ConversationNotFound extends Schema.TaggedError<ConversationNotFound>()(
  'ConversationNotFound',
  {},
  { httpApiStatus: 404 }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory
export class ConversationConflict extends Schema.TaggedError<ConversationConflict>()(
  'ConversationConflict',
  {
    reason: Schema.Literals(['busy', 'idempotency_key_reused', 'stale_retry'])
  },
  { httpApiStatus: 409 }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory
export class ConversationUnavailable extends Schema.TaggedError<ConversationUnavailable>()(
  'ConversationUnavailable',
  {
    reason: Schema.Literals(['configuration', 'storage', 'provider', 'authority'])
  },
  { httpApiStatus: 503 }
) {}

export const ConversationAcceptance = Schema.Struct({
  question: ConversationQuestion,
  attempt: ConversationAttempt,
  joined: Schema.Boolean
})
export type ConversationAcceptance = typeof ConversationAcceptance.Type

export function activeConversationAttempt(attempt: ConversationAttempt): boolean {
  return attempt.status === 'Accepted' || attempt.status === 'Running'
}

/** Fixed field order makes key comparison independent of transport JSON ordering. */
const encodeOperation = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.NullOr(Schema.String)))
)

export function canonicalConversationOperation(
  input: ConversationSend | ConversationRetry
): string {
  if ('question' in input) {
    return encodeOperation(['send', input.question, input.taskId ?? null])
  }
  return encodeOperation(['retry', input.attemptId])
}

export const admitConversationOperation = Effect.fn('AssistantConversation.admit')(
  function* (input: {
    readonly payloadHash: string
    readonly previous: {
      readonly payloadHash: string
      readonly acceptance: ConversationAcceptance
    } | null
    readonly executionBusy?: boolean | undefined
    readonly active: ConversationAttempt | null
    readonly retry?:
      | {
          readonly target: ConversationAttempt | null
          readonly latestQuestionId: string | null
          readonly latestAttemptId: string | null
        }
      | undefined
  }) {
    if (input.previous !== null) {
      if (input.previous.payloadHash !== input.payloadHash) {
        return yield* new ConversationConflict({ reason: 'idempotency_key_reused' })
      }
      return { ...input.previous.acceptance, joined: true }
    }
    if (
      input.executionBusy ||
      (input.active !== null && activeConversationAttempt(input.active))
    ) {
      return yield* new ConversationConflict({ reason: 'busy' })
    }
    if (input.retry !== undefined) {
      const target = input.retry.target
      if (
        target === null ||
        target.questionId !== input.retry.latestQuestionId ||
        target.id !== input.retry.latestAttemptId ||
        (target.status !== 'Interrupted' && target.status !== 'Stopped')
      ) {
        return yield* new ConversationConflict({ reason: 'stale_retry' })
      }
    }
    return null
  }
)

export function conversationTitle(question: string): string {
  const normalized = question.replaceAll(/\s+/g, ' ').trim()
  if (normalized.length > 80) {
    return `${normalized.slice(0, 79)}…`
  }
  return normalized
}

export const ConversationSummary = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  createdAt: Schema.String,
  title: Schema.NullOr(Schema.String),
  activeAttempt: Schema.NullOr(ConversationAttempt),
  policyRevision: Schema.Number
})
export type ConversationSummary = typeof ConversationSummary.Type
export const ConversationList = Schema.Struct({
  items: Schema.Array(ConversationSummary),
  nextCursor: Schema.NullOr(Schema.String)
})
export type ConversationList = typeof ConversationList.Type
