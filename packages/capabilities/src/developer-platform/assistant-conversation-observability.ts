import { Effect } from 'effect'
import { AuditEventLog, recordCompletedAudit } from '../governance/audit-event-log.ts'
import { type ConversationAttempt } from './assistant-conversation.ts'

/**
 * The operator record deliberately contains no prompt, evidence or response text.
 * It follows an already committed terminal write, so a failed insert is reported
 * as `audit_write_gap` instead of failing the finished attempt.
 */
export const recordConversationOutcome = Effect.fn(
  'AssistantConversation.recordOutcome'
)(function* (
  conversationId: string,
  workspaceId: string,
  attempt: ConversationAttempt
) {
  const audit = yield* AuditEventLog
  yield* recordCompletedAudit(
    audit,
    {
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
    },
    'AssistantConversation.recordOutcome'
  )
})
