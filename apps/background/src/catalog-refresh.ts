import { Effect } from 'effect'
import { runCatalogRefresh, SeedLayer } from '@b2b-saas-starter/capabilities'

// CLI/test entry point: run one catalog refresh against the Seed adapter and
// print the outcome. The capture-record-refail sequence lives in
// `runCatalogRefresh` (@b2b-saas-starter/capabilities).
const program = runCatalogRefresh.pipe(
  Effect.provide(SeedLayer),
  Effect.tap((count) =>
    Effect.sync(() => {
      process.stdout.write(
        JSON.stringify(
          {
            status: 'ok',
            modules: count,
            message: 'Catalog refresh completed against the Seed adapter.'
          },
          null,
          2
        ) + '\n'
      )
    })
  )
)

await Effect.runPromise(program)
