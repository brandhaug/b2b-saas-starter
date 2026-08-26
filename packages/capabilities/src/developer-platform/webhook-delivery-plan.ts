import { DateTime, Duration, Schema } from 'effect'

import { type AuditEventType } from '../governance/audit-event-taxonomy.ts'

/** A recorded delivery attempt, newest first in `listDeliveries`. */
export const WebhookDelivery = Schema.Struct({
  id: Schema.String,
  endpointId: Schema.String,
  eventType: Schema.String,
  status: Schema.String,
  attempts: Schema.Number,
  lastAttemptAt: Schema.NullOr(Schema.String),
  nextAttemptAt: Schema.NullOr(Schema.String),
  responseStatus: Schema.NullOr(Schema.Number)
})
export type WebhookDelivery = typeof WebhookDelivery.Type

export type ListWebhookDeliveriesInput = {
  readonly endpointId: string
}

/**
 * Delivery status vocabulary (free-text column, keep these values consistent):
 * - `delivered` — 2xx response.
 * - `failed` — retryable failure (5xx, 408, 429, network error, timeout); the
 *   queue will redeliver and `nextAttemptAt` is set.
 * - `failed_permanent` — terminal failure (non-retryable 4xx, or the endpoint
 *   URL failed the SSRF guard at dispatch); the message is acked.
 * - `dead_lettered` — the message exhausted `maxRetries` and was consumed from
 *   the dead-letter queue.
 */
export type WebhookDeliveryStatus =
  | 'delivered'
  | 'failed'
  | 'failed_permanent'
  | 'dead_lettered'

/**
 * Redelivery backoff: 30s per attempt, capped at six attempts (180s). The
 * queue retry delay and the persisted `nextAttemptAt` are derived from this
 * one function, so the stored schedule matches when Cloudflare will actually
 * redeliver.
 */
export function backoffSeconds(attempts: number): number {
  return Math.min(attempts, 6) * 30
}

export type DeliveryDecision = 'delivered' | 'retry' | 'terminal'

/**
 * Ack/retry/terminal decision per response status. `0` means no HTTP response
 * (network error or timeout) and is retryable. 4xx responses are permanent
 * failures except 408 (request timeout) and 429 (rate limited).
 */
export function classifyResponseStatus(status: number): DeliveryDecision {
  if (status >= 200 && status < 300) return 'delivered'
  if (status === 408 || status === 429) return 'retry'
  if (status >= 400 && status < 500) return 'terminal'
  return 'retry'
}

/** Persisted `webhookDeliveries.status` for a dispatch decision. */
function deliveryStatus(
  decision: DeliveryDecision
): 'delivered' | 'failed_permanent' | 'failed' {
  if (decision === 'delivered') return 'delivered'
  if (decision === 'terminal') return 'failed_permanent'
  return 'failed'
}

/** `0` stands for "no HTTP response at all", which is persisted as null. */
function recordedResponseStatus(status: number): number | null {
  if (status === 0) return null
  return status
}

/** Everything a dispatch needs to persist its attempt row and answer the queue. */
export type DeliveryAttemptPlan = {
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
   * Delivery row id. The background worker mints it before dispatch so the
   * signed payload's `deliveryId` matches the persisted row. Generated here
   * when omitted.
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
