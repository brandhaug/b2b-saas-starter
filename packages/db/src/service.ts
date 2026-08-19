import { Context, Effect, Layer, Schema } from 'effect'
import * as D1Client from '@effect/sql-d1/D1Client'
import * as SQLiteD1Drizzle from 'drizzle-orm/effect-d1'
import { type Query } from 'drizzle-orm'

export type EffectDatabase = SQLiteD1Drizzle.EffectSQLiteD1Database & {
  readonly $client: D1Client.D1Client
}

export class Database extends Context.Service<Database, EffectDatabase>()(
  '@b2b-saas-starter/db/Database'
) {}

export function layerFromDb(db: EffectDatabase): Layer.Layer<Database> {
  return Layer.succeed(Database)(db)
}

/**
 * The `orDie` is what lets this return `Layer.Layer<Database>` with no error
 * channel. Building a drizzle client over a D1 binding that already exists fails
 * only on a broken install, and there is nothing to degrade to at this level:
 * runtime query failures are caught above by `orUnavailable`, which is where the
 * starter's degraded states come from. Widening the signature instead would push a
 * `SqlError` onto every consumer of the database layer for a case none of them can
 * act on.
 */
export function layerFromD1(d1: D1Client.D1ClientConfig['db']): Layer.Layer<Database> {
  return Layer.effect(Database)(SQLiteD1Drizzle.makeWithDefaults({})).pipe(
    Layer.provide(D1Client.layer({ db: d1 })),
    // oxlint-disable-next-line starter/no-effect-escape-hatch -- see the note above
    Layer.orDie
  )
}

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

/**
 * Executes multiple statements as a single atomic D1 batch (implicit
 * transaction — all statements commit or roll back together). The effect-d1
 * drizzle driver has no batch API, so this compiles the builders and runs them
 * through the raw `D1Database` binding held by the underlying `D1Client`.
 */
function batchFailureReason(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

export function batch(
  db: EffectDatabase,
  statements: readonly BatchStatement[]
): Effect.Effect<void, DbBatchError> {
  return Effect.tryPromise({
    try: () => {
      const raw = db.$client.config.db
      return raw.batch(
        statements.map((statement) => {
          const query = statement.toSQL()
          return raw.prepare(query.sql).bind(...query.params)
        })
      )
    },
    catch: (cause) => new DbBatchError({ reason: batchFailureReason(cause) })
  }).pipe(Effect.asVoid)
}
