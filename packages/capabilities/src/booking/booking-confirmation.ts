import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq, gt, sql } from 'drizzle-orm'
import {
  appointments,
  batch,
  bookingOutbox,
  bookingSessionAdditionalServices,
  bookingSessions,
  confirmationAccess,
  Database,
  merchants,
  timeSlotHolds,
  type StoredAppointmentSnapshot
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { randomHex } from '../internal/crypto.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import type { BookingSession } from './booking-sessions.ts'
import type { SeedBookingCheckoutStore } from './booking-checkout.ts'
import type { SeedBookingSessionStore } from './booking-sessions.ts'

export type ConfirmationSigningKeyring = {
  readonly currentKeyId: string
  readonly keys: Readonly<Record<string, string>>
}

export const Appointment = Schema.Struct({
  id: Schema.String,
  merchantId: Schema.String,
  providerId: Schema.String,
  status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
  startsAt: Schema.String,
  endsAt: Schema.String,
  snapshot: Schema.Unknown,
  createdAt: Schema.String
})
export type Appointment = typeof Appointment.Type

export const ConfirmationAccess = Schema.Struct({
  routeId: Schema.String,
  tokenVersion: Schema.Number,
  signingKeyId: Schema.String,
  expiresAt: Schema.String,
  token: Schema.String
})
export type ConfirmationAccess = typeof ConfirmationAccess.Type

export const BookingConfirmationResult = Schema.Struct({
  appointment: Appointment,
  access: ConfirmationAccess,
  outboxId: Schema.String,
  replayed: Schema.Boolean
})
export type BookingConfirmationResult = typeof BookingConfirmationResult.Type

export class BookingConfirmationRejected extends Schema.TaggedErrorClass<BookingConfirmationRejected>()(
  'BookingConfirmationRejected',
  {
    reason: Schema.Literals(['hold_expired', 'details_missing', 'conflict']),
    message: Schema.String
  }
) {}

type Failure = BookingConfirmationRejected | CapabilityUnavailable
const AppointmentSnapshot = Schema.Unknown as Schema.Schema<StoredAppointmentSnapshot>
export const CustomerConfirmation = Schema.Struct({
  routeId: Schema.String,
  status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
  startsAt: Schema.String,
  endsAt: Schema.String,
  snapshot: AppointmentSnapshot,
  merchant: Schema.Struct({ publicName: Schema.String })
})
export type CustomerConfirmation = typeof CustomerConfirmation.Type
export const ConfirmationReadResult = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('found'),
    confirmation: CustomerConfirmation,
    cookieCredential: Schema.String
  }),
  Schema.Struct({ kind: Schema.Literal('expired') }),
  Schema.Struct({ kind: Schema.Literal('not_found') })
])
export type ConfirmationReadResult = typeof ConfirmationReadResult.Type
export type BookingConfirmationShape = {
  readonly confirm: (
    session: BookingSession,
    input: { readonly now: string; readonly traceId: string }
  ) => Effect.Effect<BookingConfirmationResult, Failure>
  readonly read: (input: {
    readonly routeId: string
    readonly merchantSlug: string
    readonly credential: string
    readonly credentialKind: 'bearer' | 'cookie'
    readonly now: string
  }) => Effect.Effect<ConfirmationReadResult, CapabilityUnavailable>
}
export class BookingConfirmation extends Context.Service<
  BookingConfirmation,
  BookingConfirmationShape
>()('@b2b-saas-starter/capabilities/BookingConfirmation') {}

const addMillisecondsToIso = (instant: string, milliseconds: number) =>
  new Date(Date.parse(instant) + milliseconds).toISOString()

const hmac = async (key: string, value: string): Promise<string> => {
  const imported = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const bytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(value))
  )
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const deriveConfirmationToken = (
  metadata: Omit<ConfirmationAccess, 'token'>,
  keyring: ConfirmationSigningKeyring
): Promise<string> => {
  const key = keyring.keys[metadata.signingKeyId]
  if (!key) return Promise.reject(new Error('Unknown Confirmation signing key'))
  return hmac(
    key,
    `${metadata.routeId}.${metadata.tokenVersion}.${metadata.expiresAt}.${metadata.signingKeyId}`
  )
}

export const deriveConfirmationCookieCredential = (
  metadata: Omit<ConfirmationAccess, 'token'>,
  keyring: ConfirmationSigningKeyring
): Promise<string> => {
  const key = keyring.keys[metadata.signingKeyId]
  if (!key) return Promise.reject(new Error('Unknown Confirmation signing key'))
  return hmac(
    key,
    `cookie.${metadata.routeId}.${metadata.tokenVersion}.${metadata.expiresAt}.${metadata.signingKeyId}`
  )
}

export const verifyConfirmationToken = async (
  metadata: Omit<ConfirmationAccess, 'token'> & { readonly revokedAt?: string | null },
  presentedToken: string,
  keyring: ConfirmationSigningKeyring,
  now: string
): Promise<boolean> => {
  if (metadata.revokedAt || metadata.expiresAt <= now) return false
  let expected: string
  try {
    expected = await deriveConfirmationToken(metadata, keyring)
  } catch {
    return false
  }
  const length = Math.max(expected.length, presentedToken.length)
  let difference = expected.length ^ presentedToken.length
  for (let index = 0; index < length; index += 1) {
    difference |=
      (expected.charCodeAt(index) || 0) ^ (presentedToken.charCodeAt(index) || 0)
  }
  return difference === 0
}

const rejected = (reason: BookingConfirmationRejected['reason']) =>
  new BookingConfirmationRejected({
    reason,
    message:
      reason === 'hold_expired'
        ? 'Your held time is no longer available'
        : reason === 'details_missing'
          ? 'Add your details to continue'
          : 'This appointment has already been confirmed'
  })

export type SeedBookingConfirmationStore = {
  readonly sessions: SeedBookingSessionStore
  readonly checkout: SeedBookingCheckoutStore
  readonly appointments: Map<string, Appointment>
  readonly access: Map<string, Omit<ConfirmationAccess, 'token'>>
  readonly outbox: Map<
    string,
    { readonly appointmentId: string; readonly traceId: string }
  >
}

export const emptySeedBookingConfirmationStore = (
  sessions: SeedBookingSessionStore,
  checkout: SeedBookingCheckoutStore
): SeedBookingConfirmationStore => ({
  sessions,
  checkout,
  appointments: new Map(),
  access: new Map(),
  outbox: new Map()
})

export const SeedBookingConfirmation = (
  store: SeedBookingConfirmationStore,
  keyring: ConfirmationSigningKeyring
): Layer.Layer<BookingConfirmation> =>
  Layer.succeed(BookingConfirmation)({
    read: (input) =>
      Effect.gen(function* () {
        const metadata = store.access.get(input.routeId)
        const appointment = [...store.appointments.values()].find(
          (candidate) => `cnf_${candidate.id}` === input.routeId
        )
        if (
          !metadata ||
          !appointment ||
          store.checkout.scheduling.scenario.merchant.slug !== input.merchantSlug
        )
          return { kind: 'not_found' as const }
        const expected = yield* Effect.promise(() =>
          (input.credentialKind === 'bearer'
            ? deriveConfirmationToken(metadata, keyring)
            : deriveConfirmationCookieCredential(metadata, keyring)
          ).catch(() => '')
        )
        const valid = metadata.expiresAt > input.now && expected === input.credential
        if (!valid) {
          return expected === input.credential && metadata.expiresAt <= input.now
            ? { kind: 'expired' as const }
            : { kind: 'not_found' as const }
        }
        return {
          kind: 'found' as const,
          cookieCredential: yield* Effect.promise(() =>
            deriveConfirmationCookieCredential(metadata, keyring)
          ),
          confirmation: {
            routeId: input.routeId,
            status: appointment.status,
            startsAt: appointment.startsAt,
            endsAt: appointment.endsAt,
            snapshot: appointment.snapshot as StoredAppointmentSnapshot,
            merchant: {
              publicName: store.checkout.scheduling.scenario.merchant.publicName
            }
          }
        }
      }),
    confirm: (session, input) =>
      Effect.gen(function* () {
        const record = store.sessions.sessions.get(session.id)
        if (record?.confirmedAppointmentId && record.replayExpiresAt! > input.now) {
          const appointment = store.appointments.get(record.confirmedAppointmentId)!
          const access = [...store.access.values()].find(
            (candidate) => candidate.routeId === `cnf_${appointment.id}`
          )!
          const outboxId = [...store.outbox.entries()].find(
            ([, value]) => value.appointmentId === appointment.id
          )![0]
          return {
            appointment,
            access: {
              ...access,
              token: yield* Effect.promise(() =>
                deriveConfirmationToken(access, keyring)
              )
            },
            outboxId,
            replayed: true
          }
        }
        const hold = [...store.checkout.scheduling.holds.values()].find(
          (candidate) =>
            candidate.bookingSessionId === session.id && candidate.expiresAt > input.now
        )
        if (!hold) return yield* rejected('hold_expired')
        const details = store.checkout.details.get(session.id)
        if (!details) return yield* rejected('details_missing')
        if (!record || record.lifecycle !== 'active') return yield* rejected('conflict')
        const appointmentId = `apt_${session.id}`
        const routeId = `cnf_${appointmentId}`
        const outboxId = `obx_${appointmentId}`
        const appointment: Appointment = {
          id: appointmentId,
          merchantId: record.merchantId,
          providerId: hold.providerId,
          status: 'scheduled',
          startsAt: hold.startsAt,
          endsAt: hold.endsAt,
          snapshot: {
            ...hold.quote,
            merchantTimezone: store.checkout.scheduling.scenario.merchant.timezone,
            customerDetails: details,
            checkoutPath: 'pay_in_person'
          },
          createdAt: input.now
        }
        const access = {
          routeId,
          tokenVersion: 1,
          signingKeyId: keyring.currentKeyId,
          expiresAt: addMillisecondsToIso(hold.endsAt, 30 * 24 * 60 * 60_000)
        }
        store.appointments.set(appointmentId, appointment)
        store.access.set(routeId, access)
        store.outbox.set(outboxId, { appointmentId, traceId: input.traceId })
        store.checkout.scheduling.holds.delete(hold.id)
        store.checkout.details.delete(session.id)
        store.sessions.sessions.set(session.id, {
          ...record,
          lifecycle: 'consumed',
          confirmedAppointmentId: appointmentId,
          replayExpiresAt: addMillisecondsToIso(input.now, 24 * 60 * 60_000)
        })
        return {
          appointment,
          access: {
            ...access,
            token: yield* Effect.promise(() => deriveConfirmationToken(access, keyring))
          },
          outboxId,
          replayed: false
        }
      })
  })

const resultFrom = async (
  row: {
    appointment: typeof appointments.$inferSelect
    access: typeof confirmationAccess.$inferSelect
    outboxId: string
  },
  keyring: ConfirmationSigningKeyring,
  replayed: boolean
): Promise<BookingConfirmationResult> => {
  const metadata = {
    routeId: row.access.routeId,
    tokenVersion: row.access.tokenVersion,
    signingKeyId: row.access.signingKeyId,
    expiresAt: row.access.expiresAt
  }
  return {
    appointment: {
      id: row.appointment.id,
      merchantId: row.appointment.merchantId,
      providerId: row.appointment.providerId,
      status: 'scheduled',
      startsAt: row.appointment.startsAt,
      endsAt: row.appointment.endsAt,
      snapshot: row.appointment.snapshot!,
      createdAt: row.appointment.createdAt
    },
    access: { ...metadata, token: await deriveConfirmationToken(metadata, keyring) },
    outboxId: row.outboxId,
    replayed
  }
}

export const LiveBookingConfirmation = (
  keyring: ConfirmationSigningKeyring
): Layer.Layer<BookingConfirmation, never, Database> =>
  Layer.effect(
    BookingConfirmation,
    Effect.gen(function* () {
      const db = yield* Database
      const readCommitted = (sessionId: string) =>
        orUnavailable('booking-confirmation')(
          db
            .select({
              appointment: appointments,
              access: confirmationAccess,
              outboxId: bookingOutbox.id
            })
            .from(appointments)
            .innerJoin(
              confirmationAccess,
              eq(confirmationAccess.appointmentId, appointments.id)
            )
            .innerJoin(bookingOutbox, eq(bookingOutbox.appointmentId, appointments.id))
            .where(eq(appointments.bookingSessionId, sessionId))
            .limit(1)
        )
      return {
        read: (input) =>
          Effect.gen(function* () {
            const rows = yield* orUnavailable('booking-confirmation')(
              db
                .select({
                  appointment: appointments,
                  access: confirmationAccess,
                  merchantName: merchants.publicName
                })
                .from(confirmationAccess)
                .innerJoin(
                  appointments,
                  eq(appointments.id, confirmationAccess.appointmentId)
                )
                .innerJoin(merchants, eq(merchants.id, appointments.merchantId))
                .where(
                  and(
                    eq(confirmationAccess.routeId, input.routeId),
                    eq(merchants.slug, input.merchantSlug)
                  )
                )
                .limit(1)
            )
            const row = rows[0]
            if (!row) return { kind: 'not_found' as const }
            const metadata = {
              routeId: row.access.routeId,
              tokenVersion: row.access.tokenVersion,
              signingKeyId: row.access.signingKeyId,
              expiresAt: row.access.expiresAt,
              revokedAt: row.access.revokedAt
            }
            const expected = yield* Effect.promise(() =>
              (input.credentialKind === 'bearer'
                ? deriveConfirmationToken(metadata, keyring)
                : deriveConfirmationCookieCredential(metadata, keyring)
              ).catch(() => '')
            )
            const valid =
              !metadata.revokedAt &&
              metadata.expiresAt > input.now &&
              expected === input.credential
            if (!valid) {
              if (!metadata.revokedAt && metadata.expiresAt <= input.now) {
                if (expected === input.credential) return { kind: 'expired' as const }
              }
              return { kind: 'not_found' as const }
            }
            return {
              kind: 'found' as const,
              cookieCredential: yield* Effect.promise(() =>
                deriveConfirmationCookieCredential(metadata, keyring)
              ),
              confirmation: {
                routeId: row.access.routeId,
                status: row.appointment.status,
                startsAt: row.appointment.startsAt,
                endsAt: row.appointment.endsAt,
                snapshot: row.appointment.snapshot!,
                merchant: { publicName: row.merchantName }
              }
            }
          }),
        confirm: (session, input) =>
          Effect.gen(function* () {
            const replay = (yield* readCommitted(session.id))[0]
            if (replay) {
              const sessionRows = yield* orUnavailable('booking-confirmation')(
                db
                  .select({ replayExpiresAt: bookingSessions.replayExpiresAt })
                  .from(bookingSessions)
                  .where(eq(bookingSessions.id, session.id))
                  .limit(1)
              )
              if (
                !sessionRows[0]?.replayExpiresAt ||
                sessionRows[0].replayExpiresAt <= input.now
              ) {
                return yield* rejected('conflict')
              }
              return yield* Effect.promise(() => resultFrom(replay, keyring, true))
            }

            const rows = yield* orUnavailable('booking-confirmation')(
              db
                .select({
                  session: bookingSessions,
                  hold: timeSlotHolds,
                  timezone: merchants.timezone
                })
                .from(bookingSessions)
                .innerJoin(merchants, eq(merchants.id, bookingSessions.merchantId))
                .innerJoin(
                  timeSlotHolds,
                  and(
                    eq(timeSlotHolds.bookingSessionId, bookingSessions.id),
                    gt(timeSlotHolds.expiresAt, input.now)
                  )
                )
                .where(
                  and(
                    eq(bookingSessions.id, session.id),
                    eq(bookingSessions.lifecycle, 'active')
                  )
                )
                .limit(1)
            )
            const row = rows[0]
            if (!row) return yield* rejected('hold_expired')
            if (!row.session.customerName || !row.session.customerEmail)
              return yield* rejected('details_missing')

            const appointmentId = `apt_${randomHex(16)}`
            const routeId = `cnf_${randomHex(16)}`
            const outboxId = `obx_${randomHex(16)}`
            const replayExpiresAt = addMillisecondsToIso(input.now, 24 * 60 * 60_000)
            const expiresAt = addMillisecondsToIso(
              row.hold.endsAt,
              30 * 24 * 60 * 60_000
            )
            const snapshot: StoredAppointmentSnapshot = {
              ...row.hold.quote,
              merchantTimezone: row.timezone,
              customerDetails: {
                name: row.session.customerName,
                email: row.session.customerEmail,
                phone: row.session.customerPhone
              },
              checkoutPath: 'pay_in_person'
            }
            const accessMetadata = {
              routeId,
              appointmentId,
              tokenVersion: 1,
              signingKeyId: keyring.currentKeyId,
              expiresAt,
              revokedAt: null,
              createdAt: input.now
            }
            if (!keyring.keys[keyring.currentKeyId])
              return yield* new CapabilityUnavailable({
                capability: 'booking-confirmation',
                reason: 'Current signing key is unavailable'
              })
            const statements = [
              db.insert(appointments).select(
                db
                  .select({
                    id: sql<string>`${appointmentId}`.as('id'),
                    merchantId: timeSlotHolds.merchantId,
                    providerId: timeSlotHolds.providerId,
                    bookingSessionId: timeSlotHolds.bookingSessionId,
                    status: sql<'scheduled'>`'scheduled'`.as('status'),
                    startsAt: timeSlotHolds.startsAt,
                    endsAt: timeSlotHolds.endsAt,
                    snapshot:
                      sql<StoredAppointmentSnapshot>`${JSON.stringify(snapshot)}`.as(
                        'snapshot'
                      ),
                    createdAt: sql<string>`${input.now}`.as('created_at'),
                    updatedAt: sql<string>`${input.now}`.as('updated_at')
                  })
                  .from(timeSlotHolds)
                  .innerJoin(
                    bookingSessions,
                    and(
                      eq(bookingSessions.id, timeSlotHolds.bookingSessionId),
                      eq(bookingSessions.lifecycle, 'active')
                    )
                  )
                  .where(
                    and(
                      eq(timeSlotHolds.id, row.hold.id),
                      gt(timeSlotHolds.expiresAt, input.now)
                    )
                  )
              ),
              db.insert(confirmationAccess).values(accessMetadata),
              db.insert(bookingOutbox).values({
                id: outboxId,
                appointmentId,
                kind: 'appointment.created',
                traceId: input.traceId,
                createdAt: input.now
              }),
              db
                .delete(timeSlotHolds)
                .where(
                  and(
                    eq(timeSlotHolds.id, row.hold.id),
                    gt(timeSlotHolds.expiresAt, input.now)
                  )
                ),
              db
                .delete(bookingSessionAdditionalServices)
                .where(
                  eq(bookingSessionAdditionalServices.bookingSessionId, session.id)
                ),
              db
                .update(bookingSessions)
                .set({
                  lifecycle: 'consumed',
                  confirmedAppointmentId: appointmentId,
                  confirmedAt: input.now,
                  replayExpiresAt,
                  checkoutPath: null,
                  providerPreference: null,
                  providerId: null,
                  primaryServiceId: null,
                  customerName: null,
                  customerEmail: null,
                  customerPhone: null
                })
                .where(
                  and(
                    eq(bookingSessions.id, session.id),
                    eq(bookingSessions.lifecycle, 'active')
                  )
                )
            ]
            const committed = yield* Effect.result(batch(db, statements))
            if (committed._tag === 'Failure') {
              const raced = (yield* readCommitted(session.id))[0]
              if (raced)
                return yield* Effect.promise(() => resultFrom(raced, keyring, true))
              return yield* rejected('conflict')
            }
            const stored = (yield* readCommitted(session.id))[0]
            if (!stored)
              return yield* new CapabilityUnavailable({
                capability: 'booking-confirmation',
                reason: 'Committed Appointment could not be read'
              })
            return yield* Effect.promise(() => resultFrom(stored, keyring, false))
          })
      }
    })
  )
