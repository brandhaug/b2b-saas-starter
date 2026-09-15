import { AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import { Effect, Schema } from 'effect'
import {
  type ConversationDirectoryEntry,
  type ConversationInvalidationBinding
} from '../assistant/directory.ts'
import { type AssistantLifecycleBinding } from '../assistant/lifecycle.ts'
import {
  ConversationUnavailable,
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
  Schema.Struct({ policyRevision: Schema.Number })
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

/** Parent lifecycle/export callers pass identities from the directory, never from browser input. */
export function conversationLifecycleBinding(
  namespace: ConversationNamespace
): AssistantLifecycleBinding {
  const transport = conversationTransport(namespace)
  function requestExport(
    input: Parameters<AssistantLifecycleBinding['exportConversation']>[0],
    action: 'read' | 'export'
  ) {
    return Effect.tryPromise(() =>
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
        action
      })
    )
  }
  return {
    exportConversation: (input) =>
      Effect.runPromise(
        requestExport(input, 'export').pipe(
          Effect.flatMap(requireSuccess),
          Effect.flatMap((response) => Effect.tryPromise(() => response.text())),
          Effect.map((json) => ({ json }))
        )
      ),
    revalidateConversation: (input) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const response = yield* requestExport(input, 'read')
          if ([401, 403, 404].includes(response.status)) {
            return false
          }
          yield* requireSuccess(response)
          const value = yield* Effect.tryPromise(() => response.json()).pipe(
            Effect.flatMap(decodeRevision)
          )
          return value.policyRevision === input.policyRevision
        })
      ),
    destroyConversation: (input) =>
      Effect.runPromise(
        Effect.tryPromise(() =>
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
                headers: { 'x-starter-assistant-cleanup': input.conversationId }
              })
            )
        ).pipe(Effect.flatMap(requireSuccess), Effect.asVoid)
      )
  }
}

/** Trusted mutation paths notify current authority; the host independently rechecks it. */
export function conversationInvalidationBinding(
  namespace: ConversationNamespace
): ConversationInvalidationBinding {
  return (addresses) =>
    Effect.runPromise(
      Effect.forEach(
        addresses,
        (address) =>
          Effect.tryPromise(() =>
            namespace.getByName(conversationObjectName(address)).fetch(
              new Request('https://assistant.internal/invalidate', {
                method: 'POST',
                headers: { 'x-starter-assistant-invalidate': address.id }
              })
            )
          ).pipe(Effect.flatMap(requireSuccess)),
        { concurrency: 8, discard: true }
      )
    )
}
