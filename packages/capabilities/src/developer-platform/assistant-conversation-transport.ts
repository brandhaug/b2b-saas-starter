import { attemptPromise } from '@b2b-saas-starter/failure/narrowing'
import { AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import { Effect, Schema } from 'effect'
import {
  type ConversationDirectoryEntry,
  type ConversationInvalidationBinding
} from '../assistant/directory.ts'
import {
  type AssistantLifecycleBinding,
  type ExportAuthority
} from '../assistant/lifecycle.ts'
import {
  ConversationUnavailable,
  conversationStorageFailure,
  storageUnavailable,
  type ConversationSend,
  type ConversationRetry
} from './assistant-conversation.ts'

export type ConversationNamespace = {
  readonly getByName: (name: string) => {
    readonly fetch: (request: Request) => Promise<Response>
  }
}

export type ConversationAddress = Pick<
  ConversationDirectoryEntry,
  'id' | 'workspaceId' | 'creatorUserId'
>
export type ConversationMutation =
  | ConversationSend
  | ConversationRetry
  | { readonly attemptId: string }
export type AssistantConversationTransport = {
  readonly request: (input: {
    readonly address: ConversationAddress
    readonly credential: AssistantCredentialReference
    readonly action:
      | 'read'
      | 'history'
      | 'send'
      | 'retry'
      | 'stop'
      | 'events'
      | 'export'
      | 'connect'
    readonly body?: ConversationMutation
    readonly cursor?: string | undefined
    readonly attemptId?: string | undefined
    readonly lastEventId?: string | undefined
    readonly request?: Request | undefined
    readonly signal?: AbortSignal | undefined
  }) => Promise<Response>
}
const encodeAddress = Schema.encodeSync(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String, Schema.String]))
)
const encodeInvocation = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      conversationId: Schema.String,
      credential: AssistantCredentialReference
    })
  )
)
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))
const decodeRevision = Schema.decodeUnknownEffect(
  Schema.Struct({ policyRevision: Schema.Finite })
)

/** Only immutable server-resolved identity chooses an object. */
export function conversationObjectName(address: ConversationAddress): string {
  return encodeAddress([address.workspaceId, address.creatorUserId, address.id])
}

export function conversationTransport(
  namespace: ConversationNamespace
): AssistantConversationTransport {
  return {
    request: (input) => {
      const target = new URL(`https://conversation.internal/${input.action}`)
      if (input.cursor !== undefined) {
        target.searchParams.set('cursor', input.cursor)
      }
      if (input.attemptId !== undefined) {
        target.searchParams.set('attemptId', input.attemptId)
      }
      const headers = new Headers(input.request?.headers)
      headers.delete('authorization')
      headers.delete('cookie')
      headers.set(
        'x-starter-assistant-context',
        encodeInvocation({
          conversationId: input.address.id,
          credential: input.credential
        })
      )
      if (input.lastEventId !== undefined) {
        headers.set('last-event-id', input.lastEventId)
      }
      const init: RequestInit = { method: 'GET', headers }
      if (input.signal !== undefined) {
        init.signal = input.signal
      }
      if (input.body !== undefined) {
        headers.set('content-type', 'application/json')
        init.method = 'POST'
        init.body = encodeJson(input.body)
      }
      return namespace
        .getByName(conversationObjectName(input.address))
        .fetch(new Request(target, init))
    }
  }
}

function requireSuccess(response: Response) {
  if (!response.ok) {
    return Effect.fail(new ConversationUnavailable({ reason: 'storage' }))
  }
  return Effect.succeed(response)
}

/**
 * The Durable Object stub is the one Promise edge. The signal carries the
 * caller's interruption into the object request; a rejection is storage.
 */
function objectCall<A>(call: (signal: AbortSignal) => Promise<A>) {
  return attemptPromise({
    try: call,
    narrow: conversationStorageFailure
  })
}

/** Parent lifecycle/export callers pass identities from the directory, never from browser input. */
export function conversationLifecycleBinding(
  namespace: ConversationNamespace
): AssistantLifecycleBinding {
  const transport = conversationTransport(namespace)
  function requestExport(input: ExportAuthority, action: 'read' | 'export') {
    return objectCall((signal) =>
      transport.request({
        address: {
          id: input.conversationId,
          workspaceId: input.workspaceId,
          creatorUserId: input.creatorUserId
        },
        credential: {
          kind: 'session',
          userId: input.userId,
          sessionId: input.sessionId,
          expiresAt: Number.MAX_SAFE_INTEGER
        },
        action,
        signal
      })
    )
  }
  return {
    exportConversation: Effect.fn('AssistantConversationHost.export')(function* (
      input: ExportAuthority
    ) {
      const response = yield* requireSuccess(yield* requestExport(input, 'export'))
      return { json: yield* objectCall(() => response.text()) }
    }),
    revalidateConversation: Effect.fn('AssistantConversationHost.revalidate')(
      function* (input: ExportAuthority) {
        const response = yield* requestExport(input, 'read')
        if ([401, 403, 404].includes(response.status)) {
          return false
        }
        yield* requireSuccess(response)
        const value = yield* objectCall(() => response.json()).pipe(
          Effect.flatMap(decodeRevision),
          storageUnavailable
        )
        return value.policyRevision === input.policyRevision
      }
    ),
    destroyConversation: Effect.fn('AssistantConversationHost.destroy')(function* (
      input: Parameters<AssistantLifecycleBinding['destroyConversation']>[0]
    ) {
      yield* objectCall((signal) =>
        namespace
          .getByName(
            conversationObjectName({
              id: input.conversationId,
              workspaceId: input.workspaceId,
              creatorUserId: input.creatorUserId
            })
          )
          .fetch(
            new Request('https://conversation.internal/cleanup', {
              method: 'POST',
              headers: { 'x-starter-assistant-cleanup': input.conversationId },
              signal
            })
          )
      ).pipe(Effect.flatMap(requireSuccess))
    })
  }
}

/** Trusted mutation paths notify current authority; the host independently rechecks it. */
export function conversationInvalidationBinding(
  namespace: ConversationNamespace
): ConversationInvalidationBinding {
  return Effect.fn('AssistantConversationHost.invalidate')(function* (
    addresses: Parameters<ConversationInvalidationBinding>[0]
  ) {
    yield* Effect.forEach(
      addresses,
      (address) =>
        objectCall((signal) =>
          namespace.getByName(conversationObjectName(address)).fetch(
            new Request('https://assistant.internal/invalidate', {
              method: 'POST',
              headers: { 'x-starter-assistant-invalidate': address.id },
              signal
            })
          )
        ).pipe(Effect.flatMap(requireSuccess)),
      { concurrency: 8, discard: true }
    )
  })
}
