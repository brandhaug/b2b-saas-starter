import {
  billingProviderEventStatuses,
  type BillingProviderEventStatus
} from '@b2b-saas-starter/db/enums'

/**
 * The owner of the `billing_provider_events.status` machine (ADR 0077).
 * An event row is born `processing` (`recordEvent`), each retry re-enters
 * `processing` (`begin`), failures record `failed` or operator-facing
 * `conflict`, and only a successful commit — of that event, or of a later
 * reconciliation for the same customer — writes `completed`.
 *
 * SQL mirrors that must stay in step, named rather than edited:
 * - `billing_provider_events_status_idx` pages the status column directly
 *   (migration `20260907080000_billing_reliability`).
 * - the `workspace_deletion_fences` triggers refuse deletion while an event
 *   has `status <> 'completed' AND resolved_at IS NULL` (migration
 *   `20261024202744_strong_captain_america`).
 *
 * Every adapter write keyed by one event row filters on the source set below
 * for its transition (`providerEventAttemptSources`,
 * `providerEventFailureSources`), so a stale invocation cannot move a row the
 * map refuses. Commits need no source filter: the input event's commit runs
 * after the duplicate check, and the bulk settle filters on
 * `settledBySynchronization`.
 */

/** The outcomes that can move a provider event row. */
export type ProviderEventTransition =
  | { readonly kind: 'attempt' }
  | { readonly kind: 'failure'; readonly conflict: boolean }
  | { readonly kind: 'commit' }

/**
 * The declared transition map. `attempt` and `commit` cells name their single
 * legal target (`null` refuses); `failure` carries the two targets an attempt
 * outcome can record, classified by `failureStatus`. `completed` is terminal,
 * and a `conflict` row accepts no failure reclassification — only its own
 * event's successful retry.
 */
const providerEventTransitions = {
  processing: {
    attempt: 'processing',
    failure: ['failed', 'conflict'],
    commit: 'completed'
  },
  failed: {
    attempt: 'processing',
    failure: [],
    commit: 'completed'
  },
  conflict: {
    attempt: 'processing',
    failure: [],
    commit: 'completed'
  },
  completed: {
    attempt: null,
    failure: [],
    commit: null
  }
} as const satisfies Record<
  BillingProviderEventStatus,
  {
    attempt: BillingProviderEventStatus | null
    failure: ReadonlyArray<'failed' | 'conflict'>
    commit: BillingProviderEventStatus | null
  }
>

/**
 * Provider events a successful synchronization settles: a commit for the same
 * customer may complete these. `conflict` is deliberately absent — it is the
 * operator's evidence that one event could not be applied, and a later
 * unrelated commit must not rewrite it into a reconciled success. Only the
 * event's own retry (`attempt` then `commit`) may complete it.
 */
export const settledBySynchronization: ReadonlyArray<BillingProviderEventStatus> = [
  'processing',
  'failed'
]

/**
 * The status `recordEvent` births a row with and `begin` re-enters on every
 * retry. Callers guarantee the row is not `completed` (duplicates never
 * re-attempt), so the target is legal by the map above.
 */
export const attemptProviderEventStatus: BillingProviderEventStatus = 'processing'

/** The rows an `attempt` may re-enter into `processing`. */
export const providerEventAttemptSources: ReadonlyArray<BillingProviderEventStatus> =
  billingProviderEventStatuses.filter(
    (status) => nextProviderEventStatus(status, { kind: 'attempt' }) !== null
  )

/**
 * The rows a failure write may land on. A failure is recorded against an
 * attempt: `begin` re-enters `processing` first under the lease, and the
 * unleased routing path writes the attempt and its failure in one statement.
 * So a row accepts a failure when its attempt is legal and the attempted
 * status admits either classification — never a `completed` row.
 */
export const providerEventFailureSources: ReadonlyArray<BillingProviderEventStatus> =
  billingProviderEventStatuses.filter((status) => {
    const attempted = nextProviderEventStatus(status, { kind: 'attempt' })
    return (
      attempted !== null &&
      [false, true].every(
        (conflict) =>
          nextProviderEventStatus(attempted, { kind: 'failure', conflict }) !== null
      )
    )
  })

/**
 * The status a successful commit writes. Both commit sites write under guards
 * that exclude `completed` rows (the input event by the duplicate check, the
 * bulk settle by `settledBySynchronization`), so the target is legal for
 * every row they touch.
 */
export const completedProviderEventStatus: BillingProviderEventStatus = 'completed'

/** Whether a stored provider event has already been settled by its commit. */
export function isCompletedProviderEvent(
  evidence: { readonly status: string } | undefined
): boolean {
  return evidence?.status === completedProviderEventStatus
}

/**
 * The failure classification for an in-flight attempt. `begin` re-enters
 * `processing` before any failure is recorded, so this half of the machine is
 * total over the conflict flag; the map above is what refuses failures
 * against every other status.
 */
export function failureStatus(conflict: boolean): 'failed' | 'conflict' {
  if (conflict) {
    return 'conflict'
  }
  return 'failed'
}

/** Applies one outcome to a stored status; `null` refuses the transition. */
export function nextProviderEventStatus(
  status: BillingProviderEventStatus,
  transition: ProviderEventTransition
): BillingProviderEventStatus | null {
  if (transition.kind === 'attempt') {
    return providerEventTransitions[status].attempt
  }
  if (transition.kind === 'failure') {
    const target = failureStatus(transition.conflict)
    // Read at vocabulary width: the `completed` row's empty tuple types as
    // `never[]`, which would otherwise narrow `includes` to `never`.
    const legal: ReadonlyArray<'failed' | 'conflict'> =
      providerEventTransitions[status].failure
    if (legal.includes(target)) {
      return target
    }
    return null
  }
  return providerEventTransitions[status].commit
}
