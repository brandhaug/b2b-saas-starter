import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/mcp-consent'
import { type McpClientSummary } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { type WorkspaceListItemProjection } from '@b2b-saas-starter/capabilities/workspace-projections'
import { Schema } from 'effect'

export type OAuthConsentPayload = {
  readonly client: McpClientSummary | null
  readonly workspaces: ReadonlyArray<WorkspaceListItemProjection>

  readonly oauthQuery: string | null
}

const LoadOAuthConsentInput = Schema.Struct({
  // An id that names no registered client is a payload answer (`client:
  // null`), not an input error — so an empty or unknown id decodes fine.
  clientId: Schema.String
})

const GrantOAuthConsentInput = Schema.Struct({
  workspaceId: Schema.NonEmptyString,

  oauthQuery: Schema.NonEmptyString
})

const DenyOAuthConsentInput = Schema.Struct({
  oauthQuery: Schema.NonEmptyString
})

export type LoadOAuthConsentInput = typeof LoadOAuthConsentInput.Type
export type GrantOAuthConsentInput = typeof GrantOAuthConsentInput.Type
export type DenyOAuthConsentInput = typeof DenyOAuthConsentInput.Type

export type OAuthRedirect = { readonly url: string }

export const Api = HttpApi.make('web-mcp-consent').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadOAuthConsentServerFn',
      '/api/web/loadOAuthConsentServerFn',
      {
        payload: LoadOAuthConsentInput,
        success: Responses.loadOAuthConsentServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'grantOAuthConsentServerFn',
      '/api/web/grantOAuthConsentServerFn',
      {
        payload: GrantOAuthConsentInput,
        success: Responses.grantOAuthConsentServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'denyOAuthConsentServerFn',
      '/api/web/denyOAuthConsentServerFn',
      {
        payload: DenyOAuthConsentInput,
        success: Responses.denyOAuthConsentServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const grantOAuthConsentServerFn = dataCall(
  browser,
  GrantOAuthConsentInput,
  (client, payload) => client.calls.grantOAuthConsentServerFn({ payload })
)

export const denyOAuthConsentServerFn = dataCall(
  browser,
  DenyOAuthConsentInput,
  (client, payload) => client.calls.denyOAuthConsentServerFn({ payload })
)
