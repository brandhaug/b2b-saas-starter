import {
  WebhookEndpoints,
  type WebhookEndpoint
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import {
  workspaceDashboard,
  type WorkspaceDashboardProjection
} from '@b2b-saas-starter/capabilities/workspace-projections'
import { type WorkspaceViewer } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { whenPermitted } from './authorize'
import { workspacePage, type WorkspacePageFrame } from './page-frame'

/**
 * The dashboard payload, assembled per actor: the `workspaceDashboard`
 * projection (everything `notification:read` covers) plus the webhook segment, which
 * is `null` for an actor without `webhook:list`. See
 * `workspace-settings.ts` for why a permission-shaped payload is declared in
 * the app rather than in `@b2b-saas-starter/capabilities`.
 */
export type WorkspaceDashboardPayload = WorkspaceDashboardProjection & {
  readonly viewer: WorkspaceViewer | null
  readonly webhooks: ReadonlyArray<WebhookEndpoint> | null
}

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
          )
        },
        { concurrency: 'unbounded' }
      ),
      (segments) => ({ ...segments.core, webhooks: segments.webhooks })
    )
)

/** The dashboard route's loader. */
export function loadWorkspaceDashboard(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceDashboardPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, dashboardPayload, {
    userId: input.userId
  })
}
