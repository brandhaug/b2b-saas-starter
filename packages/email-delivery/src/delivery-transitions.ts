import {
  type emailDeliveryStatuses,
  type emailPurposes
} from '@b2b-saas-starter/db/enums'

/**
 * The owner of the `email_deliveries.status` machine (ADR 0077). The status
 * is not walked state to state: concurrent worker isolates and out-of-order
 * provider webhooks write the same row, so legality is a monotonic evidence
 * lattice — lesser evidence never overwrites greater — surrounded by the
 * named sets, lease and windows below. Seed and Live share
 * `makeEmailDelivery`, and it routes every status decision through this
 * module.
 *
 * SQL mirrors that must stay in step, named rather than edited:
 * - `email_deliveries_status_created_idx` (`status`, `created_at`) and
 *   `email_deliveries_accepted_updated_idx` (`accepted_at`, `updated_at`)
 *   page the columns these sets filter (migration
 *   `20260907144556_rich_siren`).
 * - the pending-email health check in
 *   `packages/capabilities/src/governance/operational-health.ts` counts
 *   `accepted_at IS NULL` over the claimable set below.
 * - the `email_deliveries` and `email_unresolved` retention rules in
 *   `packages/capabilities/src/governance/retention-rules.ts` partition the
 *   same status vocabulary into their eligible sets.
 */

/** The stored delivery status vocabulary, derived from the db enums. */
export type EmailDeliveryStatus = (typeof emailDeliveryStatuses)[number]

/** The stored email purpose vocabulary, derived from the db enums. */
type EmailPurpose = (typeof emailPurposes)[number]

/** The statuses a provider webhook event can carry. */
export type ProviderEventStatus = Extract<
  EmailDeliveryStatus,
  'delivered' | 'delayed' | 'failed' | 'suppressed'
>

/** The statuses a transport adapter's sanitized outcome can carry. */
export type SendOutcomeStatus = Extract<
  EmailDeliveryStatus,
  'logged' | 'accepted' | 'ambiguous' | 'temporary_failure' | 'failed' | 'suppressed'
>

/**
 * The evidence-rank lattice: the stored status is the strongest evidence the
 * row has absorbed, and evidence arriving out of order can only raise it.
 * `queued`, `ambiguous` and `temporary_failure` carry no provider evidence;
 * `accepted` and `logged` prove the worker submitted the message; `delayed`
 * and `delivered` prove the provider took it further; `failed` and
 * `suppressed` are adverse outcomes that outrank delivery because a bounce,
 * complaint or suppression can legitimately follow one.
 */
export const deliveryEvidenceRanks = {
  queued: 0,
  ambiguous: 0,
  temporary_failure: 0,
  accepted: 1,
  logged: 1,
  delayed: 2,
  delivered: 3,
  failed: 4,
  suppressed: 5
} as const satisfies Record<EmailDeliveryStatus, number>

/** Adverse failure reasons: evidence about the address or content itself. */
export type AdverseReason =
  | 'complaint'
  | 'hard_bounce'
  | 'provider_suppressed'
  | 'provider_rejected'

/**
 * The adverse-reason rank lattice inside one status, strongest first: a
 * greater reason survives a lesser one when statuses tie. Every other
 * stored reason — `null`, `timeout`, `transport_unavailable`,
 * `temporary_failure`, `retry_window_expired`, `no_longer_relevant` —
 * carries no adverse evidence and ranks 0.
 */
const adverseReasonsByRank: ReadonlyArray<string> = [
  'complaint',
  'hard_bounce',
  'provider_suppressed',
  'provider_rejected'
] satisfies ReadonlyArray<AdverseReason>

/** One piece of delivery evidence: a status and its strongest failure reason. */
export type DeliveryEvidence = {
  readonly status: EmailDeliveryStatus
  readonly reason: string | null
}

/**
 * The one named decision function for provider events (ADR 0077): merges
 * incoming provider evidence into stored evidence along the lattices above.
 * `null` refuses the merge — evidence below the stored rank, or at the same
 * rank without a stronger adverse reason, can never rewrite the row,
 * whatever order the webhooks arrive in. A legal rank rise keeps the
 * stronger of the two reasons, so a complaint already on the row survives a
 * later weaker bounce.
 */
export function mergeDeliveryEvidence(
  stored: DeliveryEvidence,
  incoming: DeliveryEvidence
): DeliveryEvidence | null {
  if (deliveryEvidenceRanks[incoming.status] < deliveryEvidenceRanks[stored.status]) {
    return null
  }
  if (
    deliveryEvidenceRanks[incoming.status] === deliveryEvidenceRanks[stored.status] &&
    adverseReasonRank(incoming.reason) <= adverseReasonRank(stored.reason)
  ) {
    return null
  }
  if (adverseReasonRank(stored.reason) > adverseReasonRank(incoming.reason)) {
    return { status: incoming.status, reason: stored.reason }
  }
  return { status: incoming.status, reason: incoming.reason }
}

/**
 * Reads a provider webhook event as evidence. A `failed` or `suppressed`
 * event with no explicit reason still carries adverse evidence: its
 * implicit reason is the weakest adverse one for that status.
 */
export function providerEventEvidence(event: {
  readonly status: ProviderEventStatus
  readonly reason?: string
}): DeliveryEvidence {
  if (event.reason !== undefined) {
    return { status: event.status, reason: event.reason }
  }
  if (event.status === 'failed') {
    return { status: 'failed', reason: 'provider_rejected' }
  }
  if (event.status === 'suppressed') {
    return { status: 'suppressed', reason: 'provider_suppressed' }
  }
  return { status: event.status, reason: null }
}

/** Rank of a failure reason in the adverse lattice; unranked reasons are 0. */
function adverseReasonRank(reason: string | null): number {
  if (reason === null) {
    return 0
  }
  const position = adverseReasonsByRank.indexOf(reason)
  if (position === -1) {
    return 0
  }
  return adverseReasonsByRank.length - position
}

/**
 * Provider statuses that prove the provider took the message: only these
 * backfill `accepted_at`. A bounce or a suppression is evidence against
 * submission and must not manufacture an acceptance that never happened.
 */
const submissionProofStatuses = new Set<ProviderEventStatus>(['delivered', 'delayed'])

/** Whether a provider event status proves the provider took the message. */
export function isSubmissionProof(status: ProviderEventStatus): boolean {
  return submissionProofStatuses.has(status)
}

/**
 * Statuses a delivery never leaves by claim. `failed` still accepts
 * stronger adverse evidence (the lattice above), but no new attempt is ever
 * granted; a non-null `accepted_at` is terminal evidence for any status —
 * once the provider accepted the message it is never submitted again.
 */
export const terminalDeliveryStatuses: ReadonlyArray<EmailDeliveryStatus> = [
  'delivered',
  'failed',
  'suppressed',
  'logged'
]

/** Whether no further attempt may be claimed for this delivery. */
export function isTerminalDelivery(
  status: EmailDeliveryStatus,
  acceptedAt: string | null
): boolean {
  return acceptedAt !== null || includesStatus(terminalDeliveryStatuses, status)
}

/**
 * The statuses a queued retry or a completion decision may still act on:
 * `queued` holds the first attempt, `temporary_failure` and `ambiguous`
 * hold retries inside their window. Lease rules: every claim parks
 * `next_attempt_at` one lease ahead, and an `ambiguous` outcome — a lost
 * response — schedules its own retry a full lease out, so no second worker
 * can double-send while the first attempt's fate is unknown. `claim()`
 * refuses rows outside this set (via the terminal predicate), rows whose
 * lease has not expired, and rows past `retry_until`.
 */
export const claimableDeliveryStatuses: ReadonlyArray<EmailDeliveryStatus> = [
  'queued',
  'temporary_failure',
  'ambiguous'
]

/** Whether the status still owes a retry or a completion decision. */
export function isClaimableDelivery(status: EmailDeliveryStatus): boolean {
  return includesStatus(claimableDeliveryStatuses, status)
}

/** Membership at vocabulary width; the exported sets keep narrow element types. */
function includesStatus(
  set: ReadonlyArray<EmailDeliveryStatus>,
  status: EmailDeliveryStatus
): boolean {
  return set.includes(status)
}

/** The claim lease: how long one worker's attempt fences every other. */
export const deliveryClaimLeaseMs = 5 * 60_000

/**
 * The declared retry windows: how long after creation an interrupted or
 * failed attempt may be retried. Security credentials — verification,
 * recovery, security, invitations — carry evidence that is only meaningful
 * immediately, so they get no window at all.
 */
const deliveryRetryWindows: Readonly<Record<EmailPurpose, number>> = {
  notification: 24 * 3_600_000,
  digest: 6 * 3_600_000,
  verification: 0,
  recovery: 0,
  security: 0,
  invitation: 0
}

/** The retry window a purpose grants, in milliseconds. */
export function deliveryRetryWindow(purpose: EmailPurpose): number {
  return deliveryRetryWindows[purpose]
}

/**
 * The status a transport outcome records. A purpose with no retry window
 * downgrades `temporary_failure` to `failed`: no later attempt is ever
 * scheduled, so the failure is already final.
 */
export function recordedOutcomeStatus(
  purpose: EmailPurpose,
  outcome: SendOutcomeStatus
): EmailDeliveryStatus {
  if (outcome === 'temporary_failure' && deliveryRetryWindow(purpose) === 0) {
    return 'failed'
  }
  return outcome
}

/** The status a fresh claim births a delivery row with. */
export const initialDeliveryStatus: EmailDeliveryStatus = 'queued'

/**
 * The status operational failure evidence writes: an expired retry window
 * and an operator abandonment. Provider events route through the evidence
 * merge above; transport outcomes through `recordedOutcomeStatus`.
 */
export const operationalFailureStatus: EmailDeliveryStatus = 'failed'

/**
 * Statuses that permit claiming a fresh invitation send: each proves the
 * previous attempt ended without acceptance. A non-null `accepted_at`
 * forbids the resend regardless of status.
 */
export const resendEligibleStatuses: ReadonlyArray<EmailDeliveryStatus> = [
  'failed',
  'temporary_failure',
  'ambiguous'
]

/**
 * Whether a stored reason forbids a resend whatever the status: the provider
 * or the recipient rejected the address or content, and a fresh attempt
 * would hit the same wall. Exactly the adverse vocabulary the reason
 * lattice ranks.
 */
export function blocksResend(reason: string | null): boolean {
  return adverseReasonRank(reason) > 0
}

/**
 * Statuses whose delivery without terminal evidence is unconfirmed: the row
 * shows no completion, and missing evidence never authorizes a resend —
 * `isDeliveryUnconfirmed` escalates these once a day has passed.
 */
export const unconfirmedDeliveryStatuses: ReadonlyArray<EmailDeliveryStatus> = [
  'queued',
  'accepted',
  'delayed',
  'ambiguous'
]
