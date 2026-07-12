import { Context, Effect, Layer, Schema } from 'effect'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  batchQueries,
  brands,
  bookingParties,
  bookingRequests,
  bookingRequestServices,
  bookingSessionAdditionalServices,
  bookingSessions,
  Database,
  merchants,
  providers,
  providerServiceEligibility,
  services,
  shopProviders,
  shops,
  shopServices
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import type { BookingSession } from './booking-sessions.ts'
import { BookingPartyConflict } from './foundations.ts'
import { deleteTimeSlotHoldsForSelectionChange } from './booking-scheduling.ts'
import {
  resolveBookingConfiguration,
  resolveCatalogText,
  BookingConfiguration,
  decodeBookingConfiguration,
  ResolvedBookingConfiguration,
  ResolvedCatalogText,
  type CatalogLocale
} from '../merchant-catalog/booking-configuration.ts'

export const ProviderPreference = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('any') }),
  Schema.Struct({ kind: Schema.Literal('specific'), providerId: Schema.String })
])
export type ProviderPreference = typeof ProviderPreference.Type

export const PublicBookableProvider = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  isDefault: Schema.Boolean,
  access: Schema.Literals(['public', 'restricted']),
  localizedName: Schema.optional(
    Schema.Struct({
      text: Schema.String,
      locale: Schema.Literals(['en', 'es', 'fr', 'ro']),
      isSourceLanguageFallback: Schema.Boolean
    })
  ),
  eligibleServiceIds: Schema.Array(Schema.String)
})
export type PublicBookableProvider = typeof PublicBookableProvider.Type

export const PublicBookableService = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  localizedName: Schema.optional(ResolvedCatalogText),
  category: Schema.NullOr(Schema.String),
  priceMinor: Schema.Number,
  currency: Schema.String,
  durationMinutes: Schema.Number,
  eligibleProviderIds: Schema.Array(Schema.String)
})
export type PublicBookableService = typeof PublicBookableService.Type

export const ServiceSelection = Schema.Struct({
  primaryServiceId: Schema.NullOr(Schema.String),
  additionalServiceIds: Schema.Array(Schema.String)
})
export type ServiceSelection = typeof ServiceSelection.Type

export const BookingJourney = Schema.Struct({
  version: Schema.Number,
  presentation: Schema.Literals(['solo', 'team']),
  shopId: Schema.String,
  shops: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      slug: Schema.String,
      name: Schema.String,
      localizedName: Schema.optional(ResolvedCatalogText)
    })
  ),
  resolvedConfiguration: ResolvedBookingConfiguration,
  catalogRecovery: Schema.NullOr(
    Schema.Literals(['empty', 'inactive_entities', 'invalid_associations'])
  ),
  reconciliation: Schema.Array(
    Schema.Literals([
      'shop_changed',
      'provider_unavailable',
      'service_unavailable',
      'combination_unavailable'
    ])
  ),
  providerPreference: Schema.NullOr(ProviderPreference),
  selection: ServiceSelection,
  compatibleAdditionalServiceIds: Schema.Array(Schema.String),
  providers: Schema.Array(PublicBookableProvider),
  services: Schema.Array(PublicBookableService)
})
export type BookingJourney = typeof BookingJourney.Type

export class BookingSelectionRejected extends Schema.TaggedErrorClass<BookingSelectionRejected>()(
  'BookingSelectionRejected',
  { message: Schema.String }
) {}

type SelectionEffect<A> = Effect.Effect<
  A,
  BookingSelectionRejected | BookingPartyConflict | CapabilityUnavailable
>

export type BookingSelectionShape = {
  readonly load: (session: BookingSession) => SelectionEffect<BookingJourney>
  readonly chooseProvider: (
    session: BookingSession,
    preference: ProviderPreference,
    expectedVersion: number
  ) => SelectionEffect<BookingJourney>
  readonly chooseShop: (
    session: BookingSession,
    shopId: string,
    expectedVersion: number
  ) => SelectionEffect<BookingJourney>
  readonly chooseServices: (
    session: BookingSession,
    input: ServiceSelection,
    expectedVersion: number
  ) => SelectionEffect<BookingJourney>
}

export class BookingSelection extends Context.Service<
  BookingSelection,
  BookingSelectionShape
>()('@b2b-saas-starter/capabilities/BookingSelection') {}

type StoredProvider = {
  readonly id: string
  readonly merchantId: string
  readonly displayName: string
  readonly isDefault: boolean
  readonly status: 'active' | 'inactive'
  readonly bookingAccess?: 'public' | 'restricted'
  readonly bookingConfiguration?: BookingConfiguration | null
}
type StoredService = {
  readonly id: string
  readonly merchantId: string
  readonly name: string
  readonly category: string | null
  readonly priceMinor: number
  readonly currency: string
  readonly durationMinutes: number
  readonly status: 'active' | 'inactive'
  readonly bookingConfiguration?: BookingConfiguration | null
}
type StoredSelection = {
  version?: number
  shopId?: string
  providerPreference: ProviderPreference | null
  primaryServiceId: string | null
  additionalServiceIds: string[]
}

export type SeedBookingSelectionStore = {
  readonly merchants: Map<
    string,
    {
      readonly id: string
      readonly slug: string
      readonly presentation: 'solo' | 'team'
      readonly publicName?: string
      readonly bookingConfiguration?: BookingConfiguration | null
    }
  >
  readonly shops: Map<
    string,
    {
      readonly id: string
      readonly merchantId: string
      readonly brandId: string
      readonly slug: string
      readonly publicName: string
      readonly brandName: string
      readonly timezone?: string
      readonly bookingConfiguration?: BookingConfiguration | null
      readonly brandBookingConfiguration?: BookingConfiguration | null
    }
  >
  readonly shopProviders: Set<string>
  readonly shopServices: Set<string>
  readonly providers: Map<string, StoredProvider>
  readonly services: Map<string, StoredService>
  readonly eligibility: Set<SeedBookingSelectionEligibilityKey>
  readonly selections: Map<string, StoredSelection>
  invalidateTimeSlotHolds?: (sessionId: string) => void
}

declare const eligibilityBrand: unique symbol
export type SeedBookingSelectionEligibilityKey = string & {
  readonly [eligibilityBrand]: true
}
export const seedBookingSelectionEligibilityKey = (input: {
  readonly merchantId: string
  readonly providerId: string
  readonly serviceId: string
}): SeedBookingSelectionEligibilityKey =>
  `${input.merchantId}\0${input.providerId}\0${input.serviceId}` as SeedBookingSelectionEligibilityKey

export const emptySeedBookingSelectionStore = (
  input: {
    readonly merchants?: readonly {
      readonly id: string
      readonly slug: string
      readonly presentation: 'solo' | 'team'
      readonly publicName?: string
      readonly bookingConfiguration?: BookingConfiguration | null
    }[]
    readonly shops?: readonly {
      readonly id: string
      readonly merchantId: string
      readonly brandId: string
      readonly slug: string
      readonly publicName: string
      readonly brandName: string
      readonly timezone?: string
      readonly bookingConfiguration?: BookingConfiguration | null
      readonly brandBookingConfiguration?: BookingConfiguration | null
    }[]
    readonly providers?: readonly StoredProvider[]
    readonly services?: readonly StoredService[]
    readonly eligibility?: readonly SeedBookingSelectionEligibilityKey[]
  } = {}
): SeedBookingSelectionStore => ({
  merchants: new Map(
    (input.merchants ?? []).map((merchant) => [merchant.slug, merchant])
  ),
  shops: new Map(
    (
      input.shops ??
      input.merchants?.map((merchant) => ({
        id: `shp_${merchant.id}`,
        merchantId: merchant.id,
        brandId: `brd_${merchant.id}`,
        slug: merchant.slug,
        publicName: merchant.publicName ?? merchant.slug,
        brandName: merchant.publicName ?? merchant.slug
      })) ??
      []
    ).map((shop) => [shop.id, shop])
  ),
  shopProviders: new Set(
    (input.shops ?? []).length === 0
      ? (input.merchants ?? []).flatMap((merchant) =>
          (input.providers ?? [])
            .filter((provider) => provider.merchantId === merchant.id)
            .map((provider) => `shp_${merchant.id}\0${provider.id}`)
        )
      : (input.shops ?? []).flatMap((shop) =>
          (input.providers ?? [])
            .filter((provider) => provider.merchantId === shop.merchantId)
            .map((provider) => `${shop.id}\0${provider.id}`)
        )
  ),
  shopServices: new Set(
    (input.shops ?? []).length === 0
      ? (input.merchants ?? []).flatMap((merchant) =>
          (input.services ?? [])
            .filter((service) => service.merchantId === merchant.id)
            .map((service) => `shp_${merchant.id}\0${service.id}`)
        )
      : (input.shops ?? []).flatMap((shop) =>
          (input.services ?? [])
            .filter((service) => service.merchantId === shop.merchantId)
            .map((service) => `${shop.id}\0${service.id}`)
        )
  ),
  providers: new Map(
    (input.providers ?? []).map((provider) => [provider.id, provider])
  ),
  services: new Map((input.services ?? []).map((service) => [service.id, service])),
  eligibility: new Set(input.eligibility ?? []),
  selections: new Map()
})

type Catalog = {
  readonly merchantId: string
  readonly presentation: 'solo' | 'team'
  readonly shopId: string
  readonly shops: readonly {
    readonly id: string
    readonly slug: string
    readonly name: string
    readonly localizedName?: ResolvedCatalogText
  }[]
  readonly resolvedConfiguration: ResolvedBookingConfiguration
  readonly catalogRecovery: BookingJourney['catalogRecovery']
  readonly providers: readonly PublicBookableProvider[]
  readonly services: readonly PublicBookableService[]
}

const rejected = () =>
  new BookingSelectionRejected({ message: 'Selection could not be accepted' })

const emptySelection = (): StoredSelection => ({
  version: 1,
  providerPreference: null,
  primaryServiceId: null,
  additionalServiceIds: []
})

const journey = (
  catalog: Catalog,
  selection: StoredSelection,
  reconciliation: BookingJourney['reconciliation'] = []
): BookingJourney => ({
  version: selection.version ?? 1,
  presentation: catalog.presentation,
  shopId: catalog.shopId,
  shops: [...catalog.shops],
  resolvedConfiguration: catalog.resolvedConfiguration,
  catalogRecovery: catalog.catalogRecovery,
  reconciliation,
  providerPreference: selection.providerPreference,
  selection: {
    primaryServiceId: selection.primaryServiceId,
    additionalServiceIds: [...selection.additionalServiceIds]
  },
  compatibleAdditionalServiceIds: compatibleAdditionalServices(catalog, selection),
  providers: [...catalog.providers],
  services: [...catalog.services]
})

const preferenceAccepts = (
  catalog: Catalog,
  preference: ProviderPreference,
  serviceIds: readonly string[]
): boolean => {
  if (preference.kind === 'specific') {
    const provider = catalog.providers.find((item) => item.id === preference.providerId)
    if (!provider) return false
    if (provider.access !== 'public') return false
    if (catalog.presentation === 'solo' && !provider.isDefault) return false
    return serviceIds.every((serviceId) =>
      provider.eligibleServiceIds.includes(serviceId)
    )
  }
  if (catalog.presentation !== 'team') return false
  return catalog.providers.some(
    (provider) =>
      provider.access === 'public' &&
      serviceIds.every((serviceId) => provider.eligibleServiceIds.includes(serviceId))
  )
}

function compatibleAdditionalServices(
  catalog: Catalog,
  selection: StoredSelection
): readonly string[] {
  const preference = selection.providerPreference
  const primary = catalog.services.find(
    (service) => service.id === selection.primaryServiceId
  )
  if (!preference || !primary) return []
  return catalog.services
    .filter(
      (service) => service.id !== primary.id && service.currency === primary.currency
    )
    .filter((service) => {
      const otherAdditionalIds = selection.additionalServiceIds.filter(
        (serviceId) => serviceId !== service.id
      )
      return preferenceAccepts(catalog, preference, [
        primary.id,
        ...otherAdditionalIds,
        service.id
      ])
    })
    .map((service) => service.id)
}

const validateServices = (
  catalog: Catalog,
  selection: StoredSelection,
  input: ServiceSelection
): Effect.Effect<StoredSelection, BookingSelectionRejected> => {
  if (input.primaryServiceId === null) {
    return input.additionalServiceIds.length === 0
      ? Effect.succeed({
          ...selection,
          primaryServiceId: null,
          additionalServiceIds: []
        })
      : Effect.fail(rejected())
  }
  const preference = selection.providerPreference
  const ids = [input.primaryServiceId, ...input.additionalServiceIds]
  const unique = new Set(ids)
  const selected = ids.map((id) =>
    catalog.services.find((service) => service.id === id)
  )
  if (
    !preference ||
    unique.size !== ids.length ||
    selected.some((service) => service === undefined) ||
    new Set(selected.map((service) => service?.currency)).size !== 1 ||
    !preferenceAccepts(catalog, preference, ids)
  ) {
    return Effect.fail(rejected())
  }
  return Effect.succeed({
    ...selection,
    primaryServiceId: input.primaryServiceId,
    additionalServiceIds: [...input.additionalServiceIds]
  })
}

const seedCatalog = (
  store: SeedBookingSelectionStore,
  merchantSlug: string,
  requestedShopId: string | undefined,
  locale: CatalogLocale
): Effect.Effect<Catalog, BookingSelectionRejected> => {
  const merchant = store.merchants.get(merchantSlug)
  if (!merchant) return Effect.fail(rejected())
  const merchantShops = [...store.shops.values()].filter(
    (shop) => shop.merchantId === merchant.id
  )
  const shop =
    merchantShops.find((candidate) => candidate.id === requestedShopId) ??
    merchantShops[0]
  if (!shop) return Effect.fail(rejected())
  const pairs = [...store.eligibility].map((key) => key.split('\0'))
  const activeProviders = [...store.providers.values()].filter(
    (provider) =>
      provider.merchantId === merchant.id &&
      provider.status === 'active' &&
      store.shopProviders.has(`${shop.id}\0${provider.id}`)
  )
  const activeServices = [...store.services.values()].filter(
    (service) =>
      service.merchantId === merchant.id &&
      service.status === 'active' &&
      store.shopServices.has(`${shop.id}\0${service.id}`)
  )
  const associatedProviders = [...store.providers.values()].filter(
    (provider) =>
      provider.merchantId === merchant.id &&
      store.shopProviders.has(`${shop.id}\0${provider.id}`)
  )
  const associatedServices = [...store.services.values()].filter(
    (service) =>
      service.merchantId === merchant.id &&
      store.shopServices.has(`${shop.id}\0${service.id}`)
  )
  const hasValidAssociation = pairs.some(
    ([pairMerchantId, providerId, serviceId]) =>
      pairMerchantId === merchant.id &&
      activeProviders.some((provider) => provider.id === providerId) &&
      activeServices.some((service) => service.id === serviceId)
  )
  const localizedName = (
    sourceText: string,
    configuration: BookingConfiguration | null | undefined
  ) => {
    const resolved = resolveCatalogText({ sourceText, configuration, locale })
    return { name: resolved.text, localizedName: resolved }
  }
  return Effect.succeed({
    merchantId: merchant.id,
    presentation: merchant.presentation,
    shopId: shop.id,
    shops: merchantShops.map((candidate) => ({
      id: candidate.id,
      slug: candidate.slug,
      ...localizedName(candidate.publicName, candidate.bookingConfiguration)
    })),
    resolvedConfiguration: resolveBookingConfiguration({
      locale,
      merchant: {
        name: merchant.publicName ?? merchant.slug,
        configuration: merchant.bookingConfiguration
      },
      brand: {
        name: shop.brandName,
        configuration: shop.brandBookingConfiguration
      },
      shop: { name: shop.publicName, configuration: shop.bookingConfiguration }
    }),
    catalogRecovery:
      activeProviders.length > 0 && activeServices.length > 0 && hasValidAssociation
        ? null
        : associatedProviders.some((provider) => provider.status === 'inactive') ||
            associatedServices.some((service) => service.status === 'inactive')
          ? 'inactive_entities'
          : activeProviders.length > 0 && activeServices.length > 0
            ? 'invalid_associations'
            : 'empty',
    providers: activeProviders
      .map(
        ({
          merchantId: _,
          status: __,
          bookingAccess,
          bookingConfiguration,
          ...provider
        }) => ({
          ...provider,
          access: bookingAccess ?? 'public',
          localizedName: resolveCatalogText({
            sourceText: provider.displayName,
            configuration: bookingConfiguration,
            locale
          }),
          eligibleServiceIds: pairs
            .filter(
              ([merchantId, providerId, serviceId]) =>
                merchantId === merchant.id &&
                providerId === provider.id &&
                activeServices.some((service) => service.id === serviceId)
            )
            .map(([, , serviceId]) => serviceId!)
        })
      )
      .filter((provider) => provider.eligibleServiceIds.length > 0),
    services: activeServices
      .map(({ merchantId: _, status: __, bookingConfiguration, ...service }) => ({
        ...service,
        ...localizedName(service.name, bookingConfiguration),
        eligibleProviderIds: pairs
          .filter(
            ([merchantId, providerId, serviceId]) =>
              merchantId === merchant.id &&
              serviceId === service.id &&
              activeProviders.some((provider) => provider.id === providerId)
          )
          .map(([, providerId]) => providerId!)
      }))
      .filter((service) => service.eligibleProviderIds.length > 0)
  })
}

const withSoloDefault = (
  catalog: Catalog,
  selection: StoredSelection
): Effect.Effect<StoredSelection> => {
  if (catalog.presentation !== 'solo' || selection.providerPreference !== null) {
    return Effect.succeed(selection)
  }
  const eligibleDefaults = catalog.providers.filter(
    (provider) =>
      provider.isDefault &&
      provider.access === 'public' &&
      provider.eligibleServiceIds.length > 0
  )
  if (eligibleDefaults.length !== 1) return Effect.succeed(selection)
  return Effect.succeed({
    ...selection,
    providerPreference: { kind: 'specific', providerId: eligibleDefaults[0]!.id }
  })
}

const normalizeSelection = (
  catalog: Catalog,
  selection: StoredSelection
): Effect.Effect<StoredSelection> =>
  Effect.gen(function* () {
    const validPreference =
      selection.providerPreference &&
      preferenceAccepts(catalog, selection.providerPreference, [])
        ? selection.providerPreference
        : null
    const preferred = yield* withSoloDefault(catalog, {
      ...selection,
      providerPreference: validPreference
    })
    if (preferred.primaryServiceId === null) {
      return { ...preferred, additionalServiceIds: [] }
    }
    const validation = yield* Effect.result(
      validateServices(catalog, preferred, {
        primaryServiceId: preferred.primaryServiceId,
        additionalServiceIds: preferred.additionalServiceIds
      })
    )
    return validation._tag === 'Success'
      ? validation.success
      : { ...preferred, primaryServiceId: null, additionalServiceIds: [] }
  })

const reconciliationFor = (
  before: StoredSelection,
  after: StoredSelection
): BookingJourney['reconciliation'] => {
  const reasons: Array<BookingJourney['reconciliation'][number]> = []
  if (before.shopId && before.shopId !== after.shopId) reasons.push('shop_changed')
  if (before.providerPreference && !after.providerPreference) {
    reasons.push('provider_unavailable')
  }
  if (before.primaryServiceId && !after.primaryServiceId) {
    reasons.push(
      after.providerPreference ? 'service_unavailable' : 'combination_unavailable'
    )
  }
  return reasons
}

export const SeedBookingSelection = (
  store: SeedBookingSelectionStore
): Layer.Layer<BookingSelection> =>
  Layer.succeed(BookingSelection)({
    load: (session) =>
      Effect.gen(function* () {
        const current = store.selections.get(session.id) ?? emptySelection()
        const catalog = yield* seedCatalog(
          store,
          session.merchantSlug,
          current.shopId,
          session.locale ?? 'en'
        )
        const selected = yield* normalizeSelection(catalog, {
          ...current,
          shopId: catalog.shopId
        })
        store.selections.set(session.id, selected)
        if (JSON.stringify(current) !== JSON.stringify(selected)) {
          store.invalidateTimeSlotHolds?.(session.id)
        }
        return journey(catalog, selected, reconciliationFor(current, selected))
      }),
    chooseShop: (session, shopId, expectedVersion) =>
      Effect.gen(function* () {
        const current = store.selections.get(session.id) ?? emptySelection()
        if ((current.version ?? 1) !== expectedVersion) {
          return yield* new BookingPartyConflict({
            bookingPartyId: `bpt_${session.id}`,
            expectedVersion
          })
        }
        const shop = store.shops.get(shopId)
        const merchant = store.merchants.get(session.merchantSlug)
        if (!shop || shop.merchantId !== merchant?.id) return yield* rejected()
        const selected: StoredSelection = {
          version: expectedVersion + 1,
          shopId,
          providerPreference: null,
          primaryServiceId: null,
          additionalServiceIds: []
        }
        store.selections.set(session.id, selected)
        store.invalidateTimeSlotHolds?.(session.id)
        const catalog = yield* seedCatalog(
          store,
          session.merchantSlug,
          shopId,
          session.locale ?? 'en'
        )
        return journey(catalog, selected, ['shop_changed'])
      }),
    chooseProvider: (session, preference, expectedVersion) =>
      Effect.gen(function* () {
        const current = store.selections.get(session.id) ?? emptySelection()
        const catalog = yield* seedCatalog(
          store,
          session.merchantSlug,
          current.shopId,
          session.locale ?? 'en'
        )
        if ((current.version ?? 1) !== expectedVersion) {
          return yield* new BookingPartyConflict({
            bookingPartyId: `bpt_${session.id}`,
            expectedVersion
          })
        }
        if (!preferenceAccepts(catalog, preference, [])) {
          return yield* rejected()
        }
        if (
          preference.kind === 'specific' &&
          catalog.providers.find((provider) => provider.id === preference.providerId)
            ?.access === 'restricted'
        ) {
          return yield* rejected()
        }
        const selected: StoredSelection = {
          version: expectedVersion + 1,
          shopId: catalog.shopId,
          providerPreference: preference,
          primaryServiceId: null,
          additionalServiceIds: []
        }
        store.selections.set(session.id, selected)
        store.invalidateTimeSlotHolds?.(session.id)
        return journey(catalog, selected)
      }),
    chooseServices: (session, input, expectedVersion) =>
      Effect.gen(function* () {
        const stored = store.selections.get(session.id) ?? emptySelection()
        const catalog = yield* seedCatalog(
          store,
          session.merchantSlug,
          stored.shopId,
          session.locale ?? 'en'
        )
        if ((stored.version ?? 1) !== expectedVersion) {
          return yield* new BookingPartyConflict({
            bookingPartyId: `bpt_${session.id}`,
            expectedVersion
          })
        }
        const current = yield* withSoloDefault(catalog, stored)
        const selected = yield* validateServices(catalog, current, input)
        const versioned = { ...selected, version: expectedVersion + 1 }
        store.selections.set(session.id, versioned)
        store.invalidateTimeSlotHolds?.(session.id)
        return journey(catalog, versioned)
      })
  })

type LiveState = {
  readonly partyId: string
  readonly partyLifecycle:
    | 'active'
    | 'confirming'
    | 'confirmed'
    | 'expired'
    | 'abandoned'
  readonly catalog: Catalog
  readonly selection: StoredSelection
}

const readLiveState = (
  db: typeof Database.Service,
  session: BookingSession,
  requestedShopId?: string
): Effect.Effect<LiveState, BookingSelectionRejected | CapabilityUnavailable> =>
  Effect.gen(function* () {
    const sessionRows = yield* orUnavailable('booking-selection')(
      db
        .select({
          merchantId: merchants.id,
          merchantName: merchants.publicName,
          merchantBookingConfiguration: merchants.bookingConfigJson,
          presentation: merchants.plan,
          version: bookingParties.version,
          partyId: bookingParties.id,
          partyLifecycle: bookingParties.lifecycle,
          shopId: bookingParties.shopId,
          providerPreference: bookingSessions.providerPreference,
          providerId: bookingSessions.providerId,
          primaryServiceId: bookingSessions.primaryServiceId
        })
        .from(bookingSessions)
        .innerJoin(merchants, eq(merchants.id, bookingSessions.merchantId))
        .innerJoin(
          bookingParties,
          eq(bookingParties.bookingSessionId, bookingSessions.id)
        )
        .where(
          and(
            eq(bookingSessions.id, session.id),
            eq(merchants.slug, session.merchantSlug)
          )
        )
        .limit(1)
    )
    const row = sessionRows[0]
    if (!row) return yield* rejected()
    const [
      providerRows,
      serviceRows,
      eligibilityRows,
      additionalRows,
      shopRows,
      shopProviderRows,
      shopServiceRows
    ] = yield* Effect.all([
      orUnavailable('booking-selection')(
        db.select().from(providers).where(eq(providers.merchantId, row.merchantId))
      ),
      orUnavailable('booking-selection')(
        db.select().from(services).where(eq(services.merchantId, row.merchantId))
      ),
      orUnavailable('booking-selection')(
        db
          .select()
          .from(providerServiceEligibility)
          .where(eq(providerServiceEligibility.merchantId, row.merchantId))
      ),
      orUnavailable('booking-selection')(
        db
          .select()
          .from(bookingSessionAdditionalServices)
          .where(eq(bookingSessionAdditionalServices.bookingSessionId, session.id))
          .orderBy(asc(bookingSessionAdditionalServices.position))
      ),
      orUnavailable('booking-selection')(
        db
          .select({
            id: shops.id,
            slug: shops.slug,
            publicName: shops.publicName,
            bookingConfiguration: shops.bookingConfigJson,
            brandName: brands.name,
            brandBookingConfiguration: brands.bookingConfigJson
          })
          .from(shops)
          .innerJoin(brands, eq(brands.id, shops.brandId))
          .where(eq(shops.merchantId, row.merchantId))
          .orderBy(asc(shops.id))
      ),
      orUnavailable('booking-selection')(
        db
          .select()
          .from(shopProviders)
          .innerJoin(shops, eq(shops.id, shopProviders.shopId))
          .where(eq(shops.merchantId, row.merchantId))
      ),
      orUnavailable('booking-selection')(
        db
          .select()
          .from(shopServices)
          .innerJoin(shops, eq(shops.id, shopServices.shopId))
          .where(eq(shops.merchantId, row.merchantId))
      )
    ])
    const selectedShopId = requestedShopId ?? row.shopId
    const selectedShop = shopRows.find((shop) => shop.id === selectedShopId)
    if (!selectedShop) return yield* rejected()
    const providerIdsAtShop = new Set(
      shopProviderRows
        .filter((entry) => entry.shop_providers.shopId === selectedShopId)
        .map((entry) => entry.shop_providers.providerId)
    )
    const serviceIdsAtShop = new Set(
      shopServiceRows
        .filter((entry) => entry.shop_services.shopId === selectedShopId)
        .map((entry) => entry.shop_services.serviceId)
    )
    const associatedProviders = providerRows.filter((provider) =>
      providerIdsAtShop.has(provider.id)
    )
    const associatedServices = serviceRows.filter((service) =>
      serviceIdsAtShop.has(service.id)
    )
    const scopedProviders = associatedProviders.filter(
      (provider) => provider.status === 'active'
    )
    const scopedServices = associatedServices.filter(
      (service) => service.status === 'active'
    )
    const activeProviderIds = new Set(scopedProviders.map((provider) => provider.id))
    const activeServiceIds = new Set(scopedServices.map((service) => service.id))
    const validEligibility = eligibilityRows.filter(
      (pair) =>
        activeProviderIds.has(pair.providerId) && activeServiceIds.has(pair.serviceId)
    )
    const catalog: Catalog = {
      merchantId: row.merchantId,
      presentation: row.presentation,
      shopId: selectedShopId,
      shops: shopRows.map((shop) => ({
        id: shop.id,
        slug: shop.slug,
        ...(() => {
          const resolved = resolveCatalogText({
            sourceText: shop.publicName,
            configuration: decodeBookingConfiguration(shop.bookingConfiguration),
            locale: session.locale ?? 'en'
          })
          return { name: resolved.text, localizedName: resolved }
        })()
      })),
      resolvedConfiguration: resolveBookingConfiguration({
        locale: session.locale ?? 'en',
        merchant: {
          name: row.merchantName,
          configuration: decodeBookingConfiguration(row.merchantBookingConfiguration)
        },
        brand: {
          name: selectedShop.brandName,
          configuration: decodeBookingConfiguration(
            selectedShop.brandBookingConfiguration
          )
        },
        shop: {
          name: selectedShop.publicName,
          configuration: decodeBookingConfiguration(selectedShop.bookingConfiguration)
        }
      }),
      catalogRecovery:
        scopedProviders.length > 0 &&
        scopedServices.length > 0 &&
        validEligibility.length > 0
          ? null
          : associatedProviders.some((provider) => provider.status === 'inactive') ||
              associatedServices.some((service) => service.status === 'inactive')
            ? 'inactive_entities'
            : scopedProviders.length > 0 && scopedServices.length > 0
              ? 'invalid_associations'
              : 'empty',
      providers: scopedProviders
        .map((provider) => ({
          id: provider.id,
          displayName: provider.displayName,
          isDefault: provider.isDefault,
          access: provider.bookingAccess,
          localizedName: resolveCatalogText({
            sourceText: provider.displayName,
            configuration: decodeBookingConfiguration(provider.bookingConfigJson),
            locale: session.locale ?? 'en'
          }),
          eligibleServiceIds: validEligibility
            .filter((pair) => pair.providerId === provider.id)
            .map((pair) => pair.serviceId)
        }))
        .filter((provider) => provider.eligibleServiceIds.length > 0),
      services: scopedServices
        .map((service) => {
          const localizedName = resolveCatalogText({
            sourceText: service.name,
            configuration: decodeBookingConfiguration(service.bookingConfigJson),
            locale: session.locale ?? 'en'
          })
          return {
            id: service.id,
            name: localizedName.text,
            localizedName,
            category: service.category,
            priceMinor: service.priceMinor,
            currency: service.currency,
            durationMinutes: service.durationMinutes,
            eligibleProviderIds: validEligibility
              .filter((pair) => pair.serviceId === service.id)
              .map((pair) => pair.providerId)
          }
        })
        .filter((service) => service.eligibleProviderIds.length > 0)
    }
    return {
      partyId: row.partyId,
      partyLifecycle: row.partyLifecycle,
      catalog,
      selection: {
        version: row.version,
        shopId: row.shopId,
        providerPreference:
          row.providerPreference === 'any'
            ? { kind: 'any' }
            : row.providerPreference === 'specific' && row.providerId
              ? { kind: 'specific', providerId: row.providerId }
              : null,
        primaryServiceId: row.primaryServiceId,
        additionalServiceIds: additionalRows.map((item) => item.serviceId)
      }
    }
  })

export const LiveBookingSelection: Layer.Layer<BookingSelection, never, Database> =
  Layer.effect(
    BookingSelection,
    Effect.gen(function* () {
      const db = yield* Database
      const persistSelection = (
        sessionId: string,
        partyId: string,
        selection: StoredSelection,
        expectedVersion: number
      ) => {
        const preference = selection.providerPreference
        const nextVersion = expectedVersion + 1
        const current = sql`exists (
          select 1 from ${bookingParties}
          where ${bookingParties.id} = ${partyId}
            and ${bookingParties.version} = ${expectedVersion}
            and ${bookingParties.lifecycle} = 'active'
        )`
        return Effect.gen(function* () {
          const results = yield* orUnavailable('booking-selection')(
            batchQueries(db, [
              db
                .update(bookingSessions)
                .set({
                  providerPreference: preference?.kind ?? null,
                  providerId:
                    preference?.kind === 'specific' ? preference.providerId : null,
                  primaryServiceId: selection.primaryServiceId
                })
                .where(and(eq(bookingSessions.id, sessionId), current))
                .toSQL(),
              db
                .update(bookingRequests)
                .set({
                  providerPreference: preference?.kind ?? null,
                  providerId:
                    preference?.kind === 'specific' ? preference.providerId : null,
                  primaryServiceId: selection.primaryServiceId,
                  holdId: null,
                  startsAt: null,
                  endsAt: null
                })
                .where(
                  and(
                    eq(
                      bookingRequests.id,
                      sql`(select active_request_id from booking_parties where id = ${partyId})`
                    ),
                    current
                  )
                )
                .toSQL(),
              db
                .delete(bookingSessionAdditionalServices)
                .where(
                  and(
                    eq(bookingSessionAdditionalServices.bookingSessionId, sessionId),
                    current
                  )
                )
                .toSQL(),
              db
                .delete(bookingRequestServices)
                .where(
                  and(
                    eq(
                      bookingRequestServices.bookingRequestId,
                      sql`(select active_request_id from booking_parties where id = ${partyId})`
                    ),
                    current
                  )
                )
                .toSQL(),
              ...selection.additionalServiceIds.map((serviceId, position) =>
                db
                  .insert(bookingSessionAdditionalServices)
                  .select(
                    db
                      .select({
                        bookingSessionId: sql<string>`${sessionId}`.as(
                          'booking_session_id'
                        ),
                        serviceId: sql<string>`${serviceId}`.as('service_id'),
                        position: sql<number>`${position}`.as('position')
                      })
                      .from(bookingParties)
                      .where(
                        and(
                          eq(bookingParties.id, partyId),
                          eq(bookingParties.version, expectedVersion),
                          eq(bookingParties.lifecycle, 'active')
                        )
                      )
                  )
                  .toSQL()
              ),
              ...[selection.primaryServiceId, ...selection.additionalServiceIds]
                .filter((serviceId): serviceId is string => serviceId !== null)
                .map((serviceId, position) =>
                  db
                    .insert(bookingRequestServices)
                    .select(
                      db
                        .select({
                          bookingRequestId: bookingParties.activeRequestId,
                          serviceId: sql<string>`${serviceId}`.as('service_id'),
                          role: sql<
                            'primary' | 'additional'
                          >`${position === 0 ? 'primary' : 'additional'}`.as('role'),
                          position: sql<number>`${position}`.as('position'),
                          createdAt: sql<string>`CURRENT_TIMESTAMP`.as('created_at')
                        })
                        .from(bookingParties)
                        .where(
                          and(
                            eq(bookingParties.id, partyId),
                            eq(bookingParties.version, expectedVersion),
                            eq(bookingParties.lifecycle, 'active'),
                            sql`${bookingParties.activeRequestId} is not null`
                          )
                        )
                    )
                    .toSQL()
                ),
              deleteTimeSlotHoldsForSelectionChange(db, sessionId, current),
              db
                .update(bookingParties)
                .set({
                  version: nextVersion,
                  ...(selection.shopId ? { shopId: selection.shopId } : {})
                })
                .where(
                  and(
                    eq(bookingParties.id, partyId),
                    eq(bookingParties.version, expectedVersion),
                    eq(bookingParties.lifecycle, 'active')
                  )
                )
                .toSQL()
            ])
          )
          if ((results.at(-1)?.meta.changes ?? 0) === 0) {
            const [party] = yield* orUnavailable('booking-selection')(
              db
                .select({ lifecycle: bookingParties.lifecycle })
                .from(bookingParties)
                .where(eq(bookingParties.id, partyId))
                .limit(1)
            )
            if (party?.lifecycle !== 'active') return yield* rejected()
            return yield* new BookingPartyConflict({
              bookingPartyId: partyId,
              expectedVersion
            })
          }
          return nextVersion
        })
      }
      const load = (session: BookingSession) =>
        Effect.gen(function* () {
          const state = yield* readLiveState(db, session)
          const selected = yield* normalizeSelection(state.catalog, {
            ...state.selection,
            shopId: state.catalog.shopId
          })
          if (JSON.stringify(state.selection) !== JSON.stringify(selected)) {
            const version = yield* persistSelection(
              session.id,
              state.partyId,
              selected,
              state.selection.version ?? 1
            )
            return journey(
              state.catalog,
              { ...selected, version },
              reconciliationFor(state.selection, selected)
            )
          }
          return journey(
            state.catalog,
            selected,
            reconciliationFor(state.selection, selected)
          )
        })
      return {
        load,
        chooseShop: (session, shopId, expectedVersion) =>
          Effect.gen(function* () {
            const state = yield* readLiveState(db, session, shopId)
            if (state.partyLifecycle !== 'active') return yield* rejected()
            const selected: StoredSelection = {
              version: expectedVersion,
              shopId,
              providerPreference: null,
              primaryServiceId: null,
              additionalServiceIds: []
            }
            const version = yield* persistSelection(
              session.id,
              state.partyId,
              selected,
              expectedVersion
            )
            return journey(state.catalog, { ...selected, version }, ['shop_changed'])
          }),
        chooseProvider: (session, preference, expectedVersion) =>
          Effect.gen(function* () {
            const state = yield* readLiveState(db, session)
            if (state.partyLifecycle !== 'active') return yield* rejected()
            if (!preferenceAccepts(state.catalog, preference, [])) {
              return yield* rejected()
            }
            if (
              preference.kind === 'specific' &&
              state.catalog.providers.find(
                (provider) => provider.id === preference.providerId
              )?.access === 'restricted'
            ) {
              return yield* rejected()
            }
            const selected: StoredSelection = {
              version: expectedVersion,
              shopId: state.catalog.shopId,
              providerPreference: preference,
              primaryServiceId: null,
              additionalServiceIds: []
            }
            const version = yield* persistSelection(
              session.id,
              state.partyId,
              selected,
              expectedVersion
            )
            return journey(state.catalog, { ...selected, version })
          }),
        chooseServices: (session, input, expectedVersion) =>
          Effect.gen(function* () {
            const state = yield* readLiveState(db, session)
            if (state.partyLifecycle !== 'active') return yield* rejected()
            const current = yield* withSoloDefault(state.catalog, state.selection)
            const selected = yield* validateServices(state.catalog, current, input)
            const version = yield* persistSelection(
              session.id,
              state.partyId,
              selected,
              expectedVersion
            )
            return journey(state.catalog, { ...selected, version })
          })
      }
    })
  )
