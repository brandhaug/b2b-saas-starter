import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/account-conversations'
import { Schema } from 'effect'

const DeleteInput = Schema.Struct({ conversationId: Schema.NonEmptyString })

export const Api = HttpApi.make('web-account-conversations').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadOwnedConversationsServerFn',
      '/api/web/loadOwnedConversationsServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.loadOwnedConversationsServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'deleteOwnedConversationServerFn',
      '/api/web/deleteOwnedConversationServerFn',
      {
        payload: DeleteInput,
        success: Responses.deleteOwnedConversationServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const deleteOwnedConversationServerFn = dataCall(
  browser,
  DeleteInput,
  (client, payload) => client.calls.deleteOwnedConversationServerFn({ payload })
)
