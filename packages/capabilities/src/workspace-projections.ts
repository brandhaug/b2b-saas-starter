import { Effect, Layer } from 'effect'
import {
  AdoptionReadiness,
  projectReadiness,
  type ReadinessPoint
} from './catalog/adoption-readiness.ts'
import {
  CatalogRefreshHistory,
  type CatalogRefreshRun
} from './catalog/catalog-refresh-history.ts'
import {
  StarterModuleCatalog,
  type ModuleStatus,
  type StarterModuleWithState
} from './catalog/starter-module-catalog.ts'
import { ApiTokenRegistry } from './developer-platform/api-token-registry.ts'
import {
  WebhookEndpoints,
  type WebhookEndpoint
} from './developer-platform/webhook-endpoints.ts'
import {
  WorkspaceMembership,
  type Workspace
} from './governance/workspace-membership.ts'
import {
  NotificationFeed,
  type Notification
} from './notifications/notification-feed.ts'
import type { CapabilityUnavailable } from './errors.ts'
import { WorkspaceContext } from './workspace-context.ts'

/**
 * Named read projections over the per-capability services.
 *
 * These are pure compositions — no Seed/Live adapters of their own (that
 * god-object shape was removed by ADR 0044). They exist so the web loaders
 * and the REST/MCP Capability Interfaces assemble the same aggregates from
 * one place: pre-computed counts and scores ship with the data instead of
 * being re-derived in route handlers and UI components.
 */

const MODULE_STATUS_ORDER: readonly ModuleStatus[] = [
  'ready',
  'needs-config',
  'attention',
  'disabled'
]

export type ModuleStatusCount = {
  readonly status: ModuleStatus
  readonly count: number
}

/** Per-status Module State tally, in stable display order. */
export const countModuleStatuses = (
  modules: readonly StarterModuleWithState[]
): readonly ModuleStatusCount[] =>
  MODULE_STATUS_ORDER.map((status) => ({
    status,
    count: modules.filter((module) => module.state.status === status).length
  }))

export type WorkspaceOverviewProjection = {
  readonly workspace: Workspace
  readonly readinessScore: number
  readonly modules: readonly StarterModuleWithState[]
  readonly notifications: readonly Notification[]
  readonly readinessTrend: readonly ReadinessPoint[]
}

/**
 * The workspace overview served by the REST `overview` endpoint (matches
 * `WorkspaceOverviewDto` in `@b2b-saas-starter/api`) and embedded in the
 * dashboard projection below.
 */
export const workspaceOverview: Effect.Effect<
  WorkspaceOverviewProjection,
  CapabilityUnavailable,
  WorkspaceContext | StarterModuleCatalog | NotificationFeed | AdoptionReadiness
> = Effect.gen(function* () {
  const ctx = yield* WorkspaceContext
  const catalog = yield* StarterModuleCatalog
  const feed = yield* NotificationFeed
  const readiness = yield* AdoptionReadiness
  const [modules, notifications, readinessTrend] = yield* Effect.all(
    [catalog.listModules, feed.list, readiness.getTrend],
    { concurrency: 'unbounded' }
  )
  return {
    workspace: ctx.workspace,
    readinessScore: projectReadiness(modules.map((module) => module.state)).score,
    modules,
    notifications,
    readinessTrend
  }
})

export type WorkspaceDashboardProjection = WorkspaceOverviewProjection & {
  readonly webhooks: readonly WebhookEndpoint[]
  readonly refreshRuns: readonly CatalogRefreshRun[]
  readonly readyCount: number
  readonly unreadCount: number
  readonly moduleStatusCounts: readonly ModuleStatusCount[]
}

/** Everything the workspace dashboard renders, aggregates pre-computed. */
export const workspaceDashboard: Effect.Effect<
  WorkspaceDashboardProjection,
  CapabilityUnavailable,
  | WorkspaceContext
  | StarterModuleCatalog
  | NotificationFeed
  | AdoptionReadiness
  | WebhookEndpoints
  | CatalogRefreshHistory
> = Effect.gen(function* () {
  const webhooks = yield* WebhookEndpoints
  const refreshHistory = yield* CatalogRefreshHistory
  const [overview, endpoints, refreshRuns] = yield* Effect.all(
    [workspaceOverview, webhooks.list, refreshHistory.listRecent],
    { concurrency: 'unbounded' }
  )
  return {
    ...overview,
    webhooks: endpoints,
    refreshRuns,
    readyCount: projectReadiness(overview.modules.map((module) => module.state))
      .readyCount,
    unreadCount: overview.notifications.filter((notification) => !notification.read)
      .length,
    moduleStatusCounts: countModuleStatuses(overview.modules)
  }
})

export type WorkspaceListItemProjection = {
  readonly workspace: Workspace
  readonly moduleCount: number
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
export const listWorkspacesForUser = (
  userId: string
): Effect.Effect<
  readonly WorkspaceListItemProjection[],
  CapabilityUnavailable,
  WorkspaceMembership | StarterModuleCatalog | NotificationFeed
> =>
  Effect.gen(function* () {
    const membership = yield* WorkspaceMembership
    const catalog = yield* StarterModuleCatalog
    const feed = yield* NotificationFeed
    const memberships = yield* membership.listWorkspacesForUser(userId)
    return yield* Effect.forEach(
      memberships,
      ({ workspace, member }) =>
        Effect.all([catalog.listModules, membership.listMembers, feed.list], {
          concurrency: 'unbounded'
        }).pipe(
          Effect.map(([modules, members, notifications]) => ({
            workspace,
            moduleCount: modules.length,
            memberCount: members.length,
            notificationCount: notifications.length
          })),
          Effect.provide(
            Layer.succeed(WorkspaceContext)({
              workspace,
              actor: {
                userId: member.id,
                role: member.role,
                systemRole: member.systemRole
              }
            })
          )
        ),
      { concurrency: 'unbounded' }
    )
  })

export type WorkspaceSettingsSummaryProjection = {
  readonly modules: readonly StarterModuleWithState[]
  readonly apiTokenCount: number
  readonly webhookCount: number
  readonly unreadCount: number
}

/** The counts and module list the workspace settings page renders. */
export const workspaceSettingsSummary: Effect.Effect<
  WorkspaceSettingsSummaryProjection,
  CapabilityUnavailable,
  | WorkspaceContext
  | StarterModuleCatalog
  | ApiTokenRegistry
  | WebhookEndpoints
  | NotificationFeed
> = Effect.gen(function* () {
  const catalog = yield* StarterModuleCatalog
  const tokens = yield* ApiTokenRegistry
  const webhooks = yield* WebhookEndpoints
  const feed = yield* NotificationFeed
  const [modules, apiTokens, endpoints, unreadCount] = yield* Effect.all(
    [catalog.listModules, tokens.list, webhooks.list, feed.unreadCount],
    { concurrency: 'unbounded' }
  )
  return {
    modules,
    apiTokenCount: apiTokens.length,
    webhookCount: endpoints.length,
    unreadCount
  }
})
