import { type BatchStatement, RawD1 } from '@b2b-saas-starter/db/service'
import { and, sql, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'

import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type RecordAuditEventInput } from './audit-event-log.ts'

/** Mutation and audit commit together. The audit immediately follows the
 * nominated write and requires its change count to be positive. The preliminary
 * lookup only avoids unnecessary work; it never establishes mutation success.
 */

/** What a Live layer hands over once: the audit preparer and its own `orUnavailable` wrapper (so a 503 names the failing capability). The raw binding comes from the {@link RawD1} service instead. */
type AuditedMutationDeps = {
  readonly prepareAuditRecord: (
    input: RecordAuditEventInput,
    condition?: SQL
  ) => Effect.Effect<BatchStatement, CapabilityUnavailable>
  readonly unavailable: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, CapabilityUnavailable, R>
}

type AuditedMutationInput = {
  /**
   * The scope pre-check. Resolve `false` to skip both writes and the audit
   * event. Unconditional inserts pass `Effect.succeed(true)`.
   */
  readonly matched: Effect.Effect<boolean, CapabilityUnavailable>
  /** The audit event committed beside the write. Skipped entirely on no match. */
  readonly auditEvent: RecordAuditEventInput
  /** Built only after the optional lookup matches. Every statement commits or
   * rolls back with the audit. Dependent writes must guard their own predicates.
   */
  readonly write: () => readonly [BatchStatement, ...Array<BatchStatement>]
  /** Extra predicates and dependent statements for compound mutations. */
  readonly transition?: AuditedTransition
}

/** Additional predicates and writes for a multi-statement transition.
 * The audit always checks the nominated write's changes() before later writes
 * can overwrite it. Alongside statements must carry their own stable predicate.
 */
type AuditedTransition = {
  /** Index of the winning write when conditional prerequisite statements precede it. Defaults to zero. */
  readonly writeIndex?: number
  readonly condition: SQL
  /**
   * Statements the transition also commits — notification rows, a delivery
   * attempt. Each must carry `condition` itself; the audit insert is the only
   * statement this combinator gates on the caller's behalf.
   */
  readonly alongside: ReadonlyArray<BatchStatement>
}

/** True only when the nominated write changed at least one row. */
type AuditedMutation = (
  input: AuditedMutationInput
) => Effect.Effect<boolean, CapabilityUnavailable>

/**
 * Builds the audited-mutation combinator for one Live layer. Effectful because
 * it resolves the `RawD1` binding `batch` needs once, at layer construction,
 * and hands each mutation a closed-over copy — so the combinator a capability
 * stores on its service record carries no leftover requirement.
 */
export function auditedMutations(
  deps: AuditedMutationDeps
): Effect.Effect<AuditedMutation, never, RawD1> {
  return Effect.gen(function* () {
    const d1 = yield* RawD1
    return (input: AuditedMutationInput) =>
      Effect.gen(function* () {
        if (!(yield* input.matched)) {
          return false
        }
        const auditStatement = yield* deps.prepareAuditRecord(
          input.auditEvent,
          and(sql`changes() > 0`, input.transition?.condition)
        )
        const writes = input.write()
        const writeIndex = input.transition?.writeIndex ?? 0
        if (writes[writeIndex] === undefined) {
          return yield* deps.unavailable(
            Effect.fail('Invalid audited mutation write index')
          )
        }
        const statements: Array<BatchStatement> = [
          ...writes.slice(0, writeIndex + 1),
          auditStatement,
          ...writes.slice(writeIndex + 1),
          ...(input.transition?.alongside ?? [])
        ]
        const results = yield* deps.unavailable(
          Effect.tryPromise(() =>
            d1.batch(
              statements.map((statement) => {
                const query = statement.toSQL()
                return d1.prepare(query.sql).bind(...query.params)
              })
            )
          )
        )
        // The nominated write's count distinguishes the winning transition.
        // Bulk lifecycle fences also succeed when they change several rows.
        return (results[writeIndex]?.meta.changes ?? 0) > 0
      })
  })
}
