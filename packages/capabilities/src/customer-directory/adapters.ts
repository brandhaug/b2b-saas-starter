import { Effect, Layer } from 'effect'
import { Database, customerDirectoryStates } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
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

const hydrate = (rows: readonly (typeof customerDirectoryStates.$inferSelect)[]) => {
  const store = emptySeedCustomerDirectoryStore()
  for (const row of rows) {
    for (const record of row.stateJson.records as CustomerRecord[])
      store.records.set(record.id, record)
    for (const command of row.stateJson.commands) store.commands.set(...command)
    for (const file of row.stateJson.imports) store.imports.add(file)
  }
  return store
}

const stateFor = (store: SeedCustomerDirectoryStore, merchantId: string): State => ({
  records: [...store.records.values()].filter(
    (record) => record.merchantId === merchantId
  ),
  commands: [...store.commands.entries()].filter(([key]) =>
    key.startsWith(`${merchantId}:`)
  ),
  imports: [...store.imports].filter((key) => key.startsWith(`${merchantId}:`))
})

export const LiveCustomerDirectory: Layer.Layer<CustomerDirectory, never, Database> =
  Layer.effect(
    CustomerDirectory,
    Effect.gen(function* () {
      const db = yield* Database
      const rows = yield* orUnavailable('customer-directory')(
        db.select().from(customerDirectoryStates)
      ).pipe(Effect.orDie)
      const store = hydrate(rows)
      const seed = yield* Effect.provide(
        CustomerDirectory,
        SeedCustomerDirectory(store)
      )
      const persist = (merchantId: string, now: string) =>
        orUnavailable('customer-directory')(
          db
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
                revision:
                  (rows.find((row) => row.merchantId === merchantId)?.revision ?? 0) +
                  1,
                updatedAt: now
              }
            })
        )
      const write = <A, E>(effect: Effect.Effect<A, E, MerchantContext>, now: string) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const result = yield* effect
          yield* persist(merchant.id, now)
          return result
        })
      return {
        ...seed,
        matchOrCreate: (input) => write(seed.matchOrCreate(input), input.now),
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
        importRows: (input) => write(seed.importRows(input), input.now),
        eraseExpired: (input) => write(seed.eraseExpired(input), input.now)
      } satisfies CustomerDirectoryShape
    })
  )

export type CustomerDirectoryPersistenceError = CapabilityUnavailable
