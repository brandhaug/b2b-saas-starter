import { Schema } from 'effect'

export const ConversationRefusalReason = Schema.Union([
  Schema.Literal('provider'),
  Schema.Literal('configuration'),
  Schema.Literal('unavailable'),
  Schema.Literal('not_found'),
  Schema.Literal('access'),
  Schema.Literal('busy'),
  Schema.Literal('conflict'),
  Schema.Literal('limit'),
  Schema.Literal('input')
])

export const ConversationRefusal = Schema.Struct({
  ok: Schema.Literal(false),
  reason: ConversationRefusalReason,
  message: Schema.String,
  retryAfterSeconds: Schema.Union([Schema.Null, Schema.Number])
})

export const ConversationDeletionResult = Schema.Union([
  ConversationRefusal,
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Void })
])

export const AcceptedConversationAttempt = Schema.Struct({
  status: Schema.Literal('Accepted'),
  reason: Schema.Null,
  completedAt: Schema.Null,
  id: Schema.String,
  questionId: Schema.String,
  createdAt: Schema.String,
  deadline: Schema.Number,
  provider: Schema.Union([Schema.Null, Schema.String]),
  modelId: Schema.Union([Schema.Null, Schema.String]),
  providerRequestId: Schema.Union([Schema.Null, Schema.String]),
  finishReason: Schema.Union([Schema.Null, Schema.String]),
  inputTokens: Schema.Union([Schema.Null, Schema.Number]),
  outputTokens: Schema.Union([Schema.Null, Schema.Number]),
  omittedExchanges: Schema.Number,
  evidence: Schema.Union([
    Schema.Null,
    Schema.Struct({
      taskId: Schema.String,
      sourceId: Schema.String,
      observedAt: Schema.String,
      text: Schema.String
    })
  ])
})

export const RunningConversationAttempt = Schema.Struct({
  status: Schema.Literal('Running'),
  reason: Schema.Null,
  completedAt: Schema.Null,
  id: Schema.String,
  questionId: Schema.String,
  createdAt: Schema.String,
  deadline: Schema.Number,
  provider: Schema.Union([Schema.Null, Schema.String]),
  modelId: Schema.Union([Schema.Null, Schema.String]),
  providerRequestId: Schema.Union([Schema.Null, Schema.String]),
  finishReason: Schema.Union([Schema.Null, Schema.String]),
  inputTokens: Schema.Union([Schema.Null, Schema.Number]),
  outputTokens: Schema.Union([Schema.Null, Schema.Number]),
  omittedExchanges: Schema.Number,
  evidence: Schema.Union([
    Schema.Null,
    Schema.Struct({
      taskId: Schema.String,
      sourceId: Schema.String,
      observedAt: Schema.String,
      text: Schema.String
    })
  ])
})

export const CompletedConversationAttempt = Schema.Struct({
  status: Schema.Literal('Completed'),
  reason: Schema.Null,
  completedAt: Schema.String,
  id: Schema.String,
  questionId: Schema.String,
  createdAt: Schema.String,
  deadline: Schema.Number,
  provider: Schema.Union([Schema.Null, Schema.String]),
  modelId: Schema.Union([Schema.Null, Schema.String]),
  providerRequestId: Schema.Union([Schema.Null, Schema.String]),
  finishReason: Schema.Union([Schema.Null, Schema.String]),
  inputTokens: Schema.Union([Schema.Null, Schema.Number]),
  outputTokens: Schema.Union([Schema.Null, Schema.Number]),
  omittedExchanges: Schema.Number,
  evidence: Schema.Union([
    Schema.Null,
    Schema.Struct({
      taskId: Schema.String,
      sourceId: Schema.String,
      observedAt: Schema.String,
      text: Schema.String
    })
  ])
})

export const InterruptedConversationAttempt = Schema.Struct({
  status: Schema.Literal('Interrupted'),
  reason: Schema.String,
  completedAt: Schema.String,
  id: Schema.String,
  questionId: Schema.String,
  createdAt: Schema.String,
  deadline: Schema.Number,
  provider: Schema.Union([Schema.Null, Schema.String]),
  modelId: Schema.Union([Schema.Null, Schema.String]),
  providerRequestId: Schema.Union([Schema.Null, Schema.String]),
  finishReason: Schema.Union([Schema.Null, Schema.String]),
  inputTokens: Schema.Union([Schema.Null, Schema.Number]),
  outputTokens: Schema.Union([Schema.Null, Schema.Number]),
  omittedExchanges: Schema.Number,
  evidence: Schema.Union([
    Schema.Null,
    Schema.Struct({
      taskId: Schema.String,
      sourceId: Schema.String,
      observedAt: Schema.String,
      text: Schema.String
    })
  ])
})

export const StoppedConversationAttempt = Schema.Struct({
  status: Schema.Literal('Stopped'),
  reason: Schema.String,
  completedAt: Schema.String,
  id: Schema.String,
  questionId: Schema.String,
  createdAt: Schema.String,
  deadline: Schema.Number,
  provider: Schema.Union([Schema.Null, Schema.String]),
  modelId: Schema.Union([Schema.Null, Schema.String]),
  providerRequestId: Schema.Union([Schema.Null, Schema.String]),
  finishReason: Schema.Union([Schema.Null, Schema.String]),
  inputTokens: Schema.Union([Schema.Null, Schema.Number]),
  outputTokens: Schema.Union([Schema.Null, Schema.Number]),
  omittedExchanges: Schema.Number,
  evidence: Schema.Union([
    Schema.Null,
    Schema.Struct({
      taskId: Schema.String,
      sourceId: Schema.String,
      observedAt: Schema.String,
      text: Schema.String
    })
  ])
})

export const ConversationAttempt = Schema.Union([
  AcceptedConversationAttempt,
  RunningConversationAttempt,
  CompletedConversationAttempt,
  InterruptedConversationAttempt,
  StoppedConversationAttempt
])

export const ConversationStopSuccess = Schema.Struct({
  ok: Schema.Literal(true),
  value: ConversationAttempt
})

export const ConversationStopResult = Schema.Union([
  ConversationRefusal,
  ConversationStopSuccess
])

export const ConversationAdmission = Schema.Struct({
  question: Schema.Struct({
    id: Schema.String,
    createdAt: Schema.String,
    text: Schema.String,
    taskId: Schema.Union([Schema.Null, Schema.String])
  }),
  attempt: ConversationAttempt,
  joined: Schema.Boolean
})

export const ConversationAdmissionSuccess = Schema.Struct({
  ok: Schema.Literal(true),
  value: ConversationAdmission
})

export const ConversationAdmissionResult = Schema.Union([
  ConversationRefusal,
  ConversationAdmissionSuccess
])

export const AcceptedAttemptSummary = Schema.Struct({
  text: Schema.String,
  status: Schema.Union([Schema.Literal('Accepted'), Schema.Literal('Running')]),
  reason: Schema.Null,
  completedAt: Schema.Null,
  id: Schema.String,
  questionId: Schema.String,
  createdAt: Schema.String,
  deadline: Schema.Number,
  provider: Schema.Union([Schema.Null, Schema.String]),
  modelId: Schema.Union([Schema.Null, Schema.String]),
  providerRequestId: Schema.Union([Schema.Null, Schema.String]),
  finishReason: Schema.Union([Schema.Null, Schema.String]),
  inputTokens: Schema.Union([Schema.Null, Schema.Number]),
  outputTokens: Schema.Union([Schema.Null, Schema.Number]),
  omittedExchanges: Schema.Number,
  evidence: Schema.Union([
    Schema.Null,
    Schema.Struct({
      taskId: Schema.String,
      sourceId: Schema.String,
      observedAt: Schema.String,
      text: Schema.String
    })
  ])
})

export const CompletedAttemptSummary = Schema.Struct({
  text: Schema.String,
  status: Schema.Literal('Completed'),
  reason: Schema.Null,
  completedAt: Schema.String,
  id: Schema.String,
  questionId: Schema.String,
  createdAt: Schema.String,
  deadline: Schema.Number,
  provider: Schema.Union([Schema.Null, Schema.String]),
  modelId: Schema.Union([Schema.Null, Schema.String]),
  providerRequestId: Schema.Union([Schema.Null, Schema.String]),
  finishReason: Schema.Union([Schema.Null, Schema.String]),
  inputTokens: Schema.Union([Schema.Null, Schema.Number]),
  outputTokens: Schema.Union([Schema.Null, Schema.Number]),
  omittedExchanges: Schema.Number,
  evidence: Schema.Union([
    Schema.Null,
    Schema.Struct({
      taskId: Schema.String,
      sourceId: Schema.String,
      observedAt: Schema.String,
      text: Schema.String
    })
  ])
})

export const InterruptedAttemptSummary = Schema.Struct({
  text: Schema.String,
  status: Schema.Union([Schema.Literal('Interrupted'), Schema.Literal('Stopped')]),
  reason: Schema.String,
  completedAt: Schema.String,
  id: Schema.String,
  questionId: Schema.String,
  createdAt: Schema.String,
  deadline: Schema.Number,
  provider: Schema.Union([Schema.Null, Schema.String]),
  modelId: Schema.Union([Schema.Null, Schema.String]),
  providerRequestId: Schema.Union([Schema.Null, Schema.String]),
  finishReason: Schema.Union([Schema.Null, Schema.String]),
  inputTokens: Schema.Union([Schema.Null, Schema.Number]),
  outputTokens: Schema.Union([Schema.Null, Schema.Number]),
  omittedExchanges: Schema.Number,
  evidence: Schema.Union([
    Schema.Null,
    Schema.Struct({
      taskId: Schema.String,
      sourceId: Schema.String,
      observedAt: Schema.String,
      text: Schema.String
    })
  ])
})

export const AttemptSummary = Schema.Union([
  AcceptedAttemptSummary,
  CompletedAttemptSummary,
  InterruptedAttemptSummary
])

export const AttemptSummaries = Schema.Array(AttemptSummary)

export const ConversationExchange = Schema.Struct({
  question: Schema.Struct({
    id: Schema.String,
    createdAt: Schema.String,
    text: Schema.String,
    taskId: Schema.Union([Schema.Null, Schema.String])
  }),
  attempts: AttemptSummaries
})

export const ConversationExchanges = Schema.Array(ConversationExchange)

export const ConversationHistoryPage = Schema.Struct({
  items: ConversationExchanges,
  nextCursor: Schema.Union([Schema.Null, Schema.String]),
  policyRevision: Schema.Number
})

export const ConversationHistorySuccess = Schema.Struct({
  ok: Schema.Literal(true),
  value: ConversationHistoryPage
})

export const ConversationHistoryResult = Schema.Union([
  ConversationRefusal,
  ConversationHistorySuccess
])

export const OptionalActiveAttempt = Schema.Union([
  Schema.Null,
  AcceptedConversationAttempt,
  RunningConversationAttempt,
  CompletedConversationAttempt,
  InterruptedConversationAttempt,
  StoppedConversationAttempt
])

export const ConversationSummary = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  createdAt: Schema.String,
  title: Schema.Union([Schema.Null, Schema.String]),
  activeAttempt: OptionalActiveAttempt,
  policyRevision: Schema.Number
})

export const ConversationSummaries = Schema.Array(ConversationSummary)

export const ConversationListPage = Schema.Struct({
  items: ConversationSummaries,
  nextCursor: Schema.Union([Schema.Null, Schema.String])
})

export const ConversationListSuccess = Schema.Struct({
  ok: Schema.Literal(true),
  value: ConversationListPage
})

export const ConversationListResult = Schema.Union([
  ConversationRefusal,
  ConversationListSuccess
])

export const ConversationCreateSuccess = Schema.Struct({
  ok: Schema.Literal(true),
  value: ConversationSummary
})

export const ConversationCreateResult = Schema.Union([
  ConversationRefusal,
  ConversationCreateSuccess
])

export const LoadOwnedConversationsSchema = Schema.Union([
  ConversationRefusal,
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Array(Schema.Struct({ id: Schema.String, createdAt: Schema.String }))
  })
])
