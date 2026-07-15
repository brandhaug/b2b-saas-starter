import { Context, Effect, Layer, Schema } from 'effect'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  appointments,
  batchQueries,
  brands,
  bookingParties,
  bookingRequests,
  bookingRequestServices,
  bookingSessionAdditionalServices,
  bookingSessions,
  Database,
  giftCardProducts,
  merchants,
  providers,
  providerAccessProofs,
  providerServiceEligibility,
  scheduleRules,
  services,
  shopProviders,
  shopAddresses,
  shops,
  shopServices,
  timeSlotHolds
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { hashSha256, randomHex } from '../internal/crypto.ts'
import type { BookingSession } from './booking-sessions.ts'
import { BookingPartyConflict } from './foundations.ts'
import { deleteTimeSlotHoldsForSelectionChange } from './booking-scheduling.ts'
import { deriveSlots, type ScheduleRule } from '../scheduling/scheduling.ts'
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
  shortName: Schema.String,
  isDefault: Schema.Boolean,
  access: Schema.Literals(['public', 'restricted']),
  localizedName: Schema.optional(
    Schema.Struct({
      text: Schema.String,
      locale: Schema.Literals(['en', 'es', 'fr', 'ro']),
      isSourceLanguageFallback: Schema.Boolean
    })
  ),
  nextAvailableAt: Schema.optional(Schema.NullOr(Schema.String)),
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
      adultsOnly: Schema.optional(Schema.Boolean),
      timezone: Schema.optional(Schema.String),
      addressLines: Schema.optional(Schema.Array(Schema.String)),
      coordinates: Schema.optional(
        Schema.Struct({ latitude: Schema.Number, longitude: Schema.Number })
      ),
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
  canSellUnassignedGiftCard: Schema.optional(Schema.Boolean),
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
  readonly load: (
    session: BookingSession,
    now?: string
  ) => SelectionEffect<BookingJourney>
  readonly chooseProvider: (
    session: BookingSession,
    preference: ProviderPreference,
    expectedVersion: number,
    providerProof?: string,
    now?: string
  ) => SelectionEffect<BookingJourney>
  readonly verifyProviderAccess: (
    session: BookingSession,
    providerId: string,
    passcode: string,
    now: string
  ) => SelectionEffect<{ readonly proof: string; readonly expiresAt: string }>
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
  readonly bookingAccessVerifierHash?: string | null
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
      readonly addressLines?: readonly string[]
      readonly coordinates?: { readonly latitude: number; readonly longitude: number }
      readonly bookingConfiguration?: BookingConfiguration | null
      readonly brandBookingConfiguration?: BookingConfiguration | null
    }
  >
  readonly shopProviders: Set<string>
  readonly shopServices: Set<string>
  readonly providers: Map<string, StoredProvider>
  readonly services: Map<string, StoredService>
  readonly eligibility: Set<SeedBookingSelectionEligibilityKey>
  readonly scheduleRules: readonly (ScheduleRule & { readonly merchantId: string })[]
  readonly appointments: readonly {
    readonly providerId: string
    readonly status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
    readonly startsAt: string
    readonly endsAt: string
  }[]
  readonly canSellUnassignedGiftCard: boolean
  readonly selections: Map<string, StoredSelection>
  readonly providerProofs: Map<
    string,
    {
      readonly bookingSessionId: string
      readonly providerId: string
      readonly expiresAt: string
    }
  >
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
      readonly addressLines?: readonly string[]
      readonly coordinates?: { readonly latitude: number; readonly longitude: number }
      readonly bookingConfiguration?: BookingConfiguration | null
      readonly brandBookingConfiguration?: BookingConfiguration | null
    }[]
    readonly providers?: readonly StoredProvider[]
    readonly services?: readonly StoredService[]
    readonly eligibility?: readonly SeedBookingSelectionEligibilityKey[]
    readonly scheduleRules?: readonly (ScheduleRule & {
      readonly merchantId: string
    })[]
    readonly appointments?: readonly {
      readonly providerId: string
      readonly status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
      readonly startsAt: string
      readonly endsAt: string
    }[]
    readonly canSellUnassignedGiftCard?: boolean
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
  scheduleRules: input.scheduleRules ?? [],
  appointments: input.appointments ?? [],
  canSellUnassignedGiftCard: input.canSellUnassignedGiftCard ?? false,
  selections: new Map(),
  providerProofs: new Map()
})

type Catalog = {
  readonly merchantId: string
  readonly presentation: 'solo' | 'team'
  readonly shopId: string
  readonly shops: readonly {
    readonly id: string
    readonly slug: string
    readonly name: string
    readonly timezone?: string
    readonly addressLines?: readonly string[]
    readonly coordinates?: { readonly latitude: number; readonly longitude: number }
    readonly localizedName?: ResolvedCatalogText
  }[]
  readonly resolvedConfiguration: ResolvedBookingConfiguration
  readonly catalogRecovery: BookingJourney['catalogRecovery']
  readonly canSellUnassignedGiftCard: boolean
  readonly providers: readonly PublicBookableProvider[]
  readonly services: readonly PublicBookableService[]
}

const legacyProviderShortName = (displayName: string) => {
  const normalizedName = displayName.trim().replace(/\s+/g, ' ')
  const lastSpaceIndex = normalizedName.lastIndexOf(' ')
  if (lastSpaceIndex < 0) return normalizedName

  const firstName = normalizedName.slice(0, lastSpaceIndex)
  const lastName = normalizedName.slice(lastSpaceIndex + 1).replace(/\.$/, '')
  const lastInitial = Array.from(lastName)[0]
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName
}

const resolveProviderShortName = (input: {
  readonly localizedDisplayName: string
  readonly configuration: BookingConfiguration | null | undefined
  readonly locale: CatalogLocale
}) =>
  input.configuration?.shortNameTranslations?.[input.locale]?.trim() ||
  input.configuration?.shortName?.trim() ||
  legacyProviderShortName(input.localizedDisplayName)

const rejected = () =>
  new BookingSelectionRejected({ message: 'Selection could not be accepted' })

const parseCoordinate = (value: string | null) => {
  if (value === null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const parseAddressLines = (value: string | null): readonly string[] | undefined => {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      const lines = parsed.filter((line): line is string => typeof line === 'string')
      return lines.length > 0 ? lines : undefined
    }
    if (!parsed || typeof parsed !== 'object') return undefined
    const address = parsed as Record<string, unknown>
    const first = address.line1 ?? address.address1 ?? address.street
    const second = address.line2 ?? address.address2
    const city = address.city ?? address.locality
    const regionPostal = [
      address.state ?? address.region,
      address.postalCode ?? address.postal_code ?? address.zip
    ]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' ')
    const locality = [city, regionPostal]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(', ')
    const lines = [first, second, locality].filter(
      (line): line is string => typeof line === 'string' && line.length > 0
    )
    return lines.length > 0 ? lines : undefined
  } catch {
    return undefined
  }
}

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
  canSellUnassignedGiftCard: catalog.canSellUnassignedGiftCard,
  providers: [...catalog.providers],
  services: [...catalog.services]
})

const preferenceAccepts = (
  catalog: Catalog,
  preference: ProviderPreference,
  serviceIds: readonly string[],
  allowRestricted = false
): boolean => {
  if (preference.kind === 'specific') {
    const provider = catalog.providers.find((item) => item.id === preference.providerId)
    if (!provider) return false
    if (provider.access === 'restricted' && !allowRestricted) return false
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
      return preferenceAccepts(
        catalog,
        preference,
        [primary.id, ...otherAdditionalIds, service.id],
        true
      )
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
    !preferenceAccepts(catalog, preference, ids, true)
  ) {
    return Effect.fail(rejected())
  }
  return Effect.succeed({
    ...selection,
    primaryServiceId: input.primaryServiceId,
    additionalServiceIds: [...input.additionalServiceIds]
  })
}

type BusyInterval = {
  readonly providerId: string
  readonly startsAt: string
  readonly endsAt: string
}

const firstAvailableAt = (input: {
  readonly providerId: string
  readonly eligibleServiceIds: readonly string[]
  readonly services: readonly {
    readonly id: string
    readonly durationMinutes: number
  }[]
  readonly rules: readonly ScheduleRule[]
  readonly busyIntervals: readonly BusyInterval[]
  readonly timezone: string
  readonly now: string
}) => {
  const durationMinutes = Math.min(
    ...input.services
      .filter((service) => input.eligibleServiceIds.includes(service.id))
      .map((service) => service.durationMinutes)
  )
  if (!Number.isFinite(durationMinutes)) return null
  return (
    deriveSlots(input.rules, input.timezone, durationMinutes, input.now, 14).slots.find(
      (slot) =>
        !input.busyIntervals.some(
          (busy) =>
            busy.providerId === input.providerId &&
            busy.startsAt < slot.endsAt &&
            busy.endsAt > slot.startsAt
        )
    )?.startsAt ?? null
  )
}

const seedCatalog = (
  store: SeedBookingSelectionStore,
  merchantSlug: string,
  requestedShopId: string | undefined,
  locale: CatalogLocale,
  now: string
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
      ...(candidate.timezone ? { timezone: candidate.timezone } : {}),
      ...(candidate.addressLines ? { addressLines: [...candidate.addressLines] } : {}),
      ...(candidate.coordinates ? { coordinates: candidate.coordinates } : {}),
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
    canSellUnassignedGiftCard: store.canSellUnassignedGiftCard,
    providers: activeProviders
      .map(
        ({
          merchantId: _,
          status: __,
          bookingAccess,
          bookingConfiguration,
          ...provider
        }) => {
          const localizedName = resolveCatalogText({
            sourceText: provider.displayName,
            configuration: bookingConfiguration,
            locale
          })
          const eligibleServiceIds = pairs
            .filter(
              ([merchantId, providerId, serviceId]) =>
                merchantId === merchant.id &&
                providerId === provider.id &&
                activeServices.some((service) => service.id === serviceId)
            )
            .map(([, , serviceId]) => serviceId!)
          return {
            ...provider,
            shortName: resolveProviderShortName({
              localizedDisplayName: localizedName.text,
              configuration: bookingConfiguration,
              locale
            }),
            access: bookingAccess ?? 'public',
            localizedName,
            nextAvailableAt: firstAvailableAt({
              providerId: provider.id,
              eligibleServiceIds,
              services: activeServices,
              rules: store.scheduleRules.filter(
                (rule) =>
                  rule.merchantId === merchant.id && rule.providerId === provider.id
              ),
              busyIntervals: store.appointments.filter(
                (appointment) => appointment.status === 'scheduled'
              ),
              timezone: shop.timezone ?? 'UTC',
              now
            }),
            eligibleServiceIds
          }
        }
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
  selection: StoredSelection,
  allowRestricted = false
): Effect.Effect<StoredSelection> =>
  Effect.gen(function* () {
    const validPreference =
      selection.providerPreference &&
      preferenceAccepts(catalog, selection.providerPreference, [], allowRestricted)
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
    verifyProviderAccess: (session, providerId, passcode, now) =>
      Effect.gen(function* () {
        const provider = store.providers.get(providerId)
        if (
          !provider ||
          provider.merchantId !== store.merchants.get(session.merchantSlug)?.id ||
          provider.bookingAccess !== 'restricted' ||
          !provider.bookingAccessVerifierHash ||
          (yield* Effect.promise(() => hashSha256(passcode))) !==
            provider.bookingAccessVerifierHash
        )
          return yield* rejected()
        const proof = randomHex(32)
        const expiresAt = new Date(Date.parse(now) + 5 * 60_000).toISOString()
        store.providerProofs.set(proof, {
          bookingSessionId: session.id,
          providerId,
          expiresAt
        })
        return { proof, expiresAt }
      }),
    load: (session, now = session.lastActivityAt) =>
      Effect.gen(function* () {
        const current = store.selections.get(session.id) ?? emptySelection()
        const catalog = yield* seedCatalog(
          store,
          session.merchantSlug,
          current.shopId,
          session.locale ?? 'en',
          now
        )
        const providerId =
          current.providerPreference?.kind === 'specific'
            ? current.providerPreference.providerId
            : null
        const allowRestricted = providerId
          ? [...store.providerProofs.values()].some(
              (proof) =>
                proof.bookingSessionId === session.id &&
                proof.providerId === providerId &&
                proof.expiresAt > now
            )
          : false
        const selected = yield* normalizeSelection(
          catalog,
          { ...current, shopId: catalog.shopId },
          allowRestricted
        )
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
          session.locale ?? 'en',
          session.lastActivityAt
        )
        return journey(catalog, selected, ['shop_changed'])
      }),
    chooseProvider: (
      session,
      preference,
      expectedVersion,
      providerProof,
      now = session.lastActivityAt
    ) =>
      Effect.gen(function* () {
        const current = store.selections.get(session.id) ?? emptySelection()
        const catalog = yield* seedCatalog(
          store,
          session.merchantSlug,
          current.shopId,
          session.locale ?? 'en',
          now
        )
        if ((current.version ?? 1) !== expectedVersion) {
          return yield* new BookingPartyConflict({
            bookingPartyId: `bpt_${session.id}`,
            expectedVersion
          })
        }
        if (!preferenceAccepts(catalog, preference, [], true)) {
          return yield* rejected()
        }
        if (
          preference.kind === 'specific' &&
          catalog.providers.find((provider) => provider.id === preference.providerId)
            ?.access === 'restricted'
        ) {
          const proof = providerProof
            ? store.providerProofs.get(providerProof)
            : undefined
          if (
            !proof ||
            proof.bookingSessionId !== session.id ||
            proof.providerId !== preference.providerId ||
            proof.expiresAt <= now
          )
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
          session.locale ?? 'en',
          session.lastActivityAt
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
  requestedShopId?: string,
  now = session.lastActivityAt
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
      shopServiceRows,
      scheduleRuleRows,
      appointmentRows,
      holdRows,
      giftCardProductRows
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
            timezone: shops.timezone,
            brandId: shops.brandId,
            brandName: brands.name,
            brandBookingConfiguration: brands.bookingConfigJson,
            addressJson: shopAddresses.addressJson,
            latitude: shopAddresses.latitude,
            longitude: shopAddresses.longitude
          })
          .from(shops)
          .innerJoin(brands, eq(brands.id, shops.brandId))
          .leftJoin(shopAddresses, eq(shopAddresses.shopId, shops.id))
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
      ),
      orUnavailable('booking-selection')(
        db
          .select()
          .from(scheduleRules)
          .where(eq(scheduleRules.merchantId, row.merchantId))
      ),
      orUnavailable('booking-selection')(
        db
          .select()
          .from(appointments)
          .where(eq(appointments.merchantId, row.merchantId))
      ),
      orUnavailable('booking-selection')(
        db
          .select()
          .from(timeSlotHolds)
          .where(eq(timeSlotHolds.merchantId, row.merchantId))
      ),
      orUnavailable('booking-selection')(
        db
          .select()
          .from(giftCardProducts)
          .where(
            and(
              eq(giftCardProducts.merchantId, row.merchantId),
              eq(giftCardProducts.active, true)
            )
          )
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
      shops: shopRows.map((shop) => {
        const configuration = decodeBookingConfiguration(shop.bookingConfiguration)
        const brandConfiguration = decodeBookingConfiguration(
          shop.brandBookingConfiguration
        )
        const merchantConfiguration = decodeBookingConfiguration(
          row.merchantBookingConfiguration
        )
        const addressLines = parseAddressLines(shop.addressJson)
        const latitude = parseCoordinate(shop.latitude)
        const longitude = parseCoordinate(shop.longitude)
        const resolved = resolveCatalogText({
          sourceText: shop.publicName,
          configuration,
          locale: session.locale ?? 'en'
        })
        return {
          id: shop.id,
          slug: shop.slug,
          timezone: shop.timezone,
          adultsOnly: resolveBookingConfiguration({
            locale: session.locale ?? 'en',
            merchant: {
              name: row.merchantName,
              configuration: merchantConfiguration
            },
            brand: { name: shop.brandName, configuration: brandConfiguration },
            shop: { name: shop.publicName, configuration }
          }).adultsOnly,
          ...(addressLines ? { addressLines } : {}),
          ...(latitude === null || longitude === null
            ? {}
            : { coordinates: { latitude, longitude } }),
          name: resolved.text,
          localizedName: resolved
        }
      }),
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
      canSellUnassignedGiftCard: giftCardProductRows.some(
        (product) =>
          (product.scope === 'merchant' && product.scopeId === row.merchantId) ||
          (product.scope === 'brand' && product.scopeId === selectedShop.brandId) ||
          (product.scope === 'shop' && product.scopeId === selectedShopId)
      ),
      providers: scopedProviders
        .map((provider) => {
          const configuration = decodeBookingConfiguration(provider.bookingConfigJson)
          const locale = session.locale ?? 'en'
          const localizedName = resolveCatalogText({
            sourceText: provider.displayName,
            configuration,
            locale
          })
          const eligibleServiceIds = validEligibility
            .filter((pair) => pair.providerId === provider.id)
            .map((pair) => pair.serviceId)
          return {
            id: provider.id,
            displayName: provider.displayName,
            shortName: resolveProviderShortName({
              localizedDisplayName: localizedName.text,
              configuration,
              locale
            }),
            isDefault: provider.isDefault,
            access: provider.bookingAccess,
            localizedName,
            nextAvailableAt: firstAvailableAt({
              providerId: provider.id,
              eligibleServiceIds,
              services: scopedServices,
              rules: scheduleRuleRows
                .filter((rule) => rule.providerId === provider.id)
                .map(({ id, providerId, weekday, startTime, endTime }) => ({
                  id,
                  providerId,
                  weekday,
                  startTime,
                  endTime
                })),
              busyIntervals: [
                ...appointmentRows.filter(
                  (appointment) => appointment.status === 'scheduled'
                ),
                ...holdRows.filter((hold) => hold.expiresAt > now)
              ],
              timezone: selectedShop.timezone,
              now
            }),
            eligibleServiceIds
          }
        })
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
      const load = (session: BookingSession, now = session.lastActivityAt) =>
        Effect.gen(function* () {
          const state = yield* readLiveState(db, session, undefined, now)
          const providerId =
            state.selection.providerPreference?.kind === 'specific'
              ? state.selection.providerPreference.providerId
              : null
          const [activeProof] = providerId
            ? yield* orUnavailable('booking-selection')(
                db
                  .select({ id: providerAccessProofs.id })
                  .from(providerAccessProofs)
                  .where(
                    and(
                      eq(providerAccessProofs.bookingSessionId, session.id),
                      eq(providerAccessProofs.providerId, providerId),
                      sql`${providerAccessProofs.expiresAt} > ${now}`
                    )
                  )
                  .limit(1)
              )
            : []
          const selected = yield* normalizeSelection(
            state.catalog,
            { ...state.selection, shopId: state.catalog.shopId },
            Boolean(activeProof)
          )
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
        verifyProviderAccess: (session, providerId, passcode, now) =>
          Effect.gen(function* () {
            const [provider] = yield* orUnavailable('booking-selection')(
              db
                .select({
                  bookingAccess: providers.bookingAccess,
                  verifierHash: providers.bookingAccessVerifierHash
                })
                .from(providers)
                .innerJoin(
                  bookingSessions,
                  eq(bookingSessions.merchantId, providers.merchantId)
                )
                .where(
                  and(eq(bookingSessions.id, session.id), eq(providers.id, providerId))
                )
                .limit(1)
            )
            if (
              !provider ||
              provider.bookingAccess !== 'restricted' ||
              !provider.verifierHash ||
              (yield* Effect.promise(() => hashSha256(passcode))) !==
                provider.verifierHash
            )
              return yield* rejected()
            const proof = randomHex(32)
            const expiresAt = new Date(Date.parse(now) + 5 * 60_000).toISOString()
            yield* orUnavailable('booking-selection')(
              db.insert(providerAccessProofs).values({
                id: `pap_${randomHex(16)}`,
                bookingSessionId: session.id,
                providerId,
                proofHash: yield* Effect.promise(() => hashSha256(proof)),
                expiresAt,
                createdAt: now
              })
            )
            return { proof, expiresAt }
          }),
        load,
        chooseShop: (session, shopId, expectedVersion) =>
          Effect.gen(function* () {
            const state = yield* readLiveState(
              db,
              session,
              shopId,
              session.lastActivityAt
            )
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
        chooseProvider: (
          session,
          preference,
          expectedVersion,
          providerProof,
          now = session.lastActivityAt
        ) =>
          Effect.gen(function* () {
            const state = yield* readLiveState(db, session, undefined, now)
            if (state.partyLifecycle !== 'active') return yield* rejected()
            if (!preferenceAccepts(state.catalog, preference, [], true)) {
              return yield* rejected()
            }
            if (
              preference.kind === 'specific' &&
              state.catalog.providers.find(
                (provider) => provider.id === preference.providerId
              )?.access === 'restricted'
            ) {
              if (!providerProof) return yield* rejected()
              const [proof] = yield* orUnavailable('booking-selection')(
                db
                  .select({ id: providerAccessProofs.id })
                  .from(providerAccessProofs)
                  .where(
                    and(
                      eq(providerAccessProofs.bookingSessionId, session.id),
                      eq(providerAccessProofs.providerId, preference.providerId),
                      eq(
                        providerAccessProofs.proofHash,
                        yield* Effect.promise(() => hashSha256(providerProof))
                      ),
                      sql`${providerAccessProofs.expiresAt} > ${now}`
                    )
                  )
                  .limit(1)
              )
              if (!proof) return yield* rejected()
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
            const state = yield* readLiveState(
              db,
              session,
              undefined,
              session.lastActivityAt
            )
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
