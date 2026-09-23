import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Cause, DateTime, Effect, Exit, Result, Stream } from 'effect'
import {
  ConversationModel,
  type ConversationModelEvent
} from '@b2b-saas-starter/ai/conversation'
import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import { AssistantDirectory } from '../assistant/directory.ts'
import { AssistantAdmission } from '../assistant/admission.ts'
import { recordConversationOutcome } from './assistant-conversation-observability.ts'
import { AssistantAuthority } from './assistant-authority.ts'
import {
  type ConversationAdmissionLedger,
  type ConversationExecution
} from './assistant-conversation-admission.ts'
import {
  activeConversationAttempt,
  terminalConversationAttempt,
  ConversationNotFound,
  ConversationUnavailable,
  type ConversationAttempt
} from './assistant-conversation.ts'

export const authorizeConversation = Effect.fn('AssistantConversation.authorize')(
  function* (
    id: string | null,
    credential: AssistantCredentialReference,
    operation: 'read' | 'write',
    attempt?: ConversationAttempt,
    runAccessRevision?: number
  ) {
    const directory = yield* AssistantDirectory
    if (id === null) {
      return yield* new ConversationNotFound()
    }
    const row = yield* directory.get(id)
    if (row?.deletedAt !== null) {
      return yield* new ConversationNotFound()
    }
    if (attempt !== undefined && row.runAccessRevision !== runAccessRevision) {
      return yield* new ConversationUnavailable({ reason: 'authority' })
    }
    const authority = yield* AssistantAuthority
    let mode:
      | { mode: 'observe' }
      | { mode: 'run'; acceptedAt: number; deadline: number } = { mode: 'observe' }
    if (attempt !== undefined) {
      mode = {
        mode: 'run',
        acceptedAt: Date.parse(attempt.createdAt),
        deadline: attempt.deadline
      }
    }
    const context = yield* authority.authorize({
      credential,
      workspaceId: row.workspaceId,
      creatorUserId: row.creatorUserId,
      requiredPermissions: row.requiredPermissions,
      operation,
      ...mode
    })
    return { row, context }
  }
)

/** A terminal write wins once. Stop and recovery cannot be overwritten by a late provider. */
export const finishConversationAttempt = Effect.fn('AssistantConversation.finish')(
  function* (
    ledger: Pick<ConversationAdmissionLedger, 'update'>,
    conversationId: string | null,
    attempt: ConversationAttempt,
    status: 'Completed' | 'Interrupted' | 'Stopped',
    reason: string | null,
    onCommitted?: () => void
  ) {
    const completedAt = DateTime.formatIso(yield* DateTime.now)
    let terminal: ConversationAttempt
    if (status === 'Completed') {
      terminal = terminalConversationAttempt(attempt, { status, completedAt })
    } else {
      if (reason === null || reason.length === 0) {
        return yield* new ConversationUnavailable({ reason: 'storage' })
      }
      terminal = terminalConversationAttempt(attempt, { status, reason, completedAt })
    }
    if (!(yield* ledger.update(terminal))) {
      return null
    }
    onCommitted?.()
    const admission = yield* AssistantAdmission
    yield* admission.release(attempt.id)
    const directory = yield* AssistantDirectory
    if (conversationId === null) {
      return terminal
    }
    const row = yield* directory.get(conversationId)
    if (row !== null) {
      yield* recordConversationOutcome(row.id, row.workspaceId, terminal).pipe(
        Effect.catch(() => Effect.void)
      )
    }
    return terminal
  }
)

/** Both hosts execute this workflow; adapters own text persistence and provider event delivery. */
export const executeConversationAnswer = Effect.fn('AssistantConversation.execute')(
  function* <R>(input: {
    readonly conversationId: string
    readonly attempt: ConversationAttempt
    readonly execution: typeof ConversationExecution.Type
    readonly ledger: Pick<ConversationAdmissionLedger, 'attempt' | 'update'>
    readonly emit: (event: ConversationModelEvent) => void
    readonly persistOutput: Effect.Effect<void, ConversationUnavailable>
    readonly finish: (
      attempt: ConversationAttempt,
      status: 'Completed' | 'Interrupted',
      reason: string | null
    ) => Effect.Effect<void, ConversationUnavailable | CapabilityUnavailable, R>
  }) {
    let current: ConversationAttempt = {
      ...input.attempt,
      status: 'Running',
      reason: null,
      completedAt: null
    }
    const check = authorizeConversation(
      input.conversationId,
      input.execution.credential,
      'write',
      input.attempt,
      input.execution.runAccessRevision
    )
    const consume = Effect.gen(function* () {
      yield* check
      if (!(yield* input.ledger.update(current))) {
        return yield* new ConversationUnavailable({ reason: 'authority' })
      }
      const model = yield* ConversationModel
      yield* model.stream(input.execution.prompt).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            yield* check
            const saved = yield* input.ledger.attempt(current.id)
            if (saved === null || !activeConversationAttempt(saved)) {
              return yield* new ConversationUnavailable({ reason: 'authority' })
            }
            if (event.type === 'metadata') {
              current = {
                ...current,
                provider: event.provider,
                modelId: event.modelId,
                providerRequestId: event.providerRequestId ?? null
              }
              yield* input.ledger.update(current)
            } else if (event.type === 'finish') {
              current = {
                ...current,
                finishReason: event.reason,
                inputTokens: event.inputTokens ?? null,
                outputTokens: event.outputTokens ?? null
              }
              yield* input.ledger.update(current)
            }
            input.emit(event)
          })
        )
      )
    })
    yield* consume.pipe(
      Effect.raceFirst(
        Effect.sleep('15 seconds').pipe(Effect.andThen(check), Effect.forever)
      ),
      Effect.timeout(
        Math.max(
          1,
          input.attempt.deadline - DateTime.toEpochMillis(yield* DateTime.now)
        )
      ),
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          let reason: string | null = null
          let status: 'Completed' | 'Interrupted' = 'Completed'
          if (Exit.isFailure(exit)) {
            status = 'Interrupted'
            reason = 'provider'
            if (current.finishReason === 'length') {
              reason = 'output_limit'
            }
            const error = Cause.findError(exit.cause)
            if (Result.isSuccess(error)) {
              const failure = error.success
              if (
                failure._tag === 'ConversationModelFailure' &&
                failure.reason === 'output-limit'
              ) {
                reason = 'output_limit'
              } else if (
                failure._tag === 'AssistantAuthorityDenied' ||
                failure._tag === 'ConversationNotFound' ||
                (failure._tag === 'ConversationUnavailable' &&
                  failure.reason === 'authority')
              ) {
                reason = 'authority'
              } else if (failure._tag === 'TimeoutError') {
                reason = 'deadline_or_stop'
              }
            } else if (Cause.hasInterrupts(exit.cause)) {
              reason = 'deadline_or_stop'
            }
          }
          yield* input.persistOutput
          yield* input.finish(current, status, reason)
        })
      )
    )
  }
)
