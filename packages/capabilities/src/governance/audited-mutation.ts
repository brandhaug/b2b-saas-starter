import { type BatchStatement, RawD1 } from '@b2b-saas-starter/db/service'
import { type SQL } from 'drizzle-orm'
import { Effect } from 'effect'

import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type RecordAuditEventInput } from './audit-event-log.ts'

/**
 * One audited mutation: verify a row matches in this workspace, then run the
 * mutation and its audit insert as one D1 batch — commit or roll back together.
 *
 * This is the shape every mutating developer-platform capability used to
 * hand-copy (`auditedEndpointUpdate`, `ApiTokenRegistry.create`/`revoke`, the
 * terminal delivery-attempt write). The atomicity caveat travels with it:
 * this is check-then-act, not atomic across the lookup and the batch — a
 * concurrent delete between the two can leave a phantom audit row. D1 does
 * report each statement's change count, but only once the batch has already
 * committed, so the count cannot *gate* an unconditional audit insert from
 * inside the same batch. A mutation that can lose a race states a
 * {@link AuditedTransition} instead: the predicate travels into the audit
 * insert's own `WHERE`, so the audit row commits only where the write won,
 * and the change count is then read back to tell the winner from the loser.
 *
 * What every caller gets by construction is workspace scoping: the pre-check
 * and the write's own where clause must re-apply the workspace key, so a
 * foreign workspace's row is never mutated even when the pre-check goes
 * stale.
 *
 * Mutations that match zero rows skip both writes **and** the audit event —
 * no phantom revocation, no phantom disable.
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
  /**
   * The mutation statement(s), built lazily so a zero-match mutation never
   * pays for them. Laziness is load-bearing: `rotateSecret` mints its
   * replacement secret here, and the interface promises no secret is minted on
   * no match. The list batches beside the one audit insert, so a mutation
   * that needs several statements (a revoke that must also retire the tokens
   * it mints) adds them here.
   */
  readonly write: () => ReadonlyArray<BatchStatement>
  /**
   * Present when the write is a conditional single-row transition that a
   * concurrent request can win instead. See {@link AuditedTransition}.
   */
  readonly transition?: AuditedTransition
}

/**
 * A conditional single-row transition and everything that must commit only
 * with the request that won it.
 *
 * `condition` must be true exactly for the winning transition (in practice an
 * `EXISTS` naming the unique id the write stamps). It gates the audit insert
 * and every statement in `alongside`, all in one batch with the write, so a
 * loser commits nothing at all. The mutation then resolves `false`, read off
 * the write's own change count — no racy re-read after the batch.
 */
type AuditedTransition = {
  readonly condition: SQL
  /**
   * Statements the transition also commits — notification rows, a delivery
   * attempt. Each must carry `condition` itself; the audit insert is the only
   * statement this combinator gates on the caller's behalf.
   */
  readonly alongside: ReadonlyArray<BatchStatement>
}

/**
 * One audited mutation. Without a `transition`: `true` when the batch ran,
 * `false` when the pre-check found nothing. With one: `true` only when this
 * request's write is the one that changed the row.
 */
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
          input.transition?.condition
        )
        const statements: Array<BatchStatement> = [
          ...input.write(),
          ...(input.transition?.alongside ?? []),
          auditStatement
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
        if (input.transition === undefined) {
          return true
        }
        // The write is the batch's first statement, and its change count is
        // what separates the request that won the transition from the one
        // that arrived a moment late.
        return results[0]?.meta.changes === 1
      })
  })
}
