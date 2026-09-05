import { AUDIT_EVENT_TYPES } from '@b2b-saas-starter/capabilities/governance/audit-event-taxonomy'
import { WORKSPACE_ROLES } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import {
  workspaceDashboard,
  workspaceOverview,
  workspaceProgress
} from '@b2b-saas-starter/capabilities/workspace-projections'
import { type WorkspaceViewer } from '@/lib/permissions'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { type DemoShowcase } from './demo-showcase'
import { type WorkspaceDashboardPayload } from './workspace-dashboard'

/**
 * The public showcase reads — the behaviour behind the server functions in
 * `demo-showcase.ts`. Everything imported at this module's top level (the
 * capability services, the Effect runtime they ride) must never reach the
 * browser bundle, which is why the route tree reaches this file only through
 * dynamic `import()` inside `createServerFn` handlers (see `invitations.ts`
 * for the reference split).
 *
 * Both reads run WITHOUT an actor — the one sanctioned actorless read
 * (apps/web intent node, "Routes") — so the context layer resolves the
 * workspace alone: broadcast notifications only, no user-targeted rows, and
 * nothing here can write (the capability services get no bindings; D1
 * receives reads, never mutations).
 *
 * Seed/Live equivalence is load-bearing: in dev and test this answers from the
 * in-memory Seed layer; on a deployed Worker with a D1 binding it answers from
 * the seed rows the deployment created — the same `starter-lab` either way.
 *
 * Both reads are pinned to `DEMO_WORKSPACE_SLUG` (see `lib/demo-workspace.ts`):
 * this module is the sanctioned actorless exception, and the sanction covers
 * the showcase workspace only — never a slug handed in from a route.
 */

/**
 * The `/` landing numbers. `null` when the showcase workspace does not exist
 * in the backing store: the landing page must never 404 over its demo strip,
 * so a missing workspace degrades to "no numbers" rather than an error.
 *
 * The counts are chosen to prove breadth, not to editorialize the seed
 * workspace's state: `memberCount` and `notificationCount` are live reads,
 * while `roleCount` and `auditEventTypeCount` count the vocabulary the
 * starter enforces (the role tuple RBAC gates on, the audit taxonomy every
 * recorded event validates against) — numbers that grow with the product
 * instead of narrating a demo workspace's unread mail.
 */
export function loadDemoShowcase(): Promise<DemoShowcase | null> {
  return runWorkspaceCapabilities(
    DEMO_WORKSPACE_SLUG,
    Effect.all(
      {
        overview: workspaceOverview,
        memberCount: Effect.flatMap(WorkspaceMembership, (membership) =>
          Effect.map(membership.listMembers, (members) => members.length)
        )
      },
      { concurrency: 'unbounded' }
    )
  ).then(
    (raw) => ({
      overview: raw.overview,
      memberCount: raw.memberCount,
      notificationCount: raw.overview.notifications.length,
      roleCount: WORKSPACE_ROLES.length,
      auditEventTypeCount: AUDIT_EVENT_TYPES.length
    }),
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
