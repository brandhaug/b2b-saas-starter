import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import {
  Database,
  providerServiceEligibility,
  providers,
  services,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  authorizeSubscriptionAccess,
  NEW_DEMAND_SUBSCRIPTION_SQL_VALUES
} from '../subscriptions/subscription-access.ts'
import { MerchantContext } from './merchant-context.ts'
import { isSupportedCurrency } from './currency.ts'
import {
  decodePersistedServiceBuffers,
  type ServiceBuffersInput as ServiceBuffersInputType
} from './service-buffers.ts'

export * from './service-buffers.ts'

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
      'active_service_requires_owner_eligibility',
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
    input: ServiceBuffersInputType
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
        const ownerProvider =
          value.status === 'active'
            ? [...store.providers.values()].find(
                (provider) =>
                  provider.merchantId === merchant.id &&
                  provider.isDefault &&
                  provider.status === 'active'
              )
            : undefined
        if (value.status === 'active' && !ownerProvider)
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'item_not_found' })
          )
        store.services.set(serviceId, {
          id: serviceId,
          merchantId: merchant.id,
          ...value
        })
        if (ownerProvider)
          store.eligibility.add(
            seedEligibilityKey({
              merchantId: merchant.id,
              providerId: ownerProvider.id,
              serviceId
            })
          )
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
        const currentProviderIds = [...store.eligibility]
          .filter(
            (key) =>
              key.startsWith(`${merchant.id}\0`) && key.endsWith(`\0${serviceId}`)
          )
          .map((key) => key.split('\0')[1]!)
          .sort()
        const nextProviderIds = [...uniqueProviderIds].sort()
        if (
          store.services.get(serviceId)?.status === 'active' &&
          currentProviderIds.join('\u0000') !== nextProviderIds.join('\u0000')
        )
          return yield* Effect.fail(
            new MerchantCatalogInvalid({ reason: 'item_not_found' })
          )
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
            const created = yield* Effect.tryPromise({
              try: () =>
                db.$client.config.db
                  .prepare(
                    `INSERT INTO services
                     (id,merchant_id,name,description,category,price_minor,currency,duration_minutes,status,created_at,updated_at)
                     SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
                       SELECT 1 FROM merchant_subscriptions subscription
                       WHERE subscription.merchant_id=?
                         AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))`
                  )
                  .bind(
                    id,
                    merchant.id,
                    value.name,
                    value.description,
                    value.category,
                    value.priceMinor,
                    value.currency,
                    value.durationMinutes,
                    value.status,
                    now,
                    now,
                    merchant.id
                  )
                  .run(),
              catch: (cause) => unavailable(String(cause))
            })
            if ((created.meta.changes ?? 0) < 1)
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'restricted_access' })
              )
            return { id, ...value, eligibleProviderIds: [ownerProvider.id] }
          }),
        updateService: (serviceId, input) =>
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            yield* ensureSubscriptionMutation(db, merchant.id)
            const existing = yield* orUnavailable('merchant-catalog')(
              db
                .select({
                  id: services.id,
                  bookingConfigJson: services.bookingConfigJson,
                  durationMinutes: services.durationMinutes,
                  status: services.status
                })
                .from(services)
                .where(
                  and(eq(services.id, serviceId), eq(services.merchantId, merchant.id))
                )
                .limit(1)
            )
            const existingService = existing[0]
            if (!existingService) {
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'item_not_found' })
              )
            }
            const value = yield* validateService(input)
            const now = new Date().toISOString()
            const invalidatesHolds =
              existingService.durationMinutes !== value.durationMinutes ||
              existingService.status !== value.status
            const updateResults = yield* Effect.tryPromise({
              try: () =>
                db.$client.config.db.batch([
                  db.$client.config.db
                    .prepare(
                      `UPDATE services SET name=?,description=?,category=?,price_minor=?,currency=?,duration_minutes=?,status=?,updated_at=?
                       WHERE id=? AND merchant_id=? AND EXISTS (
                         SELECT 1 FROM merchant_subscriptions subscription
                         WHERE subscription.merchant_id=?
                           AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))`
                    )
                    .bind(
                      value.name,
                      value.description,
                      value.category,
                      value.priceMinor,
                      value.currency,
                      value.durationMinutes,
                      value.status,
                      now,
                      serviceId,
                      merchant.id,
                      merchant.id
                    ),
                  db.$client.config.db
                    .prepare(
                      `WITH changed(service_id,duration_minutes,status) AS (VALUES (?,?,?)),
                       candidates AS (
                         SELECT h.id,h.provider_id,h.starts_at,h.quote,
                           (SELECT sum(CASE
                             WHEN json_extract(item.value,'$.id')=changed.service_id
                               THEN changed.duration_minutes
                             ELSE json_extract(item.value,'$.durationMinutes') END)
                            FROM json_each(h.quote,'$.services') item) new_duration
                         FROM time_slot_holds h CROSS JOIN changed
                         WHERE h.merchant_id=? AND h.expires_at>? AND ?=1
                           AND EXISTS (SELECT 1 FROM json_each(h.quote,'$.services') item
                             WHERE json_extract(item.value,'$.id')=changed.service_id)
                           AND EXISTS (SELECT 1 FROM services s
                             WHERE s.id=changed.service_id AND s.merchant_id=? AND s.updated_at=?)
                           AND EXISTS (SELECT 1 FROM merchant_subscriptions subscription
                             WHERE subscription.merchant_id=?
                               AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES})))
                       DELETE FROM time_slot_holds WHERE id IN (
                         SELECT c.id FROM candidates c WHERE
                           ?='inactive'
                           OR c.new_duration IS NULL
                           OR json_extract(c.quote,'$.localStartTime') IS NULL
                           OR json_extract(c.quote,'$.workingIntervalStartTime') IS NULL
                           OR json_extract(c.quote,'$.workingIntervalEndTime') IS NULL
                           OR json_extract(c.quote,'$.occupiedStartsAt') IS NULL
                           OR ((CAST(substr(json_extract(c.quote,'$.localStartTime'),1,2) AS INTEGER)*60
                             + CAST(substr(json_extract(c.quote,'$.localStartTime'),4,2) AS INTEGER))
                             + c.new_duration + COALESCE(json_extract(c.quote,'$.afterBufferMinutes'),0))
                             > (CAST(substr(json_extract(c.quote,'$.workingIntervalEndTime'),1,2) AS INTEGER)*60
                               + CAST(substr(json_extract(c.quote,'$.workingIntervalEndTime'),4,2) AS INTEGER))
                           OR EXISTS (SELECT 1 FROM blocked_times b WHERE b.merchant_id=?
                             AND b.starts_at < strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,
                               '+'||c.new_duration||' minutes',
                               '+'||COALESCE(json_extract(c.quote,'$.afterBufferMinutes'),0)||' minutes')
                             AND b.ends_at > json_extract(c.quote,'$.occupiedStartsAt'))
                           OR EXISTS (SELECT 1 FROM appointments a
                             WHERE a.provider_id=c.provider_id AND a.status='scheduled'
                               AND COALESCE(json_extract(a.snapshot,'$.occupiedStartsAt'),a.starts_at)
                                 < strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,
                                   '+'||c.new_duration||' minutes',
                                   '+'||COALESCE(json_extract(c.quote,'$.afterBufferMinutes'),0)||' minutes')
                               AND COALESCE(json_extract(a.snapshot,'$.occupiedEndsAt'),a.ends_at)
                                 > json_extract(c.quote,'$.occupiedStartsAt'))
                           OR EXISTS (SELECT 1 FROM time_slot_holds other
                             WHERE other.id<>c.id AND other.provider_id=c.provider_id
                               AND other.expires_at>?
                               AND COALESCE(json_extract(other.quote,'$.occupiedStartsAt'),other.starts_at)
                                 < strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,
                                   '+'||c.new_duration||' minutes',
                                   '+'||COALESCE(json_extract(c.quote,'$.afterBufferMinutes'),0)||' minutes')
                               AND COALESCE(json_extract(other.quote,'$.occupiedEndsAt'),other.ends_at)
                                 > json_extract(c.quote,'$.occupiedStartsAt')))`
                    )
                    .bind(
                      serviceId,
                      value.durationMinutes,
                      value.status,
                      merchant.id,
                      now,
                      invalidatesHolds ? 1 : 0,
                      merchant.id,
                      now,
                      merchant.id,
                      value.status,
                      merchant.id,
                      now
                    ),
                  db.$client.config.db
                    .prepare(
                      `INSERT INTO schedule_changes
                       (id,merchant_id,kind,actor_id,reason,before_json,after_json,occurred_at)
                       SELECT ?,?,'service_configuration',?,NULL,?,?,?
                       WHERE ?=1 AND EXISTS (SELECT 1 FROM services
                         WHERE id=? AND merchant_id=? AND updated_at=?)
                       AND EXISTS (SELECT 1 FROM merchant_subscriptions subscription
                         WHERE subscription.merchant_id=?
                           AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))`
                    )
                    .bind(
                      newCapabilityId('scg'),
                      merchant.id,
                      merchant.actorUserId ?? merchant.id,
                      JSON.stringify({
                        durationMinutes: existingService.durationMinutes,
                        status: existingService.status
                      }),
                      JSON.stringify({
                        durationMinutes: value.durationMinutes,
                        status: value.status
                      }),
                      now,
                      invalidatesHolds ? 1 : 0,
                      serviceId,
                      merchant.id,
                      now,
                      merchant.id
                    )
                ]),
              catch: (cause) => unavailable(String(cause))
            })
            if ((updateResults[0]?.meta.changes ?? 0) < 1)
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'restricted_access' })
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
                .select({
                  id: services.id,
                  bookingConfigJson: services.bookingConfigJson,
                  status: services.status
                })
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
            const currentEligibility = yield* orUnavailable('merchant-catalog')(
              db
                .select({ providerId: providerServiceEligibility.providerId })
                .from(providerServiceEligibility)
                .where(
                  and(
                    eq(providerServiceEligibility.merchantId, merchant.id),
                    eq(providerServiceEligibility.serviceId, serviceId)
                  )
                )
            )
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
            const beforeProviderIds = currentEligibility
              .map((pair) => pair.providerId)
              .sort()
            const afterProviderIds = [...uniqueProviderIds].sort()
            if (beforeProviderIds.join('\u0000') === afterProviderIds.join('\u0000'))
              return
            if (serviceRows[0].status === 'active')
              return yield* Effect.fail(
                new MerchantCatalogInvalid({
                  reason: 'active_service_requires_owner_eligibility'
                })
              )
            const now = new Date().toISOString()
            const changeId = newCapabilityId('scg')
            const eligibilityResults = yield* Effect.tryPromise({
              try: () =>
                db.$client.config.db.batch([
                  db.$client.config.db
                    .prepare(
                      `INSERT INTO schedule_changes
                       (id,merchant_id,kind,actor_id,reason,before_json,after_json,occurred_at)
                       SELECT ?,?,'service_eligibility',?,NULL,?,?,? WHERE EXISTS (
                         SELECT 1 FROM services WHERE id=? AND merchant_id=?
                           AND status='inactive')
                       AND EXISTS (SELECT 1 FROM merchant_subscriptions subscription
                         WHERE subscription.merchant_id=?
                           AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))
                       AND NOT EXISTS (SELECT 1 FROM provider_service_eligibility current
                         WHERE current.merchant_id=? AND current.service_id=?
                           AND NOT EXISTS (SELECT 1 FROM json_each(?) expected
                             WHERE expected.value=current.provider_id))
                       AND NOT EXISTS (SELECT 1 FROM json_each(?) expected
                         WHERE NOT EXISTS (SELECT 1 FROM provider_service_eligibility current
                           WHERE current.merchant_id=? AND current.service_id=?
                             AND current.provider_id=expected.value))`
                    )
                    .bind(
                      changeId,
                      merchant.id,
                      merchant.actorUserId ?? merchant.id,
                      JSON.stringify({ providerIds: beforeProviderIds }),
                      JSON.stringify({ providerIds: afterProviderIds }),
                      now,
                      serviceId,
                      merchant.id,
                      merchant.id,
                      merchant.id,
                      serviceId,
                      JSON.stringify(beforeProviderIds),
                      JSON.stringify(beforeProviderIds),
                      merchant.id,
                      serviceId
                    ),
                  db.$client.config.db
                    .prepare(
                      `DELETE FROM provider_service_eligibility
                       WHERE merchant_id=? AND service_id=? AND EXISTS (
                         SELECT 1 FROM schedule_changes WHERE id=?)`
                    )
                    .bind(merchant.id, serviceId, changeId),
                  ...afterProviderIds.map((providerId) =>
                    db.$client.config.db
                      .prepare(
                        `INSERT INTO provider_service_eligibility
                         (merchant_id,provider_id,service_id,created_at)
                         SELECT ?,?,?,? WHERE EXISTS (
                           SELECT 1 FROM schedule_changes WHERE id=?)`
                      )
                      .bind(merchant.id, providerId, serviceId, now, changeId)
                  ),
                  db.$client.config.db
                    .prepare(
                      `DELETE FROM time_slot_holds AS h WHERE h.merchant_id=?
                       AND h.expires_at>? AND EXISTS (
                         SELECT 1 FROM json_each(h.quote,'$.services') item
                         WHERE json_extract(item.value,'$.id')=?)
                       AND NOT EXISTS (SELECT 1 FROM json_each(?) requested
                         WHERE requested.value=h.provider_id)
                       AND EXISTS (SELECT 1 FROM schedule_changes WHERE id=?)`
                    )
                    .bind(
                      merchant.id,
                      now,
                      serviceId,
                      JSON.stringify(afterProviderIds),
                      changeId
                    )
                ]),
              catch: (cause) => unavailable(String(cause))
            })
            if ((eligibilityResults[0]?.meta.changes ?? 0) !== 1) {
              yield* ensureSubscriptionMutation(db, merchant.id)
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'item_not_found' })
              )
            }
          }),
        setServiceBuffers: (serviceId, input) =>
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            yield* ensureSubscriptionMutation(db, merchant.id)
            if (!decodePersistedServiceBuffers(input))
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'invalid_buffer' })
              )
            const existing = yield* orUnavailable('merchant-catalog')(
              db
                .select({
                  id: services.id,
                  bookingConfigJson: services.bookingConfigJson
                })
                .from(services)
                .where(
                  and(eq(services.id, serviceId), eq(services.merchantId, merchant.id))
                )
                .limit(1)
            )
            const existingService = existing[0]
            if (!existingService)
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'item_not_found' })
              )
            const now = new Date().toISOString()
            const bufferResults = yield* Effect.tryPromise({
              try: () =>
                db.$client.config.db.batch([
                  db.$client.config.db
                    .prepare(
                      `UPDATE services SET booking_config_json=?,updated_at=?
                       WHERE id=? AND merchant_id=? AND EXISTS (
                         SELECT 1 FROM merchant_subscriptions subscription
                         WHERE subscription.merchant_id=?
                           AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))`
                    )
                    .bind(
                      JSON.stringify(input),
                      now,
                      serviceId,
                      merchant.id,
                      merchant.id
                    ),
                  db.$client.config.db
                    .prepare(
                      `WITH changed(service_id,before_minutes,after_minutes) AS (VALUES (?,?,?)),
                       candidates AS (
                         SELECT h.id,h.provider_id,h.starts_at,h.ends_at,h.quote,
                           (SELECT max(CASE WHEN json_extract(item.value,'$.id')=changed.service_id
                             THEN changed.before_minutes ELSE COALESCE(json_extract(item.value,'$.beforeBufferMinutes'),0) END)
                             FROM json_each(h.quote,'$.services') item) new_before,
                           (SELECT max(CASE WHEN json_extract(item.value,'$.id')=changed.service_id
                             THEN changed.after_minutes ELSE COALESCE(json_extract(item.value,'$.afterBufferMinutes'),0) END)
                             FROM json_each(h.quote,'$.services') item) new_after
                         FROM time_slot_holds h CROSS JOIN changed
                         WHERE h.merchant_id=? AND h.expires_at>?
                           AND EXISTS (SELECT 1 FROM json_each(h.quote,'$.services') item
                             WHERE json_extract(item.value,'$.id')=changed.service_id)
                           AND EXISTS (SELECT 1 FROM services s WHERE s.id=changed.service_id
                             AND s.merchant_id=? AND s.updated_at=?)
                           AND EXISTS (SELECT 1 FROM merchant_subscriptions subscription
                             WHERE subscription.merchant_id=?
                               AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES})))
                       DELETE FROM time_slot_holds WHERE id IN (
                         SELECT c.id FROM candidates c WHERE
                           json_extract(c.quote,'$.workingIntervalStartTime') IS NULL
                           OR ((CAST(substr(json_extract(c.quote,'$.localStartTime'),1,2) AS INTEGER)*60
                             + CAST(substr(json_extract(c.quote,'$.localStartTime'),4,2) AS INTEGER)) - c.new_before)
                             < (CAST(substr(json_extract(c.quote,'$.workingIntervalStartTime'),1,2) AS INTEGER)*60
                               + CAST(substr(json_extract(c.quote,'$.workingIntervalStartTime'),4,2) AS INTEGER))
                           OR ((CAST(substr(json_extract(c.quote,'$.localStartTime'),1,2) AS INTEGER)*60
                             + CAST(substr(json_extract(c.quote,'$.localStartTime'),4,2) AS INTEGER))
                             + COALESCE(json_extract(c.quote,'$.durationMinutes'),0) + c.new_after)
                             > (CAST(substr(json_extract(c.quote,'$.workingIntervalEndTime'),1,2) AS INTEGER)*60
                               + CAST(substr(json_extract(c.quote,'$.workingIntervalEndTime'),4,2) AS INTEGER))
                           OR EXISTS (SELECT 1 FROM blocked_times b WHERE b.merchant_id=?
                             AND b.starts_at < strftime('%Y-%m-%dT%H:%M:%fZ',c.ends_at,'+'||c.new_after||' minutes')
                             AND b.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,'-'||c.new_before||' minutes'))
                           OR EXISTS (SELECT 1 FROM appointments a WHERE a.provider_id=c.provider_id AND a.status='scheduled'
                             AND COALESCE(json_extract(a.snapshot,'$.occupiedStartsAt'),a.starts_at) < strftime('%Y-%m-%dT%H:%M:%fZ',c.ends_at,'+'||c.new_after||' minutes')
                             AND COALESCE(json_extract(a.snapshot,'$.occupiedEndsAt'),a.ends_at) > strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,'-'||c.new_before||' minutes'))
                           OR EXISTS (SELECT 1 FROM time_slot_holds other WHERE other.id<>c.id
                             AND other.provider_id=c.provider_id AND other.expires_at>?
                             AND COALESCE(json_extract(other.quote,'$.occupiedStartsAt'),other.starts_at) < strftime('%Y-%m-%dT%H:%M:%fZ',c.ends_at,'+'||c.new_after||' minutes')
                             AND COALESCE(json_extract(other.quote,'$.occupiedEndsAt'),other.ends_at) > strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,'-'||c.new_before||' minutes')))`
                    )
                    .bind(
                      serviceId,
                      input.beforeBufferMinutes,
                      input.afterBufferMinutes,
                      merchant.id,
                      now,
                      merchant.id,
                      now,
                      merchant.id,
                      merchant.id,
                      now
                    ),
                  db.$client.config.db
                    .prepare(
                      `INSERT INTO schedule_changes
                       (id,merchant_id,kind,actor_id,reason,before_json,after_json,occurred_at)
                       SELECT ?,?,'service_buffers',?,NULL,?,?,? WHERE EXISTS (
                         SELECT 1 FROM services WHERE id=? AND merchant_id=? AND updated_at=?)
                       AND EXISTS (SELECT 1 FROM merchant_subscriptions subscription
                         WHERE subscription.merchant_id=?
                           AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))`
                    )
                    .bind(
                      newCapabilityId('scg'),
                      merchant.id,
                      merchant.actorUserId ?? merchant.id,
                      JSON.stringify(existingService.bookingConfigJson ?? null),
                      JSON.stringify(input),
                      now,
                      serviceId,
                      merchant.id,
                      now,
                      merchant.id
                    )
                ]),
              catch: (cause) => unavailable(String(cause))
            })
            if ((bufferResults[0]?.meta.changes ?? 0) < 1)
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'restricted_access' })
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
            const updated = yield* Effect.tryPromise({
              try: () =>
                db.$client.config.db
                  .prepare(
                    `UPDATE providers SET display_name=?,updated_at=?
                     WHERE id=? AND merchant_id=? AND EXISTS (
                       SELECT 1 FROM merchant_subscriptions subscription
                       WHERE subscription.merchant_id=?
                         AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))`
                  )
                  .bind(value.displayName, now, providerId, merchant.id, merchant.id)
                  .run(),
              catch: (cause) => unavailable(String(cause))
            })
            if ((updated.meta.changes ?? 0) < 1)
              return yield* Effect.fail(
                new MerchantCatalogInvalid({ reason: 'restricted_access' })
              )
            const snapshot = yield* liveSnapshot(db, merchant.id)
            return snapshot.providers.find((provider) => provider.id === providerId)!
          })
      } satisfies MerchantCatalogShape
    })
  )
