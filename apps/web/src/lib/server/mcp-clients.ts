import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/mcp-clients'
import { Schema } from 'effect'

const RevokeInput = Schema.Struct({ connectionId: Schema.NonEmptyString })

export type RevokeInput = typeof RevokeInput.Type

export const Api = HttpApi.make('web-mcp-clients').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadMcpClientConnectionsServerFn',
      '/api/web/loadMcpClientConnectionsServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.loadMcpClientConnectionsServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'revokeMcpClientServerFn',
      '/api/web/revokeMcpClientServerFn',
      {
        payload: RevokeInput,
        success: Responses.revokeMcpClientServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const revokeMcpClientServerFn = dataCall(
  browser,
  RevokeInput,
  (client, payload) => client.calls.revokeMcpClientServerFn({ payload })
)
