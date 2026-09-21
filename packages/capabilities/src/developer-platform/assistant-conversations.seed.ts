import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { DateTime, Effect, Fiber, Schema, Semaphore, Stream } from 'effect'
import { ConversationModel } from '@b2b-saas-starter/ai/conversation'
import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import { AssistantDirectory } from '../assistant/directory.ts'
import {
  AssistantAdmission,
  AssistantAdmissionRefused
} from '../assistant/admission.ts'
import { type AssistantLifecycleBinding } from '../assistant/lifecycle.ts'
import { ConversationInputRejected } from '@b2b-saas-starter/ai/conversation-context'
import { AssistantAuthority, AssistantAuthorityDenied } from './assistant-authority.ts'
import { type WebhookInvestigationTasks } from './webhook-investigation-tasks.ts'
import { type AssistantConversationTransport } from './assistant-conversation-transport.ts'
import { acceptConversationAnswer } from './assistant-conversation-admission.ts'
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
    const authority = yield* AssistantAuthority
    const admission = yield* AssistantAdmission
    const model = yield* ConversationModel
    const scope = yield* Effect.scope
    const context = yield* Effect.context<
      | AssistantDirectory
      | AssistantAuthority
      | AssistantAdmission
      | ConversationModel
      | WebhookInvestigationTasks
    >()
    const run = Effect.runPromiseWith(context)
    type State = ReturnType<typeof makeSeedConversationLedger> & {
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
      operation: 'read' | 'write',
      attempt?: ConversationAttempt,
      runAccessRevision?: number
    ) {
      const row = yield* directory.get(id)
      if (row?.deletedAt !== null) {
        return yield* new ConversationNotFound()
      }
      if (attempt !== undefined && row.runAccessRevision !== runAccessRevision) {
        return yield* new ConversationUnavailable({ reason: 'authority' })
      }
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
      yield* authority.authorize({
        credential,
        workspaceId: row.workspaceId,
        creatorUserId: row.creatorUserId,
        requiredPermissions: row.requiredPermissions,
        operation,
        ...mode
      })
      return row
    })
    const terminal = Effect.fn('SeedConversationHost.terminal')(function* (
      store: State,
      attempt: ConversationAttempt,
      status: 'Stopped' | 'Interrupted' | 'Completed',
      reason: string | null
    ) {
      if (
        yield* store.ledger.update({
          ...attempt,
          status,
          reason,
          completedAt: DateTime.formatIso(yield* DateTime.now)
        })
      ) {
        yield* admission.release(attempt.id)
      }
    })
    const generate = Effect.fn('SeedConversationHost.generate')(function* (
      id: string,
      store: State,
      accepted: ConversationAttempt
    ) {
      const execution = yield* store.execution(accepted.id)
      let current: ConversationAttempt = { ...accepted, status: 'Running' }
      yield* store.ledger.update(current)
      const consume = model.stream(execution.prompt).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            yield* authorized(
              id,
              execution.credential,
              'write',
              current,
              execution.runAccessRevision
            )
            const saved = yield* store.ledger.attempt(current.id)
            if (saved === null || !activeConversationAttempt(saved)) {
              return yield* new ConversationNotFound()
            }
            if (event.type === 'text-delta') {
              store.texts.set(
                current.id,
                (store.texts.get(current.id) ?? '') + event.text
              )
            } else if (event.type === 'metadata') {
              current = {
                ...current,
                provider: event.provider,
                modelId: event.modelId,
                providerRequestId: event.providerRequestId ?? null
              }
              yield* store.ledger.update(current)
            } else {
              current = {
                ...current,
                finishReason: event.reason,
                inputTokens: event.inputTokens ?? null,
                outputTokens: event.outputTokens ?? null
              }
              yield* store.ledger.update(current)
            }
          })
        )
      )
      const check = authorized(
        id,
        execution.credential,
        'write',
        accepted,
        execution.runAccessRevision
      )
      const watch = Effect.sleep('15 seconds').pipe(
        Effect.andThen(check),
        Effect.forever
      )
      yield* check.pipe(
        Effect.andThen(consume),
        Effect.raceFirst(watch),
        Effect.timeout(
          Math.max(1, accepted.deadline - DateTime.toEpochMillis(yield* DateTime.now))
        ),
        Effect.matchEffect({
          onFailure: (error) => {
            let reason = 'provider'
            if (
              error._tag === 'ConversationModelFailure' &&
              error.reason === 'output-limit'
            ) {
              reason = 'output_limit'
            } else if (
              error._tag === 'AssistantAuthorityDenied' ||
              error._tag === 'ConversationNotFound' ||
              (error._tag === 'ConversationUnavailable' && error.reason === 'authority')
            ) {
              reason = 'authority'
            } else if (error._tag === 'TimeoutError') {
              reason = 'deadline_or_stop'
            }
            return terminal(store, current, 'Interrupted', reason)
          },
          onSuccess: () => terminal(store, current, 'Completed', null)
        })
      )
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
          yield* terminal(store, attempt, 'Stopped', 'stopped')
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
                terminal(store, accepted.attempt, 'Interrupted', 'provider')
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
        const stream = Stream.unfold({ first: true, done: false }, (cursor) =>
          Effect.gen(function* () {
            if (cursor.done) {
              return
            }
            if (!cursor.first) {
              yield* Effect.sleep('25 millis')
            }
            const value = yield* snapshot
            const done = !activeConversationAttempt(value.attempt)
            const json = encodeJson(value)
            let event = `event: snapshot\ndata: ${json}\n\n`
            if (done) {
              event += `event: terminal\ndata: ${json}\n\n`
            }
            return [event, { first: false, done }] satisfies [
              string,
              { first: boolean; done: boolean }
            ]
          })
        ).pipe(
          Stream.catch(() =>
            Stream.succeed('event: terminal\ndata: {"error":"access_unavailable"}\n\n')
          ),
          Stream.map((text) => new TextEncoder().encode(text))
        )
        const body = yield* Stream.toReadableStreamEffect(stream)
        return new Response(body, {
          headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }
        })
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
