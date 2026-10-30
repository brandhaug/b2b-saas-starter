import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall, readCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/strong-authentication'
import { Schema } from 'effect'

const VerifyCurrentPasswordInput = Schema.Struct({ password: Schema.NonEmptyString })

export const Api = HttpApi.make('web-strong-authentication').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'strongAuthenticationStatusServerFn',
      '/api/web/strongAuthenticationStatusServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.strongAuthenticationStatusServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'verifyCurrentPasswordServerFn',
      '/api/web/verifyCurrentPasswordServerFn',
      {
        payload: VerifyCurrentPasswordInput,
        success: Responses.verifyCurrentPasswordServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const strongAuthenticationStatusServerFn = readCall(browser, (client) =>
  client.calls.strongAuthenticationStatusServerFn({ payload: {} })
)

export const verifyCurrentPasswordServerFn = dataCall(
  browser,
  VerifyCurrentPasswordInput,
  (client, payload) => client.calls.verifyCurrentPasswordServerFn({ payload })
)
