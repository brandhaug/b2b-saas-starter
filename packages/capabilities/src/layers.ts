import { Effect, Layer } from 'effect'
import { type Database, layerFromD1 } from '@b2b-saas-starter/db'

// catalog
import {
  type AdoptionReadiness,
  LiveAdoptionReadiness,
  SeedAdoptionReadiness
} from './catalog/adoption-readiness.ts'
import {
  type CatalogRefreshHistory,
  LiveCatalogRefreshHistory,
  SeedCatalogRefreshHistory
} from './catalog/catalog-refresh-history.ts'
import {
  type ImplementationReports,
  LiveImplementationReports,
  SeedImplementationReports
} from './catalog/implementation-reports.ts'
import {
  LiveStarterModuleCatalog,
  SeedStarterModuleCatalog,
  type StarterModuleCatalog
} from './catalog/starter-module-catalog.ts'

// developer-platform
import {
  type ApiTokenRegistry,
  LiveApiTokenRegistry,
  SeedApiTokenRegistry
} from './developer-platform/api-token-registry.ts'
import {
  LiveWebhookEndpoints,
  SeedWebhookEndpoints,
  type WebhookEndpoints
} from './developer-platform/webhook-endpoints.ts'
import {
  LiveWebhookPublisher,
  SeedWebhookPublisher,
  type WebhookPublisher,
  type WebhookQueueBinding
} from './developer-platform/webhook-publisher.ts'

// governance
import {
  type AuditEventLog,
  LiveAuditEventLog,
  SeedAuditEventLog
} from './governance/audit-event-log.ts'
import {
  LiveWorkspaceInvitations,
  SeedWorkspaceInvitations,
  type WorkspaceInvitationBinding,
  type WorkspaceInvitations
} from './governance/workspace-invitations.ts'
import {
  LiveWorkspaceMembership,
  makeSeedRoster,
  SeedWorkspaceMembership,
  type WorkspaceMemberBinding,
  type WorkspaceMembership
} from './governance/workspace-membership.ts'

// notifications
import {
  type IntegrationSurfaces,
  LiveIntegrationSurfaces,
  SeedIntegrationSurfaces
} from './notifications/integration-surfaces.ts'
import {
  LiveNotificationFeed,
  type NotificationFeed,
  SeedNotificationFeed
} from './notifications/notification-feed.ts'

import {
  seedApiTokens,
  seedAuditEvents,
  seedCatalogRefreshHistory,
  seedImplementationReports,
  seedIntegrationSurfaces,
  seedMembers,
  seedNotifications,
  seedReadinessTrend,
  seedStarterModules,
  seedWebhookEndpoints,
  seedWorkspaceRecord
} from './seed-fixture.ts'

export type CapabilityServices =
  | AdoptionReadiness
  | ApiTokenRegistry
  | AuditEventLog
  | CatalogRefreshHistory
  | ImplementationReports
  | IntegrationSurfaces
  | NotificationFeed
  | StarterModuleCatalog
  | WebhookEndpoints
  | WebhookPublisher
  | WorkspaceInvitations
  | WorkspaceMembership

export type CapabilitiesLayer = Layer.Layer<CapabilityServices>

/**
 * Membership and invitations share one fixture roster, because accepting an
 * invitation adds a member: built independently, the two adapters would
 * disagree about who is in the workspace. Live needs no equivalent — the
 * plugin owns both writes, and both read back from the same tables.
 */
const SeedGovernance = Layer.unwrap(
  Effect.gen(function* () {
    const roster = yield* makeSeedRoster(seedMembers)
    return Layer.merge(
      SeedWorkspaceInvitations({ roster, workspace: seedWorkspaceRecord }),
      SeedWorkspaceMembership(roster, seedWorkspaceRecord)
    )
  })
)

export const SeedLayer: CapabilitiesLayer = Layer.mergeAll(
  SeedAdoptionReadiness(seedReadinessTrend),
  SeedApiTokenRegistry(seedApiTokens),
  SeedAuditEventLog(seedAuditEvents),
  SeedCatalogRefreshHistory(seedCatalogRefreshHistory),
  SeedImplementationReports(seedImplementationReports),
  SeedIntegrationSurfaces(seedIntegrationSurfaces),
  SeedNotificationFeed(seedNotifications),
  SeedStarterModuleCatalog(seedStarterModules),
  SeedWebhookEndpoints(seedWebhookEndpoints),
  SeedWebhookPublisher,
  SeedGovernance
)

export type LiveCapabilitiesOptions = {
  readonly webhookQueue?: WebhookQueueBinding | undefined
  /**
   * Adapter onto the organization plugin's member endpoints. Absent, membership
   * reads still work and mutations fail `CapabilityUnavailable` — the same
   * provider-light posture `webhookQueue` takes (CLAUDE.md rule 3).
   */
  readonly memberBinding?: WorkspaceMemberBinding | undefined
  /**
   * Adapter onto the organization plugin's invitation endpoints. Absent,
   * invitation reads still work and mutations fail `CapabilityUnavailable`.
   */
  readonly invitationBinding?: WorkspaceInvitationBinding | undefined
}

export function makeLiveCapabilitiesLayer(
  options: LiveCapabilitiesOptions = {}
): Layer.Layer<CapabilityServices, never, Database> {
  return Layer.mergeAll(
    LiveAdoptionReadiness,
    LiveApiTokenRegistry.pipe(Layer.provide(LiveAuditEventLog)),
    LiveAuditEventLog,
    LiveCatalogRefreshHistory,
    LiveImplementationReports,
    LiveIntegrationSurfaces,
    LiveNotificationFeed,
    LiveStarterModuleCatalog,
    LiveWebhookEndpoints.pipe(Layer.provide(LiveAuditEventLog)),
    LiveWebhookPublisher(options.webhookQueue),
    LiveWorkspaceInvitations(options.invitationBinding).pipe(
      Layer.provide(LiveAuditEventLog)
    ),
    LiveWorkspaceMembership(options.memberBinding).pipe(
      Layer.provide(LiveAuditEventLog)
    )
  )
}

/**
 * Exported at module level for `runtime.ts` only — not re-exported from the
 * package index. Consumers select layers through `selectCapabilitiesLayer` /
 * `selectWorkspaceLayer`.
 */
export function makeLiveLayerFromD1(
  d1: Parameters<typeof layerFromD1>[0],
  options?: LiveCapabilitiesOptions
) {
  return makeLiveCapabilitiesLayer(options).pipe(Layer.provide(layerFromD1(d1)))
}
