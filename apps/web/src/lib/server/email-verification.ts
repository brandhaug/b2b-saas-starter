import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/email-verification'
import { Schema } from 'effect'

export const Api = HttpApi.make('web-email-verification').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'getEmailVerificationStatusServerFn',
      '/api/web/getEmailVerificationStatusServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.getEmailVerificationStatusServerFnResponse,
        error: WebErrors
      }
    )
  )
)
