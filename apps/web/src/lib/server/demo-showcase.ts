import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import {
  workspaceDashboard,
  workspaceOverview,
  workspaceProgress,
  type WorkspaceOverviewProjection
} from '@b2b-saas-starter/capabilities/workspace-projections'
import { type WorkspaceViewer } from '@/lib/permissions'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { type WorkspaceDashboardPayload } from './workspace-dashboard'

/**
 * The public showcase reads: the seed workspace's numbers for `/` and a
 * member-view dashboard payload for `/demo`. Both run WITHOUT an actor — the
 * one sanctioned actorless read (apps/web intent node, "Routes") — so the
 * context layer resolves the workspace alone: broadcast notifications only,
 * no user-targeted rows, and nothing here can write (the capability services
 * get no bindings; D1 receives reads, never mutations).
 *
 * Seed/Live equivalence is load-bearing: in dev and test this answers from the
 * in-memory Seed layer; on a deployed Worker with a D1 binding it answers from
 * the seed rows the deployment created — the same `starter-lab` either way.
 *
 * Both reads are pinned to `DEMO_WORKSPACE_SLUG` (see `lib/demo-workspace.ts`):
 * this module is the sanctioned actorless exception, and the sanction covers
 * the showcase workspace only — never a slug handed in from a route.
 */

export type DemoShowcase = {
  /** The exact JSON the REST `overview` endpoint returns for the workspace. */
  readonly overview: WorkspaceOverviewProjection
  readonly memberCount: number
  readonly tokenCount: number
  readonly unusedTokenCount: number
  /** Mean success rate across enabled endpoints; `null` with none. */
  readonly endpointSuccessRate: number | null
  readonly notificationCount: number
  readonly unreadCount: number
}

/**
 * The `/` landing numbers. `null` when the showcase workspace does not exist
 * in the backing store: the landing page must never 404 over its demo strip,
 * so a missing workspace degrades to "no numbers" rather than an error.
 */
export function loadDemoShowcase(): Promise<DemoShowcase | null> {
  return runWorkspaceCapabilities(
    DEMO_WORKSPACE_SLUG,
    Effect.all(
      {
        overview: workspaceOverview,
        dashboard: workspaceDashboard,
        memberCount: Effect.flatMap(WorkspaceMembership, (membership) =>
          Effect.map(membership.listMembers, (members) => members.length)
        ),
        tokens: Effect.flatMap(ApiTokenRegistry, (tokens) => tokens.list),
        webhooks: Effect.flatMap(WebhookEndpoints, (webhooks) => webhooks.list)
      },
      { concurrency: 'unbounded' }
    )
  ).then(
    (raw) => {
      let enabledCount = 0
      let successRateTotal = 0
      let unusedTokenCount = 0
      for (const endpoint of raw.webhooks) {
        if (endpoint.enabled) {
          enabledCount += 1
          successRateTotal += endpoint.successRate
        }
      }
      for (const token of raw.tokens) {
        if (token.lastUsedAt === null) {
          unusedTokenCount += 1
        }
      }
      return {
        overview: raw.overview,
        memberCount: raw.memberCount,
        tokenCount: raw.tokens.length,
        unusedTokenCount,
        endpointSuccessRate:
          enabledCount === 0 ? null : Math.round(successRateTotal / enabledCount),
        notificationCount: raw.overview.notifications.length,
        unreadCount: raw.dashboard.unreadCount
      }
    },
    () => null
  )
}

/**
 * The `/demo` payload: the dashboard page rendered for the demo persona — a
 * plain `member`, whose permission shape withholds every owner segment
 * (`null`), so the demo shows exactly what a member sees and the route tree
 * carries no mutation path (the demo page's ports reject writes). Takes no
 * slug: the showcase workspace is fixed, and this actorless read is not
 * sanctioned for any other.
 */
export function loadDemoWorkspace(): Promise<WorkspaceDashboardPayload> {
  return runWorkspaceCapabilities(
    DEMO_WORKSPACE_SLUG,
    Effect.map(
      Effect.all(
        {
          core: workspaceDashboard,
          // The demo persona is a plain member, so the developer-platform
          // steps stay out — the same shape `permitted()` gives the dashboard
          // loader for an actor without `apiToken:list` and `webhook:list`.
          progress: workspaceProgress({ developerPlatform: false })
        },
        { concurrency: 'unbounded' }
      ),
      ({ core, progress }) => ({
        ...core,
        webhooks: null,
        apiTokens: null,
        invitations: null,
        auditEvents: null,
        progress,
        viewer: { role: 'member' } satisfies WorkspaceViewer
      })
    )
  )
}
