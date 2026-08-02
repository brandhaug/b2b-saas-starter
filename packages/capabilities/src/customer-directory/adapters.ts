import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
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
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import {
  CustomerDirectory,
  SeedCustomerDirectory,
  emptySeedCustomerDirectoryStore,
  type CustomerDirectoryShape,
  type CustomerRecord,
  type SeedCustomerDirectoryStore
} from './customer-directory.ts'

type State = (typeof customerDirectoryStates.$inferSelect)['stateJson']

const stateFor = (store: SeedCustomerDirectoryStore, merchantId: string): State => ({
  records: [...store.records.values()].filter(
    (record) => record.merchantId === merchantId
  ),
  commands: [...store.commands.entries()].filter(([key]) =>
    key.startsWith(`${merchantId}:`)
  ),
  imports: [...store.imports].filter((key) => key.startsWith(`${merchantId}:`))
})

const restore = (
  store: SeedCustomerDirectoryStore,
  merchantId: string,
  state: State
) => {
  for (const [id, record] of store.records)
    if (record.merchantId === merchantId) store.records.delete(id)
  for (const key of store.commands.keys())
    if (key.startsWith(`${merchantId}:`)) store.commands.delete(key)
  for (const key of store.imports)
    if (key.startsWith(`${merchantId}:`)) store.imports.delete(key)
  for (const record of state.records as CustomerRecord[])
    store.records.set(record.id, record)
  for (const command of state.commands) store.commands.set(...command)
  for (const file of state.imports) store.imports.add(file)
}

export const LiveCustomerDirectory: Layer.Layer<CustomerDirectory, never, Database> =
  Layer.effect(
    CustomerDirectory,
    Effect.gen(function* () {
      const db = yield* Database
      const store = emptySeedCustomerDirectoryStore()
      const seed = yield* Effect.provide(
        CustomerDirectory,
        SeedCustomerDirectory(store)
      )
      const ensure = (merchantId: string) =>
        Effect.gen(function* () {
          const [states, records, contacts, observations, bans, histories, duplicates] =
            yield* Effect.all([
              orUnavailable('customer-directory')(
                db
                  .select()
                  .from(customerDirectoryStates)
                  .where(eq(customerDirectoryStates.merchantId, merchantId))
              ),
              orUnavailable('customer-directory')(
                db
                  .select()
                  .from(customerRecords)
                  .where(eq(customerRecords.merchantId, merchantId))
              ),
              orUnavailable('customer-directory')(
                db
                  .select()
                  .from(customerContacts)
                  .where(eq(customerContacts.merchantId, merchantId))
              ),
              orUnavailable('customer-directory')(
                db
                  .select()
                  .from(customerObservations)
                  .where(eq(customerObservations.merchantId, merchantId))
              ),
              orUnavailable('customer-directory')(
                db
                  .select()
                  .from(customerBans)
                  .where(eq(customerBans.merchantId, merchantId))
              ),
              orUnavailable('customer-directory')(
                db
                  .select()
                  .from(customerDirectoryHistory)
                  .where(eq(customerDirectoryHistory.merchantId, merchantId))
              ),
              orUnavailable('customer-directory')(
                db
                  .select()
                  .from(customerDuplicateSuggestions)
                  .where(eq(customerDuplicateSuggestions.merchantId, merchantId))
              )
            ])
          const state = states[0]?.stateJson
          restore(
            store,
            merchantId,
            state ?? { records: [], commands: [], imports: [] }
          )
          for (const row of records) {
            const persisted = store.records.get(row.id)
            const recordContacts = contacts
              .filter((contact) => contact.customerRecordId === row.id)
              .map((contact) => ({
                kind: contact.kind,
                value: contact.normalizedValue,
                status:
                  contact.status === 'erased'
                    ? ('superseded' as const)
                    : contact.status,
                preferred: contact.isPreferred
              }))
            const recordObservations = observations
              .filter((observation) => observation.customerRecordId === row.id)
              .map((observation) => ({
                id: observation.id,
                appointmentId: observation.appointmentId,
                details: {
                  name: observation.name,
                  email: observation.normalizedEmail,
                  phone: observation.normalizedPhone
                },
                observedAt: observation.observedAt,
                source: 'appointment' as const
              }))
            const observationIds = new Set(
              persisted?.observations.map((observation) => observation.id) ?? []
            )
            const persistedContactKeys = new Set(
              persisted?.contacts.map(
                (contact) => `${contact.kind}:${contact.value}:${contact.status}`
              ) ?? []
            )
            const persistedHistoryIds = new Set(
              persisted?.history.map((entry) => entry.id) ?? []
            )
            const relationalHistory = histories
              .filter((entry) => entry.customerRecordId === row.id)
              .filter((entry) => !persistedHistoryIds.has(entry.id))
              .map((entry) => ({
                id: entry.id,
                kind: entry.kind as CustomerRecord['history'][number]['kind'],
                actorId: entry.actorId,
                reason: entry.reason,
                at: entry.occurredAt,
                revision: entry.revision
              }))
            store.records.set(row.id, {
              ...persisted,
              id: row.id,
              merchantId,
              status:
                persisted?.status === 'merged'
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
              contacts: [
                ...(persisted?.contacts ?? []),
                ...recordContacts.filter(
                  (contact) =>
                    !persistedContactKeys.has(
                      `${contact.kind}:${contact.value}:${contact.status}`
                    )
                )
              ],
              observations: [
                ...(persisted?.observations ?? []),
                ...recordObservations.filter(
                  (observation) => !observationIds.has(observation.id)
                )
              ],
              notes: persisted?.notes ?? [],
              consent: persisted?.consent ?? [],
              ban: bans.find((ban) => ban.customerRecordId === row.id) ?? null,
              possibleDuplicateOf: [
                ...new Set([
                  ...(persisted?.possibleDuplicateOf ?? []),
                  ...duplicates
                    .filter((item) => item.customerRecordId === row.id)
                    .map((item) => item.possibleDuplicateId)
                ])
              ],
              mergedInto: persisted?.mergedInto ?? null,
              revision: row.revision,
              lastActivityAt: row.lastActivityAt,
              history: [...(persisted?.history ?? []), ...relationalHistory].sort(
                (left, right) => left.revision - right.revision
              )
            })
          }
        })
      const persist = (merchantId: string, now: string) =>
        Effect.gen(function* () {
          const current = yield* orUnavailable('customer-directory')(
            db
              .select({ revision: customerDirectoryStates.revision })
              .from(customerDirectoryStates)
              .where(eq(customerDirectoryStates.merchantId, merchantId))
          )
          const stateWrite = db
            .insert(customerDirectoryStates)
            .values({
              merchantId,
              stateJson: stateFor(store, merchantId),
              revision: 1,
              updatedAt: now
            })
            .onConflictDoUpdate({
              target: customerDirectoryStates.merchantId,
              set: {
                stateJson: stateFor(store, merchantId),
                revision: (current[0]?.revision ?? 0) + 1,
                updatedAt: now
              }
            })
          const records = [...store.records.values()].filter(
            (record) => record.merchantId === merchantId
          )
          const statements: BatchStatement[] = [stateWrite]
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
                  revision: record.revision,
                  lastActivityAt: record.lastActivityAt,
                  createdAt: now,
                  updatedAt: now
                })
                .onConflictDoUpdate({
                  target: customerRecords.id,
                  set: {
                    displayName: record.displayName,
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
                }),
              db
                .delete(customerContacts)
                .where(eq(customerContacts.customerRecordId, record.id)),
              db
                .delete(customerBans)
                .where(eq(customerBans.customerRecordId, record.id))
            )
            for (const contact of record.contacts)
              statements.push(
                db.insert(customerContacts).values({
                  id: `cuc_${record.id}_${contact.kind}_${contact.value}`,
                  customerRecordId: record.id,
                  merchantId,
                  kind: contact.kind,
                  normalizedValue: contact.value,
                  status: contact.status,
                  isPreferred: contact.preferred,
                  createdAt: now,
                  updatedAt: now
                })
              )
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
                    reason: history.reason,
                    revision: history.revision,
                    occurredAt: history.at
                  })
                  .onConflictDoNothing()
              )
            for (const observation of record.observations) {
              if (!observation.appointmentId) continue
              statements.push(
                db
                  .update(customerObservations)
                  .set({ customerRecordId: record.id })
                  .where(eq(customerObservations.id, observation.id)),
                db
                  .update(appointmentFoundations)
                  .set({ customerRecordId: record.id })
                  .where(
                    eq(appointmentFoundations.appointmentId, observation.appointmentId)
                  )
              )
            }
          }
          yield* orUnavailable('customer-directory')(batch(db, statements))
        })
      const read = <A, E>(effect: Effect.Effect<A, E, MerchantContext>) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          yield* ensure(merchant.id)
          return yield* effect
        })
      const write = <A, E>(effect: Effect.Effect<A, E, MerchantContext>, now: string) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          yield* ensure(merchant.id)
          const before = stateFor(store, merchant.id)
          const result = yield* effect
          const persisted = yield* Effect.result(persist(merchant.id, now))
          if (persisted._tag === 'Failure') {
            restore(store, merchant.id, before)
            return yield* Effect.fail(persisted.failure)
          }
          return result
        })
      return {
        matchOrCreate: (input) => write(seed.matchOrCreate(input), input.now),
        checkPublicEligibility: (details, now) =>
          read(seed.checkPublicEligibility(details, now)),
        search: (query) => read(seed.search(query)),
        get: (id) => read(seed.get(id)),
        editPreferred: (id, input) => write(seed.editPreferred(id, input), input.now),
        addNote: (id, input) => write(seed.addNote(id, input), input.now),
        setContactStatus: (id, input) =>
          write(seed.setContactStatus(id, input), input.now),
        recordConsent: (id, input) => write(seed.recordConsent(id, input), input.now),
        setBan: (id, input) => write(seed.setBan(id, input), input.now),
        liftBan: (id, input) => write(seed.liftBan(id, input), input.now),
        merge: (input) => write(seed.merge(input), input.now),
        split: (input) => write(seed.split(input), input.now),
        archive: (id, input) => write(seed.archive(id, input), input.now),
        previewImport: (rows) => read(seed.previewImport(rows)),
        importRows: (input) => write(seed.importRows(input), input.now),
        exportMinimized: () => read(seed.exportMinimized()),
        eraseExpired: (input) => write(seed.eraseExpired(input), input.now)
      } satisfies CustomerDirectoryShape
    })
  )
