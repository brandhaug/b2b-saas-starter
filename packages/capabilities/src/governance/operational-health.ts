import { RawD1 } from '@b2b-saas-starter/db/service'
import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import { orUnavailable } from '../internal/unavailable.ts'
import { type CapabilityUnavailable } from '../errors.ts'

const HealthCount = Schema.Struct({ count: Schema.Number })
const decodeCount = Schema.decodeUnknownEffect(HealthCount)

export type OperationalHealthSnapshot = {
  readonly overdueBilling: number
  readonly recentEmailFailures: number
  readonly pendingEmail: number
}

/** Global recovery signals, read only by the operator's scheduled monitor. */
export class OperationalHealth extends Context.Service<
  OperationalHealth,
  {
    readonly read: (
      now: number
    ) => Effect.Effect<OperationalHealthSnapshot, CapabilityUnavailable>
  }
>()('@b2b-saas-starter/OperationalHealth') {}

export const LiveOperationalHealth = Layer.effect(
  OperationalHealth,
  Effect.gen(function* () {
    const database = yield* RawD1
    function count(sql: string, cutoff: string) {
      return Effect.tryPromise(() => database.prepare(sql).bind(cutoff).first()).pipe(
        Effect.flatMap(decodeCount),
        Effect.map((row) => row.count),
        orUnavailable('operational-health')
      )
    }
    return OperationalHealth.of({
      read: Effect.fn('OperationalHealth.read')(function* (now) {
        const overdueBilling = yield* count(
          `SELECT count(*) AS count FROM billing_synchronization
           WHERE status != 'current' AND unresolved_since IS NOT NULL
           AND unresolved_since <= ?`,
          DateTime.formatIso(DateTime.makeUnsafe(now - 900_000))
        )
        // Bounces, complaints and suppression remain recipient diagnostics.
        // This count covers failures before provider acceptance only.
        const recentEmailFailures = yield* count(
          `SELECT count(*) AS count FROM email_deliveries
           WHERE accepted_at IS NULL AND updated_at >= ?
           AND reason IN ('transport_unavailable', 'provider_rejected', 'timeout')`,
          DateTime.formatIso(DateTime.makeUnsafe(now - 300_000))
        )
        const pendingEmail = yield* count(
          `SELECT count(*) AS count FROM email_deliveries
           WHERE accepted_at IS NULL AND status IN ('queued', 'temporary_failure', 'ambiguous')
           AND created_at <= ?`,
          DateTime.formatIso(DateTime.makeUnsafe(now - 900_000))
        )
        return { overdueBilling, recentEmailFailures, pendingEmail }
      })
    })
  })
)
