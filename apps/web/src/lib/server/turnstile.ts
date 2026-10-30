import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/turnstile'
import { Schema } from 'effect'

export const Api = HttpApi.make('web-turnstile').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post('getTurnstileSiteKey', '/api/web/getTurnstileSiteKey', {
      payload: Schema.Struct({}),
      success: Responses.getTurnstileSiteKeyResponse,
      error: WebErrors
    })
  )
)
