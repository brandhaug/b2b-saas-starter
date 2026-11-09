import {
  billingSynchronizationStatuses,
  type BillingSynchronizationStatus
} from '@b2b-saas-starter/db/enums'

/**
 * The owner of the `billing_synchronization.status` machine (ADR 0077). The
 * status is not a stateful walk: every stored value is the classification of
 * one synchronization outcome, so the transition set is total over these
 * events and Seed and Live derive the same status from the same outcome
 * instead of restating the rules.
 *
 * SQL mirrors that must stay in step, named rather than edited:
 * - `billing_synchronization_unresolved_status_idx` filters on
 *   `unresolved_since` for the unresolved statuses below (migration
 *   `20260907144556_rich_siren`).
 * - the `workspace_deletion_fences` triggers refuse deletion while
 *   `status <> 'current' OR lease_owner IS NOT NULL` (migration
 *   `20261024202744_strong_captain_america`); the lease half is owned by
 *   `billing-lease.ts`.
 */

/** Every status except `current` leaves synchronization unresolved. */
export const unresolvedSynchronizationStatuses: ReadonlyArray<BillingSynchronizationStatus> =
  billingSynchronizationStatuses.filter((status) => status !== 'current')

/** The one settled status; SQL mirrors compare against it by name. */
export const currentSynchronizationStatus: BillingSynchronizationStatus = 'current'

/** The outcomes that write the stored status. */
export type SynchronizationStatusEvent =
  | {
      readonly kind: 'commit'
      /** Whether the committed projection came from a verified provider read. */
      readonly verified: boolean
      /** Whether the stored seat quantity matches the desired quantity. */
      readonly seatsAligned: boolean
    }
  | {
      readonly kind: 'failure'
      /** Whether the failure needs an operator rather than a retry. */
      readonly conflict: boolean
    }
  | { readonly kind: 'checkout_claim_opened' }

/**
 * The sole classification of a synchronization outcome into the stored
 * status. A commit is `current` only when the provider read was verified and
 * seats have converged; any drift stays `pending`. Failures split into
 * retryable `delayed` and operator-facing `conflict`. A newly opened
 * checkout claim leaves the workspace `pending` its subscription linkage.
 */
export function nextSynchronizationStatus(
  event: SynchronizationStatusEvent
): BillingSynchronizationStatus {
  if (event.kind === 'commit') {
    if (event.verified && event.seatsAligned) {
      return 'current'
    }
    return 'pending'
  }
  if (event.kind === 'failure') {
    if (event.conflict) {
      return 'conflict'
    }
    return 'delayed'
  }
  return 'pending'
}
