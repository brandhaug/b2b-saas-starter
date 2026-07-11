import { Context, Effect, Layer, Schema } from 'effect'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  batchQueries,
  bookingParties,
  bookingSessionAdditionalServices,
  bookingSessions,
  Database,
  merchants,
  providers,
  providerServiceEligibility,
  services
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import type { BookingSession } from './booking-sessions.ts'
import { BookingPartyConflict } from './foundations.ts'

export const ProviderPreference = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('any') }),
  Schema.Struct({ kind: Schema.Literal('specific'), providerId: Schema.String })
])
export type ProviderPreference = typeof ProviderPreference.Type

export const PublicBookableProvider = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  isDefault: Schema.Boolean,
  eligibleServiceIds: Schema.Array(Schema.String)
})
export type PublicBookableProvider = typeof PublicBookableProvider.Type

export const PublicBookableService = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
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
}
type StoredSelection = {
  version?: number
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
    }
  >
  readonly providers: Map<string, StoredProvider>
  readonly services: Map<string, StoredService>
  readonly eligibility: Set<SeedBookingSelectionEligibilityKey>
  readonly selections: Map<string, StoredSelection>
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
    }[]
    readonly providers?: readonly StoredProvider[]
    readonly services?: readonly StoredService[]
    readonly eligibility?: readonly SeedBookingSelectionEligibilityKey[]
  } = {}
): SeedBookingSelectionStore => ({
  merchants: new Map(
    (input.merchants ?? []).map((merchant) => [merchant.slug, merchant])
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

const journey = (catalog: Catalog, selection: StoredSelection): BookingJourney => ({
  version: selection.version ?? 1,
  presentation: catalog.presentation,
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
    if (catalog.presentation === 'solo' && !provider.isDefault) return false
    return serviceIds.every((serviceId) =>
      provider.eligibleServiceIds.includes(serviceId)
    )
  }
  if (catalog.presentation !== 'team') return false
  return catalog.providers.some((provider) =>
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
  merchantSlug: string
): Effect.Effect<Catalog, BookingSelectionRejected> => {
  const merchant = store.merchants.get(merchantSlug)
  if (!merchant) return Effect.fail(rejected())
  const pairs = [...store.eligibility].map((key) => key.split('\0'))
  const activeProviders = [...store.providers.values()].filter(
    (provider) => provider.merchantId === merchant.id && provider.status === 'active'
  )
  const activeServices = [...store.services.values()].filter(
    (service) => service.merchantId === merchant.id && service.status === 'active'
  )
  return Effect.succeed({
    merchantId: merchant.id,
    presentation: merchant.presentation,
    providers: activeProviders
      .map(({ merchantId: _, status: __, ...provider }) => ({
        ...provider,
        eligibleServiceIds: pairs
          .filter(
            ([merchantId, providerId, serviceId]) =>
              merchantId === merchant.id &&
              providerId === provider.id &&
              activeServices.some((service) => service.id === serviceId)
          )
          .map(([, , serviceId]) => serviceId!)
      }))
      .filter((provider) => provider.eligibleServiceIds.length > 0),
    services: activeServices
      .map(({ merchantId: _, status: __, ...service }) => ({
        ...service,
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
    (provider) => provider.isDefault && provider.eligibleServiceIds.length > 0
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

export const SeedBookingSelection = (
  store: SeedBookingSelectionStore
): Layer.Layer<BookingSelection> =>
  Layer.succeed(BookingSelection)({
    load: (session) =>
      Effect.gen(function* () {
        const catalog = yield* seedCatalog(store, session.merchantSlug)
        const current = store.selections.get(session.id) ?? emptySelection()
        const selected = yield* normalizeSelection(catalog, current)
        store.selections.set(session.id, selected)
        return journey(catalog, selected)
      }),
    chooseProvider: (session, preference, expectedVersion) =>
      Effect.gen(function* () {
        const catalog = yield* seedCatalog(store, session.merchantSlug)
        const current = store.selections.get(session.id) ?? emptySelection()
        if ((current.version ?? 1) !== expectedVersion) {
          return yield* new BookingPartyConflict({
            bookingPartyId: `bpt_${session.id}`,
            expectedVersion
          })
        }
        if (!preferenceAccepts(catalog, preference, [])) {
          return yield* rejected()
        }
        const selected: StoredSelection = {
          version: expectedVersion + 1,
          providerPreference: preference,
          primaryServiceId: null,
          additionalServiceIds: []
        }
        store.selections.set(session.id, selected)
        return journey(catalog, selected)
      }),
    chooseServices: (session, input, expectedVersion) =>
      Effect.gen(function* () {
        const catalog = yield* seedCatalog(store, session.merchantSlug)
        const stored = store.selections.get(session.id) ?? emptySelection()
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
  session: BookingSession
): Effect.Effect<LiveState, BookingSelectionRejected | CapabilityUnavailable> =>
  Effect.gen(function* () {
    const sessionRows = yield* orUnavailable('booking-selection')(
      db
        .select({
          merchantId: merchants.id,
          presentation: merchants.plan,
          version: bookingParties.version,
          partyId: bookingParties.id,
          partyLifecycle: bookingParties.lifecycle,
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
    const [providerRows, serviceRows, eligibilityRows, additionalRows] =
      yield* Effect.all([
        orUnavailable('booking-selection')(
          db
            .select()
            .from(providers)
            .where(
              and(
                eq(providers.merchantId, row.merchantId),
                eq(providers.status, 'active')
              )
            )
        ),
        orUnavailable('booking-selection')(
          db
            .select()
            .from(services)
            .where(
              and(
                eq(services.merchantId, row.merchantId),
                eq(services.status, 'active')
              )
            )
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
        )
      ])
    const activeProviderIds = new Set(providerRows.map((provider) => provider.id))
    const activeServiceIds = new Set(serviceRows.map((service) => service.id))
    const validEligibility = eligibilityRows.filter(
      (pair) =>
        activeProviderIds.has(pair.providerId) && activeServiceIds.has(pair.serviceId)
    )
    const catalog: Catalog = {
      merchantId: row.merchantId,
      presentation: row.presentation,
      providers: providerRows
        .map((provider) => ({
          id: provider.id,
          displayName: provider.displayName,
          isDefault: provider.isDefault,
          eligibleServiceIds: validEligibility
            .filter((pair) => pair.providerId === provider.id)
            .map((pair) => pair.serviceId)
        }))
        .filter((provider) => provider.eligibleServiceIds.length > 0),
      services: serviceRows
        .map((service) => ({
          id: service.id,
          name: service.name,
          category: service.category,
          priceMinor: service.priceMinor,
          currency: service.currency,
          durationMinutes: service.durationMinutes,
          eligibleProviderIds: validEligibility
            .filter((pair) => pair.serviceId === service.id)
            .map((pair) => pair.providerId)
        }))
        .filter((service) => service.eligibleProviderIds.length > 0)
    }
    return {
      partyId: row.partyId,
      partyLifecycle: row.partyLifecycle,
      catalog,
      selection: {
        version: row.version,
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
                .delete(bookingSessionAdditionalServices)
                .where(
                  and(
                    eq(bookingSessionAdditionalServices.bookingSessionId, sessionId),
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
              db
                .update(bookingParties)
                .set({ version: nextVersion })
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
          const selected = yield* normalizeSelection(state.catalog, state.selection)
          if (JSON.stringify(state.selection) !== JSON.stringify(selected)) {
            const version = yield* persistSelection(
              session.id,
              state.partyId,
              selected,
              state.selection.version ?? 1
            )
            return journey(state.catalog, { ...selected, version })
          }
          return journey(state.catalog, selected)
        })
      return {
        load,
        chooseProvider: (session, preference, expectedVersion) =>
          Effect.gen(function* () {
            const state = yield* readLiveState(db, session)
            if (state.partyLifecycle !== 'active') return yield* rejected()
            if (!preferenceAccepts(state.catalog, preference, [])) {
              return yield* rejected()
            }
            const selected: StoredSelection = {
              version: expectedVersion,
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
