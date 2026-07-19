import { Context, Effect, Layer, Schema } from 'effect'
import * as D1Client from '@effect/sql-d1/D1Client'
import * as SQLiteD1Drizzle from 'drizzle-orm/effect-d1'
import type { Query } from 'drizzle-orm'
import { createDb, type Database as PromiseDrizzleDatabase } from './client.ts'

export type EffectDatabase = SQLiteD1Drizzle.EffectSQLiteD1Database & {
  readonly $client: D1Client.D1Client
}

export class Database extends Context.Service<Database, EffectDatabase>()(
  '@b2b-saas-starter/db/Database'
) {}

export const layerFromDb = (db: EffectDatabase): Layer.Layer<Database> =>
  Layer.succeed(Database)(db)

export const layerFromD1 = (d1: D1Client.D1ClientConfig['db']): Layer.Layer<Database> =>
  Layer.effect(Database)(SQLiteD1Drizzle.makeWithDefaults({})).pipe(
    Layer.provide(D1Client.layer({ db: d1 })),
    Layer.orDie
  )

export const promiseDatabaseFromEffect = (db: EffectDatabase): PromiseDrizzleDatabase =>
  createDb(db.$client.config.db)

export class DbBatchError extends Schema.TaggedErrorClass<DbBatchError>()(
  'DbBatchError',
  { reason: Schema.String }
) {}

/**
 * A drizzle statement (insert/update/delete/select builder) that can be
 * compiled to SQL and executed as part of a D1 batch.
 */
export type BatchStatement = {
  readonly toSQL: () => Query
}

export type CompiledBatchQuery = Query
export type BatchQueryResult = {
  readonly meta: { readonly changes?: number | undefined }
}

/**
 * Executes multiple statements as a single atomic D1 batch (implicit
 * transaction — all statements commit or roll back together). The effect-d1
 * drizzle driver has no batch API, so this compiles the builders and runs them
 * through the raw `D1Database` binding held by the underlying `D1Client`.
 */
export const batch = (
  db: EffectDatabase,
  statements: readonly BatchStatement[]
): Effect.Effect<void, DbBatchError> =>
  Effect.tryPromise({
    try: async () => {
      const raw = db.$client.config.db
      await raw.batch(
        statements.map((statement) => {
          const query = statement.toSQL()
          return raw.prepare(query.sql).bind(...query.params)
        })
      )
    },
    catch: (cause) =>
      new DbBatchError({
        reason: cause instanceof Error ? cause.message : String(cause)
      })
  })

/**
 * Executes already-compiled conditional SQL inside the Database adapter and
 * returns D1 mutation metadata. Capability code uses this for atomic
 * INSERT-SELECT commands that Drizzle cannot express without dropping to SQL.
 */
export const batchQueries = (
  db: EffectDatabase,
  queries: readonly CompiledBatchQuery[]
): Effect.Effect<readonly BatchQueryResult[], DbBatchError> =>
  Effect.tryPromise({
    try: async () => {
      const raw = db.$client.config.db
      return raw.batch(
        queries.map((query) => raw.prepare(query.sql).bind(...query.params))
      )
    },
    catch: (cause) =>
      new DbBatchError({
        reason: cause instanceof Error ? cause.message : String(cause)
      })
  })
