import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/social-providers'
import { Schema } from 'effect'

export const Api = HttpApi.make('web-social-providers').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post('getSocialProviderIds', '/api/web/getSocialProviderIds', {
      payload: Schema.Struct({}),
      success: Responses.getSocialProviderIdsResponse,
      error: WebErrors
    })
  )
)
