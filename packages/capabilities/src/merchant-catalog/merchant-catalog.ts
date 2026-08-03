import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import {
  batch,
  Database,
  merchantSubscriptions,
  providerServiceEligibility,
  providers,
  services,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { authorizeSubscriptionAccess } from '../subscriptions/subscription-access.ts'
import { MerchantContext } from './merchant-context.ts'
import { isSupportedCurrency } from './currency.ts'

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

export const ProviderProfileInput = Schema.Struct({
  displayName: Schema.String
})
export type ProviderProfileInput = typeof ProviderProfileInput.Type

export const ServiceBuffersInput = Schema.Struct({
  beforeBufferMinutes: Schema.Number,
  afterBufferMinutes: Schema.Number
})
export type ServiceBuffersInput = typeof ServiceBuffersInput.Type

export const ProviderRecord = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  isDefault: Schema.Boolean,
  status: CatalogStatus,
  eligibleServiceIds: Schema.Array(Schema.String)
})
export type ProviderRecord = typeof ProviderRecord.Type

export const MerchantCatalogSnapshot = Schema.Struct({
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
      'invalid_buffer',
      'item_not_found',
      'restricted_access'
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
  readonly setServiceBuffers: (
    serviceId: string,
    input: ServiceBuffersInput
  ) => CatalogEffect<void>
  readonly updateProvider: (
    providerId: string,
    input: ProviderProfileInput
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
  readonly eligibility: Set<SeedEligibilityKey>
}

declare const seedEligibilityKeyBrand: unique symbol
export type SeedEligibilityKey = string & {
  readonly [seedEligibilityKeyBrand]: true
}
export const seedEligibilityKey = (pair: {
  readonly merchantId: string
  readonly providerId: string
  readonly serviceId: string
}): SeedEligibilityKey =>
  `${pair.merchantId}\0${pair.providerId}\0${pair.serviceId}` as SeedEligibilityKey

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
    if (!isSupportedCurrency(input.currency)) {
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

const validateProviderProfile = (input: ProviderProfileInput) => {
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
  merchantId: string
): MerchantCatalogSnapshot => {
  const pairs = [...store.eligibility]
    .map((key) => key.split('\0'))
    .filter(([pairMerchantId]) => pairMerchantId === merchantId)
  return {
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

export const SeedMerchantCatalog = (
  store: SeedMerchantCatalogConfigurationStore
): Layer.Layer<MerchantCatalog> =>
  Layer.succeed(MerchantCatalog)({
    read: () =>
      Effect.map(MerchantContext, (merchant) => seedSnapshot(store, merchant.id)),
    readBookable: () =>
      Effect.map(MerchantContext, (merchant) =>
        onlyBookable(seedSnapshot(store, merchant.id))
      ),
    createService: (input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const value = yield* validateService(input)
        const id = newCapabilityId('svc')
        const ownerProvider = [...store.providers.values()].find(
          (provider) =>
            provider.merchantId === merchant.id &&
            provider.isDefault &&
            provider.status === 'active'
        )
        if (!ownerProvider) {
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'item_not_found' })
          )
        }
        store.services.set(id, { id, merchantId: merchant.id, ...value })
        store.eligibility.add(
          seedEligibilityKey({
            merchantId: merchant.id,
            providerId: ownerProvider.id,
            serviceId: id
          })
        )
        return { id, ...value, eligibleProviderIds: [ownerProvider.id] }
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
        return seedSnapshot(store, merchant.id).services.find(
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
            return provider?.merchantId !== merchant.id || !provider.isDefault
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
          store.eligibility.add(
            seedEligibilityKey({ merchantId: merchant.id, providerId, serviceId })
          )
        }
      }),
    setServiceBuffers: (serviceId, input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        if (
          !store.services.has(serviceId) ||
          store.services.get(serviceId)?.merchantId !== merchant.id
        )
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'item_not_found' })
          )
        if (
          ![input.beforeBufferMinutes, input.afterBufferMinutes].every(
            (value) =>
              Number.isInteger(value) && value >= 0 && value <= 120 && value % 5 === 0
          )
        )
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'invalid_buffer' })
          )
      }),
    updateProvider: (providerId, input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const current = store.providers.get(providerId)
        if (
          current?.merchantId !== merchant.id ||
          !current.isDefault ||
          current.status !== 'active'
        ) {
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'item_not_found' })
          )
        }
        const value = yield* validateProviderProfile(input)
        store.providers.set(providerId, {
          ...current,
          displayName: value.displayName
        })
        return seedSnapshot(store, merchant.id).providers.find(
          (provider) => provider.id === providerId
        )!
      })
  } satisfies MerchantCatalogShape)

const liveSnapshot = (db: EffectDatabase, merchantId: string) =>
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

const ensureSubscriptionMutation = (db: EffectDatabase, merchantId: string) =>
  authorizeSubscriptionAccess(db, { merchantId }, 'configuration').pipe(
    Effect.mapError((error) =>
      error._tag === 'CapabilityDenied'
        ? new MerchantCatalogInvalid({ reason: 'restricted_access' })
        : error
    )
  )

export const LiveMerchantCatalog: Layer.Layer<MerchantCatalog, never, Database> =
  Layer.effect(
    MerchantCatalog,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        read: () =>
          Effect.flatMap(MerchantContext, (merchant) => liveSnapshot(db, merchant.id)),
        readBookable: () =>
          Effect.flatMap(MerchantContext, (merchant) =>
            Effect.map(liveSnapshot(db, merchant.id), onlyBookable)
          ),
        createService: (input) =>
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            yield* ensureSubscriptionMutation(db, merchant.id)
            const value = yield* validateService(input)
            const id = newCapabilityId('svc')
            const now = new Date().toISOString()
            const ownerProviders = yield* orUnavailable('merchant-catalog')(
              db
                .select({ id: providers.id })
                .from(providers)
                .where(
                  and(
                    eq(providers.merchantId, merchant.id),
                    eq(providers.isDefault, true),
                    eq(providers.status, 'active')
                  )
                )
                .limit(1)
            )
            const ownerProvider = ownerProviders[0]
            if (!ownerProvider) {
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'item_not_found' })
              )
            }
            yield* orUnavailable('merchant-catalog')(
              db.insert(services).values({
                id,
                merchantId: merchant.id,
                ...value,
                createdAt: now,
                updatedAt: now
              })
            )
            return { id, ...value, eligibleProviderIds: [ownerProvider.id] }
          }),
        updateService: (serviceId, input) =>
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            yield* ensureSubscriptionMutation(db, merchant.id)
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
            const snapshot = yield* liveSnapshot(db, merchant.id)
            return snapshot.services.find((service) => service.id === serviceId)!
          }),
        setServiceEligibility: (serviceId, providerIds) =>
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            yield* ensureSubscriptionMutation(db, merchant.id)
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
                    .select({ id: providers.id, isDefault: providers.isDefault })
                    .from(providers)
                    .where(eq(providers.merchantId, merchant.id))
                )
              : []
            if (
              providerRows.filter((provider) => uniqueProviderIds.includes(provider.id))
                .length !== uniqueProviderIds.length ||
              providerRows.some(
                (provider) =>
                  uniqueProviderIds.includes(provider.id) && !provider.isDefault
              )
            ) {
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'item_not_found' })
              )
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
                db
                  .insert(providerServiceEligibility)
                  .values({
                    merchantId: merchant.id,
                    providerId,
                    serviceId,
                    createdAt: now
                  })
                  .onConflictDoNothing()
              )
            ]).pipe(Effect.mapError((error) => unavailable(error.reason)))
          }),
        setServiceBuffers: (serviceId, input) =>
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            yield* ensureSubscriptionMutation(db, merchant.id)
            if (
              ![input.beforeBufferMinutes, input.afterBufferMinutes].every(
                (value) =>
                  Number.isInteger(value) &&
                  value >= 0 &&
                  value <= 120 &&
                  value % 5 === 0
              )
            )
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'invalid_buffer' })
              )
            const existing = yield* orUnavailable('merchant-catalog')(
              db
                .select({ id: services.id })
                .from(services)
                .where(
                  and(eq(services.id, serviceId), eq(services.merchantId, merchant.id))
                )
                .limit(1)
            )
            if (!existing[0])
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'item_not_found' })
              )
            yield* orUnavailable('merchant-catalog')(
              db
                .update(services)
                .set({
                  bookingConfigJson: input,
                  updatedAt: new Date().toISOString()
                })
                .where(
                  and(eq(services.id, serviceId), eq(services.merchantId, merchant.id))
                )
            )
          }),
        updateProvider: (providerId, input) =>
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            yield* ensureSubscriptionMutation(db, merchant.id)
            const rows = yield* orUnavailable('merchant-catalog')(
              db
                .select()
                .from(providers)
                .where(
                  and(
                    eq(providers.id, providerId),
                    eq(providers.merchantId, merchant.id)
                  )
                )
                .limit(1)
            )
            const current = rows[0]
            if (!current || !current.isDefault || current.status !== 'active') {
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'item_not_found' })
              )
            }
            const value = yield* validateProviderProfile(input)
            const now = new Date().toISOString()
            yield* orUnavailable('merchant-catalog')(
              db
                .update(providers)
                .set({
                  displayName: value.displayName,
                  updatedAt: now
                })
                .where(
                  and(
                    eq(providers.id, providerId),
                    eq(providers.merchantId, merchant.id)
                  )
                )
            )
            const snapshot = yield* liveSnapshot(db, merchant.id)
            return snapshot.providers.find((provider) => provider.id === providerId)!
          })
      } satisfies MerchantCatalogShape
    })
  )
