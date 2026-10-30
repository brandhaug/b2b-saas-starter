import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/assistant-conversations'
import {
  ConversationSend,
  type ConversationPage
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { Schema } from 'effect'

export type ConversationHistory = typeof ConversationPage.Type
export type ConversationResult<A> =
  | { readonly ok: true; readonly value: A }
  | {
      readonly ok: false
      readonly reason:
        | 'configuration'
        | 'provider'
        | 'unavailable'
        | 'not_found'
        | 'access'
        | 'busy'
        | 'conflict'
        | 'limit'
        | 'input'
      readonly message: string
      readonly retryAfterSeconds: number | null
    }

const WorkspaceInput = Schema.Struct({ workspaceSlug: Schema.NonEmptyString })
const ListInput = Schema.Struct({
  ...WorkspaceInput.fields,
  cursor: Schema.optionalKey(Schema.String)
})
const ConversationInput = Schema.Struct({
  ...WorkspaceInput.fields,
  conversationId: Schema.NonEmptyString
})
const HistoryInput = Schema.Struct({
  ...ConversationInput.fields,
  cursor: Schema.optionalKey(Schema.String)
})
const SendInput = Schema.Struct({
  ...ConversationInput.fields,
  ...ConversationSend.fields
})
const AttemptInput = Schema.Struct({
  ...ConversationInput.fields,
  attemptId: Schema.NonEmptyString
})
const RetryInput = Schema.Struct({
  ...AttemptInput.fields,
  idempotencyKey: SendInput.fields.idempotencyKey
})
export type ConversationWorkspaceInput = typeof WorkspaceInput.Type
export type ConversationListInput = typeof ListInput.Type
export type ConversationReadInput = typeof ConversationInput.Type
export type ConversationHistoryInput = typeof HistoryInput.Type
export type ConversationSendInput = typeof SendInput.Type
export type ConversationAttemptInput = typeof AttemptInput.Type
export type ConversationRetryInput = typeof RetryInput.Type

export const Api = HttpApi.make('web-assistant-conversations').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'createConversationServerFn',
      '/api/web/createConversationServerFn',
      {
        payload: WorkspaceInput,
        success: Responses.createConversationServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'listConversationsServerFn',
      '/api/web/listConversationsServerFn',
      {
        payload: ListInput,
        success: Responses.listConversationsServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'conversationHistoryServerFn',
      '/api/web/conversationHistoryServerFn',
      {
        payload: HistoryInput,
        success: Responses.conversationHistoryServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'sendConversationServerFn',
      '/api/web/sendConversationServerFn',
      {
        payload: SendInput,
        success: Responses.sendConversationServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'retryConversationServerFn',
      '/api/web/retryConversationServerFn',
      {
        payload: RetryInput,
        success: Responses.retryConversationServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'stopConversationServerFn',
      '/api/web/stopConversationServerFn',
      {
        payload: AttemptInput,
        success: Responses.stopConversationServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'deleteConversationServerFn',
      '/api/web/deleteConversationServerFn',
      {
        payload: ConversationInput,
        success: Responses.deleteConversationServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const createConversationServerFn = dataCall(
  browser,
  WorkspaceInput,
  (client, payload) => client.calls.createConversationServerFn({ payload })
)

export const listConversationsServerFn = dataCall(
  browser,
  ListInput,
  (client, payload) => client.calls.listConversationsServerFn({ payload })
)

export const conversationHistoryServerFn = dataCall(
  browser,
  HistoryInput,
  (client, payload) => client.calls.conversationHistoryServerFn({ payload })
)

export const sendConversationServerFn = dataCall(
  browser,
  SendInput,
  (client, payload) => client.calls.sendConversationServerFn({ payload })
)

export const retryConversationServerFn = dataCall(
  browser,
  RetryInput,
  (client, payload) => client.calls.retryConversationServerFn({ payload })
)

export const stopConversationServerFn = dataCall(
  browser,
  AttemptInput,
  (client, payload) => client.calls.stopConversationServerFn({ payload })
)

export const deleteConversationServerFn = dataCall(
  browser,
  ConversationInput,
  (client, payload) => client.calls.deleteConversationServerFn({ payload })
)
