import { SsoConnections } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { whenPermitted } from './authorize'
import { requireRequestSession } from './auth'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'
import {
  type WorkspaceSettingsInput,
  type WorkspaceSettingsPayload
} from './workspace-settings'
import { workspaceExportsSegment } from './workspace-exports.effects'

const settingsPayload: WorkspacePageFrame<WorkspaceSettingsPayload> = workspacePage(
  { notification: ['read'] },
  (ctx) =>
    Effect.map(
      Effect.all(
        {
          unreadCount,
          ssoConnections: whenPermitted(
            { sso: ['list'] },
            Effect.flatMap(SsoConnections, (sso) => sso.list)
          ),
          exports: whenPermitted(
            { workspaceExport: ['request'] },
            workspaceExportsSegment
          )
        },
        { concurrency: 'unbounded' }
      ),
      (segments) => ({ workspaceName: ctx.workspace.name, ...segments })
    )
)

export async function loadWorkspaceSettingsHandler(
  input: WorkspaceSettingsInput
): Promise<WorkspaceSettingsPayload> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(input.workspaceSlug, settingsPayload, {
    userId: session.user.id
  })
}
