import { Layer } from 'effect'
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
  LiveWorkspaceMembership,
  SeedWorkspaceMembership,
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
  | WorkspaceMembership

export type CapabilitiesLayer = Layer.Layer<CapabilityServices>

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
  SeedWorkspaceMembership(seedMembers, seedWorkspaceRecord)
)

export type LiveCapabilitiesOptions = {
  readonly webhookQueue?: WebhookQueueBinding | undefined
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
    LiveWorkspaceMembership
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
