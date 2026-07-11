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
import {
  BookingCheckout,
  emptySeedBookingCheckoutStore,
  LiveBookingCheckout,
  SeedBookingCheckout
} from './booking/booking-checkout.ts'
import {
  BookingConfirmation,
  emptySeedBookingConfirmationStore,
  LiveBookingConfirmation,
  SeedBookingConfirmation
} from './booking/booking-confirmation.ts'
import {
  AppointmentOperations,
  LiveAppointmentOperations,
  SeedAppointmentOperations
} from './booking/appointment-operations.ts'
import {
  BookingNotificationOutbox,
  LiveBookingNotificationOutbox,
  SeedBookingNotificationOutbox
} from './booking/booking-notifications.ts'

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
  LivePlatformApiTokenRegistry,
  PlatformApiTokenRegistry,
  SeedPlatformApiTokenRegistry
} from './developer-platform/platform-api-token-registry.ts'
import {
  LivePlatformApiReads,
  PlatformApiReads,
  SeedPlatformApiReads
} from './developer-platform/platform-api-reads.ts'
import {
  LivePlatformWebhookEndpoints,
  PlatformWebhookEndpoints,
  SeedPlatformWebhookEndpoints
} from './developer-platform/platform-webhook-endpoints.ts'
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
  makeSeedOperationalAppointments,
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
  | PlatformApiTokenRegistry
  | PlatformApiReads
  | PlatformWebhookEndpoints
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
  | BookingCheckout
  | BookingConfirmation
  | AppointmentOperations
  | BookingNotificationOutbox
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
const seedBookingCheckout = emptySeedBookingCheckoutStore(seedBookingScheduling)
const seedConfirmationKeyring = {
  currentKeyId: 'seed-current',
  keys: { 'seed-current': 'deterministic-seed-confirmation-key' }
} as const
const seedBookingConfirmation = emptySeedBookingConfirmationStore(
  seedBookingSessions,
  seedBookingCheckout
)
const seedOperationalAppointments = makeSeedOperationalAppointments({
  merchant: seedBookingScenario.merchant,
  provider: seedBookingScenario.provider,
  service: seedBookingScenario.services[0]!
})
const seedPlatformTimestamp = '2026-07-10T09:30:00.000Z'
const seedPlatformApiReads = new Map([
  [
    seedBookingScenario.merchant.id,
    {
      merchant: {
        id: seedBookingScenario.merchant.id,
        publicName: seedBookingScenario.merchant.publicName,
        slug: seedBookingScenario.merchant.slug,
        timeZone: seedBookingScenario.merchant.timezone,
        currency: seedBookingScenario.merchant.currency,
        publicPage: {
          status: seedBookingScenario.publicBookingPage.status,
          bookingUrl:
            seedBookingScenario.publicBookingPage.status === 'published'
              ? `/${seedBookingScenario.merchant.slug}/booking`
              : null
        },
        createdAt: seedPlatformTimestamp,
        updatedAt: seedPlatformTimestamp
      },
      services: seedBookingScenario.services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        category: service.category,
        status: service.status,
        durationMinutes: service.durationMinutes,
        price: { amountMinor: service.priceMinor, currency: service.currency },
        providerIds: seedBookingScenario.eligibility
          .filter((pair) => pair.serviceId === service.id)
          .map((pair) => pair.providerId)
          .sort(),
        createdAt: seedPlatformTimestamp,
        updatedAt: seedPlatformTimestamp
      })),
      providers: seedBookingScenario.providers.map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        status: provider.status,
        isDefault: provider.isDefault,
        serviceIds: seedBookingScenario.eligibility
          .filter((pair) => pair.providerId === provider.id)
          .map((pair) => pair.serviceId)
          .sort(),
        createdAt: seedPlatformTimestamp,
        updatedAt: seedPlatformTimestamp
      })),
      appointments: seedOperationalAppointments.map((appointment) => ({
        id: appointment.id,
        status: appointment.status,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        timeZone: appointment.snapshot.merchantTimezone,
        providerPreference: appointment.snapshot.providerPreference,
        provider: appointment.snapshot.assignedProvider,
        services: appointment.snapshot.services.map((service) => ({
          id: service.id,
          role: service.role,
          name: service.name,
          durationMinutes: service.durationMinutes,
          price: { amountMinor: service.priceMinor, currency: service.currency }
        })),
        customer: appointment.snapshot.customerDetails,
        checkoutPath: appointment.snapshot.checkoutPath,
        total: {
          amountMinor: appointment.snapshot.totalMinor,
          currency: appointment.snapshot.currency
        },
        createdAt: appointment.createdAt,
        updatedAt: appointment.createdAt
      }))
    }
  ]
])
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
  SeedPlatformApiTokenRegistry(),
  SeedPlatformApiReads(seedPlatformApiReads),
  SeedPlatformWebhookEndpoints(),
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
  SeedBookingCheckout(seedBookingCheckout),
  SeedBookingConfirmation(seedBookingConfirmation, seedConfirmationKeyring),
  SeedAppointmentOperations(seedOperationalAppointments),
  SeedBookingNotificationOutbox,
  SeedNotificationFeed(seedNotifications),
  SeedStarterModuleCatalog(seedStarterModules),
  SeedWebhookEndpoints(seedWebhookEndpoints),
  SeedWebhookPublisher,
  SeedWorkspaceMembership(seedMembers, seedWorkspaceRecord)
)

export type LiveCapabilitiesOptions = {
  readonly webhookQueue?: WebhookQueueBinding | undefined
  readonly platformApiCursorSecret?: string | undefined
  readonly requirePlatformApiCursorSecret?: boolean | undefined
  readonly confirmationKeyring?:
    | Parameters<typeof LiveBookingConfirmation>[0]
    | undefined
}

export const makeLiveCapabilitiesLayer = (
  options: LiveCapabilitiesOptions = {}
): Layer.Layer<CapabilityServices, never, Database> => {
  if (
    options.requirePlatformApiCursorSecret &&
    !options.platformApiCursorSecret?.trim()
  )
    throw new Error('PLATFORM_API_CURSOR_SECRET is required in production.')
  // Cloudflare Workers prohibit random generation while evaluating a module.
  // Callers construct the live layer from inside a request, queue, or scheduled
  // handler, so create the local-only fallback at that handler-time boundary.
  const cursorSecret = options.platformApiCursorSecret || crypto.randomUUID()
  return Layer.mergeAll(
    LiveAdoptionReadiness,
    LiveApiTokenRegistry.pipe(Layer.provide(LiveAuditEventLog)),
    LivePlatformApiTokenRegistry.pipe(Layer.provide(LiveAuditEventLog)),
    LivePlatformApiReads(cursorSecret),
    LivePlatformWebhookEndpoints(cursorSecret).pipe(Layer.provide(LiveAuditEventLog)),
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
    LiveBookingCheckout,
    LiveBookingConfirmation(
      options.confirmationKeyring ?? { currentKeyId: 'unconfigured', keys: {} }
    ),
    LiveAppointmentOperations,
    LiveBookingNotificationOutbox,
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
export const makeLiveLayerFromD1 = (
  d1: Parameters<typeof layerFromD1>[0],
  options?: LiveCapabilitiesOptions
) => makeLiveCapabilitiesLayer(options).pipe(Layer.provide(layerFromD1(d1)))
