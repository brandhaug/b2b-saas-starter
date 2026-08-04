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
  liveMerchantAppointmentCommands,
  MerchantAppointmentCommands,
  SeedMerchantAppointmentCommands
} from './booking/merchant-appointment-commands.ts'
import {
  BookingCancellations,
  emptySeedBookingCancellationStore,
  SeedBookingCancellations
} from './booking/booking-cancellation.ts'
import { makeLiveBookingCancellations } from './booking/booking-cancellation-adapter.ts'
import {
  BookingRescheduling,
  emptySeedBookingReschedulingStore,
  SeedBookingRescheduling
} from './booking/booking-rescheduling.ts'
import { makeLiveBookingRescheduling } from './booking/booking-rescheduling-adapter.ts'
import {
  BookingNotificationOutbox,
  LiveBookingNotificationOutbox,
  SeedBookingNotificationOutbox
} from './booking/booking-notifications.ts'
import {
  LiveBookingParties,
  SeedBookingParties
} from './booking/foundation-adapters.ts'
import { BookingParties } from './booking/foundations.ts'

// developer-platform
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

// governance
import {
  AuditEventLog,
  LiveAuditEventLog,
  SeedAuditEventLog
} from './governance/audit-event-log.ts'

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
import {
  LiveShopTopology,
  SeedShopTopology
} from './merchant-catalog/foundation-adapters.ts'
import { ShopTopology } from './merchant-catalog/foundations.ts'

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
  LiveMerchantActivation,
  MerchantActivation,
  SeedMerchantActivation
} from './scheduling/merchant-activation.ts'

import { deriveSeedOperationalAppointments } from './seed-fixture.ts'
import { LivePricingQuotes, SeedPricingQuotes } from './pricing/adapters.ts'
import { PricingQuotes } from './pricing/index.ts'
import {
  LivePaymentLedger,
  LivePaymentSettlement,
  SeedPaymentLedger
} from './payments/adapters.ts'
import {
  emptySeedPaymentSettlementStore,
  PaymentLedger,
  PaymentSettlement,
  SeedPaymentSettlement
} from './payments/index.ts'
import {
  LiveCustomerEngagement,
  SeedCustomerEngagement
} from './customer-engagement/adapters.ts'
import { CustomerEngagement } from './customer-engagement/index.ts'
import {
  LiveControlledTemplateEligibilityEngine,
  LiveMessagingReadModel,
  LiveNotificationIntents,
  SeedMessagingReadModel,
  SeedNotificationIntents
} from './notifications/adapters.ts'
import {
  LiveMerchantMessagingSettings,
  MerchantMessagingSettings,
  SeedMerchantMessagingSettings
} from './notifications/merchant-messaging-settings.ts'
import {
  LiveMessagingFinance,
  SeedMessagingFinance
} from './notifications/messaging-finance.ts'
import {
  ControlledTemplateEligibilityEngine,
  MessagingFinance,
  MessagingReadModel,
  NotificationIntentLifecycle,
  NotificationIntents,
  SeedControlledTemplateEligibilityEngine,
  SeedNotificationIntentLifecycle
} from './notifications/index.ts'
import { LiveNotificationIntentLifecycle } from './notifications/notification-intent-lifecycle.live.ts'
import {
  LiveScheduledWorkQueue,
  SeedScheduledWorkQueue
} from './scheduled-work/adapters.ts'
import { ScheduledWorkQueue } from './scheduled-work/index.ts'
import {
  LiveGiftCards,
  LiveGiftCardRedemptions,
  LiveGiftCardPayment,
  LiveGiftCardSales,
  SeedGiftCards
} from './gift-cards/adapters.ts'
import {
  emptySeedGiftCardSalesStore,
  GiftCardPayment,
  GiftCardSales,
  SeedGiftCardPayment,
  SeedGiftCardSales
} from './gift-cards/gift-card-sales.ts'
import { GiftCards } from './gift-cards/index.ts'
import {
  emptySeedGiftCardRedemptionStore,
  GiftCardRedemptions,
  SeedGiftCardRedemptions
} from './gift-cards/gift-card-redemption.ts'
import { LiveWalkIns, SeedWalkIns } from './walk-ins/adapters.ts'
import { WalkIns } from './walk-ins/index.ts'
import {
  LiveCustomerIdentity,
  SeedCustomerIdentity
} from './customer-identity/adapters.ts'
import { CustomerIdentity } from './customer-identity/index.ts'
import {
  emptySeedWaitingListStore,
  SeedOfferBooking,
  SeedWaitingList,
  WaitingList
} from './waiting-list/index.ts'
import { LiveWaitingList } from './waiting-list/adapters.ts'
import {
  makeLiveSharedCapabilityFoundations,
  SeedSharedCapabilityFoundations,
  SharedCapabilityFoundations
} from './foundation/index.ts'
import { classifyRestrictedMutation } from './authorization-policy.ts'
import {
  CustomerDirectory,
  makeLiveCustomerDirectory,
  SeedCustomerDirectory,
  emptySeedCustomerDirectoryStore
} from './customer-directory/index.ts'
import {
  emptySeedMerchantSubscriptionStore,
  LiveMerchantSubscriptions,
  MerchantSubscriptions,
  SeedMerchantSubscriptions
} from './subscriptions/index.ts'
import { resolveMerchantSubscriptionAccessState } from './subscriptions/subscription-access.ts'

export type CapabilityServices =
  | PlatformApiTokenRegistry
  | PlatformApiReads
  | PlatformWebhookEndpoints
  | AuditEventLog
  | MerchantMembership
  | MerchantCatalog
  | MerchantOnboarding
  | ShopTopology
  | Scheduling
  | BookingPublication
  | MerchantActivation
  | BookingSessions
  | BookingSelection
  | BookingScheduling
  | BookingCheckout
  | BookingConfirmation
  | AppointmentOperations
  | MerchantAppointmentCommands
  | BookingCancellations
  | BookingRescheduling
  | BookingNotificationOutbox
  | BookingParties
  | PricingQuotes
  | PaymentLedger
  | PaymentSettlement
  | CustomerEngagement
  | NotificationIntents
  | NotificationIntentLifecycle
  | MessagingReadModel
  | MerchantMessagingSettings
  | MessagingFinance
  | ControlledTemplateEligibilityEngine
  | ScheduledWorkQueue
  | GiftCards
  | GiftCardRedemptions
  | GiftCardSales
  | GiftCardPayment
  | WalkIns
  | CustomerIdentity
  | WaitingList
  | MerchantSubscriptions
  | SharedCapabilityFoundations
  | CustomerDirectory

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
  shops: [
    {
      id: `shp_${seedBookingScenario.merchant.id}`,
      merchantId: seedBookingScenario.merchant.id,
      brandId: `brd_${seedBookingScenario.merchant.id}`,
      slug: seedBookingScenario.merchant.slug,
      publicName: seedBookingScenario.merchant.publicName,
      brandName: seedBookingScenario.merchant.publicName,
      timezone: seedBookingScenario.merchant.timezone
    }
  ],
  providers: seedBookingScenario.providers.map(
    ({ bookingConfigJson, ...provider }) => ({
      ...provider,
      bookingConfiguration: bookingConfigJson
    })
  ),
  services: seedBookingScenario.services,
  eligibility: seedBookingScenario.eligibility.map(seedBookingSelectionEligibilityKey),
  scheduleRules: seedBookingScenario.scheduleRules,
  appointments: seedBookingScenario.appointments,
  canSellUnassignedGiftCard: true
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
const seedOperationalAppointments = deriveSeedOperationalAppointments({
  merchant: seedBookingScenario.merchant,
  provider: seedBookingScenario.provider,
  service: seedBookingScenario.services[0]!,
  appointments: seedBookingScenario.appointments
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
const seedBookingPartiesLayer = SeedBookingParties(
  [],
  seedBookingScheduling.requestSelections,
  seedBookingScheduling.activeRequests,
  seedBookingScheduling.partyRequests,
  seedBookingScheduling.holds,
  seedBookingSessions.parties,
  (sessionId, request) => {
    const current = seedBookingSelection.selections.get(sessionId)
    seedBookingSelection.selections.set(sessionId, {
      version: current?.version ?? 1,
      ...(current?.shopId ? { shopId: current.shopId } : {}),
      providerPreference: request?.providerPreference ?? null,
      primaryServiceId: request?.primaryServiceId ?? null,
      additionalServiceIds: [...(request?.additionalServiceIds ?? [])]
    })
  }
)
const seedPricingQuotesLayer = SeedPricingQuotes()
const seedGiftCardSalesStore = emptySeedGiftCardSalesStore()
const seedGiftCardRedemptionStore = emptySeedGiftCardRedemptionStore()
const seedWaitingListLayer = SeedWaitingList(emptySeedWaitingListStore()).pipe(
  Layer.provide(SeedOfferBooking)
)
const seedBookingCheckoutLayer = SeedBookingCheckout(seedBookingCheckout).pipe(
  Layer.provide(Layer.merge(seedBookingPartiesLayer, seedPricingQuotesLayer))
)

export const SeedLayer: CapabilitiesLayer = Layer.mergeAll(
  SeedMerchantSubscriptions(emptySeedMerchantSubscriptionStore()),
  SeedSharedCapabilityFoundations(),
  SeedCustomerDirectory(emptySeedCustomerDirectoryStore()),
  seedBookingPartiesLayer,
  seedPricingQuotesLayer,
  SeedPaymentLedger(),
  SeedPaymentSettlement(emptySeedPaymentSettlementStore()),
  SeedCustomerEngagement(),
  SeedNotificationIntents(),
  SeedNotificationIntentLifecycle(),
  SeedMessagingReadModel(),
  SeedMerchantMessagingSettings(),
  SeedMessagingFinance(),
  SeedControlledTemplateEligibilityEngine(),
  SeedScheduledWorkQueue(),
  SeedGiftCards(),
  SeedGiftCardRedemptions(seedGiftCardRedemptionStore),
  SeedGiftCardSales(seedGiftCardSalesStore),
  SeedGiftCardPayment(seedGiftCardSalesStore),
  SeedWalkIns(),
  SeedCustomerIdentity(),
  seedWaitingListLayer,
  SeedShopTopology([
    {
      id: `shp_${seedBookingScenario.merchant.id}`,
      brandId: `brd_${seedBookingScenario.merchant.id}`,
      merchantId: seedBookingScenario.merchant.id,
      slug: seedBookingScenario.merchant.slug,
      publicName: seedBookingScenario.merchant.publicName,
      timezone: seedBookingScenario.merchant.timezone,
      currency: seedBookingScenario.merchant.currency
    }
  ]),
  SeedPlatformApiTokenRegistry(),
  SeedPlatformApiReads(seedPlatformApiReads),
  SeedPlatformWebhookEndpoints(),
  SeedAuditEventLog([]),
  SeedMerchantOnboarding(seedMerchantCatalog),
  SeedMerchantCatalog(seedMerchantCatalogConfiguration),
  SeedScheduling(seedScheduling),
  SeedBookingPublication(seedScheduling),
  SeedMerchantActivation,
  SeedBookingSessions(seedBookingSessions),
  SeedBookingSelection(seedBookingSelection),
  SeedBookingScheduling(seedBookingScheduling),
  seedBookingCheckoutLayer,
  SeedBookingConfirmation(seedBookingConfirmation, seedConfirmationKeyring).pipe(
    Layer.provide(SeedPaymentSettlement(emptySeedPaymentSettlementStore()))
  ),
  SeedAppointmentOperations(seedOperationalAppointments),
  SeedMerchantAppointmentCommands,
  SeedBookingCancellations(emptySeedBookingCancellationStore()),
  SeedBookingRescheduling(emptySeedBookingReschedulingStore()),
  SeedBookingNotificationOutbox
)

export type LiveCapabilitiesOptions = {
  readonly customerDirectoryFingerprintKey?: string | undefined
  readonly requireCustomerDirectoryFingerprintKey?: boolean | undefined
  readonly platformApiCursorSecret?: string | undefined
  readonly requirePlatformApiCursorSecret?: boolean | undefined
  readonly confirmationKeyring?:
    | Parameters<typeof LiveBookingConfirmation>[0]
    | undefined
  readonly notificationDestinationSecrets?:
    | Parameters<typeof LiveBookingConfirmation>[1]
    | undefined
  readonly merchantAppointmentImpersonatedBy?: string | null | undefined
  readonly capabilityQueueWakeup?:
    | ((
        wakeup:
          | import('./foundation/index.ts').QueueWakeup
          | import('./notifications/index.ts').AppointmentEmailWakeup
      ) => Promise<void>)
    | undefined
  readonly capabilityOutboxHandler?:
    | ((claim: import('./foundation/index.ts').OutboxClaim) => Promise<void>)
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
  if (
    options.requireCustomerDirectoryFingerprintKey &&
    !options.customerDirectoryFingerprintKey?.trim()
  )
    throw new Error('CUSTOMER_DIRECTORY_FINGERPRINT_KEY is required in production.')
  // Cloudflare Workers prohibit random generation while evaluating a module.
  // Callers construct the live layer from inside a request, queue, or scheduled
  // handler, so create the local-only fallback at that handler-time boundary.
  const cursorSecret = options.platformApiCursorSecret || crypto.randomUUID()
  const customerDirectoryFingerprintKey =
    options.customerDirectoryFingerprintKey || crypto.randomUUID()
  const liveBookingPartiesLayer = LiveBookingParties
  const livePricingQuotesLayer = LivePricingQuotes
  const liveBookingCheckoutLayer = LiveBookingCheckout.pipe(
    Layer.provide(Layer.merge(liveBookingPartiesLayer, livePricingQuotesLayer))
  )
  return Layer.mergeAll(
    LiveMerchantSubscriptions,
    makeLiveSharedCapabilityFoundations({
      classifyRestrictedMutation,
      resolveMerchantAccess: resolveMerchantSubscriptionAccessState,
      ...(options.capabilityQueueWakeup
        ? { publishWakeup: options.capabilityQueueWakeup }
        : {}),
      ...(options.capabilityOutboxHandler
        ? { handleOutbox: options.capabilityOutboxHandler }
        : {})
    }),
    makeLiveCustomerDirectory(customerDirectoryFingerprintKey),
    liveBookingPartiesLayer,
    livePricingQuotesLayer,
    LivePaymentLedger,
    LivePaymentSettlement,
    LiveCustomerEngagement,
    LiveNotificationIntents,
    LiveNotificationIntentLifecycle.pipe(
      Layer.provide(LiveMessagingFinance),
      Layer.provide(LiveControlledTemplateEligibilityEngine)
    ),
    LiveMessagingReadModel,
    LiveMerchantMessagingSettings,
    LiveMessagingFinance,
    LiveControlledTemplateEligibilityEngine,
    LiveScheduledWorkQueue,
    LiveGiftCards,
    LiveGiftCardRedemptions,
    LiveGiftCardSales,
    LiveGiftCardPayment,
    LiveWalkIns,
    LiveCustomerIdentity,
    LiveWaitingList,
    LiveShopTopology,
    LivePlatformApiTokenRegistry.pipe(Layer.provide(LiveAuditEventLog)),
    LivePlatformApiReads(cursorSecret),
    LivePlatformWebhookEndpoints(cursorSecret).pipe(Layer.provide(LiveAuditEventLog)),
    LiveAuditEventLog,
    LiveMerchantOnboarding,
    LiveMerchantCatalog,
    LiveScheduling,
    LiveBookingPublication,
    LiveMerchantActivation,
    LiveBookingSessions,
    LiveBookingSelection,
    LiveBookingScheduling,
    liveBookingCheckoutLayer,
    LiveBookingConfirmation(
      options.confirmationKeyring ?? { currentKeyId: 'unconfigured', keys: {} },
      options.notificationDestinationSecrets,
      options.capabilityQueueWakeup
    ).pipe(Layer.provide(LivePaymentSettlement)),
    LiveAppointmentOperations,
    liveMerchantAppointmentCommands({
      impersonatedBy: options.merchantAppointmentImpersonatedBy,
      ...(options.notificationDestinationSecrets
        ? {
            notificationDestinationSecrets: options.notificationDestinationSecrets
          }
        : {}),
      ...(options.confirmationKeyring
        ? { confirmationKeyring: options.confirmationKeyring }
        : {}),
      ...(options.capabilityQueueWakeup
        ? { publishAppointmentEmailWakeup: options.capabilityQueueWakeup }
        : {})
    }),
    makeLiveBookingCancellations(
      options.notificationDestinationSecrets,
      options.capabilityQueueWakeup
    ),
    makeLiveBookingRescheduling(
      options.notificationDestinationSecrets,
      options.capabilityQueueWakeup
    ),
    LiveBookingNotificationOutbox
  )
}

/**
 * Exported at module level for `runtime.ts` only — not re-exported from the
 * package index. Consumers select layers through `selectCapabilitiesLayer`.
 */
export const makeLiveLayerFromD1 = (
  d1: Parameters<typeof layerFromD1>[0],
  options?: LiveCapabilitiesOptions
) => makeLiveCapabilitiesLayer(options).pipe(Layer.provide(layerFromD1(d1)))
