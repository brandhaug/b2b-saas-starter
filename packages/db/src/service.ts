import { failureMessage } from '@b2b-saas-starter/failure'
import { Context, Effect, Layer, Schema } from 'effect'
import * as D1Client from '@effect/sql-d1/D1Client'
import * as SQLiteD1Drizzle from 'drizzle-orm/effect-d1'
import { type Query } from 'drizzle-orm'

export type EffectDatabase = SQLiteD1Drizzle.EffectSQLiteD1Database & {
  readonly $client: D1Client.D1Client
}

/** The raw Cloudflare `D1Database` binding behind the drizzle client. */
export type D1Binding = D1Client.D1ClientConfig['db']

export class Database extends Context.Service<Database, EffectDatabase>()(
  '@b2b-saas-starter/db/Database'
) {}

/**
 * The raw D1 binding, as a service alongside {@link Database}. Batch writes
 * need it because the effect-d1 driver has no batch API — depend on this
 * instead of tunneling through `db.$client.config`. {@link layerFromD1}
 * provides it beside `Database`, so both come from one call.
 */
export class RawD1 extends Context.Service<RawD1, D1Binding>()(
  '@b2b-saas-starter/db/RawD1'
) {}

/**
 * The `orDie` is what lets this return `Layer.Layer<Database | RawD1>` with no
 * error channel. Building a drizzle client over a D1 binding that already exists fails
 * only on a broken install, and there is nothing to degrade to at this level:
 * runtime query failures are caught above by `orUnavailable`, which is where the
 * starter's degraded states come from. Widening the signature instead would push a
 * `SqlError` onto every consumer of the database layer for a case none of them can
 * act on.
 */
export function layerFromD1(d1: D1Binding): Layer.Layer<Database | RawD1> {
  return Layer.mergeAll(
    Layer.succeed(RawD1)(d1),
    Layer.effect(Database)(SQLiteD1Drizzle.makeWithDefaults({})).pipe(
      Layer.provide(D1Client.layer({ db: d1 })),
      // oxlint-disable-next-line starter/no-effect-escape-hatch -- see the note above
      Layer.orDie
    )
  )
}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class DbBatchError extends Schema.TaggedError<DbBatchError>()('DbBatchError', {
  reason: Schema.String
}) {}

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
 * through the raw `D1Database` binding, which it reads from the {@link RawD1}
 * service rather than taking as an argument.
 */
export function batch(
  statements: ReadonlyArray<BatchStatement>
): Effect.Effect<void, DbBatchError, RawD1> {
  return Effect.gen(function* () {
    const d1 = yield* RawD1
    yield* Effect.tryPromise({
      try: () =>
        d1.batch(
          statements.map((statement) => {
            const query = statement.toSQL()
            return d1.prepare(query.sql).bind(...query.params)
          })
        ),
      catch: (cause) => new DbBatchError({ reason: failureMessage(cause) })
    })
  })
}
