import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall, readCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/account'
import { Schema } from 'effect'

const DownloadPersonalDataInput = Schema.Struct({
  exportId: Schema.NonEmptyString
})
export type DownloadPersonalDataInput = typeof DownloadPersonalDataInput.Type

const DeleteAccountInput = Schema.Struct({
  password: Schema.NonEmptyString
})

export type DeleteAccountInput = typeof DeleteAccountInput.Type

export const Api = HttpApi.make('web-account').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadAccountPageServerFn',
      '/api/web/loadAccountPageServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.loadAccountPageServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'exportPersonalDataServerFn',
      '/api/web/exportPersonalDataServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.exportPersonalDataServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'downloadPersonalDataServerFn',
      '/api/web/downloadPersonalDataServerFn',
      {
        payload: DownloadPersonalDataInput,
        success: Responses.downloadPersonalDataServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post('deleteAccountServerFn', '/api/web/deleteAccountServerFn', {
      payload: DeleteAccountInput,
      success: Responses.deleteAccountServerFnResponse,
      error: WebErrors
    })
  )
)

const browser = makeBrowserClient(Api)

export const exportPersonalDataServerFn = readCall(browser, (client) =>
  client.calls.exportPersonalDataServerFn({ payload: {} })
)

export const downloadPersonalDataServerFn = dataCall(
  browser,
  DownloadPersonalDataInput,
  (client, payload) => client.calls.downloadPersonalDataServerFn({ payload })
)

export const deleteAccountServerFn = dataCall(
  browser,
  DeleteAccountInput,
  (client, payload) => client.calls.deleteAccountServerFn({ payload })
)
