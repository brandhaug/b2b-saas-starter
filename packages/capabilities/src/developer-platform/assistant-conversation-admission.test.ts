import { expect, it } from '@effect/vitest'
import { Effect, Stream } from 'effect'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import {
  ConversationModel,
  ConversationModelUnavailable
} from '@b2b-saas-starter/ai/conversation'
import {
  prepareConversationContext,
  type ConversationPrompt
} from '@b2b-saas-starter/ai/conversation-context'
import { WorkspaceContext } from '../workspace-context.ts'
import { WebhookInvestigationTasks } from './webhook-investigation-tasks.ts'
import { AssistantDirectory } from '../assistant/directory.ts'
import { AssistantAdmission } from '../assistant/admission.ts'
import { SeedLayer } from '../layers.ts'
import {
  demoUserIdentity,
  seedAssistantSessionId,
  seedWorkspaceRecord
} from '../seed-fixture.ts'
import {
  acceptConversationAnswer,
  type ConversationAdmissionLedger
} from './assistant-conversation-admission.ts'
import { makeSeedConversationLedger } from './assistant-conversation-ledger.seed.ts'
import {
  ConversationUnavailable,
  type ConversationSend,
  type ConversationRetry
} from './assistant-conversation.ts'

const credential = {
  kind: 'session',
  userId: demoUserIdentity.id,
  sessionId: seedAssistantSessionId,
  expiresAt: Number.MAX_SAFE_INTEGER
} satisfies AssistantCredentialReference
const limits = {
  maxInputTokens: 64_000,
  maxOutputTokens: 16_000,
  providerContextTokens: 128_000,
  providerOutputTokens: 16_000
}
const setup = Effect.fn('ConversationAdmissionTest.setup')(function* (
  options: {
    failCommit?: boolean
    unavailableModel?: boolean
    maxInputTokens?: number
    activeLimit?: number
    rateLimit?: number
  } = {}
) {
  const directory = yield* AssistantDirectory
  const admission = yield* AssistantAdmission
  const row = yield* directory.create({
    id: 'admission-test',
    workspaceId: seedWorkspaceRecord.id,
    creatorUserId: credential.userId
  })
  const store = makeSeedConversationLedger()
  const calls: Array<string> = []
  const prompts: Array<ConversationPrompt> = []
  const model = ConversationModel.of({
    prepare: Effect.fn('AdmissionTest.prepare')(function* (input) {
      prompts.push(input)
      if (options.unavailableModel) {
        return yield* new ConversationModelUnavailable({
          reason: 'unconfigured',
          message: 'No provider configured.'
        })
      }
      return yield* prepareConversationContext(input, {
        ...limits,
        maxInputTokens: options.maxInputTokens ?? limits.maxInputTokens
      })
    }),
    stream: () => Stream.empty
  })
  const counted = AssistantAdmission.of({
    ...admission,
    reserve: Effect.fn('AdmissionTest.reserve')((input) => {
      calls.push('reserve')
      return admission.reserve(input)
    }),
    commit: Effect.fn('AdmissionTest.commit')(function* (id) {
      calls.push('commit')
      if (options.failCommit) {
        return yield* new CapabilityUnavailable({
          capability: 'assistant-admission',
          reason: 'unavailable'
        })
      }
      yield* admission.commit(id)
    }),
    release: Effect.fn('AdmissionTest.release')((id) => {
      calls.push('release')
      return admission.release(id)
    })
  })
  const accept = Effect.fn('AdmissionTest.accept')(
    (
      operation: ConversationSend | ConversationRetry,
      ledger: ConversationAdmissionLedger = store.ledger,
      executionBusy = false
    ) =>
      acceptConversationAnswer({
        credential,
        row,
        operation,
        ledger,
        executionBusy,
        savedText: (id) => store.texts.get(id) ?? '',
        limits: {
          deadlineMs: 300_000,
          activeLimit: options.activeLimit ?? 3,
          rateLimit: options.rateLimit ?? 20
        }
      }).pipe(
        Effect.provideService(ConversationModel, model),
        Effect.provideService(AssistantAdmission, counted)
      )
  )
  return { store, accept, calls, prompts, admission, row }
})

it.effect(
  'refuses an unconfigured model and oversized current context before quota or ledger writes',
  () =>
    Effect.gen(function* () {
      const unavailable = yield* setup({ unavailableModel: true })
      expect(
        (yield* unavailable
          .accept({ question: 'Hello', idempotencyKey: 'no-model' })
          .pipe(Effect.flip))._tag
      ).toBe('ConversationModelUnavailable')
      expect(unavailable.calls).toEqual([])
      expect(yield* unavailable.store.ledger.questions()).toEqual([])
      const small = yield* setup({ maxInputTokens: 100 })
      expect(
        (yield* small
          .accept({ question: 'Hello', idempotencyKey: 'too-large' })
          .pipe(Effect.flip))._tag
      ).toBe('ConversationInputRejected')
      expect(small.calls).toEqual([])
    }).pipe(Effect.provide(SeedLayer))
)

it.effect(
  'joins canonical duplicates before a full quota and an execution drain, while rejecting distinct input',
  () =>
    Effect.gen(function* () {
      const host = yield* setup({ activeLimit: 1, rateLimit: 1 })
      const operation = { question: 'Hello', idempotencyKey: 'first' }
      const first = yield* host.accept(operation)
      expect((yield* host.accept(operation, host.store.ledger, true)).attempt.id).toBe(
        first.attempt.id
      )
      expect(
        yield* host
          .accept({ ...operation, question: 'Changed' }, host.store.ledger, true)
          .pipe(Effect.flip)
      ).toMatchObject({
        _tag: 'ConversationConflict',
        reason: 'idempotency_key_reused'
      })
      expect(
        yield* host
          .accept(
            { ...operation, idempotencyKey: 'different' },
            host.store.ledger,
            true
          )
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: 'ConversationConflict', reason: 'busy' })
      expect(host.calls).toEqual(['reserve', 'commit'])
      expect(host.prompts).toHaveLength(1)
    }).pipe(Effect.provide(SeedLayer))
)

it.effect(
  'keeps one question across Retry and includes only successful historical answers',
  () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const failed = yield* host.accept({
        question: 'First question',
        idempotencyKey: 'first'
      })
      yield* host.store.ledger.update({
        ...failed.attempt,
        status: 'Interrupted',
        reason: 'provider'
      })
      host.store.texts.set(failed.attempt.id, 'Partial failed answer')
      yield* host.admission.release(failed.attempt.id)
      const retry = yield* host.accept({
        attemptId: failed.attempt.id,
        idempotencyKey: 'retry'
      })
      expect(retry.question.id).toBe(failed.question.id)
      expect(host.prompts[1]?.history).toEqual([])
      yield* host.store.ledger.update({ ...retry.attempt, status: 'Completed' })
      host.store.texts.set(retry.attempt.id, 'Successful answer')
      yield* host.admission.release(retry.attempt.id)
      yield* host.accept({ question: 'Follow up', idempotencyKey: 'follow-up' })
      expect(host.prompts[2]?.history).toEqual([
        {
          questionId: failed.question.id,
          question: 'First question',
          answer: 'Successful answer'
        }
      ])
      expect(yield* host.store.ledger.questions()).toHaveLength(2)
      expect(yield* host.store.ledger.attempts()).toHaveLength(3)
    }).pipe(Effect.provide(SeedLayer))
)

it.effect(
  'releases a reservation if atomic ledger acceptance fails without charging a second attempt',
  () =>
    Effect.gen(function* () {
      const host = yield* setup({ activeLimit: 1 })
      const broken: ConversationAdmissionLedger = {
        ...host.store.ledger,
        accept: () => Effect.fail(new ConversationUnavailable({ reason: 'storage' }))
      }
      expect(
        (yield* host
          .accept({ question: 'Hello', idempotencyKey: 'failed' }, broken)
          .pipe(Effect.flip))._tag
      ).toBe('ConversationUnavailable')
      expect(host.calls).toEqual(['reserve', 'release'])
      expect(yield* host.store.ledger.attempts()).toEqual([])
      yield* host.accept({ question: 'Hello', idempotencyKey: 'retry-delivery' })
      expect(host.calls).toEqual(['reserve', 'release', 'reserve', 'commit'])
    }).pipe(Effect.provide(SeedLayer))
)

it.effect(
  'marks a saved attempt Interrupted and releases its slot if reservation commit fails',
  () =>
    Effect.gen(function* () {
      const host = yield* setup({ failCommit: true, activeLimit: 1 })
      const operation = { question: 'Hello', idempotencyKey: 'commit-failed' }
      expect((yield* host.accept(operation).pipe(Effect.flip))._tag).toBe(
        'CapabilityUnavailable'
      )
      expect(host.calls).toEqual(['reserve', 'commit', 'release'])
      const saved = (yield* host.store.ledger.attempts())[0]
      expect(saved).toMatchObject({ status: 'Interrupted', reason: 'storage' })
      const joined = yield* host.accept(operation)
      expect(joined.attempt.id).toBe(saved?.id)
      expect(joined.joined).toBe(true)
      expect(host.calls).toEqual(['reserve', 'commit', 'release'])
    }).pipe(Effect.provide(SeedLayer))
)

it.effect(
  'captures current task evidence, raises the content policy, and carries its historical source forward',
  () =>
    Effect.gen(function* () {
      const host = yield* setup()
      const tasks = yield* WebhookInvestigationTasks
      const task = yield* tasks.create({
        deliveryId: 'whd_seed_dead_lettered',
        question: 'Explain failure'
      })
      const accepted = yield* host.accept({
        question: 'Explain this task',
        taskId: task.id,
        idempotencyKey: 'task'
      })
      expect(accepted.attempt.evidence).toMatchObject({
        taskId: task.id,
        sourceId: 'whd_seed_dead_lettered'
      })
      const policy = yield* (yield* AssistantDirectory).get(host.row.id)
      expect(policy?.requiredPermissions).toContain('webhook:list')
      expect(policy?.policyRevision).toBeGreaterThan(0)
      yield* host.store.ledger.update({ ...accepted.attempt, status: 'Completed' })
      host.store.texts.set(accepted.attempt.id, 'Task explanation')
      yield* host.admission.release(accepted.attempt.id)
      yield* host.accept({ question: 'What changed?', idempotencyKey: 'follow-up' })
      expect(host.prompts[1]?.history[0]?.evidence).toEqual(accepted.attempt.evidence)
      expect(host.prompts[1]?.evidence).toBeUndefined()
    }).pipe(
      Effect.provideService(WorkspaceContext, {
        workspace: seedWorkspaceRecord,
        actor: { userId: demoUserIdentity.id, role: 'owner', systemRole: 'user' },
        actorType: 'user'
      }),
      Effect.provide(SeedLayer)
    )
)

it.effect(
  'charges new attempts against the shared rolling limit after completed answers release slots',
  () =>
    Effect.gen(function* () {
      const host = yield* setup({ rateLimit: 1 })
      const first = yield* host.accept({ question: 'Hello', idempotencyKey: 'first' })
      yield* host.store.ledger.update({ ...first.attempt, status: 'Completed' })
      yield* host.admission.release(first.attempt.id)
      expect(
        yield* host
          .accept({ question: 'Next', idempotencyKey: 'next' })
          .pipe(Effect.flip)
      ).toMatchObject({
        _tag: 'AssistantAdmissionRefused',
        reason: 'generation_rate_limit'
      })
      expect(yield* host.store.ledger.questions()).toHaveLength(1)
    }).pipe(Effect.provide(SeedLayer))
)

it.effect(
  'treats an empty ledger as absent and rejects duplicate atomic acceptance without rewriting terminal state',
  () =>
    Effect.gen(function* () {
      const host = yield* setup()
      expect(yield* host.store.ledger.latestAttempt()).toBeNull()
      expect(yield* host.store.ledger.active()).toBeNull()
      expect(yield* host.store.ledger.question('absent')).toBeNull()
      expect(yield* host.store.ledger.attempt('absent')).toBeNull()
      expect((yield* host.store.execution('absent').pipe(Effect.flip))._tag).toBe(
        'ConversationUnavailable'
      )
      const accepted = yield* host.accept({
        question: 'Hello',
        idempotencyKey: 'first'
      })
      const execution = yield* host.store.execution(accepted.attempt.id)
      const replay = yield* host.store.ledger.previous('first')
      if (replay === null) {
        return yield* Effect.die('Accepted key is absent.')
      }
      expect(
        (yield* host.store.ledger
          .accept({
            key: 'first',
            hash: replay.payloadHash,
            acceptance: accepted,
            execution
          })
          .pipe(Effect.flip))._tag
      ).toBe('ConversationUnavailable')
      expect(yield* host.store.ledger.questions()).toHaveLength(1)
      yield* host.store.ledger.update({ ...accepted.attempt, status: 'Stopped' })
      expect(
        yield* host.store.ledger.update({ ...accepted.attempt, status: 'Completed' })
      ).toBe(false)
      expect(
        yield* host.store.ledger.update({ ...accepted.attempt, id: 'absent' })
      ).toBe(false)
      expect((yield* host.store.ledger.attempt(accepted.attempt.id))?.status).toBe(
        'Stopped'
      )
    }).pipe(Effect.provide(SeedLayer))
)

it.effect(
  'refuses Retry when its saved target or question is absent without reserving another slot',
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      expect(
        (yield* fixture
          .accept({ attemptId: 'absent', idempotencyKey: 'missing' })
          .pipe(Effect.flip))._tag
      ).toBe('ConversationConflict')
      expect(fixture.calls).toEqual([])
      const accepted = yield* fixture.accept({
        question: 'Saved question',
        idempotencyKey: 'original'
      })
      yield* fixture.store.ledger.update({ ...accepted.attempt, status: 'Interrupted' })
      yield* fixture.admission.release(accepted.attempt.id)
      const before = fixture.calls.length
      const missingQuestion = {
        ...fixture.store.ledger,
        question: () => Effect.succeed(null)
      } satisfies ConversationAdmissionLedger
      expect(
        (yield* fixture
          .accept(
            { attemptId: accepted.attempt.id, idempotencyKey: 'orphan' },
            missingQuestion
          )
          .pipe(Effect.flip))._tag
      ).toBe('ConversationNotFound')
      expect(fixture.calls).toHaveLength(before)
    }).pipe(Effect.provide(SeedLayer))
)
