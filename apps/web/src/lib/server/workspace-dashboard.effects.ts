import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { WorkspaceInvitations } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import {
  workspaceDashboard,
  workspaceProgress
} from '@b2b-saas-starter/capabilities/workspace-projections'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { permitted, whenPermitted } from './authorize'
import { workspacePage, type WorkspacePageFrame } from './page-frame'
import {
  type WorkspaceDashboardInput,
  type WorkspaceDashboardPayload
} from './workspace-dashboard'

/**
 * The dashboard payload assembly and its server-only wiring, reached only
 * through dynamic `import()` inside the handler of
 * `loadWorkspaceDashboardServerFn` (`workspace-dashboard.ts`); see
 * apps/web/AGENTS.md. `workspace-dashboard.ts` holds the client-safe half
 * and the reason for the split.
 */

/**
 * The checklist's developer-platform steps read the token and endpoint lists,
 * which the matrix withholds from a `member`. The projection cannot decide
 * that, so the loader does — the same decision `whenPermitted` makes for the
 * webhook segment, applied to two steps instead of one segment.
 */
const progress = Effect.flatMap(
  permitted({ apiToken: ['list'], webhook: ['list'] }),
  (developerPlatform) => workspaceProgress({ developerPlatform })
)

const dashboardPayload: WorkspacePageFrame<WorkspaceDashboardPayload> = workspacePage(
  { notification: ['read'] },
  () =>
    Effect.map(
      Effect.all(
        {
          core: workspaceDashboard,
          webhooks: whenPermitted(
            { webhook: ['list'] },
            Effect.flatMap(WebhookEndpoints, (webhooks) => webhooks.list)
          ),
          apiTokens: whenPermitted(
            { apiToken: ['list'] },
            Effect.flatMap(ApiTokenRegistry, (tokens) => tokens.list)
          ),
          invitations: whenPermitted(
            { invitation: ['create'] },
            Effect.flatMap(WorkspaceInvitations, (invites) => invites.list)
          ),
          auditEvents: whenPermitted(
            { auditLog: ['read'] },
            Effect.flatMap(AuditEventLog, (log) =>
              Effect.map(log.list(), (page) => page.events.slice(0, 5))
            )
          ),
          progress
        },
        { concurrency: 'unbounded' }
      ),
      (segments) => {
        const { core, ...soft } = segments
        return { ...core, ...soft }
      }
    )
)

/**
 * The loader as a plain function, so tests drive it directly with fixture
 * actors (`workspace-dashboard.test.ts`) — no request, no auth runtime.
 */
export function loadWorkspaceDashboard(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceDashboardPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, dashboardPayload, {
    userId: input.userId
  })
}

export async function loadWorkspaceDashboardHandler(
  input: WorkspaceDashboardInput
): Promise<WorkspaceDashboardPayload> {
  const session = await requireRequestSession()
  return loadWorkspaceDashboard({
    workspaceSlug: input.workspaceSlug,
    userId: session.user.id
  })
}
