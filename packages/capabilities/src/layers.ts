import { Layer } from 'effect'
import { Database, layerFromD1 } from '@b2b-saas-starter/db'

// catalog
import {
  AdoptionReadiness,
  LiveAdoptionReadiness,
  SeedAdoptionReadiness
} from './catalog/adoption-readiness.ts'
import {
  CatalogRefreshHistory,
  LiveCatalogRefreshHistory,
  SeedCatalogRefreshHistory
} from './catalog/catalog-refresh-history.ts'
import {
  ImplementationReports,
  LiveImplementationReports,
  SeedImplementationReports
} from './catalog/implementation-reports.ts'
import {
  LiveStarterModuleCatalog,
  SeedStarterModuleCatalog,
  StarterModuleCatalog
} from './catalog/starter-module-catalog.ts'

// developer-platform
import {
  ApiTokenRegistry,
  LiveApiTokenRegistry,
  SeedApiTokenRegistry
} from './developer-platform/api-token-registry.ts'
import {
  LiveWebhookEndpoints,
  SeedWebhookEndpoints,
  WebhookEndpoints
} from './developer-platform/webhook-endpoints.ts'
import {
  LiveWebhookPublisher,
  SeedWebhookPublisher,
  WebhookPublisher,
  type WebhookQueueBinding
} from './developer-platform/webhook-publisher.ts'

// governance
import {
  AuditEventLog,
  LiveAuditEventLog,
  SeedAuditEventLog
} from './governance/audit-event-log.ts'
import {
  LiveWorkspaceMembership,
  SeedWorkspaceMembership,
  WorkspaceMembership
} from './governance/workspace-membership.ts'

// notifications
import {
  IntegrationSurfaces,
  LiveIntegrationSurfaces,
  SeedIntegrationSurfaces
} from './notifications/integration-surfaces.ts'
import {
  LiveNotificationFeed,
  NotificationFeed,
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

export const makeLiveCapabilitiesLayer = (
  options: LiveCapabilitiesOptions = {}
): Layer.Layer<CapabilityServices, never, Database> =>
  Layer.mergeAll(
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

/**
 * Exported at module level for `runtime.ts` only — not re-exported from the
 * package index. Consumers select layers through `selectCapabilitiesLayer` /
 * `selectWorkspaceLayer`.
 */
export const makeLiveLayerFromD1 = (
  d1: Parameters<typeof layerFromD1>[0],
  options?: LiveCapabilitiesOptions
) => makeLiveCapabilitiesLayer(options).pipe(Layer.provide(layerFromD1(d1)))
