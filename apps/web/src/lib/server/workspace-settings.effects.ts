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

/**
 * The settings payload assembly and its server-only wiring, reached only
 * through dynamic `import()` inside the handler of
 * `loadWorkspaceSettingsServerFn` (`workspace-settings.ts`): handler bodies
 * are stripped from the client build, so this graph ships to the server
 * alone. `workspace-settings.ts` holds the client-safe half and the reason
 * for the split.
 */

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

/**
 * The loader as a plain function, so tests drive it directly with fixture
 * actors (`workspace-settings.test.ts`) — no request, no auth runtime. The
 * actor is the session's user; the layout route's gate has already proved
 * membership, and `runWorkspaceCapabilities` re-proves it server-side.
 */
export function loadWorkspaceSettings(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceSettingsPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, settingsPayload, {
    userId: input.userId
  })
}

export async function loadWorkspaceSettingsHandler(
  input: WorkspaceSettingsInput
): Promise<WorkspaceSettingsPayload> {
  const session = await requireRequestSession()
  return loadWorkspaceSettings({
    workspaceSlug: input.workspaceSlug,
    userId: session.user.id
  })
}
