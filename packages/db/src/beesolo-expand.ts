import type { D1Database } from '@cloudflare/workers-types'
import { Context, Effect, Layer, Schema } from 'effect'

export const beesoloExpandMigration = '20260802120000_beesolo_expand'

export type DurableFactPolicy = {
  readonly fact: string
  readonly owner: string
  readonly invariant: string
  readonly retention: string
  readonly compatibility: string
  readonly migration: string
  readonly forwardRepair: string
}

/** Release-reviewed ownership and lifecycle contract for every expand-phase fact. */
export const beesoloDurableFactPolicies: readonly DurableFactPolicy[] = [
  {
    fact: 'migration jobs and evidence',
    owner: 'Platform Operations',
    invariant: 'one job per migration and fact; counts equal committed source truth',
    retention: 'release evidence: indefinite',
    compatibility: 'previous Workers receive a write-through companion trigger',
    migration: 'created empty; Appointment backfill is bounded and resumable',
    forwardRepair: 'reconcile counts from source facts, then resume'
  },
  {
    fact: 'Merchant Subscription',
    owner: 'Subscription capability',
    invariant: 'one Solo projection per Merchant; provider evidence is not authority',
    retention: 'Merchant life plus statutory billing retention',
    compatibility: 'no writer switch in expand phase',
    migration: 'later subscription slice creates rows prospectively',
    forwardRepair: 'traffic rollback and provider-evidence reconciliation event'
  },
  {
    fact: 'schedule exception and blocked time',
    owner: 'Scheduling capability',
    invariant: 'Merchant-scoped civil date and valid exact interval',
    retention: 'Merchant life; Appointment snapshots remain immutable',
    compatibility: 'legacy Schedule Rules remain authoritative',
    migration: 'new writes begin only after candidate activation',
    forwardRepair: 'disable candidate writer and append a correcting revision'
  },
  {
    fact: 'Customer Record and Contact',
    owner: 'Customer Directory capability',
    invariant:
      'Merchant-scoped; shared contacts remain ambiguous; one preferred per kind',
    retention: 'activity-based retention, holds, and erasure policy',
    compatibility: 'legacy Appointment snapshots remain readable',
    migration: 'prospective creation plus bounded association backfill',
    forwardRepair: 'quarantine ambiguous records and forward-partition'
  },
  {
    fact: 'Appointment foundation and Series',
    owner: 'Appointment capability',
    invariant: 'one foundation per Appointment; finite 1–8-week cadence and membership',
    retention: 'Appointment operational retention; snapshots immutable',
    compatibility: 'old Appointment writes receive truthful companion rows',
    migration: 'bounded idempotent foundation backfill',
    forwardRepair: 'traffic rollback; correct companion facts or append history'
  },
  {
    fact: 'External Collection',
    owner: 'Appointment capability',
    invariant:
      'append-only positive collection or return; matching snapshot currency; net between zero and snapshot total; corrections exactly offset once; never a verified Payment',
    retention: 'Appointment and statutory record retention',
    compatibility: 'old Workers ignore entries',
    migration: 'prospective after capability activation',
    forwardRepair: 'append a compensating return or collection'
  },
  {
    fact: 'Privacy Request, Preflight, and Action Ledger',
    owner: 'Governance capability',
    invariant: 'revision-bound approval; restore-external action keys replay once',
    retention: 'direct values purge after 30 days terminal; evidence 3 years',
    compatibility: 'additive and dormant until privacy activation',
    migration: 'separate Privacy Ledger D1 remains outside Merchant restores',
    forwardRepair: 'maintenance mode, replay external ledger, then resume traffic'
  },
  {
    fact: 'Report Export',
    owner: 'Reporting capability',
    invariant: 'one consistent source read; artifact expires after 24 hours',
    retention: 'artifact 24 hours; minimized audit follows governance retention',
    compatibility: 'source reports remain on demand',
    migration: 'prospective only',
    forwardRepair: 'expire artifact and regenerate from authoritative facts'
  }
]

type BackfillResult = {
  readonly processed: number
  readonly cursor: string | null
  readonly complete: boolean
}

const utcIsoDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/

const isRealUtcIsoDateTime = (value: string): boolean => {
  const parts = utcIsoDateTimePattern.exec(value)
  if (!parts) return false
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return false
  return (
    parsed.getUTCFullYear() === Number(parts[1]) &&
    parsed.getUTCMonth() + 1 === Number(parts[2]) &&
    parsed.getUTCDate() === Number(parts[3]) &&
    parsed.getUTCHours() === Number(parts[4]) &&
    parsed.getUTCMinutes() === Number(parts[5]) &&
    parsed.getUTCSeconds() === Number(parts[6]) &&
    parsed.getUTCMilliseconds() === Number(parts[7] ?? 0)
  )
}

const IsoDateTime = Schema.String.check(
  Schema.isPattern(utcIsoDateTimePattern),
  Schema.makeFilter(isRealUtcIsoDateTime)
)

export const AppointmentFoundationBackfillInput = Schema.Struct({
  now: IsoDateTime,
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))
  )
})
export type AppointmentFoundationBackfillInput =
  typeof AppointmentFoundationBackfillInput.Type

export class BeesoloBackfillInputInvalid extends Schema.TaggedErrorClass<BeesoloBackfillInputInvalid>()(
  'BeesoloBackfillInputInvalid',
  { reason: Schema.String }
) {}

export class BeesoloBackfillUnavailable extends Schema.TaggedErrorClass<BeesoloBackfillUnavailable>()(
  'BeesoloBackfillUnavailable',
  { reason: Schema.String }
) {}

type BeesoloMigrationBackfillService = {
  readonly runAppointmentFoundations: (
    input: AppointmentFoundationBackfillInput
  ) => Effect.Effect<
    BackfillResult,
    BeesoloBackfillInputInvalid | BeesoloBackfillUnavailable
  >
}

export class BeesoloMigrationBackfill extends Context.Service<
  BeesoloMigrationBackfill,
  BeesoloMigrationBackfillService
>()('@beesolo/db/BeesoloMigrationBackfill') {}

/**
 * Adds companion Appointment foundations without changing the legacy Appointment.
 * Each transaction handles at most `limit` rows and commits its cursor with its rows.
 */
const runAppointmentFoundationBackfill = async (
  d1: D1Database,
  input: AppointmentFoundationBackfillInput
): Promise<BackfillResult> => {
  const limit = input.limit ?? 100

  const jobId = `${beesoloExpandMigration}:appointment_foundations`
  const source = await d1
    .prepare('SELECT count(*) AS count FROM appointments')
    .first<{ count: number }>()
  await d1
    .prepare(
      `INSERT INTO beesolo_migration_jobs
       (id, migration_name, fact_kind, status, processed_count, source_count, updated_at)
     VALUES (?, ?, 'appointment_foundations', 'pending', 0, ?, ?)
     ON CONFLICT(migration_name, fact_kind) DO NOTHING`
    )
    .bind(jobId, beesoloExpandMigration, source?.count ?? 0, input.now)
    .run()

  const job = await d1
    .prepare(`SELECT cursor FROM beesolo_migration_jobs WHERE id = ?`)
    .bind(jobId)
    .first<{ cursor: string | null }>()
  const rows = await d1
    .prepare(
      `SELECT a.id, a.merchant_id, a.booking_session_id, a.created_at
       FROM appointments a
       LEFT JOIN appointment_foundations f ON f.appointment_id = a.id
       WHERE f.appointment_id IS NULL
       ORDER BY a.id LIMIT ?`
    )
    .bind(limit)
    .all<{
      id: string
      merchant_id: string
      booking_session_id: string | null
      created_at: string
    }>()

  const statements = rows.results.map((row) =>
    d1
      .prepare(
        `INSERT INTO appointment_foundations
       (appointment_id, merchant_id, origin, foundation_version, created_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(appointment_id) DO NOTHING`
      )
      .bind(
        row.id,
        row.merchant_id,
        row.booking_session_id === null ? 'merchant_created' : 'public_booking',
        row.created_at
      )
  )
  const nextCursor = rows.results.at(-1)?.id ?? job?.cursor ?? null
  statements.push(
    d1
      .prepare(
        `WITH reconciliation AS (
       SELECT
         (SELECT count(*) FROM appointment_foundations) AS processed_count,
         (SELECT count(*) FROM appointments) AS source_count
     )
     UPDATE beesolo_migration_jobs
     SET cursor = ?,
         status = CASE WHEN reconciliation.processed_count = reconciliation.source_count
           THEN 'complete' ELSE 'running' END,
         processed_count = reconciliation.processed_count,
         source_count = reconciliation.source_count,
         started_at = coalesce(started_at, ?),
         completed_at = CASE WHEN reconciliation.processed_count = reconciliation.source_count
           THEN ? ELSE NULL END,
         updated_at = ?
     FROM reconciliation
     WHERE id = ?`
      )
      .bind(nextCursor, input.now, input.now, input.now, jobId)
  )
  statements.push(
    d1
      .prepare(
        `INSERT OR IGNORE INTO beesolo_migration_evidence
       (id, migration_name, phase, fact_kind, row_count, invariant_version, details_json, recorded_at)
     SELECT ?, ?,
            CASE WHEN count(*) = (SELECT count(*) FROM appointments)
              THEN 'after' ELSE 'batch' END,
            'appointment_foundations', count(*), 'beesolo-expand-v2', ?, ?
     FROM appointment_foundations`
      )
      .bind(
        `${jobId}:${nextCursor ?? 'empty'}`,
        beesoloExpandMigration,
        JSON.stringify({ cursor: nextCursor }),
        input.now
      )
  )
  const batchResults = await d1.batch(statements)
  const inserted = batchResults
    .slice(0, rows.results.length)
    .reduce((count, result) => count + (result.meta.changes ?? 0), 0)
  const completedJob = await d1
    .prepare(`SELECT cursor, status FROM beesolo_migration_jobs WHERE id = ?`)
    .bind(jobId)
    .first<{ cursor: string | null; status: string }>()
  return {
    processed: inserted,
    cursor: completedJob?.cursor ?? null,
    complete: completedJob?.status === 'complete'
  }
}

export const layerBeesoloMigrationBackfillFromD1 = (
  d1: D1Database
): Layer.Layer<BeesoloMigrationBackfill> =>
  Layer.succeed(BeesoloMigrationBackfill)({
    runAppointmentFoundations: (input) =>
      Effect.tryPromise({
        try: () => runAppointmentFoundationBackfill(d1, input),
        catch: (cause) =>
          new BeesoloBackfillUnavailable({
            reason: cause instanceof Error ? cause.message : String(cause)
          })
      })
  })

export const backfillAppointmentFoundations = (
  input: unknown
): Effect.Effect<
  BackfillResult,
  BeesoloBackfillInputInvalid | BeesoloBackfillUnavailable,
  BeesoloMigrationBackfill
> =>
  Effect.flatMap(
    Schema.decodeUnknownEffect(AppointmentFoundationBackfillInput)(input).pipe(
      Effect.mapError(
        (error) => new BeesoloBackfillInputInvalid({ reason: String(error) })
      )
    ),
    (decoded) =>
      Effect.flatMap(BeesoloMigrationBackfill, (service) =>
        service.runAppointmentFoundations(decoded)
      )
  )
