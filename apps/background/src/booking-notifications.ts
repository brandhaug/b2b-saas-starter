import { Effect, Result } from 'effect'
import { HttpBody, HttpClient } from 'effect/unstable/http'
import {
  BookingNotificationOutbox,
  type ConfirmationSigningKeyring
} from '@b2b-saas-starter/capabilities/booking'
import { validateWebhookUrl } from '@b2b-saas-starter/capabilities/developer-platform'
import type { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'

export const BOOKING_RETRY_DELAYS = [30, 60, 90, 120, 150, 180] as const
export type OperationalEmailProviderState =
  | 'disabled'
  | 'needs_configuration'
  | 'configured'

export const classifyBookingResponse = (
  statusCode: number | null,
  attemptNumber: number
) => {
  if (statusCode !== null && statusCode >= 200 && statusCode < 300)
    return { status: 'delivered' as const, retryDelay: null }
  const retryable =
    statusCode === null ||
    statusCode === 408 ||
    statusCode === 429 ||
    (statusCode >= 500 && statusCode < 600)
  if (!retryable) return { status: 'failed_permanent' as const, retryDelay: null }
  if (attemptNumber >= 7) return { status: 'dead_lettered' as const, retryDelay: null }
  return {
    status: 'failed_retryable' as const,
    retryDelay: BOOKING_RETRY_DELAYS[attemptNumber - 1]!
  }
}

const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )

export const signBookingWebhook = async (
  secret: string,
  timestamp: number,
  rawBody: string
) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${rawBody}`)
    )
  )
}

const id = (prefix: 'dlv') => {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return `${prefix}_${hex(bytes.buffer)}`
}

export const processBookingOutbox = (input: {
  readonly outboxId: string
  readonly now: string
  readonly publicOrigin: string
  readonly emailProviderState: OperationalEmailProviderState
  readonly confirmationKeyring: ConfirmationSigningKeyring
  readonly scheduleRetry?: (outboxId: string, delaySeconds: number) => Promise<unknown>
}): Effect.Effect<
  void,
  CapabilityUnavailable,
  BookingNotificationOutbox | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const store = yield* BookingNotificationOutbox
    const work = yield* store.claim(input.outboxId, input.now)
    if (!work) return
    const emailRetryPending = false
    if (
      work.emailStatus === 'pending' ||
      work.emailStatus === 'needs_configuration' ||
      work.emailStatus === 'failed_retryable'
    )
      yield* store.recordEmail(
        work.outboxId,
        'disabled',
        'migrated_to_appointment_email_intent',
        work.emailAttemptCount,
        null
      )

    const event = yield* store.ensureEvent(work)
    const endpoints = yield* store.endpoints(work.merchantId)
    const client = yield* HttpClient.HttpClient
    let pending = false
    let deadLettered = false
    for (const endpoint of endpoints) {
      const history = yield* store.attempts(event.id, endpoint.id)
      const last = history.at(-1)
      if (
        last?.status === 'delivered' ||
        last?.status === 'failed_permanent' ||
        last?.status === 'dead_lettered'
      ) {
        if (last.status === 'dead_lettered') deadLettered = true
        continue
      }
      if (last?.nextAttemptAt && last.nextAttemptAt > input.now) {
        pending = true
        continue
      }
      const attemptNumber = (last?.attemptNumber ?? 0) + 1
      const attemptedAt = input.now
      const deliveryId = id('dlv')
      const started = Date.now()
      const destination = validateWebhookUrl(endpoint.url)
      if (!destination.valid) {
        yield* store.recordAttempt({
          id: deliveryId,
          endpointId: endpoint.id,
          eventId: event.id,
          status: 'failed_permanent',
          failureCode: 'invalid_destination',
          attemptNumber,
          responseStatus: null,
          durationMs: Date.now() - started,
          attemptedAt,
          nextAttemptAt: null
        })
        continue
      }
      const timestamp = Math.floor(Date.parse(attemptedAt) / 1000)
      const signature = yield* Effect.promise(() =>
        signBookingWebhook(endpoint.signingSecret, timestamp, event.rawBody)
      )
      const response = yield* Effect.result(
        client
          .post(endpoint.url, {
            headers: {
              'content-type': 'application/json',
              'Webhook-Event': 'appointment.created',
              'Webhook-Event-Id': event.id,
              'Webhook-Delivery-Id': deliveryId,
              'Webhook-Timestamp': String(timestamp),
              'Webhook-Signature': `t=${timestamp},v1=${signature}`,
              'x-trace-id': work.traceId
            },
            body: HttpBody.text(event.rawBody, 'application/json')
          })
          .pipe(Effect.timeout('10 seconds'))
      )
      const durationMs = Date.now() - started
      const statusCode = Result.isSuccess(response) ? response.success.status : null
      const decision = classifyBookingResponse(statusCode, attemptNumber)
      if (decision.status === 'delivered') {
        yield* store.recordAttempt({
          id: deliveryId,
          endpointId: endpoint.id,
          eventId: event.id,
          status: 'delivered',
          failureCode: null,
          attemptNumber,
          responseStatus: statusCode,
          durationMs,
          attemptedAt,
          nextAttemptAt: null
        })
      } else if (decision.status === 'failed_retryable') {
        const nextAttemptAt = new Date(
          Date.parse(attemptedAt) + decision.retryDelay * 1000
        ).toISOString()
        yield* store.recordAttempt({
          id: deliveryId,
          endpointId: endpoint.id,
          eventId: event.id,
          status: 'failed_retryable',
          failureCode:
            statusCode === null
              ? durationMs >= 10_000
                ? 'timeout'
                : 'network_error'
              : 'http_status',
          attemptNumber,
          responseStatus: statusCode,
          durationMs,
          attemptedAt,
          nextAttemptAt
        })
        if (input.scheduleRetry)
          yield* Effect.promise(() =>
            input.scheduleRetry!(work.outboxId, decision.retryDelay)
          ).pipe(Effect.catch(() => Effect.void))
        pending = true
      } else if (decision.status === 'dead_lettered') {
        yield* store.recordAttempt({
          id: deliveryId,
          endpointId: endpoint.id,
          eventId: event.id,
          status: 'dead_lettered',
          failureCode: 'retries_exhausted',
          attemptNumber,
          responseStatus: statusCode,
          durationMs,
          attemptedAt,
          nextAttemptAt: null
        })
        deadLettered = true
      } else {
        yield* store.recordAttempt({
          id: deliveryId,
          endpointId: endpoint.id,
          eventId: event.id,
          status: 'failed_permanent',
          failureCode: 'http_status',
          attemptNumber,
          responseStatus: statusCode,
          durationMs,
          attemptedAt,
          nextAttemptAt: null
        })
      }
    }
    const notificationStatus =
      pending || emailRetryPending
        ? 'pending'
        : deadLettered
          ? 'dead_lettered'
          : 'completed'
    yield* store.finish(
      work.outboxId,
      notificationStatus,
      pending || emailRetryPending ? null : input.now
    )
    yield* Effect.log('booking.notifications.processed', {
      traceId: work.traceId,
      outboxId: work.outboxId,
      notificationStatus
    })
  })

export const recoverBookingOutbox = (now: string) =>
  Effect.flatMap(BookingNotificationOutbox, (store) => store.recoverable(now))
