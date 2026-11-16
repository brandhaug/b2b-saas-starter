import { UserId, WorkspaceId } from '@b2b-saas-starter/db/ids'
import { expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { AssistantDirectory } from '../assistant/directory.ts'
import { SeedAssistantDirectory } from '../assistant/directory.seed.ts'
import {
  AssistantConversationLifecycle,
  AssistantConversationLifecycleLayer
} from '../assistant/lifecycle.ts'
import {
  conversationTransport,
  conversationLifecycleBinding,
  conversationInvalidationBinding,
  type ConversationNamespace
} from './assistant-conversation-transport.ts'
import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'

const credential = {
  kind: 'session',
  userId: UserId.make('user'),
  sessionId: 'session',
  expiresAt: Number.MAX_SAFE_INTEGER
} satisfies AssistantCredentialReference
const address = {
  id: 'conversation',
  workspaceId: WorkspaceId.make('workspace'),
  creatorUserId: UserId.make('user')
}
const authority = {
  conversationId: address.id,
  workspaceId: address.workspaceId,
  creatorUserId: address.creatorUserId,
  userId: UserId.make('user'),
  sessionId: 'session',
  policyRevision: 7
}

it.effect(
  'addresses the immutable object and strips browser credentials while forwarding observation and mutation data',
  () =>
    Effect.gen(function* () {
      const names: Array<string> = []
      const requests: Array<Request> = []
      const namespace: ConversationNamespace = {
        getByName: (name) => {
          names.push(name)
          return {
            fetch: (request) => {
              requests.push(request)
              return Promise.resolve(Response.json({}))
            }
          }
        }
      }
      const transport = conversationTransport(namespace)
      yield* Effect.promise(() =>
        transport.request({ address, credential, action: 'read' })
      )
      yield* Effect.promise(() =>
        transport.request({
          address,
          credential,
          action: 'events',
          cursor: 'page-cursor',
          attemptId: 'attempt',
          lastEventId: 'event-cursor',
          request: new Request('https://web.test', {
            headers: {
              authorization: 'Bearer secret',
              cookie: 'session=secret',
              'x-request-id': 'trace'
            }
          })
        })
      )
      yield* Effect.promise(() =>
        transport.request({
          address,
          credential,
          action: 'send',
          body: { question: 'Hello', idempotencyKey: 'key' }
        })
      )
      expect(names).toEqual(
        Array.from({ length: 3 }, () => '["workspace","user","conversation"]')
      )
      expect(requests[0]?.method).toBe('GET')
      expect(requests[1]?.headers.get('authorization')).toBeNull()
      expect(requests[1]?.headers.get('cookie')).toBeNull()
      expect(requests[1]?.headers.get('last-event-id')).toBe('event-cursor')
      expect(requests[1]?.headers.get('x-starter-assistant-context')).toContain(
        'conversationId'
      )
      expect(requests[1]?.url).toContain('attemptId=attempt')
      expect(requests[1]?.url).toContain('cursor=page-cursor')
      const mutation = requests[2]
      if (mutation === undefined) {
        return yield* Effect.die('Mutation request is absent.')
      }
      expect(mutation.method).toBe('POST')
      expect(yield* Effect.promise(() => mutation.json())).toEqual({
        question: 'Hello',
        idempotencyKey: 'key'
      })
    })
)

it.effect(
  'revalidates export revisions, refuses stale authority, and surfaces host storage failures',
  () =>
    Effect.gen(function* () {
      let status = 200
      let revision = 7
      const requests: Array<Request> = []
      const binding = conversationLifecycleBinding({
        getByName: () => ({
          fetch: (request) => {
            requests.push(request)
            return Promise.resolve(
              Response.json({ policyRevision: revision, items: [] }, { status })
            )
          }
        })
      })
      expect(yield* binding.revalidateConversation(authority)).toBe(true)
      revision = 8
      expect(yield* binding.revalidateConversation(authority)).toBe(false)
      for (const refusal of [401, 403, 404]) {
        status = refusal
        expect(yield* binding.revalidateConversation(authority)).toBe(false)
      }
      status = 503
      expect(
        (yield* binding.revalidateConversation(authority).pipe(Effect.result))._tag
      ).toBe('Failure')
      expect(
        (yield* binding.exportConversation(authority).pipe(Effect.result))._tag
      ).toBe('Failure')
      status = 200
      expect((yield* binding.exportConversation(authority)).json).toContain('items')
      yield* binding.destroyConversation(authority)
      expect(requests.at(-1)?.headers.get('x-starter-assistant-cleanup')).toBe(
        'conversation'
      )
      expect(requests.at(-1)?.method).toBe('POST')
    })
)

it.effect('notifies every immutable address and reports a failed invalidation', () =>
  Effect.gen(function* () {
    const names: Array<string> = []
    const requests: Array<Request> = []
    let status = 204
    const invalidate = conversationInvalidationBinding({
      getByName: (name) => {
        names.push(name)
        return {
          fetch: (request) => {
            requests.push(request)
            return Promise.resolve(new Response(null, { status }))
          }
        }
      }
    })
    yield* invalidate([address, { ...address, id: 'second' }])
    expect(names).toEqual([
      '["workspace","user","conversation"]',
      '["workspace","user","second"]'
    ])
    expect(requests[0]?.headers.get('x-starter-assistant-invalidate')).toBe(
      'conversation'
    )
    status = 503
    expect((yield* invalidate([address]).pipe(Effect.result))._tag).toBe('Failure')
  })
)

/**
 * How the lifecycle port can lose a host failure on its way to the caller:
 * - a host 503 arrives as an untyped rejection, so the export refusal names
 *   the Promise wrapper instead of the conversation host;
 * - the object request runs detached, so interrupting the export leaves it
 *   in flight.
 */
function lifecycleOver(namespace: ConversationNamespace) {
  return AssistantConversationLifecycleLayer(
    conversationLifecycleBinding(namespace)
  ).pipe(Layer.provideMerge(SeedAssistantDirectory))
}

it.effect(
  'reports a conversation host outage to export callers with its typed reason',
  () =>
    Effect.gen(function* () {
      const directory = yield* AssistantDirectory
      yield* directory.create(address)
      const lifecycle = yield* AssistantConversationLifecycle
      expect(
        yield* lifecycle
          .collectForExport(UserId.make('user'), 'session')
          .pipe(Effect.result)
      ).toMatchObject({
        _tag: 'Failure',
        failure: {
          _tag: 'CapabilityUnavailable',
          capability: 'assistant-lifecycle',
          reason: 'conversation_host_storage'
        }
      })
    }).pipe(
      Effect.provide(
        lifecycleOver({
          getByName: () => ({
            fetch: () => Promise.resolve(new Response(null, { status: 503 }))
          })
        })
      )
    )
)

it.effect(
  'interrupting an export revalidation aborts the in-flight object request',
  () => {
    const started = Deferred.makeUnsafe<boolean>()
    const aborted = Deferred.makeUnsafe<boolean>()
    return Effect.gen(function* () {
      const directory = yield* AssistantDirectory
      const row = yield* directory.create(address)
      const lifecycle = yield* AssistantConversationLifecycle
      const validation = yield* lifecycle
        .validateExport(UserId.make('user'), 'session', [
          { id: row.id, policyRevision: row.policyRevision }
        ])
        .pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(validation)
      yield* Deferred.await(aborted)
    }).pipe(
      Effect.provide(
        lifecycleOver({
          getByName: () => ({
            fetch: (request) => {
              request.signal.addEventListener('abort', () =>
                Deferred.doneUnsafe(aborted, Effect.succeed(true))
              )
              Deferred.doneUnsafe(started, Effect.succeed(true))
              // Never settles: only the caller's interruption can end this request.
              return new Promise<Response>(() => {})
            }
          })
        })
      )
    )
  }
)
