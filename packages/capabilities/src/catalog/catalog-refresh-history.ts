import { Context, Effect, Layer, Schema } from 'effect'
import { desc } from 'drizzle-orm'
import {
  Database,
  catalogRefreshRuns,
  type CatalogRefreshSummary
} from '@b2b-saas-starter/db'

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
  readonly listRecent: Effect.Effect<readonly CatalogRefreshRun[]>
  readonly recordRun: (input: {
    readonly label: string
    readonly status: CatalogRefreshStatus
    readonly modules: number
    readonly durationMs: number
    readonly startedAt: string
  }) => Effect.Effect<void>
}

export class CatalogRefreshHistory extends Context.Service<
  CatalogRefreshHistory,
  CatalogRefreshHistoryShape
>()('@b2b-saas-starter/capabilities/CatalogRefreshHistory') {}

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
    return {
      listRecent: Effect.promise(() =>
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
        Effect.promise(async () => {
          await db.insert(catalogRefreshRuns).values({
            id: `crr_${Date.now()}`,
            workspaceId: null,
            status: input.status,
            startedAt: input.startedAt,
            completedAt: new Date().toISOString(),
            summary: {
              modules: input.modules,
              durationMs: input.durationMs
            } satisfies CatalogRefreshSummary
          })
        })
    }
  })
)
