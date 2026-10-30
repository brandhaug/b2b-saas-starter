import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/notifications'
import { Schema } from 'effect'

const ListNotificationsInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const MarkNotificationsReadInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  // All constraints in the schema: an empty array decodes fine and marks
  // nothing; unknown or invisible ids are ignored by the capability itself.
  ids: Schema.Array(Schema.String)
})

export type ListNotificationsInput = typeof ListNotificationsInput.Type
export type MarkNotificationsReadInput = typeof MarkNotificationsReadInput.Type

export const Api = HttpApi.make('web-notifications').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'listNotificationsServerFn',
      '/api/web/listNotificationsServerFn',
      {
        payload: ListNotificationsInput,
        success: Responses.listNotificationsServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'markNotificationsReadServerFn',
      '/api/web/markNotificationsReadServerFn',
      {
        payload: MarkNotificationsReadInput,
        success: Responses.markNotificationsReadServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const listNotificationsServerFn = dataCall(
  browser,
  ListNotificationsInput,
  (client, payload) => client.calls.listNotificationsServerFn({ payload })
)

export const markNotificationsReadServerFn = dataCall(
  browser,
  MarkNotificationsReadInput,
  (client, payload) => client.calls.markNotificationsReadServerFn({ payload })
)
