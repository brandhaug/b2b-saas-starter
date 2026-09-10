import { batch, type BatchStatement, RawD1 } from '@b2b-saas-starter/db/service'
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
 * concurrent delete between the two can leave a phantom audit row (the UPDATE
 * no-ops while the audit insert commits; D1 batches discard per-statement
 * results, so the row count cannot gate the insert inside one batch). What
 * every caller gets by construction is workspace scoping: the pre-check and
 * the write's own where clause must re-apply the workspace key, so a foreign
 * workspace's row is never mutated even when the pre-check goes stale.
 *
 * Mutations that match zero rows skip both writes **and** the audit event —
 * no phantom revocation, no phantom disable.
 */

/** What a Live layer hands over once: the audit preparer and its own `orUnavailable` wrapper (so a 503 names the failing capability). The raw binding comes from the {@link RawD1} service instead. */
type AuditedMutationDeps = {
  readonly prepareAuditRecord: (
    input: RecordAuditEventInput
  ) => Effect.Effect<BatchStatement>
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
}

/** One audited mutation: `true` when the batch ran, `false` when the pre-check found nothing. */
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
        const auditStatement = yield* deps.prepareAuditRecord(input.auditEvent)
        yield* deps.unavailable(batch([...input.write(), auditStatement]))
        return true
      }).pipe(Effect.provideService(RawD1, d1))
  })
}

/**
 * Commit a conditional single-row transition and its conditional audit insert.
 * The audit predicate must match the transition's unique id. The D1 change
 * count identifies the winning request without a racy read after the batch.
 */
export const commitAuditedTransition = Effect.fn('Audit.commitTransition')(function* (
  write: BatchStatement,
  records: ReadonlyArray<BatchStatement>
) {
  const d1 = yield* RawD1
  const results = yield* Effect.tryPromise(() =>
    d1.batch(
      [write, ...records].map((statement) => {
        const query = statement.toSQL()
        return d1.prepare(query.sql).bind(...query.params)
      })
    )
  )
  return results[0]?.meta.changes === 1
})
