import { Effect } from 'effect'
import {
  CatalogRefreshHistory,
  SeedLayer,
  StarterModuleCatalog
} from '@b2b-saas-starter/capabilities'

const program = Effect.gen(function* () {
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  const catalog = yield* StarterModuleCatalog
  const history = yield* CatalogRefreshHistory
  const modules = yield* catalog.listAllModules
  yield* history.recordRun({
    label: new Date(startedAt).toUTCString(),
    status: 'ok',
    modules: modules.length,
    durationMs: Date.now() - startedMs,
    startedAt
  })
  return modules.length
}).pipe(
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
