import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/workspace-suspension'
import { Schema } from 'effect'

import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { type WorkspaceViewer } from '@/lib/permissions'
import { type WorkspaceSuspension } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'

const WorkspaceSlugInput = Schema.Struct({ workspaceSlug: Schema.NonEmptyString })
type WorkspaceSuspensionPayload = Pick<
  WorkspaceSuspension,
  'workspaceId' | 'status' | 'customerExplanation' | 'changedAt'
>

type WorkspaceSuspensionIdentity = WorkspaceSuspensionPayload & {
  readonly workspaceName: string
  readonly viewer: WorkspaceViewer
}

export type WorkspaceSuspensionGatePayload = WorkspaceSuspensionIdentity & {
  readonly strongAuthenticationRequired: boolean
}

export type WorkspaceRecoveryPayload = WorkspaceSuspensionIdentity & {
  readonly canViewExplanation: boolean
  readonly canManageBilling: boolean
  readonly billingConfigured: boolean
  readonly apiTokens: ReadonlyArray<ApiToken> | null
  readonly ssoConnections: ReadonlyArray<SsoConnection> | null
}

export const Api = HttpApi.make('web-workspace-suspension').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadWorkspaceSuspensionServerFn',
      '/api/web/loadWorkspaceSuspensionServerFn',
      {
        payload: WorkspaceSlugInput,
        success: Responses.loadWorkspaceSuspensionServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'loadWorkspaceRecoveryServerFn',
      '/api/web/loadWorkspaceRecoveryServerFn',
      {
        payload: WorkspaceSlugInput,
        success: Responses.loadWorkspaceRecoveryServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const loadWorkspaceRecoveryServerFn = dataCall(
  browser,
  WorkspaceSlugInput,
  (client, payload) => client.calls.loadWorkspaceRecoveryServerFn({ payload })
)
