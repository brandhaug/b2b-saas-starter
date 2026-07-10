import { Layer } from 'effect'
import { Database, layerFromD1 } from '@b2b-saas-starter/db'

// booking
import {
  BookingSessions,
  emptySeedBookingSessionStore,
  LiveBookingSessions,
  SeedBookingSessions
} from './booking/booking-sessions.ts'
import {
  BookingSelection,
  emptySeedBookingSelectionStore,
  LiveBookingSelection,
  SeedBookingSelection,
  seedBookingSelectionEligibilityKey
} from './booking/booking-selection.ts'
import {
  BookingScheduling,
  emptySeedBookingSchedulingStore,
  LiveBookingScheduling,
  SeedBookingScheduling
} from './booking/booking-scheduling.ts'

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

// merchant-catalog
import {
  buildSeedBookingScenario,
  emptySeedMerchantCatalog,
  LiveMerchantOnboarding,
  MerchantMembership,
  MerchantOnboarding,
  SeedMerchantOnboarding
} from './merchant-catalog/merchant-onboarding.ts'
import {
  LiveMerchantCatalog,
  MerchantCatalog,
  SeedMerchantCatalog,
  seedEligibilityKey,
  type SeedMerchantCatalogConfigurationStore
} from './merchant-catalog/merchant-catalog.ts'

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
  BookingPublication,
  emptySeedSchedulingStore,
  LiveBookingPublication,
  LiveScheduling,
  Scheduling,
  SeedBookingPublication,
  SeedScheduling
} from './scheduling/scheduling.ts'

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
  | MerchantMembership
  | MerchantCatalog
  | MerchantOnboarding
  | NotificationFeed
  | StarterModuleCatalog
  | Scheduling
  | BookingPublication
  | BookingSessions
  | BookingSelection
  | BookingScheduling
  | WebhookEndpoints
  | WebhookPublisher
  | WorkspaceMembership

export type CapabilitiesLayer = Layer.Layer<CapabilityServices>

const seedBookingScenario = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')
const seedBookingSessions = emptySeedBookingSessionStore({
  merchants: [
    {
      id: seedBookingScenario.merchant.id,
      slug: seedBookingScenario.merchant.slug,
      published: seedBookingScenario.publicBookingPage.status === 'published'
    }
  ]
})
const seedBookingSelection = emptySeedBookingSelectionStore({
  merchants: [
    {
      id: seedBookingScenario.merchant.id,
      slug: seedBookingScenario.merchant.slug,
      presentation: seedBookingScenario.merchant.plan
    }
  ],
  providers: seedBookingScenario.providers,
  services: seedBookingScenario.services,
  eligibility: seedBookingScenario.eligibility.map(seedBookingSelectionEligibilityKey)
})
const seedBookingScheduling = emptySeedBookingSchedulingStore(
  seedBookingScenario,
  seedBookingSelection
)
const seedScheduling = emptySeedSchedulingStore(seedBookingScenario)
const seedMerchantCatalog = emptySeedMerchantCatalog([seedBookingScenario.owner])
seedMerchantCatalog.merchants.set(seedBookingScenario.merchant.slug, {
  ...seedBookingScenario.merchant,
  defaultProvider: {
    id: seedBookingScenario.provider.id,
    displayName: seedBookingScenario.provider.displayName,
    status: seedBookingScenario.provider.status
  },
  publicBookingPage: {
    id: seedBookingScenario.publicBookingPage.id,
    status: seedBookingScenario.publicBookingPage.status
  }
})
const seedMerchantCatalogConfiguration: SeedMerchantCatalogConfigurationStore = {
  services: new Map(
    seedBookingScenario.services.map((service) => [service.id, service])
  ),
  providers: new Map(
    seedBookingScenario.providers.map((provider) => [provider.id, provider])
  ),
  eligibility: new Set(
    seedBookingScenario.eligibility.map((pair) => seedEligibilityKey(pair))
  )
}

export const SeedLayer: CapabilitiesLayer = Layer.mergeAll(
  SeedAdoptionReadiness(seedReadinessTrend),
  SeedApiTokenRegistry(seedApiTokens),
  SeedAuditEventLog(seedAuditEvents),
  SeedCatalogRefreshHistory(seedCatalogRefreshHistory),
  SeedImplementationReports(seedImplementationReports),
  SeedIntegrationSurfaces(seedIntegrationSurfaces),
  SeedMerchantOnboarding(seedMerchantCatalog),
  SeedMerchantCatalog(seedMerchantCatalogConfiguration),
  SeedScheduling(seedScheduling),
  SeedBookingPublication(seedScheduling),
  SeedBookingSessions(seedBookingSessions),
  SeedBookingSelection(seedBookingSelection),
  SeedBookingScheduling(seedBookingScheduling),
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
    LiveMerchantOnboarding,
    LiveMerchantCatalog,
    LiveScheduling,
    LiveBookingPublication,
    LiveBookingSessions,
    LiveBookingSelection,
    LiveBookingScheduling,
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
