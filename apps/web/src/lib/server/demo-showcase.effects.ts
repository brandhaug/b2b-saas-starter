import { AUDIT_EVENT_TYPES } from '@b2b-saas-starter/capabilities/governance/audit-event-taxonomy'
import { workspaceRoles } from '@b2b-saas-starter/db/enums'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { workspaceOverview } from '@b2b-saas-starter/capabilities/workspace-projections'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { type DemoShowcase } from './demo-showcase'

/**
 * Homepage summary pinned to the showcase workspace. This actorless read exposes
 * broadcast notifications and aggregate counts only. The /demo preview uses
 * separate static fixtures and never selects these runtime adapters.
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
      roleCount: workspaceRoles.length,
      auditEventTypeCount: AUDIT_EVENT_TYPES.length
    }),
    () => null
  )
}
