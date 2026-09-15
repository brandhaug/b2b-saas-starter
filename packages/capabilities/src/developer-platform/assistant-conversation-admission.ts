import { DateTime, Effect, Schema } from 'effect'
import { AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import { ConversationModel } from '@b2b-saas-starter/ai/conversation'
import {
  PreparedConversationPrompt,
  type ConversationPrompt
} from '@b2b-saas-starter/ai/conversation-context'
import { AssistantAdmission } from '../assistant/admission.ts'
import {
  AssistantDirectory,
  type ConversationDirectoryEntry
} from '../assistant/directory.ts'
import { hashSha256 } from '../crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AssistantAuthority } from './assistant-authority.ts'
import { assistantTaskEvidence } from './assistant-task-evidence.ts'
import {
  admitConversationOperation,
  canonicalConversationOperation,
  ConversationNotFound,
  type ConversationAcceptance,
  type ConversationAttempt,
  type ConversationQuestion,
  type ConversationRetry,
  type ConversationSend,
  type ConversationUnavailable
} from './assistant-conversation.ts'

export const ConversationExecution = Schema.Struct({
  credential: AssistantCredentialReference,
  runAccessRevision: Schema.Int,
  prompt: PreparedConversationPrompt
})

type Stored<A> = Effect.Effect<A, ConversationUnavailable>
/** The host supplies its atomic SQLite ledger and SDK-authoritative saved text. */
export type ConversationAdmissionLedger = {
  latestAttempt(): Stored<ConversationAttempt | null>
  attempt(id: string): Stored<ConversationAttempt | null>
  active(): Stored<ConversationAttempt | null>
  previous(key: string): Stored<{
    readonly payloadHash: string
    readonly acceptance: ConversationAcceptance
  } | null>
  question(id: string): Stored<ConversationQuestion | null>
  questions(): Stored<ReadonlyArray<ConversationQuestion>>
  attempts(): Stored<ReadonlyArray<ConversationAttempt>>
  accept(input: {
    readonly key: string
    readonly hash: string
    readonly acceptance: ConversationAcceptance
    readonly execution: typeof ConversationExecution.Type
  }): Stored<void>
  update(attempt: ConversationAttempt): Stored<boolean>
}

/** Serialize per conversation at the host; D1 admission arbitrates across conversations. */
export const acceptConversationAnswer = Effect.fn('AssistantConversation.accept')(
  function* (input: {
    readonly credential: AssistantCredentialReference
    readonly row: ConversationDirectoryEntry
    readonly operation: ConversationSend | ConversationRetry
    readonly executionBusy?: boolean
    readonly ledger: ConversationAdmissionLedger
    readonly savedText: (attemptId: string) => string
    readonly limits: {
      readonly deadlineMs: number
      readonly activeLimit: number
      readonly rateLimit: number
    }
  }) {
    const { credential, row, operation, ledger, limits } = input
    const authority = yield* AssistantAuthority
    const context = yield* authority.authorize({
      credential,
      workspaceId: row.workspaceId,
      creatorUserId: row.creatorUserId,
      requiredPermissions: row.requiredPermissions,
      operation: 'write',
      mode: 'observe'
    })
    const hash = yield* Effect.tryPromise(() =>
      hashSha256(canonicalConversationOperation(operation))
    )
    const latest = yield* ledger.latestAttempt()
    let retry: Parameters<typeof admitConversationOperation>[0]['retry']
    if ('attemptId' in operation) {
      retry = {
        target: yield* ledger.attempt(operation.attemptId),
        latestQuestionId: latest?.questionId ?? null,
        latestAttemptId: latest?.id ?? null
      }
    }
    const joined = yield* admitConversationOperation({
      payloadHash: hash,
      previous: yield* ledger.previous(operation.idempotencyKey),
      active: yield* ledger.active(),
      executionBusy: input.executionBusy,
      retry
    })
    if (joined !== null) {
      return joined
    }
    let question: ConversationQuestion | null = null
    if ('question' in operation) {
      question = {
        id: yield* newCapabilityId('question'),
        text: operation.question,
        taskId: operation.taskId ?? null,
        createdAt: DateTime.formatIso(yield* DateTime.now)
      }
    } else if (latest !== null) {
      question = yield* ledger.question(latest.questionId)
    }
    if (question === null) {
      return yield* new ConversationNotFound()
    }
    if (question.taskId !== null) {
      yield* authority.authorize({
        credential,
        workspaceId: row.workspaceId,
        creatorUserId: row.creatorUserId,
        requiredPermissions: [...row.requiredPermissions, 'webhook:list'],
        operation: 'write',
        mode: 'observe'
      })
    }
    const evidence = yield* assistantTaskEvidence(question.taskId).pipe(
      Effect.provideService(WorkspaceContext, context)
    )
    const questions = yield* ledger.questions()
    const attempts = yield* ledger.attempts()
    const history = questions.flatMap((prior) => {
      const completed = attempts.find(
        (attempt) => attempt.questionId === prior.id && attempt.status === 'Completed'
      )
      if (completed === undefined) {
        return []
      }
      const exchange: ConversationPrompt['history'][number] = {
        questionId: prior.id,
        question: prior.text,
        answer: input.savedText(completed.id)
      }
      if (completed.evidence !== null) {
        Object.assign(exchange, { evidence: completed.evidence })
      }
      return [exchange]
    })
    const model = yield* ConversationModel
    const request: ConversationPrompt = {
      workspaceSlug: context.workspace.slug,
      question: question.text,
      history
    }
    if (evidence !== null) {
      Object.assign(request, { evidence })
    }
    const prompt = yield* model.prepare(request)
    const directory = yield* AssistantDirectory
    if (evidence !== null) {
      yield* directory.raisePolicy(row.id, ['webhook:list'])
    }
    const now = DateTime.toEpochMillis(yield* DateTime.now)
    const attempt: ConversationAttempt = {
      id: yield* newCapabilityId('attempt'),
      questionId: question.id,
      createdAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
      deadline: now + limits.deadlineMs,
      status: 'Accepted',
      reason: null,
      completedAt: null,
      provider: null,
      modelId: null,
      providerRequestId: null,
      finishReason: null,
      inputTokens: null,
      outputTokens: null,
      omittedExchanges: prompt.omittedExchanges,
      evidence
    }
    const admission = yield* AssistantAdmission
    yield* admission.reserve({
      id: attempt.id,
      conversationId: row.id,
      workspaceId: row.workspaceId,
      userId: credential.userId,
      deadline: attempt.deadline,
      activeLimit: limits.activeLimit,
      rateLimit: limits.rateLimit
    })
    const acceptance = { question, attempt, joined: false }
    yield* ledger
      .accept({
        key: operation.idempotencyKey,
        hash,
        acceptance,
        execution: { credential, prompt, runAccessRevision: row.runAccessRevision }
      })
      .pipe(
        Effect.catch((error) =>
          admission.release(attempt.id).pipe(Effect.andThen(Effect.fail(error)))
        )
      )
    yield* admission.commit(attempt.id).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* ledger.update({
            ...attempt,
            status: 'Interrupted',
            reason: 'storage',
            completedAt: DateTime.formatIso(yield* DateTime.now)
          })
          yield* admission.release(attempt.id)
          return yield* Effect.fail(error)
        })
      )
    )
    return acceptance
  }
)
