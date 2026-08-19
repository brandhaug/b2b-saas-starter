import { Clock, Context, DateTime, Effect, Layer, Option, Result, Schema } from 'effect'
import { desc } from 'drizzle-orm'
import {
  Database,
  catalogRefreshRuns,
  type CatalogRefreshSummary
} from '@b2b-saas-starter/db'
import { type CapabilityUnavailable } from '../errors.ts'
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

const decodeCatalogRefreshSummary = Schema.decodeUnknownOption(
  CatalogRefreshSummarySchema
)

export type CatalogRefreshHistoryInterface = {
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
  CatalogRefreshHistoryInterface
>()('@b2b-saas-starter/capabilities/CatalogRefreshHistory') {}

/** Status + refreshed-module count recorded for one catalog refresh run. */
type RefreshRunOutcome = {
  readonly status: CatalogRefreshStatus
  readonly modules: number
}

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
  const startedAtDateTime = yield* DateTime.now
  const startedAt = DateTime.formatIso(startedAtDateTime)
  const startedMs = DateTime.toEpochMillis(startedAtDateTime)
  const catalog = yield* StarterModuleCatalog
  const history = yield* CatalogRefreshHistory
  const modules = yield* Effect.result(catalog.listAllModules)
  const completedMs = yield* Clock.currentTimeMillis
  const outcome = Result.match(modules, {
    onSuccess: (refreshed): RefreshRunOutcome => ({
      status: 'ok',
      modules: refreshed.length
    }),
    onFailure: (): RefreshRunOutcome => ({ status: 'failed', modules: 0 })
  })
  yield* history.recordRun({
    label: DateTime.toDateUtc(startedAtDateTime).toUTCString(),
    status: outcome.status,
    modules: outcome.modules,
    durationMs: completedMs - startedMs,
    startedAt
  })
  if (Result.isFailure(modules)) {
    return yield* Effect.fail(modules.failure)
  }
  return modules.success.length
})

export function SeedCatalogRefreshHistory(
  seed: readonly CatalogRefreshRun[]
): Layer.Layer<CatalogRefreshHistory> {
  return Layer.succeed(CatalogRefreshHistory)({
    listRecent: Effect.succeed(seed),
    recordRun: () => Effect.void
  })
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function labelFromDate(iso: string): string {
  return Option.match(DateTime.make(iso), {
    onNone: () => 'Day',
    onSome: (moment) => WEEKDAY_LABELS[DateTime.getPartUtc(moment, 'weekDay')] ?? 'Day'
  })
}

/** Anything the row does not spell as `failed` is reported as a successful run. */
function refreshStatus(status: string): CatalogRefreshStatus {
  if (status === 'failed') return 'failed'
  return 'ok'
}

/** Maps one persisted run row onto the wire DTO, tolerating a malformed summary. */
function toCatalogRefreshRun(
  row: typeof catalogRefreshRuns.$inferSelect
): CatalogRefreshRun {
  const summary = decodeCatalogRefreshSummary(row.summary)
  const counts = Option.match(summary, {
    onNone: () => ({ modules: 0, durationMs: 0 }),
    onSome: (decoded) => ({
      modules: decoded.modules,
      durationMs: decoded.durationMs
    })
  })
  return {
    id: row.id,
    label: labelFromDate(row.startedAt),
    status: refreshStatus(row.status),
    modules: counts.modules,
    durationMs: counts.durationMs,
    startedAt: row.startedAt
  }
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
      ).pipe(Effect.map((rows) => rows.map(toCatalogRefreshRun))),
      recordRun: Effect.fnUntraced(function* (input) {
        const id = yield* newCapabilityId('crr')
        const completedAt = yield* DateTime.now
        return yield* unavailable(
          db.insert(catalogRefreshRuns).values({
            id,
            workspaceId: null,
            status: input.status,
            startedAt: input.startedAt,
            completedAt: DateTime.formatIso(completedAt),
            summary: {
              modules: input.modules,
              durationMs: input.durationMs
            } satisfies CatalogRefreshSummary
          })
        ).pipe(Effect.asVoid)
      })
    }
  })
)
