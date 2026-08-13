import { Console, Effect, Schema } from 'effect'
import { runCatalogRefresh, SeedLayer } from '@b2b-saas-starter/capabilities'

/** What this entry point prints on success, as one JSON line. */
const RefreshReport = Schema.Struct({
  status: Schema.Literal('ok'),
  modules: Schema.Number,
  message: Schema.String
})
const encodeRefreshReport = Schema.encodeSync(Schema.fromJsonString(RefreshReport))

// CLI/test entry point: run one catalog refresh against the Seed adapter and
// print the outcome. The capture-record-refail sequence lives in
// `runCatalogRefresh` (@b2b-saas-starter/capabilities).
const program = runCatalogRefresh.pipe(
  Effect.provide(SeedLayer),
  Effect.tap((count) =>
    Console.log(
      encodeRefreshReport({
        status: 'ok',
        modules: count,
        message: 'Catalog refresh completed against the Seed adapter.'
      })
    )
  )
)

// oxlint-disable-next-line effect/noAsyncFunction -- Process boundary of a CLI script: there is no enclosing Effect to yield into, and awaiting here is what makes the exit code reflect the refresh outcome.
await Effect.runPromise(program)
