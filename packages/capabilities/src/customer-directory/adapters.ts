import { Effect, Layer, Schema } from 'effect'
import { and, eq, inArray, or } from 'drizzle-orm'
import {
  Database,
  appointmentFoundations,
  batch,
  customerBans,
  customerContacts,
  customerDirectoryStates,
  customerDirectoryHistory,
  customerDuplicateSuggestions,
  customerObservations,
  customerRecords,
  type BatchStatement
} from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { CapabilityConflict, CapabilityUnavailable } from '../errors.ts'
import { hashSha256 } from '../internal/crypto.ts'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import {
  CustomerDirectory,
  emptyCustomerDirectoryState,
  makeCustomerDirectoryService,
  ConsentEvidenceSchema,
  CustomerHistorySchema,
  CustomerObservationSchema,
  MerchantNoteSchema,
  type CustomerDirectoryState,
  type CustomerDirectoryShape,
  type CustomerRecord,
  type StoredCustomerDirectoryCommand
} from './customer-directory.ts'

type RecordSupplement = Pick<
  CustomerRecord,
  'id' | 'merchantId' | 'notes' | 'consent' | 'observations'
>

const RecordSupplementSchema = Schema.Struct({
  id: Schema.String,
  merchantId: Schema.String,
  notes: Schema.Array(MerchantNoteSchema),
  consent: Schema.Array(ConsentEvidenceSchema),
  observations: Schema.Array(CustomerObservationSchema)
})
const StoredCommandResultSchema = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('record'), recordId: Schema.String }),
  Schema.Struct({
    _tag: Schema.Literal('split'),
    sourceId: Schema.String,
    createdId: Schema.String
  }),
  Schema.Struct({
    _tag: Schema.Literal('import'),
    created: Schema.Number,
    matched: Schema.Number,
    rejected: Schema.Number
  }),
  Schema.Struct({ _tag: Schema.Literal('count'), value: Schema.Number })
])
const PersistedStateSchema = Schema.Struct({
  records: Schema.Array(RecordSupplementSchema),
  commands: Schema.Array(
    Schema.Tuple([
      Schema.String,
      Schema.Struct({
        fingerprint: Schema.String,
        result: StoredCommandResultSchema
      })
    ])
  ),
  imports: Schema.Array(Schema.String)
})
type State = (typeof customerDirectoryStates.$inferSelect)['stateJson']

type MemoryState = {
  readonly records: readonly CustomerRecord[]
  readonly commands: readonly (readonly [string, StoredCustomerDirectoryCommand])[]
  readonly imports: readonly string[]
}

const supplementFor = (record: CustomerRecord): RecordSupplement => ({
  id: record.id,
  merchantId: record.merchantId,
  notes: record.notes,
  consent: record.consent,
  observations: record.observations.filter(
    (observation) => observation.appointmentId === null
  )
})

const stateFor = (
  store: CustomerDirectoryState,
  merchantId: string,
  persistedSupplements: ReadonlyMap<string, RecordSupplement>
): State => {
  const records = new Map(persistedSupplements)
  for (const record of store.records.values())
    if (record.merchantId === merchantId) records.set(record.id, supplementFor(record))
  return {
    records: [...records.values()],
    commands: [...store.commands.entries()].filter(([key]) =>
      key.startsWith(`${merchantId}:`)
    ),
    imports: [...store.imports].filter((key) => key.startsWith(`${merchantId}:`))
  }
}

const memoryStateFor = (
  store: CustomerDirectoryState,
  merchantId: string
): MemoryState => ({
  records: [...store.records.values()].filter(
    (record) => record.merchantId === merchantId
  ),
  commands: [...store.commands.entries()].filter(([key]) =>
    key.startsWith(`${merchantId}:`)
  ),
  imports: [...store.imports].filter((key) => key.startsWith(`${merchantId}:`))
})

const clearMerchantState = (store: CustomerDirectoryState, merchantId: string) => {
  for (const [id, record] of store.records)
    if (record.merchantId === merchantId) store.records.delete(id)
  for (const key of store.commands.keys())
    if (key.startsWith(`${merchantId}:`)) store.commands.delete(key)
  for (const key of store.imports)
    if (key.startsWith(`${merchantId}:`)) store.imports.delete(key)
}

const restoreMemory = (
  store: CustomerDirectoryState,
  merchantId: string,
  state: MemoryState
) => {
  clearMerchantState(store, merchantId)
  for (const record of state.records) store.records.set(record.id, record)
  for (const command of state.commands) store.commands.set(...command)
  for (const file of state.imports) store.imports.add(file)
}

const groupByRecord = <T extends { readonly customerRecordId: string }>(
  rows: readonly T[]
) => {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const current = grouped.get(row.customerRecordId) ?? []
    current.push(row)
    grouped.set(row.customerRecordId, current)
  }
  return grouped
}

export const LiveCustomerDirectory: Layer.Layer<CustomerDirectory, never, Database> =
  Layer.effect(
    CustomerDirectory,
    Effect.gen(function* () {
      const db = yield* Database
      const store = emptyCustomerDirectoryState()
      const observedRevisions = new Map<string, number>()
      const persistedSupplements = new Map<string, RecordSupplement>()
      const directory = makeCustomerDirectoryService(store)
      const ensure = (merchantId: string, recordIds?: readonly string[]) =>
        Effect.gen(function* () {
          const recordWhere = recordIds?.length
            ? and(
                eq(customerRecords.merchantId, merchantId),
                inArray(customerRecords.id, recordIds)
              )
            : eq(customerRecords.merchantId, merchantId)
          const contactWhere = recordIds?.length
            ? and(
                eq(customerContacts.merchantId, merchantId),
                inArray(customerContacts.customerRecordId, recordIds)
              )
            : eq(customerContacts.merchantId, merchantId)
          const observationWhere = recordIds?.length
            ? and(
                eq(customerObservations.merchantId, merchantId),
                inArray(customerObservations.customerRecordId, recordIds)
              )
            : eq(customerObservations.merchantId, merchantId)
          const banWhere = recordIds?.length
            ? and(
                eq(customerBans.merchantId, merchantId),
                inArray(customerBans.customerRecordId, recordIds)
              )
            : eq(customerBans.merchantId, merchantId)
          const historyWhere = recordIds?.length
            ? and(
                eq(customerDirectoryHistory.merchantId, merchantId),
                inArray(customerDirectoryHistory.customerRecordId, recordIds)
              )
            : eq(customerDirectoryHistory.merchantId, merchantId)
          const duplicateWhere = recordIds?.length
            ? and(
                eq(customerDuplicateSuggestions.merchantId, merchantId),
                or(
                  inArray(customerDuplicateSuggestions.customerRecordId, recordIds),
                  inArray(customerDuplicateSuggestions.possibleDuplicateId, recordIds)
                )
              )
            : eq(customerDuplicateSuggestions.merchantId, merchantId)
          const [states, records, contacts, observations, bans, histories, duplicates] =
            yield* Effect.all([
              orUnavailable('customer-directory')(
                db
                  .select()
                  .from(customerDirectoryStates)
                  .where(eq(customerDirectoryStates.merchantId, merchantId))
              ),
              orUnavailable('customer-directory')(
                db.select().from(customerRecords).where(recordWhere)
              ),
              orUnavailable('customer-directory')(
                db.select().from(customerContacts).where(contactWhere)
              ),
              orUnavailable('customer-directory')(
                db.select().from(customerObservations).where(observationWhere)
              ),
              orUnavailable('customer-directory')(
                db.select().from(customerBans).where(banWhere)
              ),
              orUnavailable('customer-directory')(
                db.select().from(customerDirectoryHistory).where(historyWhere)
              ),
              orUnavailable('customer-directory')(
                db.select().from(customerDuplicateSuggestions).where(duplicateWhere)
              )
            ])
          const state = yield* Schema.decodeUnknownEffect(PersistedStateSchema)(
            states[0]?.stateJson ?? { records: [], commands: [], imports: [] }
          ).pipe(
            Effect.mapError(
              () =>
                new CapabilityUnavailable({
                  capability: 'customer-directory',
                  reason: 'persisted state is invalid'
                })
            )
          )
          observedRevisions.set(merchantId, states[0]?.revision ?? 0)
          clearMerchantState(store, merchantId)
          for (const command of state.commands)
            store.commands.set(command[0], command[1])
          for (const file of state.imports) store.imports.add(file)
          const supplements = new Map(
            state.records.map((record) => [record.id, record] as const)
          )
          persistedSupplements.clear()
          for (const [id, supplement] of supplements)
            persistedSupplements.set(id, supplement)
          const contactsByRecord = groupByRecord(contacts)
          const observationsByRecord = groupByRecord(observations)
          const bansByRecord = groupByRecord(bans)
          const historyByRecord = groupByRecord(histories)
          const duplicatesByRecord = groupByRecord(duplicates)
          for (const row of records) {
            const supplement = supplements.get(row.id)
            const recordContacts = (contactsByRecord.get(row.id) ?? []).map(
              (contact) => ({
                kind: contact.kind,
                value: contact.normalizedValue,
                status:
                  contact.status === 'erased'
                    ? ('superseded' as const)
                    : contact.status,
                preferred: contact.isPreferred
              })
            )
            const recordObservations = (observationsByRecord.get(row.id) ?? []).map(
              (observation) => ({
                id: observation.id,
                appointmentId: observation.appointmentId,
                details: {
                  name: observation.name,
                  email: observation.normalizedEmail,
                  phone: observation.normalizedPhone
                },
                observedAt: observation.observedAt,
                source: 'appointment' as const
              })
            )
            const observationIds = new Set(
              supplement?.observations.map((observation) => observation.id) ?? []
            )
            const relationalHistory = yield* Effect.forEach(
              historyByRecord.get(row.id) ?? [],
              (entry) =>
                Schema.decodeUnknownEffect(CustomerHistorySchema)({
                  id: entry.id,
                  kind: entry.kind,
                  actorId: entry.actorId,
                  impersonatedBy: entry.impersonatedBy,
                  reason: entry.reason,
                  at: entry.occurredAt,
                  revision: entry.revision
                }).pipe(
                  Effect.mapError(
                    () =>
                      new CapabilityUnavailable({
                        capability: 'customer-directory',
                        reason: 'persisted history is invalid'
                      })
                  )
                )
            )
            store.records.set(row.id, {
              id: row.id,
              merchantId,
              status: row.mergedInto
                ? 'merged'
                : row.status === 'erased'
                  ? 'erased'
                  : row.status === 'quarantined'
                    ? 'archived'
                    : 'active',
              displayName: row.displayName,
              preferredEmail:
                recordContacts.find(
                  (contact) => contact.kind === 'email' && contact.preferred
                )?.value ?? null,
              preferredPhone:
                recordContacts.find(
                  (contact) => contact.kind === 'phone' && contact.preferred
                )?.value ?? null,
              contacts: recordContacts,
              observations: [
                ...(supplement?.observations ?? []),
                ...recordObservations.filter(
                  (observation) => !observationIds.has(observation.id)
                )
              ],
              notes: supplement?.notes ?? [],
              consent: supplement?.consent ?? [],
              ban: bansByRecord.get(row.id)?.[0] ?? null,
              possibleDuplicateOf: (duplicatesByRecord.get(row.id) ?? []).map(
                (item) => item.possibleDuplicateId
              ),
              mergedInto: row.mergedInto,
              revision: row.revision,
              lastActivityAt: row.lastActivityAt,
              history: relationalHistory.sort(
                (left, right) => left.revision - right.revision
              )
            })
          }
        })
      const persist = (
        merchantId: string,
        now: string,
        expectedRevision: number,
        before: MemoryState
      ) =>
        Effect.gen(function* () {
          const stateWrite = db
            .insert(customerDirectoryStates)
            .values({
              merchantId,
              stateJson: stateFor(store, merchantId, persistedSupplements),
              revision: 1,
              updatedAt: now
            })
            .onConflictDoUpdate({
              target: customerDirectoryStates.merchantId,
              set: {
                stateJson: stateFor(store, merchantId, persistedSupplements),
                revision: expectedRevision + 1,
                updatedAt: now
              }
            })
          const previousRecords = new Map(
            before.records.map((record) => [record.id, record])
          )
          const records = [...store.records.values()].filter(
            (record) =>
              record.merchantId === merchantId &&
              JSON.stringify(previousRecords.get(record.id)) !== JSON.stringify(record)
          )
          const changedIds = records.map((record) => record.id)
          const terminalIds = records
            .filter(
              (record) => record.status === 'merged' || record.status === 'erased'
            )
            .map((record) => record.id)
          const statements: BatchStatement[] = [stateWrite]
          if (changedIds.length > 0)
            statements.push(
              db
                .delete(customerDuplicateSuggestions)
                .where(
                  inArray(customerDuplicateSuggestions.customerRecordId, changedIds)
                ),
              ...records.flatMap((record) => [
                db
                  .delete(customerContacts)
                  .where(eq(customerContacts.customerRecordId, record.id)),
                db
                  .delete(customerBans)
                  .where(eq(customerBans.customerRecordId, record.id))
              ])
            )
          if (terminalIds.length > 0)
            statements.push(
              db
                .delete(customerDuplicateSuggestions)
                .where(
                  inArray(customerDuplicateSuggestions.possibleDuplicateId, terminalIds)
                )
            )
          for (const record of records) {
            statements.push(
              db
                .insert(customerRecords)
                .values({
                  id: record.id,
                  merchantId,
                  displayName: record.displayName,
                  status:
                    record.status === 'erased'
                      ? 'erased'
                      : record.status === 'archived'
                        ? 'quarantined'
                        : 'active',
                  preferredLocale: 'en',
                  mergedInto: record.mergedInto,
                  revision: record.revision,
                  lastActivityAt: record.lastActivityAt,
                  createdAt: now,
                  updatedAt: now
                })
                .onConflictDoUpdate({
                  target: customerRecords.id,
                  set: {
                    displayName: record.displayName,
                    mergedInto: record.mergedInto,
                    status:
                      record.status === 'erased'
                        ? 'erased'
                        : record.status === 'archived'
                          ? 'quarantined'
                          : 'active',
                    revision: record.revision,
                    lastActivityAt: record.lastActivityAt,
                    updatedAt: now
                  }
                })
            )
            for (const contact of record.contacts) {
              const contactDigest = yield* Effect.promise(() =>
                hashSha256(
                  `${merchantId}:${record.id}:${contact.kind}:${contact.value}`
                )
              )
              statements.push(
                db.insert(customerContacts).values({
                  id: `cuc_${contactDigest.slice(0, 32)}`,
                  customerRecordId: record.id,
                  merchantId,
                  kind: contact.kind,
                  normalizedValue: contact.value,
                  status: record.status === 'merged' ? 'superseded' : contact.status,
                  isPreferred: record.status === 'merged' ? false : contact.preferred,
                  createdAt: now,
                  updatedAt: now
                })
              )
            }
            if (record.ban)
              statements.push(
                db.insert(customerBans).values({
                  customerRecordId: record.id,
                  merchantId,
                  reason: record.ban.reason,
                  actorId: record.ban.actorId,
                  createdAt: record.ban.createdAt,
                  expiresAt: record.ban.expiresAt
                })
              )
            if (record.status !== 'merged' && record.status !== 'erased')
              for (const possibleDuplicateId of record.possibleDuplicateOf)
                statements.push(
                  db.insert(customerDuplicateSuggestions).values({
                    merchantId,
                    customerRecordId: record.id,
                    possibleDuplicateId,
                    createdAt: now
                  })
                )
            for (const history of record.history)
              statements.push(
                db
                  .insert(customerDirectoryHistory)
                  .values({
                    id: history.id,
                    merchantId,
                    customerRecordId: record.id,
                    kind: history.kind,
                    actorId: history.actorId,
                    impersonatedBy: history.impersonatedBy ?? null,
                    reason: history.reason,
                    revision: history.revision,
                    occurredAt: history.at
                  })
                  .onConflictDoNothing()
              )
            if (record.status !== 'merged')
              for (const observation of record.observations) {
                if (!observation.appointmentId) continue
                statements.push(
                  db
                    .update(customerObservations)
                    .set({
                      customerRecordId: record.id,
                      name: observation.details.name,
                      normalizedEmail: observation.details.email,
                      normalizedPhone: observation.details.phone
                    })
                    .where(eq(customerObservations.id, observation.id)),
                  db
                    .update(appointmentFoundations)
                    .set({ customerRecordId: record.id })
                    .where(
                      eq(
                        appointmentFoundations.appointmentId,
                        observation.appointmentId
                      )
                    )
                )
              }
          }
          yield* orUnavailable('customer-directory')(batch(db, statements))
        })
      const read = <A, E>(
        effect: Effect.Effect<A, E, MerchantContext>,
        recordIds?: readonly string[]
      ) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          yield* ensure(merchant.id, recordIds)
          return yield* effect
        })
      const write = <A, E>(
        effect: Effect.Effect<A, E, MerchantContext>,
        now: string,
        recordIds?: readonly string[]
      ) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          yield* ensure(merchant.id, recordIds)
          const before = memoryStateFor(store, merchant.id)
          const expectedRevision = observedRevisions.get(merchant.id) ?? 0
          const result = yield* effect
          const persisted = yield* Effect.result(
            persist(merchant.id, now, expectedRevision, before)
          )
          if (persisted._tag === 'Failure') {
            restoreMemory(store, merchant.id, before)
            if (persisted.failure.reason.includes('customer_directory_stale_revision'))
              return yield* Effect.fail(
                new CapabilityConflict({ reason: 'stale_revision' })
              )
            return yield* Effect.fail(persisted.failure)
          }
          return result
        })
      return {
        matchOrCreate: (input) => write(directory.matchOrCreate(input), input.now),
        checkPublicEligibility: (details, now) =>
          read(directory.checkPublicEligibility(details, now)),
        search: (query, options) => read(directory.search(query, options)),
        get: (id) => read(directory.get(id), [id]),
        editPreferred: (id, input) =>
          write(directory.editPreferred(id, input), input.now, [id]),
        addNote: (id, input) => write(directory.addNote(id, input), input.now, [id]),
        setContactStatus: (id, input) =>
          write(directory.setContactStatus(id, input), input.now, [id]),
        recordConsent: (id, input) =>
          write(directory.recordConsent(id, input), input.now, [id]),
        setBan: (id, input) => write(directory.setBan(id, input), input.now, [id]),
        liftBan: (id, input) => write(directory.liftBan(id, input), input.now, [id]),
        merge: (input) =>
          write(directory.merge(input), input.now, [
            input.survivorId,
            input.absorbedId
          ]),
        split: (input) => write(directory.split(input), input.now, [input.sourceId]),
        archive: (id, input) => write(directory.archive(id, input), input.now, [id]),
        previewImport: (rows) => read(directory.previewImport(rows)),
        importRows: (input) => write(directory.importRows(input), input.now),
        exportMinimized: () => read(directory.exportMinimized()),
        eraseExpired: (input) => write(directory.eraseExpired(input), input.now)
      } satisfies CustomerDirectoryShape
    })
  )
