import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq, inArray } from 'drizzle-orm'
import {
  batch,
  Database,
  providerServiceEligibility,
  providers,
  services,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { MerchantContext } from './merchant-context.ts'

export const CatalogStatus = Schema.Literals(['active', 'inactive'])
export type CatalogStatus = typeof CatalogStatus.Type

export const ServiceInput = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  category: Schema.optional(Schema.NullOr(Schema.String)),
  priceMinor: Schema.Number,
  currency: Schema.String,
  durationMinutes: Schema.Number,
  status: CatalogStatus
})
export type ServiceInput = typeof ServiceInput.Type

export const ServiceRecord = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  category: Schema.NullOr(Schema.String),
  priceMinor: Schema.Number,
  currency: Schema.String,
  durationMinutes: Schema.Number,
  status: CatalogStatus,
  eligibleProviderIds: Schema.Array(Schema.String)
})
export type ServiceRecord = typeof ServiceRecord.Type

export const ProviderInput = Schema.Struct({
  displayName: Schema.String,
  isDefault: Schema.Boolean,
  status: CatalogStatus
})
export type ProviderInput = typeof ProviderInput.Type

export const ProviderRecord = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  isDefault: Schema.Boolean,
  status: CatalogStatus,
  eligibleServiceIds: Schema.Array(Schema.String)
})
export type ProviderRecord = typeof ProviderRecord.Type

export const MerchantCatalogSnapshot = Schema.Struct({
  presentation: Schema.Literals(['solo', 'team']),
  services: Schema.Array(ServiceRecord),
  providers: Schema.Array(ProviderRecord)
})
export type MerchantCatalogSnapshot = typeof MerchantCatalogSnapshot.Type

export class MerchantCatalogInvalid extends Schema.TaggedErrorClass<MerchantCatalogInvalid>()(
  'MerchantCatalogInvalid',
  {
    reason: Schema.Literals([
      'invalid_name',
      'invalid_description',
      'invalid_category',
      'invalid_price',
      'invalid_currency',
      'invalid_duration',
      'item_not_found',
      'team_required',
      'default_required'
    ])
  }
) {}

type CatalogEffect<A> = Effect.Effect<
  A,
  MerchantCatalogInvalid | CapabilityUnavailable,
  MerchantContext
>

export type MerchantCatalogShape = {
  readonly read: () => CatalogEffect<MerchantCatalogSnapshot>
  readonly readBookable: () => CatalogEffect<MerchantCatalogSnapshot>
  readonly createService: (input: ServiceInput) => CatalogEffect<ServiceRecord>
  readonly updateService: (
    serviceId: string,
    input: ServiceInput
  ) => CatalogEffect<ServiceRecord>
  readonly setServiceEligibility: (
    serviceId: string,
    providerIds: readonly string[]
  ) => CatalogEffect<void>
  readonly createProvider: (input: ProviderInput) => CatalogEffect<ProviderRecord>
  readonly updateProvider: (
    providerId: string,
    input: ProviderInput
  ) => CatalogEffect<ProviderRecord>
}

export class MerchantCatalog extends Context.Service<
  MerchantCatalog,
  MerchantCatalogShape
>()('@b2b-saas-starter/capabilities/MerchantCatalog') {}

type StoredService = Omit<ServiceRecord, 'eligibleProviderIds'> & {
  readonly merchantId: string
}
type StoredProvider = Omit<ProviderRecord, 'eligibleServiceIds'> & {
  readonly merchantId: string
}

export type SeedMerchantCatalogConfigurationStore = {
  readonly services: Map<string, StoredService>
  readonly providers: Map<string, StoredProvider>
  /** Normalized keys are merchantId, Provider id, and Service id joined by NUL. */
  readonly eligibility: Set<string>
}

const eligibilityKey = (merchantId: string, providerId: string, serviceId: string) =>
  `${merchantId}\0${providerId}\0${serviceId}`

const optionalText = (
  value: string | null | undefined,
  invalidReason: 'invalid_description' | 'invalid_category',
  maxLength: number
): Effect.Effect<string | null, MerchantCatalogInvalid> => {
  if (value === undefined || value === null || value === '') return Effect.succeed(null)
  if (value !== value.trim() || value.length > maxLength) {
    return Effect.fail(new MerchantCatalogInvalid({ reason: invalidReason }))
  }
  return Effect.succeed(value)
}

const validCurrency = (currency: string): boolean => {
  if (!/^[A-Z]{3}$/.test(currency)) return false
  try {
    return Intl.supportedValuesOf('currency').includes(currency)
  } catch {
    return false
  }
}

const validateService = (input: ServiceInput) =>
  Effect.gen(function* () {
    if (
      input.name !== input.name.trim() ||
      input.name.length < 2 ||
      input.name.length > 80
    ) {
      return yield* Effect.fail(new MerchantCatalogInvalid({ reason: 'invalid_name' }))
    }
    if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor <= 0) {
      return yield* Effect.fail(new MerchantCatalogInvalid({ reason: 'invalid_price' }))
    }
    if (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes <= 0) {
      return yield* Effect.fail(
        new MerchantCatalogInvalid({ reason: 'invalid_duration' })
      )
    }
    if (!validCurrency(input.currency)) {
      return yield* Effect.fail(
        new MerchantCatalogInvalid({ reason: 'invalid_currency' })
      )
    }
    return {
      name: input.name,
      description: yield* optionalText(input.description, 'invalid_description', 300),
      category: yield* optionalText(input.category, 'invalid_category', 80),
      priceMinor: input.priceMinor,
      currency: input.currency,
      durationMinutes: input.durationMinutes,
      status: input.status
    }
  })

const validateProvider = (input: ProviderInput) => {
  if (
    input.displayName !== input.displayName.trim() ||
    input.displayName.length < 2 ||
    input.displayName.length > 80
  ) {
    return Effect.fail(new MerchantCatalogInvalid({ reason: 'invalid_name' }))
  }
  return Effect.succeed(input)
}

const seedSnapshot = (
  store: SeedMerchantCatalogConfigurationStore,
  merchantId: string,
  presentation: 'solo' | 'team'
): MerchantCatalogSnapshot => {
  const pairs = [...store.eligibility]
    .map((key) => key.split('\0'))
    .filter(([pairMerchantId]) => pairMerchantId === merchantId)
  return {
    presentation,
    services: [...store.services.values()]
      .filter((service) => service.merchantId === merchantId)
      .map(({ merchantId: _, ...service }) => ({
        ...service,
        eligibleProviderIds: pairs
          .filter(([, , serviceId]) => serviceId === service.id)
          .map(([, providerId]) => providerId!)
          .sort()
      })),
    providers: [...store.providers.values()]
      .filter((provider) => provider.merchantId === merchantId)
      .map(({ merchantId: _, ...provider }) => ({
        ...provider,
        eligibleServiceIds: pairs
          .filter(([, providerId]) => providerId === provider.id)
          .map(([, , serviceId]) => serviceId!)
          .sort()
      }))
  }
}

const onlyBookable = (snapshot: MerchantCatalogSnapshot): MerchantCatalogSnapshot => {
  const activeProviderIds = new Set(
    snapshot.providers
      .filter((provider) => provider.status === 'active')
      .map((provider) => provider.id)
  )
  const services = snapshot.services
    .filter(
      (service) =>
        service.status === 'active' &&
        service.eligibleProviderIds.some((id) => activeProviderIds.has(id))
    )
    .map((service) => ({
      ...service,
      eligibleProviderIds: service.eligibleProviderIds.filter((id) =>
        activeProviderIds.has(id)
      )
    }))
  const activeServiceIds = new Set(services.map((service) => service.id))
  return {
    ...snapshot,
    services,
    providers: snapshot.providers
      .filter((provider) => provider.status === 'active')
      .map((provider) => ({
        ...provider,
        eligibleServiceIds: provider.eligibleServiceIds.filter((id) =>
          activeServiceIds.has(id)
        )
      }))
  }
}

export const SeedMerchantCatalogConfiguration = (
  store: SeedMerchantCatalogConfigurationStore
): Layer.Layer<MerchantCatalog> =>
  Layer.succeed(MerchantCatalog)({
    read: () =>
      Effect.map(MerchantContext, (merchant) =>
        seedSnapshot(store, merchant.id, merchant.plan)
      ),
    readBookable: () =>
      Effect.map(MerchantContext, (merchant) =>
        onlyBookable(seedSnapshot(store, merchant.id, merchant.plan))
      ),
    createService: (input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const value = yield* validateService(input)
        const id = newCapabilityId('svc')
        store.services.set(id, { id, merchantId: merchant.id, ...value })
        return { id, ...value, eligibleProviderIds: [] }
      }),
    updateService: (serviceId, input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const current = store.services.get(serviceId)
        if (current?.merchantId !== merchant.id) {
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'item_not_found' })
          )
        }
        const value = yield* validateService(input)
        store.services.set(serviceId, {
          id: serviceId,
          merchantId: merchant.id,
          ...value
        })
        return seedSnapshot(store, merchant.id, merchant.plan).services.find(
          (service) => service.id === serviceId
        )!
      }),
    setServiceEligibility: (serviceId, providerIds) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        if (store.services.get(serviceId)?.merchantId !== merchant.id) {
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'item_not_found' })
          )
        }
        const uniqueProviderIds = [...new Set(providerIds)]
        if (
          uniqueProviderIds.some((providerId) => {
            const provider = store.providers.get(providerId)
            return (
              provider?.merchantId !== merchant.id ||
              (merchant.plan === 'solo' && !provider.isDefault)
            )
          })
        ) {
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'item_not_found' })
          )
        }
        for (const key of store.eligibility) {
          if (key.startsWith(`${merchant.id}\0`) && key.endsWith(`\0${serviceId}`)) {
            store.eligibility.delete(key)
          }
        }
        for (const providerId of uniqueProviderIds) {
          store.eligibility.add(eligibilityKey(merchant.id, providerId, serviceId))
        }
      }),
    createProvider: (input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        if (merchant.plan !== 'team') {
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'team_required' })
          )
        }
        const value = yield* validateProvider(input)
        if (value.isDefault) {
          for (const [id, provider] of store.providers) {
            if (provider.merchantId === merchant.id) {
              store.providers.set(id, { ...provider, isDefault: false })
            }
          }
        }
        const id = newCapabilityId('prv')
        store.providers.set(id, { id, merchantId: merchant.id, ...value })
        return { id, ...value, eligibleServiceIds: [] }
      }),
    updateProvider: (providerId, input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const current = store.providers.get(providerId)
        if (current?.merchantId !== merchant.id) {
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'item_not_found' })
          )
        }
        const value = yield* validateProvider(input)
        if (current.isDefault && !value.isDefault) {
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'default_required' })
          )
        }
        if (value.isDefault) {
          for (const [id, provider] of store.providers) {
            if (provider.merchantId === merchant.id) {
              store.providers.set(id, { ...provider, isDefault: id === providerId })
            }
          }
        }
        store.providers.set(providerId, {
          id: providerId,
          merchantId: merchant.id,
          ...value
        })
        return seedSnapshot(store, merchant.id, merchant.plan).providers.find(
          (provider) => provider.id === providerId
        )!
      })
  } satisfies MerchantCatalogShape)

const liveSnapshot = (
  db: EffectDatabase,
  merchantId: string,
  presentation: 'solo' | 'team'
) =>
  Effect.gen(function* () {
    const serviceRows = yield* orUnavailable('merchant-catalog')(
      db.select().from(services).where(eq(services.merchantId, merchantId))
    )
    const providerRows = yield* orUnavailable('merchant-catalog')(
      db.select().from(providers).where(eq(providers.merchantId, merchantId))
    )
    const pairs = yield* orUnavailable('merchant-catalog')(
      db
        .select()
        .from(providerServiceEligibility)
        .where(eq(providerServiceEligibility.merchantId, merchantId))
    )
    return {
      presentation,
      services: serviceRows.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        category: service.category,
        priceMinor: service.priceMinor,
        currency: service.currency,
        durationMinutes: service.durationMinutes,
        status: service.status,
        eligibleProviderIds: pairs
          .filter((pair) => pair.serviceId === service.id)
          .map((pair) => pair.providerId)
          .sort()
      })),
      providers: providerRows.map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        status: provider.status,
        isDefault: provider.isDefault,
        eligibleServiceIds: pairs
          .filter((pair) => pair.providerId === provider.id)
          .map((pair) => pair.serviceId)
          .sort()
      }))
    } satisfies MerchantCatalogSnapshot
  })

const unavailable = (reason: string) =>
  new CapabilityUnavailable({ capability: 'merchant-catalog', reason })

export const LiveMerchantCatalogConfiguration: Layer.Layer<
  MerchantCatalog,
  never,
  Database
> = Layer.effect(
  MerchantCatalog,
  Effect.gen(function* () {
    const db = yield* Database
    return {
      read: () =>
        Effect.flatMap(MerchantContext, (merchant) =>
          liveSnapshot(db, merchant.id, merchant.plan)
        ),
      readBookable: () =>
        Effect.flatMap(MerchantContext, (merchant) =>
          Effect.map(liveSnapshot(db, merchant.id, merchant.plan), onlyBookable)
        ),
      createService: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const value = yield* validateService(input)
          const id = newCapabilityId('svc')
          const now = new Date().toISOString()
          yield* orUnavailable('merchant-catalog')(
            db.insert(services).values({
              id,
              merchantId: merchant.id,
              ...value,
              createdAt: now,
              updatedAt: now
            })
          )
          return { id, ...value, eligibleProviderIds: [] }
        }),
      updateService: (serviceId, input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const existing = yield* orUnavailable('merchant-catalog')(
            db
              .select({ id: services.id })
              .from(services)
              .where(
                and(eq(services.id, serviceId), eq(services.merchantId, merchant.id))
              )
              .limit(1)
          )
          if (!existing[0]) {
            return yield* Effect.fail(
              new MerchantCatalogInvalid({ reason: 'item_not_found' })
            )
          }
          const value = yield* validateService(input)
          yield* orUnavailable('merchant-catalog')(
            db
              .update(services)
              .set({ ...value, updatedAt: new Date().toISOString() })
              .where(
                and(eq(services.id, serviceId), eq(services.merchantId, merchant.id))
              )
          )
          const snapshot = yield* liveSnapshot(db, merchant.id, merchant.plan)
          return snapshot.services.find((service) => service.id === serviceId)!
        }),
      setServiceEligibility: (serviceId, providerIds) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const serviceRows = yield* orUnavailable('merchant-catalog')(
            db
              .select({ id: services.id })
              .from(services)
              .where(
                and(eq(services.id, serviceId), eq(services.merchantId, merchant.id))
              )
              .limit(1)
          )
          if (!serviceRows[0]) {
            return yield* Effect.fail(
              new MerchantCatalogInvalid({ reason: 'item_not_found' })
            )
          }
          const uniqueProviderIds = [...new Set(providerIds)]
          const providerRows = uniqueProviderIds.length
            ? yield* orUnavailable('merchant-catalog')(
                db
                  .select({ id: providers.id })
                  .from(providers)
                  .where(
                    and(
                      eq(providers.merchantId, merchant.id),
                      inArray(providers.id, uniqueProviderIds)
                    )
                  )
              )
            : []
          if (providerRows.length !== uniqueProviderIds.length) {
            return yield* Effect.fail(
              new MerchantCatalogInvalid({ reason: 'item_not_found' })
            )
          }
          if (merchant.plan === 'solo' && uniqueProviderIds.length > 0) {
            const defaultRows = yield* orUnavailable('merchant-catalog')(
              db
                .select({ id: providers.id })
                .from(providers)
                .where(
                  and(
                    eq(providers.merchantId, merchant.id),
                    eq(providers.isDefault, true),
                    inArray(providers.id, uniqueProviderIds)
                  )
                )
            )
            if (defaultRows.length !== uniqueProviderIds.length) {
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'item_not_found' })
              )
            }
          }
          const now = new Date().toISOString()
          yield* batch(db, [
            db
              .delete(providerServiceEligibility)
              .where(
                and(
                  eq(providerServiceEligibility.merchantId, merchant.id),
                  eq(providerServiceEligibility.serviceId, serviceId)
                )
              ),
            ...uniqueProviderIds.map((providerId) =>
              db.insert(providerServiceEligibility).values({
                merchantId: merchant.id,
                providerId,
                serviceId,
                createdAt: now
              })
            )
          ]).pipe(Effect.mapError((error) => unavailable(error.reason)))
        }),
      createProvider: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          if (merchant.plan !== 'team') {
            return yield* Effect.fail(
              new MerchantCatalogInvalid({ reason: 'team_required' })
            )
          }
          const value = yield* validateProvider(input)
          const id = newCapabilityId('prv')
          const now = new Date().toISOString()
          const statements = []
          if (value.isDefault) {
            statements.push(
              db
                .update(providers)
                .set({ isDefault: false, updatedAt: now })
                .where(eq(providers.merchantId, merchant.id))
            )
          }
          statements.push(
            db.insert(providers).values({
              id,
              merchantId: merchant.id,
              linkedUserId: null,
              displayName: value.displayName,
              status: value.status,
              isDefault: value.isDefault,
              createdAt: now,
              updatedAt: now
            })
          )
          yield* batch(db, statements).pipe(
            Effect.mapError((error) => unavailable(error.reason))
          )
          return { id, ...value, eligibleServiceIds: [] }
        }),
      updateProvider: (providerId, input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const rows = yield* orUnavailable('merchant-catalog')(
            db
              .select()
              .from(providers)
              .where(
                and(eq(providers.id, providerId), eq(providers.merchantId, merchant.id))
              )
              .limit(1)
          )
          const current = rows[0]
          if (!current) {
            return yield* Effect.fail(
              new MerchantCatalogInvalid({ reason: 'item_not_found' })
            )
          }
          const value = yield* validateProvider(input)
          if (current.isDefault && !value.isDefault) {
            return yield* Effect.fail(
              new MerchantCatalogInvalid({ reason: 'default_required' })
            )
          }
          const now = new Date().toISOString()
          const statements = []
          if (value.isDefault) {
            statements.push(
              db
                .update(providers)
                .set({ isDefault: false, updatedAt: now })
                .where(eq(providers.merchantId, merchant.id))
            )
          }
          statements.push(
            db
              .update(providers)
              .set({
                displayName: value.displayName,
                status: value.status,
                isDefault: value.isDefault,
                updatedAt: now
              })
              .where(
                and(eq(providers.id, providerId), eq(providers.merchantId, merchant.id))
              )
          )
          yield* batch(db, statements).pipe(
            Effect.mapError((error) => unavailable(error.reason))
          )
          const snapshot = yield* liveSnapshot(db, merchant.id, merchant.plan)
          return snapshot.providers.find((provider) => provider.id === providerId)!
        })
    } satisfies MerchantCatalogShape
  })
)
