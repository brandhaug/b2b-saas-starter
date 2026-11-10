import { ASSISTANT_SHUTDOWN_GRACE_MS, type AssistantReservation } from './admission.ts'

/**
 * The owner of the `assistant_reservations` machine (ADR 0077). A reservation
 * has no status column: its state derives from `committed_at`, `released_at`
 * and the `deadline` that bounds ambiguous cross-store writes, so every
 * admission guard in Seed and Live shares this one vocabulary.
 *
 * Transition evidence is the audit trail, which names each write:
 * `assistant_attempt.reserved` records the birth of a held reservation,
 * `assistant_attempt.committed` records reserved → committed, and
 * `assistant_attempt.released` records → released — with `action: 'expired'`
 * when deadline expiry rather than an explicit release did it.
 *
 * SQL mirrors that must stay in step, named rather than edited:
 * - the conditional reserve INSERT in `admission.live.ts` counts held rows as
 *   `released_at is null and deadline > now - shutdown grace` and the rolling
 *   minute as `created_at > now - 60_000`, over
 *   `assistant_reservations_member_idx` (migration
 *   `20260915114634_friendly_madame_hydra`).
 * - `commit` writes only where `committed_at is null and released_at is null
 *   and deadline > now`; `release` and expiry reconciliation write only where
 *   `released_at is null` (expiry additionally `deadline <= now - grace`).
 * - the directory fence in `directory.live.ts` releases every unreleased
 *   reservation of a fenced conversation.
 */

/** The stored fields the machine derives from; both adapters' rows carry them. */
export type AssistantReservationClock = Pick<
  AssistantReservation,
  'committedAt' | 'releasedAt' | 'deadline'
>

export type AssistantReservationStatus = 'reserved' | 'committed' | 'released'

/** Evidence that moves a reservation; each kind names its audit event above. */
export type AssistantReservationEvent =
  | { readonly kind: 'committed' }
  | { readonly kind: 'released' }
  | { readonly kind: 'expired' }

export function reservationStatus(
  reservation: AssistantReservationClock
): AssistantReservationStatus {
  if (reservation.releasedAt !== null) {
    return 'released'
  }
  if (reservation.committedAt !== null) {
    return 'committed'
  }
  return 'reserved'
}

/**
 * The declared transition map: the status each event produces from each
 * status. `null` refuses the event. Release is idempotent and commit is
 * idempotent inside its deadline (an ambiguous retry keeps the first
 * timestamp); the deadline bound itself lives in `nextReservationStatus`.
 */
const reservationTransitions = {
  reserved: { committed: 'committed', released: 'released', expired: 'released' },
  committed: { committed: 'committed', released: 'released', expired: 'released' },
  released: { committed: null, released: 'released', expired: null }
} as const satisfies Record<
  AssistantReservationStatus,
  Record<AssistantReservationEvent['kind'], AssistantReservationStatus | null>
>

/**
 * Applies one event at `now`. Commit refuses once the deadline has passed —
 * the deadline is what bounds an ambiguous cross-store write — and expiry
 * refuses until the shutdown grace has elapsed past the deadline, because a
 * reservation whose deadline just passed may still belong to a live attempt.
 */
export function nextReservationStatus(
  reservation: AssistantReservationClock,
  event: AssistantReservationEvent,
  now: number
): AssistantReservationStatus | null {
  if (event.kind === 'committed' && reservation.deadline <= now) {
    return null
  }
  if (event.kind === 'expired' && !isReservationExpired(reservation, now)) {
    return null
  }
  return reservationTransitions[reservationStatus(reservation)][event.kind]
}

/**
 * Whether the reservation still occupies one of its Member's concurrency
 * slots: unreleased, with deadline plus shutdown grace still in the future.
 * A row past that bound but not yet reconciled no longer counts.
 */
export function isReservationHeld(
  reservation: AssistantReservationClock,
  now: number
): boolean {
  return reservation.releasedAt === null && !isReservationExpired(reservation, now)
}

/** Whether the reservation was released; released rows never move back. */
export function isReservationReleased(reservation: AssistantReservationClock): boolean {
  return reservation.releasedAt !== null
}

/**
 * Whether deadline expiry has taken the reservation: unreleased, with the
 * attempt deadline plus shutdown grace in the past. These rows are the
 * ambiguous cross-store writes that expiry reconciliation releases.
 */
export function isReservationExpired(
  reservation: AssistantReservationClock,
  now: number
): boolean {
  return (
    reservation.releasedAt === null &&
    reservation.deadline + ASSISTANT_SHUTDOWN_GRACE_MS <= now
  )
}

/**
 * Whether committing is legal at all: a released reservation is terminal and
 * a past deadline refuses. An already-committed reservation stays
 * committable, so an ambiguous retry succeeds without a new audit write.
 */
export function canCommitReservation(
  reservation: AssistantReservationClock | undefined,
  now: number
): boolean {
  if (reservation === undefined) {
    return false
  }
  return nextReservationStatus(reservation, { kind: 'committed' }, now) !== null
}

/**
 * Whether the audited reserved → committed write can land: a first commit on
 * an unreleased reservation inside its deadline. The SQL guard in
 * `admission.live.ts` mirrors this predicate; already-committed rows return
 * false so the audit never repeats.
 */
export function isReservationAwaitingCommit(
  reservation: AssistantReservationClock | undefined,
  now: number
): boolean {
  if (reservation === undefined) {
    return false
  }
  return reservation.committedAt === null && canCommitReservation(reservation, now)
}
