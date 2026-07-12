import { Context, Effect, Layer } from 'effect'
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm'
import {
  appointments,
  bookingOutbox,
  confirmationAccess,
  Database,
  merchants,
  notificationIntents,
  platformWebhookDeliveries,
  platformWebhookEndpoints,
  platformWebhookEvents,
  type StoredAppointmentSnapshot
} from '@b2b-saas-starter/db'
import type { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'

export type BookingNotificationWork = {
  readonly outboxId: string
  readonly appointmentId: string
  readonly notificationIntentId: string
  readonly merchantId: string
  readonly merchantSlug: string
  readonly traceId: string
  readonly createdAt: string
  readonly appointmentStatus: string
  readonly appointmentUpdatedAt: string
  readonly snapshot: StoredAppointmentSnapshot
  readonly confirmation: {
    readonly routeId: string
    readonly tokenVersion: number
    readonly signingKeyId: string
    readonly expiresAt: string
  }
  readonly emailStatus:
    | 'pending'
    | 'delivered'
    | 'disabled'
    | 'needs_configuration'
    | 'failed_retryable'
    | 'failed_terminal'
  readonly emailAttemptCount: number
  readonly emailNextAttemptAt: string | null
}

export type BookingWebhookEndpoint = {
  readonly id: string
  readonly url: string
  readonly signingSecret: string
}

export type BookingWebhookEvent = {
  readonly id: string
  readonly rawBody: string
  readonly occurredAt: string
}

export type BookingDeliveryAttemptInput = {
  readonly id: string
  readonly endpointId: string
  readonly eventId: string
  readonly status:
    | 'delivered'
    | 'failed_retryable'
    | 'failed_permanent'
    | 'dead_lettered'
  readonly failureCode:
    | 'network_error'
    | 'timeout'
    | 'http_status'
    | 'invalid_destination'
    | 'retries_exhausted'
    | null
  readonly attemptNumber: number
  readonly responseStatus: number | null
  readonly durationMs: number
  readonly attemptedAt: string
  readonly nextAttemptAt: string | null
}

export type BookingNotificationOutboxShape = {
  readonly claim: (
    outboxId: string,
    now: string
  ) => Effect.Effect<BookingNotificationWork | null, CapabilityUnavailable>
  readonly recoverable: (
    now: string,
    limit?: number
  ) => Effect.Effect<readonly string[], CapabilityUnavailable>
  readonly recordEmail: (
    outboxId: string,
    status:
      | 'delivered'
      | 'disabled'
      | 'needs_configuration'
      | 'failed_retryable'
      | 'failed_terminal',
    failureCode: string | null,
    attemptCount: number,
    nextAttemptAt: string | null
  ) => Effect.Effect<void, CapabilityUnavailable>
  readonly ensureEvent: (
    work: BookingNotificationWork
  ) => Effect.Effect<BookingWebhookEvent, CapabilityUnavailable>
  readonly endpoints: (
    merchantId: string
  ) => Effect.Effect<readonly BookingWebhookEndpoint[], CapabilityUnavailable>
  readonly attempts: (
    eventId: string,
    endpointId: string
  ) => Effect.Effect<
    readonly { attemptNumber: number; status: string; nextAttemptAt: string | null }[],
    CapabilityUnavailable
  >
  readonly recordAttempt: (
    input: BookingDeliveryAttemptInput
  ) => Effect.Effect<void, CapabilityUnavailable>
  readonly finish: (
    outboxId: string,
    webhookStatus: 'pending' | 'completed' | 'dead_lettered',
    processedAt: string | null
  ) => Effect.Effect<void, CapabilityUnavailable>
}

export class BookingNotificationOutbox extends Context.Service<
  BookingNotificationOutbox,
  BookingNotificationOutboxShape
>()('@b2b-saas-starter/capabilities/BookingNotificationOutbox') {}

export const SeedBookingNotificationOutbox: Layer.Layer<BookingNotificationOutbox> =
  Layer.succeed(BookingNotificationOutbox)({
    claim: () => Effect.succeed(null),
    recoverable: () => Effect.succeed([]),
    recordEmail: () => Effect.void,
    ensureEvent: () => Effect.die('seed booking notification event unavailable'),
    endpoints: () => Effect.succeed([]),
    attempts: () => Effect.succeed([]),
    recordAttempt: () => Effect.void,
    finish: () => Effect.void
  })

const unavailable = orUnavailable('booking-notifications')

export const LiveBookingNotificationOutbox: Layer.Layer<
  BookingNotificationOutbox,
  never,
  Database
> = Layer.effect(BookingNotificationOutbox)(
  Effect.gen(function* () {
    const db = yield* Database
    const read = (outboxId: string) =>
      unavailable(
        db
          .select({
            outbox: bookingOutbox,
            appointment: appointments,
            access: confirmationAccess,
            merchantSlug: merchants.slug
          })
          .from(bookingOutbox)
          .innerJoin(appointments, eq(appointments.id, bookingOutbox.appointmentId))
          .innerJoin(
            confirmationAccess,
            eq(confirmationAccess.appointmentId, appointments.id)
          )
          .innerJoin(merchants, eq(merchants.id, appointments.merchantId))
          .where(eq(bookingOutbox.id, outboxId))
          .limit(1)
      )
    return {
      claim: (outboxId, now) =>
        Effect.gen(function* () {
          const stale = new Date(Date.parse(now) - 60_000).toISOString()
          const claimed = yield* unavailable(
            db
              .update(bookingOutbox)
              .set({ claimedAt: now })
              .where(
                and(
                  eq(bookingOutbox.id, outboxId),
                  isNull(bookingOutbox.processedAt),
                  or(
                    isNull(bookingOutbox.claimedAt),
                    lt(bookingOutbox.claimedAt, stale)
                  )
                )
              )
              .returning({ id: bookingOutbox.id })
          )
          if (claimed.length === 0) return null
          const row = (yield* read(outboxId))[0]
          if (!row || !row.appointment.snapshot) return null
          if (!row.outbox.notificationIntentId) return null
          yield* unavailable(
            db
              .update(notificationIntents)
              .set({ status: 'processing', updatedAt: now })
              .where(eq(notificationIntents.id, row.outbox.notificationIntentId))
          )
          return {
            outboxId: row.outbox.id,
            appointmentId: row.appointment.id,
            notificationIntentId: row.outbox.notificationIntentId,
            merchantId: row.appointment.merchantId,
            merchantSlug: row.merchantSlug,
            traceId: row.outbox.traceId,
            createdAt: row.outbox.createdAt,
            appointmentStatus: row.appointment.status,
            appointmentUpdatedAt: row.appointment.updatedAt,
            snapshot: row.appointment.snapshot,
            confirmation: {
              routeId: row.access.routeId,
              tokenVersion: row.access.tokenVersion,
              signingKeyId: row.access.signingKeyId,
              expiresAt: row.access.expiresAt
            },
            emailStatus: row.outbox.emailStatus,
            emailAttemptCount: row.outbox.emailAttemptCount,
            emailNextAttemptAt: row.outbox.emailNextAttemptAt
          }
        }),
      recoverable: (now, limit = 100) =>
        unavailable(
          db
            .select({ id: bookingOutbox.id })
            .from(bookingOutbox)
            .where(
              and(
                isNull(bookingOutbox.processedAt),
                or(
                  isNull(bookingOutbox.claimedAt),
                  lt(
                    bookingOutbox.claimedAt,
                    new Date(Date.parse(now) - 60_000).toISOString()
                  )
                )
              )
            )
            .orderBy(asc(bookingOutbox.createdAt))
            .limit(limit)
        ).pipe(Effect.map((rows) => rows.map((row) => row.id))),
      recordEmail: (outboxId, status, failureCode, attemptCount, nextAttemptAt) =>
        unavailable(
          db
            .update(bookingOutbox)
            .set({
              emailStatus: status,
              emailFailureCode: failureCode,
              emailAttemptCount: attemptCount,
              emailNextAttemptAt: nextAttemptAt
            })
            .where(eq(bookingOutbox.id, outboxId))
        ).pipe(Effect.asVoid),
      ensureEvent: (work) =>
        Effect.gen(function* () {
          const id = `evt_${work.outboxId.replace(/^out_/, '')}`
          const rawBody = JSON.stringify({
            id,
            type: 'appointment.created',
            schemaVersion: 1,
            occurredAt: work.createdAt,
            merchantId: work.merchantId,
            data: {
              appointmentId: work.appointmentId,
              status: work.appointmentStatus,
              updatedAt: work.appointmentUpdatedAt
            }
          })
          yield* unavailable(
            db
              .insert(platformWebhookEvents)
              .values({
                id,
                outboxId: work.outboxId,
                merchantId: work.merchantId,
                eventType: 'appointment.created',
                rawBody,
                occurredAt: work.createdAt,
                createdAt: work.createdAt
              })
              .onConflictDoNothing()
          )
          const row = (yield* unavailable(
            db
              .select()
              .from(platformWebhookEvents)
              .where(eq(platformWebhookEvents.outboxId, work.outboxId))
              .limit(1)
          ))[0]
          if (!row) return yield* Effect.die('webhook event missing after insert')
          return { id: row.id, rawBody: row.rawBody, occurredAt: row.occurredAt }
        }),
      endpoints: (merchantId) =>
        unavailable(
          db
            .select({
              id: platformWebhookEndpoints.id,
              url: platformWebhookEndpoints.url,
              signingSecret: platformWebhookEndpoints.signingSecret,
              events: platformWebhookEndpoints.events
            })
            .from(platformWebhookEndpoints)
            .where(
              and(
                eq(platformWebhookEndpoints.merchantId, merchantId),
                eq(platformWebhookEndpoints.status, 'active')
              )
            )
        ).pipe(
          Effect.map((rows) =>
            rows
              .filter((row) => row.events.includes('appointment.created'))
              .map(({ events: _, ...row }) => row)
          )
        ),
      attempts: (eventId, endpointId) =>
        unavailable(
          db
            .select({
              attemptNumber: platformWebhookDeliveries.attemptNumber,
              status: platformWebhookDeliveries.status,
              nextAttemptAt: platformWebhookDeliveries.nextAttemptAt
            })
            .from(platformWebhookDeliveries)
            .where(
              and(
                eq(platformWebhookDeliveries.eventId, eventId),
                eq(platformWebhookDeliveries.endpointId, endpointId)
              )
            )
            .orderBy(asc(platformWebhookDeliveries.attemptNumber))
        ),
      recordAttempt: (input) =>
        unavailable(
          db.insert(platformWebhookDeliveries).values({
            ...input,
            eventType: 'appointment.created'
          })
        ).pipe(Effect.asVoid),
      finish: (outboxId, webhookStatus, processedAt) =>
        Effect.gen(function* () {
          const rows = yield* unavailable(
            db
              .update(bookingOutbox)
              .set({ webhookStatus, processedAt, claimedAt: null })
              .where(eq(bookingOutbox.id, outboxId))
              .returning({
                notificationIntentId: bookingOutbox.notificationIntentId,
                emailStatus: bookingOutbox.emailStatus
              })
          )
          const intentId = rows[0]?.notificationIntentId
          if (intentId && processedAt)
            yield* unavailable(
              db
                .update(notificationIntents)
                .set({
                  status:
                    rows[0]!.emailStatus === 'disabled'
                      ? 'cancelled'
                      : webhookStatus === 'dead_lettered' ||
                          rows[0]!.emailStatus === 'needs_configuration' ||
                          rows[0]!.emailStatus === 'failed_terminal'
                        ? 'failed'
                        : 'delivered',
                  updatedAt: processedAt
                })
                .where(eq(notificationIntents.id, intentId))
            )
        })
    }
  })
)
