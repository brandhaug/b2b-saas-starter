import {
  batch,
  type BatchStatement,
  type EffectDatabase
} from '@b2b-saas-starter/db/src/service.ts'
import { Effect } from 'effect'

import { type CapabilityUnavailable } from '../errors.ts'
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

/** What a Live layer hands over once: its `Database`, the audit preparer, and its own `orUnavailable` wrapper (so a 503 names the failing capability). */
export type AuditedMutationDeps = {
  readonly db: EffectDatabase
  readonly prepareAuditRecord: (
    input: RecordAuditEventInput
  ) => Effect.Effect<BatchStatement>
  readonly unavailable: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, CapabilityUnavailable, R>
}

export type AuditedMutationInput = {
  /**
   * The scope pre-check. Resolve `false` to skip both writes and the audit
   * event. Unconditional inserts pass `Effect.succeed(true)`.
   */
  readonly matched: Effect.Effect<boolean, CapabilityUnavailable>
  /** The audit event committed beside the write. Skipped entirely on no match. */
  readonly auditEvent: RecordAuditEventInput
  /**
   * The mutation statement, built lazily so a zero-match mutation never pays
   * for it. Laziness is load-bearing: `rotateSecret` mints its replacement
   * secret here, and the interface promises no secret is minted on no match.
   */
  readonly write: () => BatchStatement
}

/**
 * Builds the audited-mutation combinator for one Live layer. Resolves `true`
 * when the batch ran, `false` when the pre-check found nothing — callers map
 * that onto their interface's shape (`boolean`, `Option.some(...)`, …).
 */
export function auditedMutations(deps: AuditedMutationDeps) {
  return function auditedMutation(
    input: AuditedMutationInput
  ): Effect.Effect<boolean, CapabilityUnavailable> {
    return Effect.gen(function* () {
      if (!(yield* input.matched)) return false
      const auditStatement = yield* deps.prepareAuditRecord(input.auditEvent)
      yield* deps.unavailable(batch(deps.db, [input.write(), auditStatement]))
      return true
    })
  }
}
