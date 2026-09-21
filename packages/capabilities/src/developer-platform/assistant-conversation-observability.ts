import { Effect } from 'effect'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type ConversationAttempt } from './assistant-conversation.ts'

/** The operator record deliberately contains no prompt, evidence or response text. */
export const recordConversationOutcome = Effect.fn(
  'AssistantConversation.recordOutcome'
)(function* (
  conversationId: string,
  workspaceId: string,
  attempt: ConversationAttempt
) {
  const audit = yield* AuditEventLog
  yield* audit.record({
    eventType: 'assistant_attempt.finished',
    targetType: 'assistant_attempt',
    targetId: attempt.id,
    actorType: 'system',
    metadata: {
      conversationId,
      workspaceId,
      status: attempt.status,
      reason: attempt.reason,
      provider: attempt.provider,
      modelId: attempt.modelId,
      providerRequestId: attempt.providerRequestId,
      finishReason: attempt.finishReason,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      acceptedAt: attempt.createdAt,
      deadline: attempt.deadline,
      completedAt: attempt.completedAt
    }
  })
})
