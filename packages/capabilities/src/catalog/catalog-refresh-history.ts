import { Context, Effect, Layer, Result, Schema } from 'effect'
import { desc } from 'drizzle-orm'
import {
  Database,
  catalogRefreshRuns,
  type CatalogRefreshSummary
} from '@b2b-saas-starter/db'
import type { CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { StarterModuleCatalog } from './starter-module-catalog.ts'

export const CatalogRefreshStatus = Schema.Literals(['ok', 'failed'])
export type CatalogRefreshStatus = typeof CatalogRefreshStatus.Type

export const CatalogRefreshRun = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  status: CatalogRefreshStatus,
  modules: Schema.Number,
  durationMs: Schema.Number,
  startedAt: Schema.String
})
export type CatalogRefreshRun = typeof CatalogRefreshRun.Type

export const CatalogRefreshSummarySchema = Schema.Struct({
  modules: Schema.Number,
  durationMs: Schema.Number
})

export type CatalogRefreshHistoryShape = {
  readonly listRecent: Effect.Effect<
    readonly CatalogRefreshRun[],
    CapabilityUnavailable
  >
  readonly recordRun: (input: {
    readonly label: string
    readonly status: CatalogRefreshStatus
    readonly modules: number
    readonly durationMs: number
    readonly startedAt: string
  }) => Effect.Effect<void, CapabilityUnavailable>
}

export class CatalogRefreshHistory extends Context.Service<
  CatalogRefreshHistory,
  CatalogRefreshHistoryShape
>()('@b2b-saas-starter/capabilities/CatalogRefreshHistory') {}

/**
 * One catalog refresh run with the "no refresh run goes unrecorded" rule
 * applied: the refresh outcome is captured with `Effect.result`, an ok/failed
 * history row with the real duration is recorded via `recordRun`, and the
 * original failure is then re-raised. Resolves the refreshed module count.
 * Every catalog-refresh entry point (cron handler, CLI) runs this effect
 * instead of re-implementing the capture-record-refail sequence.
 */
export const runCatalogRefresh: Effect.Effect<
  number,
  CapabilityUnavailable,
  StarterModuleCatalog | CatalogRefreshHistory
> = Effect.gen(function* () {
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  const catalog = yield* StarterModuleCatalog
  const history = yield* CatalogRefreshHistory
  const modules = yield* Effect.result(catalog.listAllModules)
  yield* history.recordRun({
    label: new Date(startedAt).toUTCString(),
    status: Result.isSuccess(modules) ? 'ok' : 'failed',
    modules: Result.isSuccess(modules) ? modules.success.length : 0,
    durationMs: Date.now() - startedMs,
    startedAt
  })
  if (Result.isFailure(modules)) {
    return yield* Effect.fail(modules.failure)
  }
  return modules.success.length
})

export const SeedCatalogRefreshHistory = (
  seed: readonly CatalogRefreshRun[]
): Layer.Layer<CatalogRefreshHistory> =>
  Layer.succeed(CatalogRefreshHistory)({
    listRecent: Effect.succeed(seed),
    recordRun: () => Effect.void
  })

const labelFromDate = (iso: string): string => {
  const day = new Date(iso).getUTCDay()
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] ?? 'Day'
}

export const LiveCatalogRefreshHistory: Layer.Layer<
  CatalogRefreshHistory,
  never,
  Database
> = Layer.effect(CatalogRefreshHistory)(
  Effect.gen(function* () {
    const db = yield* Database
    const unavailable = orUnavailable('catalog-refresh-history')
    return {
      listRecent: unavailable(
        db
          .select()
          .from(catalogRefreshRuns)
          .orderBy(desc(catalogRefreshRuns.startedAt))
          .limit(14)
      ).pipe(
        Effect.map((rows) =>
          rows.map((row) => {
            const summary = Schema.decodeUnknownOption(CatalogRefreshSummarySchema)(
              row.summary
            )
            return {
              id: row.id,
              label: labelFromDate(row.startedAt),
              status: row.status === 'failed' ? 'failed' : 'ok',
              modules: summary._tag === 'Some' ? summary.value.modules : 0,
              durationMs: summary._tag === 'Some' ? summary.value.durationMs : 0,
              startedAt: row.startedAt
            }
          })
        )
      ),
      recordRun: (input) =>
        unavailable(
          db.insert(catalogRefreshRuns).values({
            id: newCapabilityId('crr'),
            workspaceId: null,
            status: input.status,
            startedAt: input.startedAt,
            completedAt: new Date().toISOString(),
            summary: {
              modules: input.modules,
              durationMs: input.durationMs
            } satisfies CatalogRefreshSummary
          })
        ).pipe(Effect.asVoid)
    }
  })
)
