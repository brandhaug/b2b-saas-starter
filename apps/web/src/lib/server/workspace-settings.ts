import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/workspace-settings'
import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { type WorkspaceViewer } from '@/lib/permissions'
import { Schema } from 'effect'

import { type WorkspaceExportsSegment } from './workspace-exports'

export type WorkspaceSettingsPayload = {
  readonly viewer: WorkspaceViewer | null

  readonly workspaceName: string
  readonly unreadCount: number

  readonly ssoConnections: ReadonlyArray<SsoConnection> | null

  readonly exports: WorkspaceExportsSegment | null
}

const WorkspaceSettingsInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

export type WorkspaceSettingsInput = typeof WorkspaceSettingsInput.Type

export const Api = HttpApi.make('web-workspace-settings').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadWorkspaceSettingsServerFn',
      '/api/web/loadWorkspaceSettingsServerFn',
      {
        payload: WorkspaceSettingsInput,
        success: Responses.loadWorkspaceSettingsServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const loadWorkspaceSettingsServerFn = dataCall(
  browser,
  WorkspaceSettingsInput,
  (client, payload) => client.calls.loadWorkspaceSettingsServerFn({ payload })
)
