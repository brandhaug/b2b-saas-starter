import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/api-tokens'
import {
  CreateApiTokenPayload,
  ReplaceApiTokenPayload,
  type ApiToken
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type WorkspaceViewer } from '@/lib/permissions'
import { Schema } from 'effect'

export type WorkspaceApiTokensPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly unreadCount: number
  readonly tokens: ReadonlyArray<ApiToken>
}

const LoadApiTokensInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const CreateApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  ...CreateApiTokenPayload.fields
})

// The `workspaceSlug` half is the web fn's own; the capability's revoke
// input is `{ tokenId }` alone (`RevokeApiTokenRef` below).
const RevokeApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  tokenId: Schema.NonEmptyString
})

export type LoadApiTokensInput = typeof LoadApiTokensInput.Type
export type CreateApiTokenInput = typeof CreateApiTokenInput.Type
export type RevokeApiTokenInput = typeof RevokeApiTokenInput.Type

const ReplaceApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  tokenId: Schema.NonEmptyString,
  ...ReplaceApiTokenPayload.fields
})
export type ReplaceApiTokenInput = typeof ReplaceApiTokenInput.Type

export const Api = HttpApi.make('web-api-tokens').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadWorkspaceApiTokensServerFn',
      '/api/web/loadWorkspaceApiTokensServerFn',
      {
        payload: LoadApiTokensInput,
        success: Responses.loadWorkspaceApiTokensServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post('createApiTokenServerFn', '/api/web/createApiTokenServerFn', {
      payload: CreateApiTokenInput,
      success: Responses.createApiTokenServerFnResponse,
      error: WebErrors
    }),
    HttpApiEndpoint.post('revokeApiTokenServerFn', '/api/web/revokeApiTokenServerFn', {
      payload: RevokeApiTokenInput,
      success: Responses.revokeApiTokenServerFnResponse,
      error: WebErrors
    }),
    HttpApiEndpoint.post(
      'replaceApiTokenServerFn',
      '/api/web/replaceApiTokenServerFn',
      {
        payload: ReplaceApiTokenInput,
        success: Responses.replaceApiTokenServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const loadWorkspaceApiTokensServerFn = dataCall(
  browser,
  LoadApiTokensInput,
  (client, payload) => client.calls.loadWorkspaceApiTokensServerFn({ payload })
)

export const createApiTokenServerFn = dataCall(
  browser,
  CreateApiTokenInput,
  (client, payload) => client.calls.createApiTokenServerFn({ payload })
)

export const revokeApiTokenServerFn = dataCall(
  browser,
  RevokeApiTokenInput,
  (client, payload) => client.calls.revokeApiTokenServerFn({ payload })
)

export const replaceApiTokenServerFn = dataCall(
  browser,
  ReplaceApiTokenInput,
  (client, payload) => client.calls.replaceApiTokenServerFn({ payload })
)
