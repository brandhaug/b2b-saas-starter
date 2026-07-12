import { Effect, Layer } from 'effect'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  batch,
  Database,
  lifecycleHistory,
  notificationIntents,
  protectedAccessGrants,
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
  WalkIns,
  WalkInsClosed,
  WalkInTransitionRejected,
  WalkInUnavailable,
  type WalkInConfiguration,
  type WalkInEnrollment,
  type WalkInStatus,
  type WalkInsShape
} from './index.ts'

type Entry = typeof import('./index.ts').WalkInQueueEntry.Type
type LegacyEntry = typeof import('./index.ts').WalkInEntry.Type
type SeedOptions = {
  readonly records?: readonly (Entry | LegacyEntry)[]
  readonly configurations?: readonly WalkInConfiguration[]
  readonly now?: () => string
}
type Stored = {
  entry: Entry
  contactKey: string
  capability: string
  expiresAt: string
}

const active = new Set<WalkInStatus>(['waiting', 'called', 'serving'])
const transitions: Readonly<Record<WalkInStatus, readonly WalkInStatus[]>> = {
  waiting: ['called', 'removed', 'expired'],
  called: ['serving', 'waiting', 'removed', 'expired'],
  serving: ['served', 'removed'],
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
    expiresAt: new Date(Date.parse(now()) + 60 * 60_000).toISOString()
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
    findById: (entryId) =>
      Effect.map(find(entryId), ({ entry }) => ({
        id: entry.id,
        shopId: entry.shopId,
        status: entry.status,
        position: entry.position
      })),
    queue,
    inspect: ({ shopId, entryId, capability }) =>
      Effect.flatMap(find(entryId, shopId), (stored) =>
        stored.capability === capability &&
        Date.parse(stored.expiresAt) > Date.parse(now())
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
      records.push({ entry, contactKey: key, capability, expiresAt })
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
      })
  })
}

const decodeConfiguration = (
  shopId: string,
  value: unknown
): WalkInConfiguration | null => {
  if (!value || typeof value !== 'object') return null
  const walkIns = (value as { walkIns?: unknown }).walkIns
  if (!walkIns || typeof walkIns !== 'object') return null
  const config = walkIns as Record<string, unknown>
  return {
    shopId,
    open: config.open === true,
    eligibleServiceIds: Array.isArray(config.eligibleServiceIds)
      ? config.eligibleServiceIds.filter((id): id is string => typeof id === 'string')
      : [],
    eligibleProviderIds: Array.isArray(config.eligibleProviderIds)
      ? config.eligibleProviderIds.filter((id): id is string => typeof id === 'string')
      : [],
    averageServiceMinutes:
      typeof config.averageServiceMinutes === 'number' &&
      config.averageServiceMinutes > 0
        ? config.averageServiceMinutes
        : 15,
    acknowledgmentTtlMinutes:
      typeof config.acknowledgmentTtlMinutes === 'number' &&
      config.acknowledgmentTtlMinutes > 0
        ? config.acknowledgmentTtlMinutes
        : 60
  }
}

type StoredRequest = {
  readonly serviceId: string
  readonly providerPreference: WalkInEnrollment['providerPreference']
  readonly locale: string
  readonly contactKey: string
}
const parseRequest = (value: string): StoredRequest => {
  try {
    const parsed = JSON.parse(value) as Partial<StoredRequest>
    return {
      serviceId: parsed.serviceId ?? '',
      providerPreference: parsed.providerPreference ?? { kind: 'any' },
      locale: parsed.locale ?? 'en',
      contactKey: parsed.contactKey ?? ''
    }
  } catch {
    return {
      serviceId: '',
      providerPreference: { kind: 'any' },
      locale: 'en',
      contactKey: ''
    }
  }
}

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
        ([shop]) => {
          const configuration = decodeConfiguration(shopId, shop?.bookingConfigJson)
          return configuration
            ? Effect.succeed(configuration)
            : Effect.fail(new WalkInUnavailable({ shopId, reason: 'not-configured' }))
        }
      )
    const histories = (entryId: string) =>
      Effect.map(
        orUnavailable('walk-ins')(
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
        ),
        (events) =>
          events.map((event) => ({
            from: event.fromState as WalkInStatus | null,
            to: event.toState as WalkInStatus,
            occurredAt: event.occurredAt
          }))
      )
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
            .orderBy(asc(walkInEntries.position), asc(walkInEntries.createdAt))
        )
        return yield* Effect.forEach(rows, (row, index) =>
          Effect.map(histories(row.id), (history): Entry => {
            const request = parseRequest(row.requestJson)
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
            }
          })
        )
      })
    const findQueueEntry = (entryId: string) =>
      Effect.gen(function* () {
        const [row] = yield* orUnavailable('walk-ins')(
          db.select().from(walkInEntries).where(eq(walkInEntries.id, entryId)).limit(1)
        )
        if (!row) return yield* Effect.fail(new WalkInEntryNotFound({ entryId }))
        const request = parseRequest(row.requestJson)
        return {
          id: row.id,
          shopId: row.shopId,
          status: row.status,
          position: row.position,
          projectedWaitMinutes: 0,
          serviceId: request.serviceId,
          providerPreference: request.providerPreference,
          locale: request.locale,
          history: yield* histories(row.id)
        } satisfies Entry
      })
    const findById: WalkInsShape['findById'] = (entryId) =>
      Effect.map(findQueueEntry(entryId), (entry) => ({
        id: entry.id,
        shopId: entry.shopId,
        status: entry.status,
        position: entry.position
      }))
    const service: WalkInsShape = {
      findById,
      queue,
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
          const entry = yield* findQueueEntry(entryId)
          if (entry.shopId !== shopId)
            return yield* Effect.fail(new WalkInEntryNotFound({ entryId }))
          return entry
        }),
      enroll: (enrollment) =>
        Effect.gen(function* () {
          const configuration = yield* configurationFor(enrollment.shopId)
          if (!configuration.open)
            return yield* Effect.fail(new WalkInsClosed({ shopId: enrollment.shopId }))
          if (!configuration.eligibleServiceIds.includes(enrollment.serviceId))
            return yield* Effect.fail(
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
            return yield* Effect.fail(
              new WalkInUnavailable({
                shopId: enrollment.shopId,
                reason: 'provider-ineligible'
              })
            )
          const current = yield* queue(enrollment.shopId)
          const key = contactKey(enrollment)
          const rows = yield* orUnavailable('walk-ins')(
            db
              .select({ id: walkInEntries.id, requestJson: walkInEntries.requestJson })
              .from(walkInEntries)
              .where(
                and(
                  eq(walkInEntries.shopId, enrollment.shopId),
                  inArray(walkInEntries.status, ['waiting', 'called', 'serving'])
                )
              )
          )
          const duplicate = rows.find(
            (row) => parseRequest(row.requestJson).contactKey === key
          )
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
                requestJson: JSON.stringify(request),
                customerSnapshotJson: JSON.stringify(enrollment.customerDetails),
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
          if (committed._tag === 'Failure')
            return yield* Effect.fail(
              new CapabilityUnavailable({
                capability: 'walk-ins',
                reason: committed.failure.reason
              })
            )
          return {
            entry: yield* findQueueEntry(id),
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
          const entry = yield* findQueueEntry(entryId)
          if (entry.shopId !== shopId)
            return yield* Effect.fail(new WalkInEntryNotFound({ entryId }))
          if (!transitions[entry.status].includes(to))
            return yield* Effect.fail(
              new WalkInTransitionRejected({ entryId, from: entry.status, to })
            )
          const now = new Date().toISOString()
          const intentId = newCapabilityId('nti')
          const committed = yield* Effect.result(
            batch(db, [
              db
                .update(walkInEntries)
                .set({ status: to, updatedAt: now })
                .where(
                  and(
                    eq(walkInEntries.id, entryId),
                    eq(walkInEntries.shopId, shopId),
                    eq(walkInEntries.status, entry.status)
                  )
                ),
              db.insert(lifecycleHistory).values({
                id: newCapabilityId('lch'),
                aggregateType: 'walk-in-entry',
                aggregateId: entryId,
                fromState: entry.status,
                toState: to,
                factsJson: '{}',
                occurredAt: now,
                createdAt: now
              }),
              db.insert(notificationIntents).values({
                id: intentId,
                shopId,
                topic: `walk-in.${to}`,
                recipientJson: '{}',
                payloadJson: JSON.stringify({ entryId }),
                sourceType: 'walk-in-entry',
                sourceId: entryId,
                deduplicationKey: `walk-in.${to}:${entryId}`,
                status: 'pending',
                availableAt: now,
                createdAt: now,
                updatedAt: now
              })
            ])
          )
          if (committed._tag === 'Failure')
            return yield* Effect.fail(
              new CapabilityUnavailable({
                capability: 'walk-ins',
                reason: committed.failure.reason
              })
            )
          return {
            entry: yield* findQueueEntry(entryId),
            notificationIntent: {
              id: intentId,
              topic: `walk-in.${to}`,
              sourceId: entryId
            }
          }
        })
    }
    return service
  })
)
