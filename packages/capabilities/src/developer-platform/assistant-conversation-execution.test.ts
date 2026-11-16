import { UserId, WorkspaceId } from '@b2b-saas-starter/db/ids'
import { expect, it, vi } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { AssistantAdmission } from '../assistant/admission.ts'
import { AssistantDirectory } from '../assistant/directory.ts'
import { finishConversationAttempt } from './assistant-conversation-execution.ts'
import { type ConversationAttempt } from './assistant-conversation.ts'

/**
 * How the finished-attempt audit can go missing silently:
 * - the audit insert fails after the terminal write committed and the failure
 *   is swallowed, so operators get no `audit_write_gap` to reconcile usage;
 * - the audit failure turns the committed terminal attempt into an error.
 */

const running: ConversationAttempt = {
  id: 'attempt-audit-gap',
  questionId: 'question',
  createdAt: '2026-09-15T12:00:00.000Z',
  deadline: 600_000,
  status: 'Running',
  reason: null,
  completedAt: null,
  provider: 'mock',
  modelId: 'model',
  providerRequestId: 'request',
  finishReason: 'stop',
  inputTokens: 3,
  outputTokens: 5,
  omittedExchanges: 0,
  evidence: null
}

const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
const decodeLine = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))

const services = Layer.mergeAll(
  Layer.mock(AssistantAdmission, { release: () => Effect.void }),
  Layer.mock(AssistantDirectory, {
    get: (id) =>
      Effect.succeed({
        id,
        workspaceId: WorkspaceId.make('workspace'),
        creatorUserId: UserId.make('owner'),
        requiredPermissions: [],
        policyRevision: 0,
        runAccessRevision: 0,
        createdAt: '2026-09-15T11:00:00.000Z',
        deletedAt: null,
        cleanedAt: null
      })
  }),
  Layer.mock(AuditEventLog, {
    record: () =>
      Effect.fail(
        new CapabilityUnavailable({
          capability: 'audit-log',
          reason: 'persistence_sql'
        })
      )
  })
)

it.effect(
  'keeps a committed terminal attempt and reports the lost finished-attempt audit as a gap',
  () =>
    Effect.gen(function* () {
      const terminal = yield* finishConversationAttempt(
        { update: () => Effect.succeed(true) },
        'conversation',
        running,
        'Completed',
        null
      )

      expect(terminal).toMatchObject({ id: running.id, status: 'Completed' })
      const signals = errors.mock.calls.map(([line]) => decodeLine(String(line)))
      expect(signals).toEqual([
        expect.objectContaining({
          event: 'operations.failure',
          signal: 'audit_write_gap',
          evidence: expect.objectContaining({
            operation: 'AssistantConversation.recordOutcome',
            capability: 'audit-log',
            reason: 'persistence_sql',
            eventType: 'assistant_attempt.finished',
            targetId: running.id
          })
        })
      ])
    }).pipe(Effect.provide(services))
)
