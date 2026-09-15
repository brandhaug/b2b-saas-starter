import { ConversationInputRejected } from '@b2b-saas-starter/ai/conversation-context'
import { Context, Effect, Layer, Schema, Predicate } from 'effect'
import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import { AssistantDirectory } from '../assistant/directory.ts'
import { AssistantAdmissionRefused } from '../assistant/admission.ts'
import { AssistantAuthority, AssistantAuthorityDenied } from './assistant-authority.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { type ListPageInput } from '../internal/keyset-cursor.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import {
  type AssistantConversationTransport,
  type ConversationMutation
} from './assistant-conversation-transport.ts'
import {
  ConversationSummary,
  ConversationPage,
  ConversationAcceptance,
  ConversationAttempt,
  ConversationNotFound,
  ConversationConflict,
  ConversationUnavailable,
  type ConversationList,
  type ConversationSend,
  type ConversationRetry
} from './assistant-conversation.ts'

export type ConversationIdentity = {
  readonly credential: AssistantCredentialReference
  readonly conversationId: string
}
export type ConversationError =
  | ConversationInputRejected
  | ConversationNotFound
  | ConversationConflict
  | ConversationUnavailable
  | AssistantAdmissionRefused
  | AssistantAuthorityDenied
  | CapabilityUnavailable
export class AssistantConversations extends Context.Service<
  AssistantConversations,
  {
    readonly create: (input: {
      readonly credential: AssistantCredentialReference
    }) => Effect.Effect<ConversationSummary, ConversationError, WorkspaceContext>
    readonly list: (
      input: { readonly credential: AssistantCredentialReference } & ListPageInput
    ) => Effect.Effect<ConversationList, ConversationError, WorkspaceContext>
    readonly read: (
      input: ConversationIdentity
    ) => Effect.Effect<ConversationSummary, ConversationError>
    readonly history: (
      input: ConversationIdentity & { readonly cursor?: string | undefined }
    ) => Effect.Effect<typeof ConversationPage.Type, ConversationError>
    readonly send: (
      input: ConversationIdentity & ConversationSend
    ) => Effect.Effect<ConversationAcceptance, ConversationError>
    readonly retry: (
      input: ConversationIdentity & ConversationRetry
    ) => Effect.Effect<ConversationAcceptance, ConversationError>
    readonly stop: (
      input: ConversationIdentity & { readonly attemptId: string }
    ) => Effect.Effect<ConversationAttempt, ConversationError>
    readonly remove: (
      input: ConversationIdentity
    ) => Effect.Effect<void, ConversationError>
    readonly observe: (
      input: ConversationIdentity & {
        readonly attemptId: string
        readonly lastEventId?: string | undefined
      }
    ) => Effect.Effect<Response, ConversationError>
    readonly connect: (
      input: ConversationIdentity & { readonly request: Request }
    ) => Effect.Effect<Response, ConversationError>
  }
>()('@b2b-saas-starter/capabilities/AssistantConversations') {}

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
function decode<A>(schema: Schema.Codec<A>, response: Response) {
  return Effect.tryPromise({
    try: () => response.json(),
    catch: () => new ConversationUnavailable({ reason: 'storage' })
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => new ConversationUnavailable({ reason: 'storage' }))
  )
}

export function AssistantConversationsLayer(
  transport?: AssistantConversationTransport
) {
  return Layer.effect(
    AssistantConversations,
    Effect.gen(function* () {
      const directory = yield* AssistantDirectory
      const authority = yield* AssistantAuthority
      const authorized = Effect.fn('AssistantConversations.authorize')(function* (
        input: ConversationIdentity,
        operation: 'read' | 'write'
      ) {
        const row = yield* directory.get(input.conversationId)
        if (row?.deletedAt !== null || row.creatorUserId !== input.credential.userId) {
          return yield* new ConversationNotFound()
        }
        yield* authority
          .authorize({
            credential: input.credential,
            workspaceId: row.workspaceId,
            creatorUserId: row.creatorUserId,
            requiredPermissions: row.requiredPermissions,
            operation,
            mode: 'observe'
          })
          .pipe(
            Effect.mapError((error) => {
              if (
                error._tag === 'AssistantAuthorityDenied' &&
                error.reason === 'not_found'
              ) {
                return new ConversationNotFound()
              }
              return error
            })
          )
        return row
      })
      const dispatch = Effect.fn('AssistantConversations.dispatch')(function* (
        input: ConversationIdentity,
        action: Parameters<AssistantConversationTransport['request']>[0]['action'],
        options: {
          readonly body?: ConversationMutation
          readonly cursor?: string | undefined
          readonly attemptId?: string
          readonly lastEventId?: string | undefined
          readonly request?: Request
        } = {}
      ) {
        let operation: 'read' | 'write' = 'read'
        if (['send', 'retry', 'stop'].includes(action)) {
          operation = 'write'
        }
        const address = yield* authorized(input, operation)
        if (transport === undefined) {
          return yield* new ConversationUnavailable({ reason: 'configuration' })
        }
        const response = yield* Effect.tryPromise({
          try: () =>
            transport.request({
              address,
              credential: input.credential,
              action,
              ...options
            }),
          catch: () => new ConversationUnavailable({ reason: 'storage' })
        })
        if (response.ok || response.status === 101) {
          return response
        }
        const body = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: () => new ConversationUnavailable({ reason: 'storage' })
        })
        const failure = decodeFailure(body)
        if (failure._tag === 'Success') {
          return yield* Effect.fail(failure.success)
        }
        return yield* new ConversationUnavailable({ reason: 'storage' })
      })

      const read = Effect.fn('AssistantConversations.read')(
        (input: ConversationIdentity) =>
          dispatch(input, 'read').pipe(
            Effect.flatMap((response) => decode(ConversationSummary, response))
          )
      )
      return AssistantConversations.of({
        create: Effect.fn('AssistantConversations.create')(function* ({ credential }) {
          const context = yield* WorkspaceContext
          yield* authority.authorize({
            credential,
            workspaceId: context.workspace.id,
            requiredPermissions: ['assistant:read'],
            operation: 'write',
            mode: 'observe'
          })
          const row = yield* directory.create({
            id: yield* newCapabilityId('conversation'),
            workspaceId: context.workspace.id,
            creatorUserId: credential.userId
          })
          return {
            id: row.id,
            workspaceId: row.workspaceId,
            createdAt: row.createdAt,
            title: null,
            activeAttempt: null,
            policyRevision: row.policyRevision
          }
        }),
        list: Effect.fn('AssistantConversations.list')(function* (input) {
          const context = yield* WorkspaceContext
          yield* authority.authorize({
            credential: input.credential,
            workspaceId: context.workspace.id,
            requiredPermissions: ['assistant:read'],
            operation: 'read',
            mode: 'observe'
          })
          const page = yield* directory.list({
            workspaceId: context.workspace.id,
            creatorUserId: input.credential.userId,
            cursor: input.cursor,
            limit: input.limit
          })
          const rows = yield* Effect.forEach(page.items, (row) =>
            read({ credential: input.credential, conversationId: row.id }).pipe(
              Effect.catchTag('AssistantAuthorityDenied', () => Effect.succeed(null)),
              Effect.catchTag('ConversationNotFound', () => Effect.succeed(null))
            )
          )
          return {
            items: rows.filter(Predicate.isNotNull),
            nextCursor: page.nextCursor
          }
        }),
        read,
        history: Effect.fn('AssistantConversations.history')((input) =>
          dispatch(input, 'history', { cursor: input.cursor }).pipe(
            Effect.flatMap((response) => decode(ConversationPage, response))
          )
        ),
        send: Effect.fn('AssistantConversations.send')((input) => {
          const body: ConversationSend = {
            idempotencyKey: input.idempotencyKey,
            question: input.question
          }
          if (input.taskId !== undefined) {
            Object.assign(body, { taskId: input.taskId })
          }
          return dispatch(input, 'send', { body }).pipe(
            Effect.flatMap((response) => decode(ConversationAcceptance, response))
          )
        }),
        retry: Effect.fn('AssistantConversations.retry')((input) =>
          dispatch(input, 'retry', {
            body: { idempotencyKey: input.idempotencyKey, attemptId: input.attemptId }
          }).pipe(
            Effect.flatMap((response) => decode(ConversationAcceptance, response))
          )
        ),
        stop: Effect.fn('AssistantConversations.stop')((input) =>
          dispatch(input, 'stop', { body: { attemptId: input.attemptId } }).pipe(
            Effect.flatMap((response) => decode(ConversationAttempt, response))
          )
        ),
        remove: Effect.fn('AssistantConversations.remove')(function* (input) {
          const row = yield* authorized(input, 'write')
          yield* directory.fence({ conversationId: row.id })
        }),
        observe: Effect.fn('AssistantConversations.observe')((input) =>
          dispatch(input, 'events', {
            attemptId: input.attemptId,
            lastEventId: input.lastEventId
          })
        ),
        connect: Effect.fn('AssistantConversations.connect')((input) =>
          dispatch(input, 'connect', { request: input.request })
        )
      })
    })
  )
}
