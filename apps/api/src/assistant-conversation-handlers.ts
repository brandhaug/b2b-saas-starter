import { StarterApi } from '@b2b-saas-starter/api'
import { AssistantApiPrincipal } from '@b2b-saas-starter/api/assistant-conversations'
import {
  AssistantConversations,
  type ConversationError
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversations'
import {
  ConversationNotFound,
  ConversationUnavailable
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { assistantAuthorityFailure } from './assistant-conversation-guards.ts'
import { observed } from './request-guards.ts'

export function assistantConversationsGroup() {
  return HttpApiBuilder.group(StarterApi, 'assistant-conversations', (handlers) =>
    Effect.gen(function* () {
      const conversations = yield* AssistantConversations
      const selectWorkspace = Effect.fn('AssistantRest.selectWorkspace')(function* (
        slug: string
      ) {
        const context = yield* WorkspaceContext
        if (context.workspace.slug !== slug) {
          return yield* new ConversationNotFound()
        }
      })
      return handlers
        .handle('create', ({ payload }) =>
          read(
            'create',
            Effect.gen(function* () {
              yield* selectWorkspace(payload.workspaceSlug)
              return yield* conversations.create({
                credential: yield* AssistantApiPrincipal
              })
            })
          )
        )
        .handle('list', ({ query }) =>
          read(
            'list',
            Effect.gen(function* () {
              yield* selectWorkspace(query.workspaceSlug)
              return yield* conversations.list({
                credential: yield* AssistantApiPrincipal,
                cursor: query.cursor,
                limit: query.limit
              })
            })
          )
        )
        .handle('read', ({ params }) =>
          read(
            'read',
            Effect.gen(function* () {
              return yield* conversations.read({
                ...params,
                credential: yield* AssistantApiPrincipal
              })
            })
          )
        )
        .handle('history', ({ params, query }) =>
          read(
            'history',
            Effect.gen(function* () {
              return yield* conversations.history({
                ...params,
                cursor: query.cursor,
                credential: yield* AssistantApiPrincipal
              })
            })
          )
        )
        .handle('send', ({ params, payload }) =>
          generate(
            'send',
            Effect.gen(function* () {
              return yield* conversations.send({
                ...params,
                ...payload,
                credential: yield* AssistantApiPrincipal
              })
            })
          )
        )
        .handle('retry', ({ params, payload }) =>
          generate(
            'retry',
            Effect.gen(function* () {
              return yield* conversations.retry({
                ...params,
                ...payload,
                credential: yield* AssistantApiPrincipal
              })
            })
          )
        )
        .handle('stop', ({ params }) =>
          read(
            'stop',
            Effect.gen(function* () {
              return yield* conversations.stop({
                ...params,
                credential: yield* AssistantApiPrincipal
              })
            })
          )
        )
        .handle('observe', ({ params, headers }) =>
          read(
            'observe',
            Effect.gen(function* () {
              const response = yield* conversations.observe({
                ...params,
                credential: yield* AssistantApiPrincipal,
                lastEventId: headers['last-event-id']
              })
              return HttpServerResponse.fromWeb(response)
            })
          )
        )
        .handle('delete', ({ params }) =>
          read(
            'delete',
            Effect.gen(function* () {
              yield* conversations.remove({
                ...params,
                credential: yield* AssistantApiPrincipal
              })
              return { status: 'deleting' } satisfies { status: 'deleting' }
            })
          )
        )
    })
  )
}

function read<A, R>(event: string, operation: Effect.Effect<A, ConversationError, R>) {
  return observed(
    `assistant-conversations.${event}`,
    operation.pipe(Effect.mapError(readError))
  )
}

function generate<A, R>(
  event: string,
  operation: Effect.Effect<A, ConversationError, R>
) {
  return observed(
    `assistant-conversations.${event}`,
    operation.pipe(Effect.mapError(routeError))
  )
}

function routeError(error: ConversationError) {
  if (error._tag === 'AssistantAuthorityDenied') {
    return assistantAuthorityFailure(error)
  }
  return error
}

// Admission errors on an observation indicate a host contract failure. They
// must not turn reads into generation operations or advertise read quotas.
function readError(error: ConversationError) {
  switch (error._tag) {
    case 'ConversationConflict':
    case 'ConversationInputRejected':
    case 'AssistantAdmissionRefused': {
      return new ConversationUnavailable({ reason: 'storage' })
    }
    case 'AssistantAuthorityDenied': {
      return assistantAuthorityFailure(error)
    }
    case 'CapabilityUnavailable':
    case 'ConversationNotFound':
    case 'ConversationUnavailable': {
      return error
    }
  }
}
