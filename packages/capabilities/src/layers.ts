import { Layer } from 'effect'
import {
  Database,
  layerFromD1,
  layerFromDb,
  type DrizzleDatabase
} from '@b2b-saas-starter/db'

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
  seedWebhookEndpoints
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
  SeedWorkspaceMembership(seedMembers)
)

export const LiveCapabilitiesLayer: Layer.Layer<
  | AdoptionReadiness
  | ApiTokenRegistry
  | AuditEventLog
  | CatalogRefreshHistory
  | ImplementationReports
  | IntegrationSurfaces
  | NotificationFeed
  | StarterModuleCatalog
  | WebhookEndpoints
  | WorkspaceMembership,
  never,
  Database
> = Layer.mergeAll(
  LiveAdoptionReadiness,
  LiveApiTokenRegistry.pipe(Layer.provide(LiveAuditEventLog)),
  LiveAuditEventLog,
  LiveCatalogRefreshHistory,
  LiveImplementationReports,
  LiveIntegrationSurfaces,
  LiveNotificationFeed,
  LiveStarterModuleCatalog,
  LiveWebhookEndpoints.pipe(Layer.provide(LiveAuditEventLog)),
  LiveWorkspaceMembership
)

export const makeLiveLayerFromD1 = (d1: Parameters<typeof layerFromD1>[0]) =>
  LiveCapabilitiesLayer.pipe(Layer.provide(layerFromD1(d1)))

export const makeLiveLayerFromDb = (db: DrizzleDatabase) =>
  LiveCapabilitiesLayer.pipe(Layer.provide(layerFromDb(db)))
