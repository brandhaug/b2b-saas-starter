import {
  ApiTokenRegistry,
  type ApiToken
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import {
  WebhookEndpoints,
  type WebhookEndpoint
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import {
  AuditEventLog,
  type AuditEvent
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  WorkspaceInvitations,
  type Invitation
} from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import {
  workspaceDashboard,
  type WorkspaceDashboardProjection
} from '@b2b-saas-starter/capabilities/workspace-projections'
import { type WorkspaceViewer } from '@/lib/permissions'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { whenPermitted } from './authorize'
import { workspacePage, type WorkspacePageFrame } from './page-frame'

/**
 * The dashboard payload, assembled per actor: the `workspaceDashboard`
 * projection (everything `notification:read` covers) plus the soft segments
 * the attention feed reads, each `null` for an actor without its permission.
 * A member gets the notifications panel and nothing else — the segments are
 * never read, so nothing permission-shaped reaches their SSR payload. See
 * `workspace-settings.ts` for why a permission-shaped payload is declared in
 * the app rather than in `@b2b-saas-starter/capabilities`.
 */
export type WorkspaceDashboardPayload = WorkspaceDashboardProjection & {
  readonly viewer: WorkspaceViewer | null
  readonly webhooks: ReadonlyArray<WebhookEndpoint> | null
  readonly apiTokens: ReadonlyArray<ApiToken> | null
  readonly invitations: ReadonlyArray<Invitation> | null
  /** The newest audit events, for the dashboard's trailing activity card. */
  readonly auditEvents: ReadonlyArray<AuditEvent> | null
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
          )
        },
        { concurrency: 'unbounded' }
      ),
      (segments) => {
        const { core, ...soft } = segments
        return { ...core, ...soft }
      }
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
