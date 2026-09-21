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
import { HttpServerResponse, type HttpServerRequest } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { assistantAuthorityFailure } from './assistant-conversation-guards.ts'
import { type ApiEnv } from './env.ts'
import { observed } from './request-guards.ts'

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

export function assistantConversationsGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'assistant-conversations', (handlers) =>
    Effect.gen(function* () {
      const conversations = yield* AssistantConversations
      function read<A, R>(
        request: HttpServerRequest.HttpServerRequest,
        event: string,
        operation: Effect.Effect<A, ConversationError, R>
      ) {
        return observed(
          env,
          request,
          `assistant-conversations.${event}`,
          {},
          operation.pipe(Effect.mapError(readError))
        )
      }
      function generate<A, R>(
        request: HttpServerRequest.HttpServerRequest,
        event: string,
        operation: Effect.Effect<A, ConversationError, R>
      ) {
        return observed(
          env,
          request,
          `assistant-conversations.${event}`,
          {},
          operation.pipe(Effect.mapError(routeError))
        )
      }
      const selectWorkspace = Effect.fn('AssistantRest.selectWorkspace')(function* (
        slug: string
      ) {
        const context = yield* WorkspaceContext
        if (context.workspace.slug !== slug) {
          return yield* new ConversationNotFound()
        }
      })
      return handlers
        .handle('create', ({ payload, request }) =>
          read(
            request,
            'create',
            Effect.gen(function* () {
              yield* selectWorkspace(payload.workspaceSlug)
              return yield* conversations.create({
                credential: yield* AssistantApiPrincipal
              })
            })
          )
        )
        .handle('list', ({ query, request }) =>
          read(
            request,
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
        .handle('read', ({ params, request }) =>
          read(
            request,
            'read',
            Effect.gen(function* () {
              return yield* conversations.read({
                ...params,
                credential: yield* AssistantApiPrincipal
              })
            })
          )
        )
        .handle('history', ({ params, query, request }) =>
          read(
            request,
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
        .handle('send', ({ params, payload, request }) =>
          generate(
            request,
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
        .handle('retry', ({ params, payload, request }) =>
          generate(
            request,
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
        .handle('stop', ({ params, request }) =>
          read(
            request,
            'stop',
            Effect.gen(function* () {
              return yield* conversations.stop({
                ...params,
                credential: yield* AssistantApiPrincipal
              })
            })
          )
        )
        .handle('observe', ({ params, headers, request }) =>
          read(
            request,
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
        .handle('delete', ({ params, request }) =>
          read(
            request,
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
