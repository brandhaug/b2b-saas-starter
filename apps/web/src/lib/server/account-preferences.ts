import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/account-preferences'
import { Schema } from 'effect'
import { accountLocales } from '@b2b-saas-starter/db/enums'

const AccountPreferencesInput = Schema.Struct({
  locale: Schema.optional(Schema.NullOr(Schema.Literals(accountLocales))),
  timeZone: Schema.optional(Schema.NullOr(Schema.String)),
  initializeTimeZone: Schema.optional(Schema.Boolean)
})
export type AccountPreferencesInput = typeof AccountPreferencesInput.Type

export const Api = HttpApi.make('web-account-preferences').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'setLocalePreferencesServerFn',
      '/api/web/setLocalePreferencesServerFn',
      {
        payload: AccountPreferencesInput,
        success: Responses.setLocalePreferencesServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const setLocalePreferencesServerFn = dataCall(
  browser,
  AccountPreferencesInput,
  (client, payload) => client.calls.setLocalePreferencesServerFn({ payload })
)
