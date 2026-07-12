import { Effect, Layer, Schema } from 'effect'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  batch,
  Database,
  lifecycleHistory,
  notificationIntents,
  protectedAccessGrants,
  providers,
  services,
  shopProviders,
  shopServices,
  shops,
  walkInEntries
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { hashSha256, randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  WalkInDuplicate,
  WalkInEntryNotFound,
  WalkInHistoryEvent,
  WalkInConfiguration,
  WalkIns,
  WalkInsClosed,
  WalkInTransitionRejected,
  WalkInUnavailable,
  walkInMerchantTransitions,
  StoredWalkInRequest,
  type WalkInConfiguration as WalkInConfigurationType,
  type WalkInEnrollment,
  type StoredWalkInRequest as StoredRequest,
  type WalkInStatus,
  type WalkInsShape
} from './index.ts'

type Entry = typeof import('./index.ts').WalkInQueueEntry.Type
type LegacyEntry = typeof import('./index.ts').WalkInEntry.Type
type SeedOptions = {
  readonly records?: readonly (Entry | LegacyEntry)[]
  readonly configurations?: readonly WalkInConfigurationType[]
  readonly now?: () => string
}
type Stored = {
  entry: Entry
  contactKey: string
  capability: string
  acknowledgmentExpiresAt: string
  entryExpiresAt: string
}

const active = new Set<WalkInStatus>(['waiting', 'called', 'serving'])
const transitions: Readonly<Record<WalkInStatus, readonly WalkInStatus[]>> = {
  waiting: [...walkInMerchantTransitions('waiting'), 'expired'],
  called: [...walkInMerchantTransitions('called'), 'expired'],
  serving: [...walkInMerchantTransitions('serving'), 'expired'],
  served: [],
  removed: [],
  expired: []
}
const contactKey = (input: WalkInEnrollment) =>
  `${input.customerDetails.email.trim().toLowerCase()}|${input.customerDetails.phone.replace(/\D/g, '')}`

const project = (records: readonly Stored[], shopId: string, average: number) => {
  const ordered = records
    .filter(
      (record) => record.entry.shopId === shopId && active.has(record.entry.status)
    )
    .sort(
      (a, b) =>
        a.entry.position - b.entry.position || a.entry.id.localeCompare(b.entry.id)
    )
  return ordered.map((record, index) => ({
    ...record.entry,
    position: index + 1,
    projectedWaitMinutes: index * average
  }))
}

export const SeedWalkIns = (
  input: readonly (Entry | LegacyEntry)[] | SeedOptions = []
): Layer.Layer<WalkIns> => {
  const options: SeedOptions = Array.isArray(input)
    ? { records: input }
    : (input as SeedOptions)
  const now = options.now ?? (() => new Date().toISOString())
  const configurations = new Map(
    (options.configurations ?? []).map((configuration) => [
      configuration.shopId,
      configuration
    ])
  )
  const records: Stored[] = (options.records ?? []).map((record) => ({
    entry: {
      ...record,
      projectedWaitMinutes:
        'projectedWaitMinutes' in record ? record.projectedWaitMinutes : 0,
      serviceId: 'serviceId' in record ? record.serviceId : '',
      providerPreference:
        'providerPreference' in record
          ? record.providerPreference
          : { kind: 'any' as const },
      locale: 'locale' in record ? record.locale : 'en',
      history:
        'history' in record
          ? record.history
          : [{ from: null, to: record.status, occurredAt: now() }]
    },
    contactKey: '',
    capability: randomHex(32),
    acknowledgmentExpiresAt: new Date(Date.parse(now()) + 60 * 60_000).toISOString(),
    entryExpiresAt: new Date(Date.parse(now()) + 4 * 60 * 60_000).toISOString()
  }))
  const configurationFor = (shopId: string) => configurations.get(shopId)
  const queue: WalkInsShape['queue'] = (shopId) => {
    const configuration = configurationFor(shopId)
    return configuration
      ? Effect.succeed(project(records, shopId, configuration.averageServiceMinutes))
      : Effect.fail(new WalkInUnavailable({ shopId, reason: 'not-configured' }))
  }
  const find = (entryId: string, shopId?: string) => {
    const stored = records.find(
      (candidate) =>
        candidate.entry.id === entryId && (!shopId || candidate.entry.shopId === shopId)
    )
    return stored
      ? Effect.succeed(stored)
      : Effect.fail(new WalkInEntryNotFound({ entryId }))
  }
  return Layer.succeed(WalkIns)({
    findById: ({ shopId, entryId }) =>
      Effect.map(find(entryId, shopId), ({ entry }) => ({
        id: entry.id,
        shopId: entry.shopId,
        status: entry.status,
        position: entry.position
      })),
    queue,
    overview: (shopId) => {
      const configuration = configurationFor(shopId)
      return configuration
        ? Effect.map(queue(shopId), (entries) => ({
            state: configuration.open ? ('open' as const) : ('closed' as const),
            services: configuration.eligibleServiceIds.map((id) => ({ id, name: id })),
            providers: configuration.eligibleProviderIds.map((id) => ({
              id,
              name: id
            })),
            queue: entries
          }))
        : Effect.fail(new WalkInUnavailable({ shopId, reason: 'not-configured' }))
    },
    inspect: ({ shopId, entryId, capability }) =>
      Effect.flatMap(find(entryId, shopId), (stored) =>
        stored.capability === capability &&
        Date.parse(stored.acknowledgmentExpiresAt) > Date.parse(now())
          ? Effect.succeed(stored.entry)
          : Effect.fail(new WalkInEntryNotFound({ entryId }))
      ),
    enroll: (enrollment) => {
      const configuration = configurationFor(enrollment.shopId)
      if (!configuration)
        return Effect.fail(
          new WalkInUnavailable({ shopId: enrollment.shopId, reason: 'not-configured' })
        )
      if (!configuration.open)
        return Effect.fail(new WalkInsClosed({ shopId: enrollment.shopId }))
      if (!configuration.eligibleServiceIds.includes(enrollment.serviceId))
        return Effect.fail(
          new WalkInUnavailable({
            shopId: enrollment.shopId,
            reason: 'service-ineligible'
          })
        )
      if (
        enrollment.providerPreference.kind === 'specific' &&
        !configuration.eligibleProviderIds.includes(
          enrollment.providerPreference.providerId
        )
      )
        return Effect.fail(
          new WalkInUnavailable({
            shopId: enrollment.shopId,
            reason: 'provider-ineligible'
          })
        )
      const key = contactKey(enrollment)
      const duplicate = records.find(
        (record) =>
          record.entry.shopId === enrollment.shopId &&
          record.contactKey === key &&
          active.has(record.entry.status)
      )
      if (duplicate)
        return Effect.fail(
          new WalkInDuplicate({
            shopId: enrollment.shopId,
            entryId: duplicate.entry.id
          })
        )
      const createdAt = now()
      const capability = randomHex(32)
      const id = newCapabilityId('wie')
      const entry: Entry = {
        id,
        shopId: enrollment.shopId,
        status: 'waiting',
        position:
          project(records, enrollment.shopId, configuration.averageServiceMinutes)
            .length + 1,
        projectedWaitMinutes:
          project(records, enrollment.shopId, configuration.averageServiceMinutes)
            .length * configuration.averageServiceMinutes,
        serviceId: enrollment.serviceId,
        providerPreference: enrollment.providerPreference,
        locale: enrollment.locale,
        history: [{ from: null, to: 'waiting', occurredAt: createdAt }]
      }
      const expiresAt = new Date(
        Date.parse(createdAt) + configuration.acknowledgmentTtlMinutes * 60_000
      ).toISOString()
      const entryExpiresAt = new Date(
        Date.parse(createdAt) + configuration.entryTtlMinutes * 60_000
      ).toISOString()
      records.push({
        entry,
        contactKey: key,
        capability,
        acknowledgmentExpiresAt: expiresAt,
        entryExpiresAt
      })
      return Effect.succeed({
        entry,
        acknowledgment: { capability, expiresAt },
        notificationIntent: {
          id: newCapabilityId('nti'),
          topic: 'walk-in.enrolled' as const,
          sourceId: id
        }
      })
    },
    transition: ({ shopId, entryId, to }) =>
      Effect.flatMap(find(entryId, shopId), (stored) => {
        const from = stored.entry.status
        if (!transitions[from].includes(to))
          return Effect.fail(new WalkInTransitionRejected({ entryId, from, to }))
        stored.entry = {
          ...stored.entry,
          status: to,
          history: [...stored.entry.history, { from, to, occurredAt: now() }]
        }
        const configuration = configurationFor(shopId)
        if (configuration) {
          for (const projected of project(
            records,
            shopId,
            configuration.averageServiceMinutes
          )) {
            const target = records.find((record) => record.entry.id === projected.id)
            if (target) target.entry = projected
          }
        }
        return Effect.succeed({
          entry: stored.entry,
          notificationIntent: {
            id: newCapabilityId('nti'),
            topic: `walk-in.${to}`,
            sourceId: entryId
          }
        })
      }),
    expireEntries: ({ shopId, now: at }) => {
      const expired = records.filter(
        (record) =>
          record.entry.shopId === shopId &&
          active.has(record.entry.status) &&
          record.entryExpiresAt <= at
      )
      for (const stored of expired) {
        const from = stored.entry.status
        stored.entry = {
          ...stored.entry,
          status: 'expired',
          history: [...stored.entry.history, { from, to: 'expired', occurredAt: at }]
        }
      }
      return Effect.succeed(expired.map(({ entry }) => entry))
    }
  })
}

const decodeConfiguration = (
  shopId: string,
  value: unknown
): WalkInConfigurationType | null => {
  if (!value || typeof value !== 'object') return null
  const walkIns = (value as { walkIns?: unknown }).walkIns
  if (walkIns === undefined) return null
  try {
    return Schema.decodeUnknownSync(WalkInConfiguration)({
      ...(typeof walkIns === 'object' && walkIns !== null ? walkIns : {}),
      shopId
    })
  } catch (cause) {
    throw new CapabilityUnavailable({
      capability: 'walk-ins',
      reason: `invalid-shop-configuration:${cause instanceof Error ? cause.message : String(cause)}`
    })
  }
}

const parseRequest = (value: string) =>
  Effect.try({
    try: (): StoredRequest =>
      Schema.decodeUnknownSync(StoredWalkInRequest)(JSON.parse(value)),
    catch: () =>
      new CapabilityUnavailable({
        capability: 'walk-ins',
        reason: 'invalid-persisted-request'
      })
  })

export const LiveWalkIns: Layer.Layer<WalkIns, never, Database> = Layer.effect(
  WalkIns,
  Effect.gen(function* () {
    const db = yield* Database
    const configurationFor = (shopId: string) =>
      Effect.flatMap(
        orUnavailable('walk-ins')(
          db
            .select({ bookingConfigJson: shops.bookingConfigJson })
            .from(shops)
            .where(eq(shops.id, shopId))
            .limit(1)
        ),
        ([shop]) =>
          Effect.flatMap(
            Effect.try({
              try: () => decodeConfiguration(shopId, shop?.bookingConfigJson),
              catch: (cause) =>
                new CapabilityUnavailable({
                  capability: 'walk-ins',
                  reason:
                    cause instanceof CapabilityUnavailable
                      ? cause.reason
                      : 'invalid-shop-configuration'
                })
            }),
            (configuration) =>
              configuration
                ? Effect.succeed(configuration)
                : Effect.fail(
                    new WalkInUnavailable({ shopId, reason: 'not-configured' })
                  )
          )
      )
    const histories = (shopId: string, entryId: string) =>
      Effect.gen(function* () {
        const [owned] = yield* orUnavailable('walk-ins')(
          db
            .select({ id: walkInEntries.id })
            .from(walkInEntries)
            .where(and(eq(walkInEntries.shopId, shopId), eq(walkInEntries.id, entryId)))
            .limit(1)
        )
        if (!owned) return yield* Effect.fail(new WalkInEntryNotFound({ entryId }))
        const events = yield* orUnavailable('walk-ins')(
          db
            .select()
            .from(lifecycleHistory)
            .where(
              and(
                eq(lifecycleHistory.aggregateType, 'walk-in-entry'),
                eq(lifecycleHistory.aggregateId, entryId)
              )
            )
            .orderBy(asc(lifecycleHistory.occurredAt))
        )
        return yield* Effect.forEach(events, (event) =>
          Schema.decodeUnknownEffect(WalkInHistoryEvent)({
            from: event.fromState,
            to: event.toState,
            occurredAt: event.occurredAt
          }).pipe(
            Effect.mapError(
              () =>
                new CapabilityUnavailable({
                  capability: 'walk-ins',
                  reason: 'invalid-lifecycle-history'
                })
            )
          )
        )
      })
    const queue = (shopId: string) =>
      Effect.gen(function* () {
        const configuration = yield* configurationFor(shopId)
        const rows = yield* orUnavailable('walk-ins')(
          db
            .select()
            .from(walkInEntries)
            .where(
              and(
                eq(walkInEntries.shopId, shopId),
                inArray(walkInEntries.status, ['waiting', 'called', 'serving'])
              )
            )
            .orderBy(
              asc(walkInEntries.position),
              asc(walkInEntries.createdAt),
              asc(walkInEntries.id)
            )
        )
        return yield* Effect.forEach(rows, (row, index) =>
          Effect.gen(function* () {
            const request = yield* parseRequest(row.requestJson)
            const history = yield* histories(shopId, row.id)
            return {
              id: row.id,
              shopId: row.shopId,
              status: row.status,
              position: index + 1,
              projectedWaitMinutes: index * configuration.averageServiceMinutes,
              serviceId: request.serviceId,
              providerPreference: request.providerPreference,
              locale: request.locale,
              history
            } satisfies Entry
          })
        )
      })
    const findQueueEntry = (shopId: string, entryId: string) =>
      Effect.gen(function* () {
        const [row] = yield* orUnavailable('walk-ins')(
          db
            .select()
            .from(walkInEntries)
            .where(and(eq(walkInEntries.shopId, shopId), eq(walkInEntries.id, entryId)))
            .limit(1)
        )
        if (!row) return yield* Effect.fail(new WalkInEntryNotFound({ entryId }))
        const request = yield* parseRequest(row.requestJson)
        return {
          id: row.id,
          shopId: row.shopId,
          status: row.status,
          position: row.position,
          projectedWaitMinutes: 0,
          serviceId: request.serviceId,
          providerPreference: request.providerPreference,
          locale: request.locale,
          history: yield* histories(shopId, row.id)
        } satisfies Entry
      })
    const findById: WalkInsShape['findById'] = ({ shopId, entryId }) =>
      Effect.map(findQueueEntry(shopId, entryId), (entry) => ({
        id: entry.id,
        shopId: entry.shopId,
        status: entry.status,
        position: entry.position
      }))
    const service: WalkInsShape = {
      findById,
      queue,
      overview: (shopId) =>
        Effect.gen(function* () {
          const configuration = yield* configurationFor(shopId)
          const eligibleServices =
            configuration.eligibleServiceIds.length === 0
              ? []
              : yield* orUnavailable('walk-ins')(
                  db
                    .select({ id: services.id, name: services.name })
                    .from(shopServices)
                    .innerJoin(services, eq(shopServices.serviceId, services.id))
                    .where(
                      and(
                        eq(shopServices.shopId, shopId),
                        eq(services.status, 'active'),
                        inArray(services.id, configuration.eligibleServiceIds)
                      )
                    )
                    .orderBy(asc(services.name), asc(services.id))
                )
          const eligibleProviders =
            configuration.eligibleProviderIds.length === 0
              ? []
              : yield* orUnavailable('walk-ins')(
                  db
                    .select({ id: providers.id, name: providers.displayName })
                    .from(shopProviders)
                    .innerJoin(providers, eq(shopProviders.providerId, providers.id))
                    .where(
                      and(
                        eq(shopProviders.shopId, shopId),
                        eq(providers.status, 'active'),
                        inArray(providers.id, configuration.eligibleProviderIds)
                      )
                    )
                    .orderBy(asc(providers.displayName), asc(providers.id))
                )
          return {
            state: configuration.open ? ('open' as const) : ('closed' as const),
            services: eligibleServices,
            providers: eligibleProviders,
            queue: yield* queue(shopId)
          }
        }),
      inspect: ({ shopId, entryId, capability }) =>
        Effect.gen(function* () {
          const candidateHash = yield* Effect.promise(() => hashSha256(capability))
          const [grant] = yield* orUnavailable('walk-ins')(
            db
              .select()
              .from(protectedAccessGrants)
              .where(
                and(
                  eq(protectedAccessGrants.shopId, shopId),
                  eq(protectedAccessGrants.resourceType, 'walk-in-entry'),
                  eq(protectedAccessGrants.resourceId, entryId),
                  eq(protectedAccessGrants.capabilityHash, candidateHash)
                )
              )
              .limit(1)
          )
          if (!grant || Date.parse(grant.expiresAt) <= Date.now())
            return yield* Effect.fail(new WalkInEntryNotFound({ entryId }))
          const entries = yield* queue(shopId)
          const queued = entries.find((candidate) => candidate.id === entryId)
          const entry = queued ?? (yield* findQueueEntry(shopId, entryId))
          if (entry.shopId !== shopId)
            return yield* Effect.fail(new WalkInEntryNotFound({ entryId }))
          return entry
        }),
      enroll: (enrollment) =>
        Effect.gen(function* () {
          const configuration = yield* configurationFor(enrollment.shopId)
          const enrollmentOptions = yield* service.overview(enrollment.shopId)
          if (enrollmentOptions.state === 'closed')
            return yield* Effect.fail(new WalkInsClosed({ shopId: enrollment.shopId }))
          if (!enrollmentOptions.services.some(({ id }) => id === enrollment.serviceId))
            return yield* Effect.fail(
              new WalkInUnavailable({
                shopId: enrollment.shopId,
                reason: 'service-ineligible'
              })
            )
          if (enrollment.providerPreference.kind === 'specific') {
            const providerId = enrollment.providerPreference.providerId
            if (!enrollmentOptions.providers.some(({ id }) => id === providerId))
              return yield* Effect.fail(
                new WalkInUnavailable({
                  shopId: enrollment.shopId,
                  reason: 'provider-ineligible'
                })
              )
          }
          const current = yield* queue(enrollment.shopId)
          const key = contactKey(enrollment)
          const rows = yield* orUnavailable('walk-ins')(
            db
              .select({
                id: walkInEntries.id,
                contactKey: walkInEntries.contactKey,
                requestJson: walkInEntries.requestJson
              })
              .from(walkInEntries)
              .where(
                and(
                  eq(walkInEntries.shopId, enrollment.shopId),
                  inArray(walkInEntries.status, ['waiting', 'called', 'serving'])
                )
              )
          )
          const contacts = yield* Effect.forEach(rows, (row) =>
            row.contactKey
              ? Effect.succeed({ id: row.id, contactKey: row.contactKey })
              : Effect.map(parseRequest(row.requestJson), (request) => ({
                  id: row.id,
                  contactKey: request.contactKey
                }))
          )
          const duplicate = contacts.find((row) => row.contactKey === key)
          if (duplicate)
            return yield* Effect.fail(
              new WalkInDuplicate({ shopId: enrollment.shopId, entryId: duplicate.id })
            )
          const now = new Date().toISOString()
          const id = newCapabilityId('wie')
          const capability = randomHex(32)
          const expiresAt = new Date(
            Date.parse(now) + configuration.acknowledgmentTtlMinutes * 60_000
          ).toISOString()
          const entryExpiresAt = new Date(
            Date.parse(now) + configuration.entryTtlMinutes * 60_000
          ).toISOString()
          const grantId = newCapabilityId('pag')
          const intentId = newCapabilityId('nti')
          const historyId = newCapabilityId('lch')
          const request: StoredRequest = {
            serviceId: enrollment.serviceId,
            providerPreference: enrollment.providerPreference,
            locale: enrollment.locale,
            contactKey: key
          }
          const committed = yield* Effect.result(
            batch(db, [
              db.insert(walkInEntries).values({
                id,
                shopId: enrollment.shopId,
                status: 'waiting',
                position: current.length + 1,
                contactKey: key,
                requestJson: JSON.stringify(request),
                customerSnapshotJson: JSON.stringify(enrollment.customerDetails),
                expiresAt: entryExpiresAt,
                createdAt: now,
                updatedAt: now
              }),
              db.insert(lifecycleHistory).values({
                id: historyId,
                aggregateType: 'walk-in-entry',
                aggregateId: id,
                fromState: null,
                toState: 'waiting',
                factsJson: '{}',
                occurredAt: now,
                createdAt: now
              }),
              db.insert(protectedAccessGrants).values({
                id: grantId,
                shopId: enrollment.shopId,
                purpose: 'walk-in-acknowledgment',
                resourceType: 'walk-in-entry',
                resourceId: id,
                capabilityHash: yield* Effect.promise(() => hashSha256(capability)),
                expiresAt,
                createdAt: now
              }),
              db.insert(notificationIntents).values({
                id: intentId,
                shopId: enrollment.shopId,
                topic: 'walk-in.enrolled',
                recipientJson: JSON.stringify(enrollment.customerDetails),
                payloadJson: JSON.stringify({ entryId: id, locale: enrollment.locale }),
                sourceType: 'walk-in-entry',
                sourceId: id,
                deduplicationKey: `walk-in.enrolled:${id}`,
                status: 'pending',
                availableAt: now,
                createdAt: now,
                updatedAt: now
              })
            ])
          )
          if (committed._tag === 'Failure') {
            const [racingDuplicate] = yield* orUnavailable('walk-ins')(
              db
                .select({ id: walkInEntries.id })
                .from(walkInEntries)
                .where(
                  and(
                    eq(walkInEntries.shopId, enrollment.shopId),
                    eq(walkInEntries.contactKey, key),
                    inArray(walkInEntries.status, ['waiting', 'called', 'serving'])
                  )
                )
                .limit(1)
            )
            if (racingDuplicate)
              return yield* Effect.fail(
                new WalkInDuplicate({
                  shopId: enrollment.shopId,
                  entryId: racingDuplicate.id
                })
              )
            return yield* Effect.fail(
              new CapabilityUnavailable({
                capability: 'walk-ins',
                reason: committed.failure.reason
              })
            )
          }
          return {
            entry: yield* findQueueEntry(enrollment.shopId, id),
            acknowledgment: { capability, expiresAt },
            notificationIntent: {
              id: intentId,
              topic: 'walk-in.enrolled' as const,
              sourceId: id
            }
          }
        }),
      transition: ({ shopId, entryId, to }) =>
        Effect.gen(function* () {
          const entry = yield* findQueueEntry(shopId, entryId)
          if (entry.shopId !== shopId)
            return yield* Effect.fail(new WalkInEntryNotFound({ entryId }))
          if (!transitions[entry.status].includes(to))
            return yield* Effect.fail(
              new WalkInTransitionRejected({ entryId, from: entry.status, to })
            )
          const now = new Date().toISOString()
          const intentId = newCapabilityId('nti')
          const [stored] = yield* orUnavailable('walk-ins')(
            db
              .select({ customerSnapshotJson: walkInEntries.customerSnapshotJson })
              .from(walkInEntries)
              .where(
                and(eq(walkInEntries.id, entryId), eq(walkInEntries.shopId, shopId))
              )
              .limit(1)
          )
          const historyId = newCapabilityId('lch')
          const raw = db.$client.config.db
          const committed = yield* Effect.result(
            Effect.tryPromise({
              try: () =>
                raw.batch([
                  raw
                    .prepare(
                      'UPDATE walk_in_entries SET status = ?, updated_at = ? WHERE id = ? AND shop_id = ? AND status = ?'
                    )
                    .bind(to, now, entryId, shopId, entry.status),
                  raw
                    .prepare(
                      "INSERT INTO lifecycle_history (id, aggregate_type, aggregate_id, from_state, to_state, facts_json, occurred_at, created_at) SELECT ?, 'walk-in-entry', ?, ?, ?, '{}', ?, ? WHERE changes() = 1"
                    )
                    .bind(historyId, entryId, entry.status, to, now, now),
                  raw
                    .prepare(
                      "INSERT INTO notification_intents (id, shop_id, topic, recipient_json, payload_json, source_type, source_id, deduplication_key, status, available_at, created_at, updated_at) SELECT ?, ?, ?, ?, ?, 'walk-in-entry', ?, ?, 'pending', ?, ?, ? WHERE changes() = 1"
                    )
                    .bind(
                      intentId,
                      shopId,
                      `walk-in.${to}`,
                      stored?.customerSnapshotJson ?? '{}',
                      JSON.stringify({ entryId }),
                      entryId,
                      `walk-in.${to}:${entryId}:${historyId}`,
                      now,
                      now,
                      now
                    )
                ]),
              catch: (cause) =>
                new CapabilityUnavailable({
                  capability: 'walk-ins',
                  reason: cause instanceof Error ? cause.message : String(cause)
                })
            })
          )
          if (committed._tag === 'Failure') return yield* Effect.fail(committed.failure)
          if (committed.success[0]?.meta.changes !== 1)
            return yield* Effect.fail(
              new WalkInTransitionRejected({ entryId, from: entry.status, to })
            )
          return {
            entry: yield* findQueueEntry(shopId, entryId),
            notificationIntent: {
              id: intentId,
              topic: `walk-in.${to}`,
              sourceId: entryId
            }
          }
        }),
      expireEntries: ({ shopId, now: at }) =>
        Effect.gen(function* () {
          const due = yield* orUnavailable('walk-ins')(
            db
              .select({ entryId: walkInEntries.id })
              .from(walkInEntries)
              .where(
                and(
                  eq(walkInEntries.shopId, shopId),
                  inArray(walkInEntries.status, ['waiting', 'called', 'serving']),
                  sql`${walkInEntries.expiresAt} IS NOT NULL`,
                  sql`${walkInEntries.expiresAt} <= ${at}`
                )
              )
          )
          const expired = yield* Effect.forEach(
            due,
            ({ entryId }) => service.transition({ shopId, entryId, to: 'expired' }),
            { concurrency: 1 }
          )
          return expired.map((result) => result.entry)
        })
    }
    return service
  })
)
