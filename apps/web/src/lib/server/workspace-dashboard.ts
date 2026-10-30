import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/workspace-dashboard'
import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import {
  type WorkspaceDashboardProjection,
  type WorkspaceProgressProjection
} from '@b2b-saas-starter/capabilities/workspace-projections'
import { type WorkspaceViewer } from '@/lib/permissions'
import { Schema } from 'effect'

export type WorkspaceDashboardPayload = WorkspaceDashboardProjection & {
  readonly viewer: WorkspaceViewer | null
  readonly webhooks: ReadonlyArray<WebhookEndpoint> | null
  readonly apiTokens: ReadonlyArray<ApiToken> | null
  readonly invitations: ReadonlyArray<Invitation> | null

  readonly auditEvents: ReadonlyArray<AuditEvent> | null
  readonly progress: WorkspaceProgressProjection
}

const WorkspaceDashboardInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

export type WorkspaceDashboardInput = typeof WorkspaceDashboardInput.Type

export const Api = HttpApi.make('web-workspace-dashboard').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadWorkspaceDashboardServerFn',
      '/api/web/loadWorkspaceDashboardServerFn',
      {
        payload: WorkspaceDashboardInput,
        success: Responses.loadWorkspaceDashboardServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const loadWorkspaceDashboardServerFn = dataCall(
  browser,
  WorkspaceDashboardInput,
  (client, payload) => client.calls.loadWorkspaceDashboardServerFn({ payload })
)
