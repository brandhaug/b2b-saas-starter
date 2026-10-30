import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, readCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/email-delivery'
import { Schema } from 'effect'
import { type EmailDeliveryRecord } from '@b2b-saas-starter/email-delivery/email-delivery'

export type EmailDeliveryRow = EmailDeliveryRecord & {
  readonly unconfirmed: boolean
  readonly resendAllowed: boolean
}

export const Api = HttpApi.make('web-email-delivery').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadOwnEmailDeliveryServerFn',
      '/api/web/loadOwnEmailDeliveryServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.loadOwnEmailDeliveryServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'loadSystemEmailDeliveryServerFn',
      '/api/web/loadSystemEmailDeliveryServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.loadSystemEmailDeliveryServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const loadSystemEmailDeliveryServerFn = readCall(browser, (client) =>
  client.calls.loadSystemEmailDeliveryServerFn({ payload: {} })
)
