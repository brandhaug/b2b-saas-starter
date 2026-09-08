import { deliveryAttemptPhases } from '@b2b-saas-starter/db/enums'
import { DateTime, Duration, Option, Schema } from 'effect'

import { type AuditEventType } from '../governance/audit-event-taxonomy.ts'
import { type NotificationEvent } from '../notifications/notification-events.ts'

/** The JSON value type `Schema.Json` decodes — the payload column's contract. */
export type Json = typeof Schema.Json.Type

/** A recorded delivery attempt, newest first in `listDeliveries`. */
export const WebhookDelivery = Schema.Struct({
  id: Schema.String,
  endpointId: Schema.String,
  eventType: Schema.String,
  status: Schema.String,
  attempts: Schema.Number,
  lastAttemptAt: Schema.NullOr(Schema.String),
  nextAttemptAt: Schema.NullOr(Schema.String),
  responseStatus: Schema.NullOr(Schema.Number),
  /**
   * Operator evidence, recorded per latest attempt: the payload that was (or
   * will be, while `pending`) sent, the request header block the worker
   * posted, a truncated response body, and — on a replay — the delivery row
   * this one was replayed from. The payload is never absent: every dispatch
   * holds one, and terminal rows record what they never sent or exhausted.
   */
  payload: Schema.Json,
  requestHeaders: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
  responseBody: Schema.NullOr(Schema.String),
  replayedFrom: Schema.NullOr(Schema.String)
})
export type WebhookDelivery = typeof WebhookDelivery.Type

/** Immutable evidence for one queue dispatch or its terminal disposition. */
export const WebhookDeliveryAttempt = Schema.Struct({
  id: Schema.String,
  deliveryId: Schema.String,
  attempts: Schema.Number,
  phase: Schema.Literals(deliveryAttemptPhases),
  status: Schema.String,
  attemptedAt: Schema.String,
  durationMs: Schema.NullOr(Schema.Number),
  failureReason: Schema.NullOr(Schema.String),
  responseStatus: Schema.NullOr(Schema.Number),
  requestHeaders: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
  responseBody: Schema.NullOr(Schema.String)
})
export type WebhookDeliveryAttempt = typeof WebhookDeliveryAttempt.Type

export const DELIVERY_HISTORY_RETENTION_DAYS = 30
export const DELIVERY_HISTORY_CLEANUP_LIMIT = 100

export type ListWebhookDeliveriesInput = {
  readonly endpointId: string
}

/**
 * Delivery status vocabulary (the stored enum, `deliveryStatuses` in
 * `packages/db`, stays in step):
 * - `pending` — an operator action (replay or test send) created the row and
 *   the queue has not dispatched it yet.
 * - `delivered` — 2xx response.
 * - `failed` — retryable failure (5xx, 408, 429, network error, timeout); the
 *   queue will redeliver and `nextAttemptAt` is set.
 * - `failed_permanent` — terminal failure (non-retryable 4xx, or the endpoint
 *   URL failed the SSRF guard at dispatch); the message is acked.
 * - `dead_lettered` — the message exhausted `maxRetries` and was consumed from
 *   the dead-letter queue.
 */
export type WebhookDeliveryStatus =
  | 'pending'
  | 'delivered'
  | 'failed'
  | 'failed_permanent'
  | 'dead_lettered'

/**
 * A Seed delivery-history row so the operator surface (deliveries list,
 * replay) has something to show before any attempt is recorded. Absent
 * optional fields default the way a recorded attempt would leave them.
 * Lives on the plan module beside the delivery row types, so the seed fixture
 * can import it without a cycle through the adapters.
 */
export type SeedWebhookDeliveryFixture = {
  readonly id: string
  readonly endpointId: string
  readonly eventType: string
  readonly status: WebhookDeliveryStatus
  readonly attempts: number
  readonly lastAttemptAt: string
  readonly responseStatus?: number | null
  readonly nextAttemptAt?: string | null
  readonly payload: Json
  readonly requestHeaders?: Record<string, string> | null
  readonly responseBody?: string | null
  readonly replayedFrom?: string | null
  readonly workspaceId?: string
}

/**
 * The statuses an operator may replay: anything that has failed. A `pending`
 * row has not dispatched yet and a `delivered` row needs no operator help, so
 * neither offers a replay.
 */
const REPLAYABLE_DELIVERY_STATUSES: ReadonlySet<WebhookDeliveryStatus> = new Set([
  'failed',
  'failed_permanent',
  'dead_lettered'
])

export function isReplayableDeliveryStatus(status: WebhookDeliveryStatus): boolean {
  return REPLAYABLE_DELIVERY_STATUSES.has(status)
}

/** Longest response body persisted on a delivery row, in characters. */
export const RESPONSE_BODY_MAX_LENGTH = 2048

/**
 * How many delivery rows `listDeliveries` serves — the operator drawer's
 * history cap, named once so both adapters page identically.
 */
export const DELIVERIES_PAGE_SIZE = 20

/**
 * The `User-Agent` header every dispatch posts with. The background worker
 * stamps it onto outgoing requests and the seed fixture's recorded history
 * carries the same value, so the deliveries drawer reads like the real thing.
 * One constant because the consumer's replay-detection and the fixture's
 * realism must not drift.
 */
export const WEBHOOK_USER_AGENT = 'b2b-saas-starter-webhooks/0.1'

/**
 * Truncates a receiver's response body for storage. Rows are operator
 * evidence, not an archive: a marker records that truncation happened so a
 * reader never mistakes a cut body for the whole one.
 */
export function truncateResponseBody(body: string): string {
  if (body.length <= RESPONSE_BODY_MAX_LENGTH) {
    return body
  }
  return `${body.slice(0, RESPONSE_BODY_MAX_LENGTH)}… [truncated]`
}

/** How long a rotated-out signing secret keeps signing deliveries. */
const SECRET_ROTATION_GRACE = Duration.hours(24)

/**
 * The rotation half of the secret state machine: when a rotation takes effect,
 * the secret it replaces stays valid for the grace window so the receiver can
 * finish rolling without dropping deliveries (the sender dual-signs during the
 * window — see `activeSigningSecrets`). Pure — both adapters persist the
 * expiry this returns next to the replacement secret.
 */
export function planSecretRotation(now: DateTime.Utc): string {
  return DateTime.formatIso(DateTime.addDuration(now, SECRET_ROTATION_GRACE))
}

/** The stored rotation columns, as `getDispatchTarget` reads them back. */
type SigningSecretRotation = {
  readonly signingSecret: string
  readonly previousSigningSecret?: string | null
  readonly previousSecretExpiresAt?: string | null
}

/**
 * Which secrets a dispatch signs with right now: always the current one, plus
 * the previous one while its grace window is still open — so a receiver that
 * has not yet installed the rotated secret keeps verifying deliveries against
 * the signature it still knows. The instant the window closes the previous
 * secret stops signing; nothing needs to sweep it first.
 */
export function activeSigningSecrets(
  rotation: SigningSecretRotation,
  now: DateTime.Utc
): ReadonlyArray<string> {
  const previous = rotation.previousSigningSecret
  const expiresAt = rotation.previousSecretExpiresAt
  if (
    previous === undefined ||
    previous === null ||
    previous.length === 0 ||
    expiresAt === undefined ||
    expiresAt === null
  ) {
    return [rotation.signingSecret]
  }
  const parsed = DateTime.make(expiresAt)
  // Mapping-boundary parse: a malformed stored timestamp must not crash the
  // dispatch path — it lands on "grace over", like an expired one.
  if (
    Option.isNone(parsed) ||
    DateTime.toEpochMillis(parsed.value) <= DateTime.toEpochMillis(now)
  ) {
    return [rotation.signingSecret]
  }
  return [rotation.signingSecret, previous]
}

/**
 * Redelivery backoff: 30s per attempt, capped at six attempts (180s). The
 * queue retry delay and the persisted `nextAttemptAt` are derived from this
 * one function, so the stored schedule matches when Cloudflare will actually
 * redeliver.
 */
export function backoffSeconds(attempts: number): number {
  return Math.min(attempts, 6) * 30
}

type DeliveryDecision = 'delivered' | 'retry' | 'terminal'

/**
 * Ack/retry/terminal decision per response status. `0` means no HTTP response
 * (network error or timeout) and is retryable. 4xx responses are permanent
 * failures except 408 (request timeout) and 429 (rate limited).
 */
export function classifyResponseStatus(status: number): DeliveryDecision {
  if (status >= 200 && status < 300) {
    return 'delivered'
  }
  if (status === 408 || status === 429) {
    return 'retry'
  }
  if (status >= 400 && status < 500) {
    return 'terminal'
  }
  return 'retry'
}

/** Persisted `webhookDeliveries.status` for a dispatch decision. */
function deliveryStatus(
  decision: DeliveryDecision
): 'delivered' | 'failed_permanent' | 'failed' {
  if (decision === 'delivered') {
    return 'delivered'
  }
  if (decision === 'terminal') {
    return 'failed_permanent'
  }
  return 'failed'
}

/** `0` stands for "no HTTP response at all", which is persisted as null. */
function recordedResponseStatus(status: number): number | null {
  if (status === 0) {
    return null
  }
  return status
}

/** An endpoint with no delivery attempts yet reports a full success rate. */
export function deliverySuccessRate(total: number, delivered: number): number {
  if (total === 0) {
    return 100
  }
  return Math.round((delivered / total) * 100)
}

/**
 * The failure ladder (ADR 0062 addendum): the streak of consecutive failed
 * delivery attempts one endpoint carries in `consecutive_failures`. Each
 * recorded failure climbs it; a delivered attempt resets it to zero. The
 * queue consumer reacts to the streak this module names: the workspace
 * owners are warned at each rung below, and at the threshold the endpoint is
 * auto-disabled atomically with the accepted failure and warned once
 * more. Rungs are exact so each fires once per climb; the threshold is a
 * floor so an endpoint re-enabled mid-streak without a success disables
 * again on its next failure instead of sailing past the rung.
 */
const WEBHOOK_FAILURE_NOTIFY_RUNGS: ReadonlySet<number> = new Set([5, 10, 15])

/** The streak length at which the ladder auto-disables the endpoint. */
export const WEBHOOK_FAILURE_AUTO_DISABLE_AT = 20

/**
 * The streak after an attempt writes: every failure — retryable, permanent,
 * or dead-lettered — climbs; only a delivered attempt resets. Pure, so the
 * Seed and Live adapters move the stored counter identically.
 */
export function nextConsecutiveFailures(
  current: number,
  status: WebhookDeliveryStatus
): number {
  if (status === 'delivered') {
    return 0
  }
  return current + 1
}

/** What the ladder does at a streak value. */
export type FailureLadderAction = 'silent' | 'warn' | 'disable'

/**
 * The ladder's reaction to the streak a recorded attempt left, pure so the
 * queue consumer only executes it: nothing between rungs, an owner warning
 * at each rung, and from the threshold on the disable plus the warning that
 * names it.
 */
export function failureLadderAction(consecutiveFailures: number): FailureLadderAction {
  if (reachedWebhookFailureThreshold(consecutiveFailures)) {
    return 'disable'
  }
  if (WEBHOOK_FAILURE_NOTIFY_RUNGS.has(consecutiveFailures)) {
    return 'warn'
  }
  return 'silent'
}

/** Whether a streak has reached the auto-disable threshold. */
function reachedWebhookFailureThreshold(consecutiveFailures: number): boolean {
  return consecutiveFailures >= WEBHOOK_FAILURE_AUTO_DISABLE_AT
}

/** Everything a dispatch needs to persist its attempt row and answer the queue. */
type DeliveryAttemptPlan = {
  readonly status: 'delivered' | 'failed_permanent' | 'failed'
  readonly responseStatus: number | null
  readonly nextAttemptAt: string | null
  readonly outcome: 'ack' | 'retry'
}

/**
 * The dispatch half of the delivery state machine, pure and owned here so the
 * background worker never re-derives it: classify the response status, map it
 * to the persisted vocabulary above, and derive the retry schedule from the
 * same `backoffSeconds` the queue consumer passes to `message.retry`. Terminal
 * outcomes have no next attempt.
 */
export function planDeliveryAttempt(
  responseStatus: number,
  attempts: number,
  now: DateTime.Utc
): DeliveryAttemptPlan {
  const decision = classifyResponseStatus(responseStatus)
  const status = deliveryStatus(decision)
  const recorded = recordedResponseStatus(responseStatus)
  if (decision !== 'retry') {
    return { status, responseStatus: recorded, nextAttemptAt: null, outcome: 'ack' }
  }
  const nextAttemptAt = DateTime.formatIso(
    DateTime.addDuration(now, Duration.seconds(backoffSeconds(attempts)))
  )
  return { status, responseStatus: recorded, nextAttemptAt, outcome: 'retry' }
}

export type WebhookDeliveryAttemptInput = {
  /**
   * Delivery row id. Queue dispatch supplies the producer's reserved ID.
   * Trusted bookkeeping can originate history and generates an ID if omitted.
   */
  readonly id?: string
  readonly endpointId: string
  /**
   * Owning workspace of the endpoint, carried in the queue message. Terminal
   * statuses use it to scope their audit event.
   */
  readonly workspaceId: string
  readonly eventType: string
  readonly status: WebhookDeliveryStatus
  readonly attempts: number
  readonly responseStatus?: number | null
  readonly nextAttemptAt?: string | null
  readonly durationMs?: number | null
  readonly failureReason?: string | null
  readonly phase?: 'http' | 'terminal'
  /** Operator evidence columns, recorded from the latest attempt. */
  readonly payload: Json
  readonly requestHeaders?: Record<string, string> | null
  readonly responseBody?: string | null
  readonly replayedFrom?: string | null
}

/** Everything a replay needs to know about the row it replays. */
type ReplayableWebhookDelivery = {
  readonly id: string
  readonly endpointId: string
  readonly eventType: string
  readonly payload: Json
}

/**
 * The `pending` row an operator dispatch (replay, test send) starts from,
 * pure: attempts reset to zero, no response yet, and — on a replay — a
 * `replayedFrom` link to the source row. Test sends carry `null` provenance.
 * Time plays no part in the plan itself; the adapter stamps the row (its id
 * and timestamp) as it persists it, alongside the workspace it already
 * resolved.
 */
export type PendingDispatchPlan = {
  readonly endpointId: string
  readonly eventType: string
  readonly status: 'pending'
  readonly attempts: 0
  readonly nextAttemptAt: null
  readonly responseStatus: null
  readonly payload: Json
  readonly replayedFrom: string | null
}

export function planPendingDispatch(input: {
  readonly endpointId: string
  readonly eventType: string
  readonly payload: Json
  readonly replayedFrom?: string | undefined
}): PendingDispatchPlan {
  return {
    endpointId: input.endpointId,
    eventType: input.eventType,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    responseStatus: null,
    payload: input.payload,
    replayedFrom: input.replayedFrom ?? null
  }
}

/** A replay plan is a pending dispatch with provenance. */
type ReplayedDeliveryPlan = PendingDispatchPlan & {
  readonly replayedFrom: string
}

export function planReplayedDelivery(
  source: ReplayableWebhookDelivery
): ReplayedDeliveryPlan {
  return { ...planPendingDispatch(source), replayedFrom: source.id }
}

/**
 * Audit event emitted per terminal delivery status — retryable attempts stay
 * out of the governance log. Naming follows the `auth.sign_in` /
 * `auth.sign_in_failed` convention from the web app's auth audit.
 */
export const terminalDeliveryAuditEventType = new Map<
  WebhookDeliveryStatus,
  AuditEventType
>([
  ['failed_permanent', 'webhook.delivery_failed'],
  ['dead_lettered', 'webhook.delivery_dead_lettered']
])

/**
 * The workspace notification a dead-lettered delivery raises: broadcast (no
 * target user), naming the endpoint URL and attempt count so the message is
 * actionable without a query. Owned here so the Seed and Live adapters emit
 * byte-identical copy.
 */
type NotificationCopy = {
  readonly title: string
  readonly message: string
  readonly event: NotificationEvent
}

export function deadLetterNotification(input: {
  readonly eventType: string
  readonly url: string
  readonly attempts: number
}): NotificationCopy {
  return {
    title: 'Webhook delivery dead-lettered',
    message: `${input.eventType} to ${input.url} failed ${input.attempts} attempts and was moved to the dead-letter queue. Replay it from the workspace webhooks page.`,
    event: {
      type: 'webhook.dead_letter',
      eventType: input.eventType,
      endpointUrl: input.url,
      attempts: input.attempts
    }
  }
}

/**
 * The workspace-owner notice a ladder rung raises, owned here so the
 * consumer's in-app copy stays identical across environments. A rung notice
 * names the streak and what is coming; the threshold notice names what
 * already happened and the one way back (`update { enabled: true }`).
 */
export function failureLadderNotification(input: {
  readonly url: string | null
  readonly consecutiveFailures: number
}): NotificationCopy {
  const target = input.url ?? 'A webhook endpoint'
  if (reachedWebhookFailureThreshold(input.consecutiveFailures)) {
    return {
      title: 'Webhook endpoint auto-disabled',
      message: `${target} was disabled after ${input.consecutiveFailures} consecutive failed deliveries. Re-enable it from the workspace webhooks page once the receiver is fixed.`,
      event: {
        type: 'webhook.ladder_threshold',
        target,
        consecutiveFailures: input.consecutiveFailures
      }
    }
  }
  return {
    title: 'Webhook endpoint failing',
    message: `${target} has failed ${input.consecutiveFailures} deliveries in a row and will be disabled automatically after ${WEBHOOK_FAILURE_AUTO_DISABLE_AT} consecutive failures.`,
    event: {
      type: 'webhook.ladder_warning',
      target,
      consecutiveFailures: input.consecutiveFailures,
      disableAt: WEBHOOK_FAILURE_AUTO_DISABLE_AT
    }
  }
}
