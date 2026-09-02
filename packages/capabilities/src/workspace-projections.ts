import { Effect, Layer } from 'effect'
import { type Workspace } from './governance/workspace-identity.ts'
import { WorkspaceMembership } from './governance/workspace-membership.ts'
import {
  NotificationFeed,
  type Notification
} from './notifications/notification-feed.ts'
import { type CapabilityUnavailable } from './errors.ts'
import { memberToActor, WorkspaceContext } from './workspace-context.ts'

/**
 * Named read projections over the per-capability services.
 *
 * These are pure compositions — no Seed/Live adapters of their own (that
 * god-object shape was removed by ADR 0044). They exist so the web loaders
 * and the REST/MCP Capability Interfaces assemble the same aggregates from
 * one place: pre-computed counts and scores ship with the data instead of
 * being re-derived in route handlers and UI components.
 */

export type WorkspaceOverviewProjection = {
  readonly workspace: Workspace
  readonly notifications: ReadonlyArray<Notification>
}

/**
 * The workspace overview served by the REST `overview` endpoint (matches
 * `WorkspaceOverviewDto` in `@b2b-saas-starter/api`) and embedded in the
 * dashboard projection below.
 */
export const workspaceOverview: Effect.Effect<
  WorkspaceOverviewProjection,
  CapabilityUnavailable,
  WorkspaceContext | NotificationFeed
> = Effect.gen(function* () {
  const ctx = yield* WorkspaceContext
  const feed = yield* NotificationFeed
  const notifications = yield* feed.list
  return {
    workspace: ctx.workspace,
    notifications
  }
})

export type WorkspaceDashboardProjection = WorkspaceOverviewProjection & {
  readonly unreadCount: number
}

/**
 * Everything the workspace dashboard renders under one permission, aggregates
 * pre-computed. `notification:read` covers all of it.
 *
 * Webhook endpoints are deliberately NOT here: `webhook:list` is a separate
 * permission a `member` does not hold, and a projection cannot check
 * authorization (see this package's intent node). The caller reads them as its
 * own segment and drops the segment when the actor may not have it — see
 * `apps/web/src/lib/server/workspace-dashboard.ts`. Folding them back in would
 * mean the read runs for every actor and the numbers ship in the page payload.
 */
export const workspaceDashboard: Effect.Effect<
  WorkspaceDashboardProjection,
  CapabilityUnavailable,
  WorkspaceContext | NotificationFeed
> = workspaceOverview.pipe(
  Effect.map((overview) => ({
    ...overview,
    unreadCount: overview.notifications.filter((notification) => !notification.read)
      .length
  }))
)

export type WorkspaceListItemProjection = {
  readonly workspace: Workspace
  readonly memberCount: number
  readonly notificationCount: number
}

/**
 * "My workspaces": every workspace the user is a member of, with the counts
 * the workspace list page renders. Possibly empty — no `WorkspaceNotFound`
 * here; a user with no memberships gets `[]`, not an error. Unlike the other
 * projections this takes no ambient `WorkspaceContext`: it resolves the
 * user's memberships first and scopes each per-workspace read itself, using
 * the membership row the query already proved as the actor.
 */
export function listWorkspacesForUser(
  userId: string
): Effect.Effect<
  ReadonlyArray<WorkspaceListItemProjection>,
  CapabilityUnavailable,
  WorkspaceMembership | NotificationFeed
> {
  return Effect.gen(function* () {
    const membership = yield* WorkspaceMembership
    const feed = yield* NotificationFeed
    const memberships = yield* membership.listWorkspacesForUser(userId)
    return yield* Effect.forEach(
      memberships,
      ({ workspace, member }) =>
        Effect.all([membership.listMembers, feed.list], {
          concurrency: 'unbounded'
        }).pipe(
          Effect.map(([members, notifications]) => ({
            workspace,
            memberCount: members.length,
            notificationCount: notifications.length
          })),
          Effect.provide(
            Layer.succeed(WorkspaceContext)({
              workspace,
              actor: memberToActor(member)
            })
          )
        ),
      { concurrency: 'unbounded' }
    )
  })
}
