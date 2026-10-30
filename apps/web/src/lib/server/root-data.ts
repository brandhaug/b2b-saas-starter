import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/root-data'
import { Schema } from 'effect'

import { type ClientTelemetryConfig } from './telemetry-config'

export type RootData = {
  readonly telemetry: ClientTelemetryConfig

  readonly signedIn: boolean
}

export const Api = HttpApi.make('web-root-data').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post('rootDataServerFn', '/api/web/rootDataServerFn', {
      payload: Schema.Struct({}),
      success: Responses.rootDataServerFnResponse,
      error: WebErrors
    })
  )
)
