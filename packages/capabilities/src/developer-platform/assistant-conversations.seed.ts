import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Effect, Fiber, Schema, Semaphore } from 'effect'
import { type ConversationModel } from '@b2b-saas-starter/ai/conversation'
import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import { type AuditEventLog } from '../governance/audit-event-log.ts'
import { AssistantDirectory } from '../assistant/directory.ts'
import {
  AssistantAdmission,
  AssistantAdmissionRefused
} from '../assistant/admission.ts'
import { type AssistantLifecycleBinding } from '../assistant/lifecycle.ts'
import { ConversationInputRejected } from '@b2b-saas-starter/ai/conversation-context'
import {
  type AssistantAuthority,
  AssistantAuthorityDenied
} from './assistant-authority.ts'
import { type WebhookInvestigationTasks } from './webhook-investigation-tasks.ts'
import { type AssistantConversationTransport } from './assistant-conversation-transport.ts'
import { acceptConversationAnswer } from './assistant-conversation-admission.ts'
import {
  authorizeConversation,
  executeConversationAnswer,
  finishConversationAttempt
} from './assistant-conversation-execution.ts'
import { observeConversationAttempt } from './assistant-conversation-events.ts'
import { makeSeedConversationLedger } from './assistant-conversation-ledger.seed.ts'
import {
  activeConversationAttempt,
  conversationTitle,
  ConversationSend,
  ConversationRetry,
  ConversationNotFound,
  ConversationConflict,
  ConversationUnavailable,
  type ConversationAttempt,
  conversationHistoryPage
} from './assistant-conversation.ts'

const decodeSend = Schema.decodeUnknownEffect(ConversationSend)
const decodeRetry = Schema.decodeUnknownEffect(ConversationRetry)
const decodeStop = Schema.decodeUnknownEffect(
  Schema.Struct({ attemptId: Schema.String })
)
const decodeFailure = Schema.decodeUnknownResult(
  Schema.Union([
    ConversationInputRejected,
    ConversationNotFound,
    ConversationConflict,
    ConversationUnavailable,
    AssistantAdmissionRefused,
    AssistantAuthorityDenied
  ])
)
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

function failure(decoded: ReturnType<typeof decodeFailure>): Response {
  if (decoded._tag === 'Failure') {
    return Response.json(
      { _tag: 'ConversationUnavailable', reason: 'storage' },
      { status: 503 }
    )
  }
  const value = decoded.success
  let status = 503
  switch (value._tag) {
    case 'ConversationUnavailable': {
      break
    }
    case 'ConversationInputRejected': {
      status = 400
      break
    }
    case 'ConversationNotFound': {
      status = 404
      break
    }
    case 'ConversationConflict': {
      status = 409
      break
    }
    case 'AssistantAdmissionRefused': {
      status = 429
      break
    }
    case 'AssistantAuthorityDenied': {
      status = 403
      break
    }
  }
  return Response.json(value, { status })
}

function exportCredential(
  input: Parameters<AssistantLifecycleBinding['exportConversation']>[0]
): AssistantCredentialReference {
  return {
    kind: 'session',
    userId: input.userId,
    sessionId: input.sessionId,
    expiresAt: Number.MAX_SAFE_INTEGER
  }
}

/** In-memory host for Seed composition. Its model is supplied explicitly by the layer. */
export const makeSeedAssistantConversationHost = Effect.fn('SeedConversationHost.make')(
  function* () {
    const directory = yield* AssistantDirectory
    const admission = yield* AssistantAdmission
    const scope = yield* Effect.scope
    const context = yield* Effect.context<
      | AssistantDirectory
      | AssistantAuthority
      | AssistantAdmission
      | ConversationModel
      | WebhookInvestigationTasks
      | AuditEventLog
    >()
    const run = Effect.runPromiseWith(context)
    type State = ReturnType<typeof makeSeedConversationLedger> & {
      id: string
      lock: Semaphore.Semaphore
      fiber: Fiber.Fiber<void, CapabilityUnavailable | ConversationUnavailable> | null
      executing: boolean
    }
    const conversations = new Map<string, State>()
    function state(id: string): State {
      const existing = conversations.get(id)
      if (existing !== undefined) {
        return existing
      }
      const created: State = {
        ...makeSeedConversationLedger(),
        id,
        lock: Semaphore.makeUnsafe(1),
        fiber: null,
        executing: false
      }
      conversations.set(id, created)
      return created
    }
    const authorized = Effect.fn('SeedConversationHost.authorize')(function* (
      id: string,
      credential: AssistantCredentialReference,
      operation: 'read' | 'write'
    ) {
      return (yield* authorizeConversation(id, credential, operation)).row
    })
    const generate = Effect.fn('SeedConversationHost.generate')(function* (
      id: string,
      store: State,
      accepted: ConversationAttempt
    ) {
      const execution = yield* store.execution(accepted.id)
      yield* executeConversationAnswer({
        conversationId: id,
        attempt: accepted,
        execution,
        ledger: store.ledger,
        emit: (event) => {
          if (event.type === 'text-delta') {
            store.texts.set(
              accepted.id,
              (store.texts.get(accepted.id) ?? '') + event.text
            )
          }
        },
        persistOutput: Effect.void,
        finish: (attempt, status, reason) =>
          finishConversationAttempt(
            store.ledger,
            store.id,
            attempt,
            status,
            reason
          ).pipe(Effect.asVoid)
      }).pipe(Effect.catch(() => Effect.void))
    })
    const history = Effect.fn('SeedConversationHost.history')(function* (
      id: string,
      credential: AssistantCredentialReference,
      cursor?: string,
      full = false
    ) {
      const row = yield* authorized(id, credential, 'read')
      const store = state(id)
      const questions = yield* store.ledger.questions()
      const attempts = yield* store.ledger.attempts()
      const page = conversationHistoryPage({
        questions,
        attempts,
        cursor: cursor ?? null,
        full,
        policyRevision: row.policyRevision,
        text: (attemptId) => store.texts.get(attemptId) ?? ''
      })
      if (!(yield* directory.policyMatches(id, row.policyRevision))) {
        return yield* new ConversationUnavailable({ reason: 'authority' })
      }
      return page
    })
    const dispatch = Effect.fn('SeedConversationHost.dispatch')(function* (
      input: Parameters<AssistantConversationTransport['request']>[0]
    ) {
      const { id } = input.address
      const write = ['send', 'retry', 'stop'].includes(input.action)
      let permission: 'read' | 'write' = 'read'
      if (write) {
        permission = 'write'
      }
      const row = yield* authorized(id, input.credential, permission)
      const store = state(id)
      if (input.action === 'read') {
        const first = (yield* store.ledger.questions())[0]
        let title: string | null = null
        if (first !== undefined) {
          title = conversationTitle(first.text)
        }
        return Response.json({
          id,
          workspaceId: row.workspaceId,
          createdAt: row.createdAt,
          title,
          activeAttempt: yield* store.ledger.active(),
          policyRevision: row.policyRevision
        })
      }
      if (input.action === 'history' || input.action === 'export') {
        return Response.json(
          yield* history(id, input.credential, input.cursor, input.action === 'export')
        )
      }
      if (input.action === 'stop') {
        const { attemptId } = yield* decodeStop(input.body)
        return yield* Effect.gen(function* () {
          const attempt = yield* store.ledger.attempt(attemptId)
          if (attempt === null) {
            return yield* new ConversationNotFound()
          }
          if (!activeConversationAttempt(attempt)) {
            return Response.json(attempt)
          }
          yield* finishConversationAttempt(
            store.ledger,
            store.id,
            attempt,
            'Stopped',
            'stopped'
          )
          if (store.fiber !== null) {
            yield* Fiber.interrupt(store.fiber)
            store.fiber = null
          }
          return Response.json(yield* store.ledger.attempt(attemptId))
        }).pipe(store.lock.withPermits(1))
      }
      if (input.action === 'send' || input.action === 'retry') {
        let operation: ConversationSend | ConversationRetry
        if (input.action === 'send') {
          operation = yield* decodeSend(input.body)
        } else {
          operation = yield* decodeRetry(input.body)
        }
        return yield* Effect.gen(function* () {
          const accepted = yield* acceptConversationAnswer({
            credential: input.credential,
            row,
            operation,
            ledger: store.ledger,
            executionBusy: store.executing,
            savedText: (attemptId) => store.texts.get(attemptId) ?? '',
            limits: { deadlineMs: 300_000, activeLimit: 3, rateLimit: 20 }
          })
          if (!accepted.joined) {
            store.executing = true
            store.fiber = yield* generate(id, store, accepted.attempt).pipe(
              Effect.catch(() =>
                finishConversationAttempt(
                  store.ledger,
                  store.id,
                  accepted.attempt,
                  'Interrupted',
                  'provider'
                ).pipe(Effect.asVoid)
              ),
              Effect.ensuring(
                Effect.sync(() => {
                  store.executing = false
                })
              ),
              Effect.forkIn(scope)
            )
          }
          let status = 202
          if (accepted.joined) {
            status = 200
          }
          return Response.json(accepted, { status })
        }).pipe(store.lock.withPermits(1))
      }
      if (input.action === 'events') {
        const snapshot = Effect.gen(function* () {
          const current = yield* directory.get(id)
          if (current?.runAccessRevision !== row.runAccessRevision) {
            return yield* new ConversationUnavailable({ reason: 'authority' })
          }
          const page = yield* history(id, input.credential, undefined, true)
          const exchange = page.items.find((item) =>
            item.attempts.some((attempt) => attempt.id === input.attemptId)
          )
          const attempt = exchange?.attempts.find(
            (candidate) => candidate.id === input.attemptId
          )
          if (exchange === undefined || attempt === undefined) {
            return yield* new ConversationNotFound()
          }
          return {
            question: exchange.question,
            attempt,
            policyRevision: page.policyRevision
          }
        })
        yield* snapshot
        return yield* observeConversationAttempt(
          id,
          snapshot,
          input.lastEventId ?? input.request?.headers.get('last-event-id') ?? null
        )
      }
      return yield* new ConversationUnavailable({ reason: 'configuration' })
    })
    const transport: AssistantConversationTransport = {
      request: (input) =>
        run(
          dispatch(input).pipe(
            Effect.catchTag('ConversationModelUnavailable', () =>
              Effect.fail(new ConversationUnavailable({ reason: 'configuration' }))
            ),
            Effect.catch((error) => Effect.succeed(failure(decodeFailure(error))))
          )
        )
    }

    const lifecycle: AssistantLifecycleBinding = {
      exportConversation: (input) =>
        run(
          history(input.conversationId, exportCredential(input), undefined, true).pipe(
            Effect.map((page) => ({ json: encodeJson(page) }))
          )
        ),
      revalidateConversation: (input) =>
        run(
          authorized(input.conversationId, exportCredential(input), 'read').pipe(
            Effect.map((row) => row.policyRevision === input.policyRevision),
            Effect.catch(() => Effect.succeed(false))
          )
        ),
      destroyConversation: (input) =>
        run(
          Effect.gen(function* () {
            const row = yield* directory.get(input.conversationId)
            if (
              row?.deletedAt === null ||
              row === null ||
              row.workspaceId !== input.workspaceId ||
              row.creatorUserId !== input.creatorUserId
            ) {
              return yield* new ConversationNotFound()
            }
            const store = conversations.get(row.id)
            if (store !== undefined) {
              if (store.fiber !== null) {
                yield* Fiber.interrupt(store.fiber)
              }
              const active = yield* store.ledger.active()
              if (active !== null) {
                yield* admission.release(active.id)
              }
            }
            conversations.delete(row.id)
          })
        )
    }
    return { transport, lifecycle }
  }
)
