import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  conversationTransport,
  conversationLifecycleBinding,
  conversationInvalidationBinding,
  type ConversationNamespace
} from './assistant-conversation-transport.ts'
import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'

const credential = {
  kind: 'session',
  userId: 'user',
  sessionId: 'session',
  expiresAt: Number.MAX_SAFE_INTEGER
} satisfies AssistantCredentialReference
const address = { id: 'conversation', workspaceId: 'workspace', creatorUserId: 'user' }
const authority = {
  conversationId: address.id,
  workspaceId: address.workspaceId,
  creatorUserId: address.creatorUserId,
  userId: 'user',
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
      expect(
        yield* Effect.promise(() => binding.revalidateConversation(authority))
      ).toBe(true)
      revision = 8
      expect(
        yield* Effect.promise(() => binding.revalidateConversation(authority))
      ).toBe(false)
      for (const refusal of [401, 403, 404]) {
        status = refusal
        expect(
          yield* Effect.promise(() => binding.revalidateConversation(authority))
        ).toBe(false)
      }
      status = 503
      expect(
        (yield* Effect.tryPromise(() => binding.revalidateConversation(authority)).pipe(
          Effect.result
        ))._tag
      ).toBe('Failure')
      expect(
        (yield* Effect.tryPromise(() => binding.exportConversation(authority)).pipe(
          Effect.result
        ))._tag
      ).toBe('Failure')
      status = 200
      expect(
        (yield* Effect.promise(() => binding.exportConversation(authority))).json
      ).toContain('items')
      yield* Effect.promise(() => binding.destroyConversation(authority))
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
    yield* Effect.promise(() => invalidate([address, { ...address, id: 'second' }]))
    expect(names).toEqual([
      '["workspace","user","conversation"]',
      '["workspace","user","second"]'
    ])
    expect(requests[0]?.headers.get('x-starter-assistant-invalidate')).toBe(
      'conversation'
    )
    status = 503
    expect(
      (yield* Effect.tryPromise(() => invalidate([address])).pipe(Effect.result))._tag
    ).toBe('Failure')
  })
)
