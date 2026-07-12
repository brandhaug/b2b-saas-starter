import { Effect, Result } from 'effect'
import { HttpBody, HttpClient } from 'effect/unstable/http'
import {
  BookingNotificationOutbox,
  deriveConfirmationToken,
  type BookingNotificationWork,
  type ConfirmationSigningKeyring
} from '@b2b-saas-starter/capabilities/booking'
import { validateWebhookUrl } from '@b2b-saas-starter/capabilities/developer-platform'
import type { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { AppointmentConfirmationEmail, EmailDispatcher } from '@b2b-saas-starter/email'

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

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100)

const sendEmail = (
  work: BookingNotificationWork,
  publicOrigin: string,
  keyring: ConfirmationSigningKeyring
) =>
  Effect.gen(function* () {
    const dispatcher = yield* EmailDispatcher
    const token = yield* Effect.promise(() =>
      deriveConfirmationToken(work.confirmation, keyring)
    )
    const url = `${publicOrigin.replace(/\/$/, '')}/${encodeURIComponent(work.merchantSlug)}/booking/confirmations/${encodeURIComponent(work.confirmation.routeId)}?token=${encodeURIComponent(token)}`
    yield* dispatcher.send({
      from: '',
      to: work.snapshot.customerDetails.email,
      subject: 'Your appointment is confirmed',
      element: AppointmentConfirmationEmail({
        startsAt: work.snapshot.startsAt,
        timeZone: work.snapshot.merchantTimezone,
        services: work.snapshot.services.map((service) => ({
          name: service.name,
          price: money(service.priceMinor, service.currency)
        })),
        total: money(work.snapshot.totalMinor, work.snapshot.currency),
        confirmationUrl: url
      })
    })
  })

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
  BookingNotificationOutbox | EmailDispatcher | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const store = yield* BookingNotificationOutbox
    const work = yield* store.claim(input.outboxId, input.now)
    if (!work) return
    let emailRetryPending = false

    if (work.emailStatus === 'pending' || work.emailStatus === 'failed_retryable') {
      const emailDue = !work.emailNextAttemptAt || work.emailNextAttemptAt <= input.now
      if (!emailDue) {
        // A queue wake-up may arrive before the durable retry deadline.
        emailRetryPending = true
      } else if (input.emailProviderState === 'disabled')
        yield* store.recordEmail(work.outboxId, 'disabled', null, 0, null)
      else if (input.emailProviderState === 'needs_configuration')
        yield* store.recordEmail(
          work.outboxId,
          'needs_configuration',
          'email_not_configured',
          0,
          null
        )
      else {
        const attemptNumber = work.emailAttemptCount + 1
        const outcome = yield* Effect.result(
          sendEmail(work, input.publicOrigin, input.confirmationKeyring).pipe(
            Effect.annotateLogs({ traceId: work.traceId, outboxId: work.outboxId })
          )
        )
        if (Result.isSuccess(outcome))
          yield* store.recordEmail(
            work.outboxId,
            'delivered',
            null,
            attemptNumber,
            null
          )
        else if (attemptNumber >= 7)
          yield* store.recordEmail(
            work.outboxId,
            'failed_terminal',
            'email_retries_exhausted',
            attemptNumber,
            null
          )
        else {
          const delay = BOOKING_RETRY_DELAYS[attemptNumber - 1]!
          const nextAttemptAt = new Date(
            Date.parse(input.now) + delay * 1000
          ).toISOString()
          yield* store.recordEmail(
            work.outboxId,
            'failed_retryable',
            'email_send_failed',
            attemptNumber,
            nextAttemptAt
          )
          if (input.scheduleRetry)
            yield* Effect.promise(() =>
              input.scheduleRetry!(work.outboxId, delay)
            ).pipe(Effect.catch(() => Effect.void))
          emailRetryPending = true
        }
      }
    }

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
    yield* store.finish(
      work.outboxId,
      pending || emailRetryPending
        ? 'pending'
        : deadLettered
          ? 'dead_lettered'
          : 'completed',
      pending || emailRetryPending ? null : input.now
    )
    yield* Effect.log('booking.notifications.processed', {
      traceId: work.traceId,
      outboxId: work.outboxId,
      webhookStatus: pending ? 'pending' : deadLettered ? 'dead_lettered' : 'completed'
    })
  })

export const recoverBookingOutbox = (now: string) =>
  Effect.flatMap(BookingNotificationOutbox, (store) => store.recoverable(now))
