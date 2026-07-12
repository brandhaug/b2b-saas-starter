import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq, gt, sql } from 'drizzle-orm'
import {
  appointments,
  batch,
  bookingOutbox,
  bookingParties,
  bookingRequests,
  bookingSessionAdditionalServices,
  bookingSessions,
  confirmationAccess,
  Database,
  merchants,
  notificationIntents,
  pricingQuoteAcceptances,
  pricingQuotes,
  policyAcceptances,
  promotionReservations,
  settlementAllocations,
  shops,
  timeSlotHolds,
  type BatchStatement,
  type StoredAppointmentSnapshot
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { randomHex } from '../internal/crypto.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import type { BookingSession } from './booking-sessions.ts'
import type { SeedBookingCheckoutStore } from './booking-checkout.ts'
import type { SeedBookingSessionStore } from './booking-sessions.ts'
import { PaymentSettlement } from '../payments/index.ts'
import type { SeedPaymentSettlementStore } from '../payments/payment-settlement.ts'

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
  bookingPartyId: Schema.optional(Schema.NullOr(Schema.String)),
  purpose: Schema.optional(
    Schema.Literals(['appointment_confirmation', 'party_confirmation'])
  ),
  tokenVersion: Schema.Number,
  signingKeyId: Schema.String,
  expiresAt: Schema.String,
  token: Schema.String
})
export type ConfirmationAccess = typeof ConfirmationAccess.Type

export const BookingConfirmationResult = Schema.Struct({
  appointment: Appointment,
  appointments: Schema.Array(Appointment),
  access: ConfirmationAccess,
  accesses: Schema.Array(ConfirmationAccess),
  outboxId: Schema.String,
  outboxIds: Schema.Array(Schema.String),
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

export class BookingConfirmationProcessing extends Schema.TaggedErrorClass<BookingConfirmationProcessing>()(
  'BookingConfirmationProcessing',
  { reason: Schema.Literal('commitment_unknown') }
) {}

type Failure =
  | BookingConfirmationRejected
  | BookingConfirmationProcessing
  | CapabilityUnavailable
const AppointmentSnapshot = Schema.Unknown as Schema.Schema<StoredAppointmentSnapshot>
const CustomerConfirmationAppointment = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
  startsAt: Schema.String,
  endsAt: Schema.String,
  snapshot: AppointmentSnapshot
})
export const CustomerConfirmation = Schema.Struct({
  routeId: Schema.String,
  status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
  startsAt: Schema.String,
  endsAt: Schema.String,
  locale: Schema.Literals(['en', 'es', 'fr', 'ro']),
  snapshot: AppointmentSnapshot,
  appointments: Schema.Array(CustomerConfirmationAppointment),
  merchant: Schema.Struct({ publicName: Schema.String })
})
export type CustomerConfirmation = typeof CustomerConfirmation.Type
export const ConfirmationReadResult = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('found'),
    confirmation: CustomerConfirmation,
    cookieCredential: Schema.String
  }),
  Schema.Struct({
    kind: Schema.Literal('expired'),
    locale: Schema.Literals(['en', 'es', 'fr', 'ro'])
  }),
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

const confirmationNotificationIntent = (input: {
  readonly id: string
  readonly shopId: string
  readonly appointmentId: string
  readonly customerEmail: string
  readonly snapshot: StoredAppointmentSnapshot
  readonly confirmationRouteId: string
  readonly now: string
}) => ({
  id: input.id,
  shopId: input.shopId,
  topic: 'appointment.confirmed',
  recipientJson: JSON.stringify({ email: input.customerEmail }),
  payloadJson: JSON.stringify({
    appointmentId: input.appointmentId,
    snapshot: input.snapshot,
    confirmationRouteId: input.confirmationRouteId
  }),
  sourceType: 'appointment',
  sourceId: input.appointmentId,
  deduplicationKey: `appointment.confirmed:${input.appointmentId}`,
  status: 'pending' as const,
  availableAt: input.now,
  createdAt: input.now,
  updatedAt: input.now
})

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

const accessPurpose = (metadata: Omit<ConfirmationAccess, 'token'>) =>
  metadata.purpose ?? 'appointment_confirmation'
const accessResource = (metadata: Omit<ConfirmationAccess, 'token'>) =>
  metadata.bookingPartyId ?? metadata.routeId

export const deriveConfirmationToken = (
  metadata: Omit<ConfirmationAccess, 'token'>,
  keyring: ConfirmationSigningKeyring
): Promise<string> => {
  const key = keyring.keys[metadata.signingKeyId]
  if (!key) return Promise.reject(new Error('Unknown Confirmation signing key'))
  return hmac(
    key,
    `${accessPurpose(metadata)}.${accessResource(metadata)}.${metadata.routeId}.${metadata.tokenVersion}.${metadata.expiresAt}.${metadata.signingKeyId}`
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
    `cookie.${accessPurpose(metadata)}.${accessResource(metadata)}.${metadata.routeId}.${metadata.tokenVersion}.${metadata.expiresAt}.${metadata.signingKeyId}`
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
  readonly paymentSettlement?: SeedPaymentSettlementStore
  readonly appointments: Map<string, Appointment>
  readonly access: Map<string, Omit<ConfirmationAccess, 'token'>>
  readonly exchangedAccess: Set<string>
  readonly outbox: Map<
    string,
    { readonly appointmentId: string; readonly traceId: string }
  >
}

export const emptySeedBookingConfirmationStore = (
  sessions: SeedBookingSessionStore,
  checkout: SeedBookingCheckoutStore,
  paymentSettlement?: SeedPaymentSettlementStore
): SeedBookingConfirmationStore => ({
  sessions,
  checkout,
  ...(paymentSettlement ? { paymentSettlement } : {}),
  appointments: new Map(),
  access: new Map(),
  exchangedAccess: new Set(),
  outbox: new Map()
})

const recordForAppointmentParty = (
  store: SeedBookingConfirmationStore,
  appointmentId: string
) =>
  [...store.sessions.sessions.values()].find((session) =>
    (
      session.confirmedAppointmentIds ??
      (session.confirmedAppointmentId ? [session.confirmedAppointmentId] : [])
    ).includes(appointmentId)
  )

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
        if (
          valid &&
          input.credentialKind === 'bearer' &&
          store.exchangedAccess.has(input.routeId)
        )
          return { kind: 'not_found' as const }
        if (!valid) {
          return expected === input.credential && metadata.expiresAt <= input.now
            ? {
                kind: 'expired' as const,
                locale:
                  [...store.sessions.sessions.values()].find(
                    (session) => session.confirmedAppointmentId === appointment.id
                  )?.locale ?? 'en'
              }
            : { kind: 'not_found' as const }
        }
        if (input.credentialKind === 'bearer') store.exchangedAccess.add(input.routeId)
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
            locale:
              [...store.sessions.sessions.values()].find(
                (session) => session.confirmedAppointmentId === appointment.id
              )?.locale ?? 'en',
            snapshot: appointment.snapshot as StoredAppointmentSnapshot,
            appointments: (metadata.purpose === 'party_confirmation'
              ? (recordForAppointmentParty(store, appointment.id)
                  ?.confirmedAppointmentIds ?? [appointment.id])
              : [appointment.id]
            ).map((id) => {
              const sibling = store.appointments.get(id)!
              return {
                id: sibling.id,
                status: sibling.status,
                startsAt: sibling.startsAt,
                endsAt: sibling.endsAt,
                snapshot: sibling.snapshot as StoredAppointmentSnapshot
              }
            }),
            merchant: {
              publicName: store.checkout.scheduling.scenario.merchant.publicName
            }
          }
        }
      }),
    confirm: (session, input) =>
      Effect.gen(function* () {
        const record = store.sessions.sessions.get(session.id)
        const committedIds =
          record?.confirmedAppointmentIds ??
          (record?.confirmedAppointmentId ? [record.confirmedAppointmentId] : [])
        if (
          committedIds.length > 0 &&
          record?.replayExpiresAt &&
          record.replayExpiresAt > input.now
        ) {
          const appointments = committedIds.map((id) => store.appointments.get(id)!)
          const accesses = yield* Effect.forEach(appointments, (appointment) => {
            const access = [...store.access.values()].find(
              (candidate) => candidate.routeId === `cnf_${appointment.id}`
            )!
            return Effect.promise(async () => ({
              ...access,
              token: await deriveConfirmationToken(access, keyring)
            }))
          })
          const outboxIds = appointments.map(
            (appointment) =>
              [...store.outbox.entries()].find(
                ([, value]) => value.appointmentId === appointment.id
              )![0]
          )
          return {
            appointment: appointments[0]!,
            appointments,
            access: accesses[0]!,
            accesses,
            outboxId: outboxIds[0]!,
            outboxIds,
            replayed: true
          }
        }
        const partyRequestIds = store.checkout.scheduling.partyRequests.get(session.id)
        const requestIds = partyRequestIds?.size
          ? [...partyRequestIds]
          : [store.checkout.scheduling.activeRequests.get(session.id) ?? session.id]
        const holds = requestIds.map((requestId) =>
          [...store.checkout.scheduling.holds.values()].find(
            (candidate) =>
              candidate.bookingSessionId === session.id &&
              candidate.expiresAt > input.now &&
              (candidate.bookingRequestId === requestId ||
                (requestIds.length === 1 && !candidate.bookingRequestId))
          )
        )
        if (holds.some((hold) => !hold)) return yield* rejected('hold_expired')
        const details = requestIds.map((requestId) =>
          store.checkout.details.get(requestId)
        )
        if (details.some((value) => !value)) return yield* rejected('details_missing')
        if (!record || record.lifecycle !== 'active') return yield* rejected('conflict')
        const partyId = store.sessions.parties.get(session.id)?.id
        const payment = partyId
          ? [...(store.paymentSettlement?.payments.values() ?? [])].find(
              (candidate) => candidate.bookingPartyId === partyId
            )
          : undefined
        if (payment && payment.status !== 'captured')
          return yield* new BookingConfirmationProcessing({
            reason: 'commitment_unknown'
          })
        const checkoutPath = payment ? 'online_payment' : 'pay_in_person'
        const appointments: Appointment[] = []
        const accesses: ConfirmationAccess[] = []
        const outboxIds: string[] = []
        for (let index = 0; index < requestIds.length; index += 1) {
          const requestId = requestIds[index]!
          const hold = holds[index]!
          const appointmentId = `apt_${requestId}`
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
              customerDetails: details[index]!,
              checkoutPath
            },
            createdAt: input.now
          }
          const access = {
            routeId,
            bookingPartyId: requestIds.length > 1 ? `seed_party_${session.id}` : null,
            purpose:
              requestIds.length > 1 && index === 0
                ? ('party_confirmation' as const)
                : ('appointment_confirmation' as const),
            tokenVersion: 1,
            signingKeyId: keyring.currentKeyId,
            expiresAt: addMillisecondsToIso(hold.endsAt, 30 * 24 * 60 * 60_000)
          }
          store.appointments.set(appointmentId, appointment)
          store.access.set(routeId, access)
          store.outbox.set(outboxId, { appointmentId, traceId: input.traceId })
          store.checkout.scheduling.holds.delete(hold.id)
          store.checkout.details.delete(requestId)
          appointments.push(appointment)
          accesses.push({
            ...access,
            token: yield* Effect.promise(() => deriveConfirmationToken(access, keyring))
          })
          outboxIds.push(outboxId)
        }
        store.sessions.sessions.set(session.id, {
          ...record,
          lifecycle: 'consumed',
          confirmedAppointmentId: appointments[0]!.id,
          confirmedAppointmentIds: appointments.map((appointment) => appointment.id),
          replayExpiresAt: addMillisecondsToIso(input.now, 24 * 60 * 60_000)
        })
        return {
          appointment: appointments[0]!,
          appointments,
          access: accesses[0]!,
          accesses,
          outboxId: outboxIds[0]!,
          outboxIds,
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
    bookingPartyId: row.access.bookingPartyId,
    purpose: row.access.purpose,
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
    appointments: [
      {
        id: row.appointment.id,
        merchantId: row.appointment.merchantId,
        providerId: row.appointment.providerId,
        status: 'scheduled',
        startsAt: row.appointment.startsAt,
        endsAt: row.appointment.endsAt,
        snapshot: row.appointment.snapshot!,
        createdAt: row.appointment.createdAt
      }
    ],
    access: { ...metadata, token: await deriveConfirmationToken(metadata, keyring) },
    accesses: [
      { ...metadata, token: await deriveConfirmationToken(metadata, keyring) }
    ],
    outboxId: row.outboxId,
    outboxIds: [row.outboxId],
    replayed
  }
}

const resultsFrom = async (
  rows: readonly {
    appointment: typeof appointments.$inferSelect
    access: typeof confirmationAccess.$inferSelect
    outboxId: string
  }[],
  keyring: ConfirmationSigningKeyring,
  replayed: boolean
): Promise<BookingConfirmationResult> => {
  const results = await Promise.all(
    rows.map((row) => resultFrom(row, keyring, replayed))
  )
  const first = results[0]!
  return {
    appointment: first.appointment,
    appointments: results.map((result) => result.appointment),
    access: first.access,
    accesses: results.map((result) => result.access),
    outboxId: first.outboxId,
    outboxIds: results.map((result) => result.outboxId),
    replayed
  }
}

export const LiveBookingConfirmation = (
  keyring: ConfirmationSigningKeyring
): Layer.Layer<BookingConfirmation, never, Database | PaymentSettlement> =>
  Layer.effect(
    BookingConfirmation,
    Effect.gen(function* () {
      const db = yield* Database
      const paymentSettlements = yield* PaymentSettlement
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
        )
      return {
        read: (input) =>
          Effect.gen(function* () {
            const rows = yield* orUnavailable('booking-confirmation')(
              db
                .select({
                  appointment: appointments,
                  access: confirmationAccess,
                  merchantName: merchants.publicName,
                  locale: bookingSessions.locale
                })
                .from(confirmationAccess)
                .innerJoin(
                  appointments,
                  eq(appointments.id, confirmationAccess.appointmentId)
                )
                .innerJoin(merchants, eq(merchants.id, appointments.merchantId))
                .innerJoin(
                  bookingSessions,
                  eq(bookingSessions.id, appointments.bookingSessionId)
                )
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
              bookingPartyId: row.access.bookingPartyId,
              purpose: row.access.purpose,
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
              expected === input.credential &&
              (input.credentialKind === 'cookie' || !row.access.exchangedAt)
            if (!valid) {
              if (!metadata.revokedAt && metadata.expiresAt <= input.now) {
                if (expected === input.credential)
                  return {
                    kind: 'expired' as const,
                    locale: row.locale as 'en' | 'es' | 'fr' | 'ro'
                  }
              }
              return { kind: 'not_found' as const }
            }
            if (input.credentialKind === 'bearer') {
              const exchanged = yield* orUnavailable('booking-confirmation')(
                db
                  .update(confirmationAccess)
                  .set({ exchangedAt: input.now })
                  .where(
                    and(
                      eq(confirmationAccess.routeId, input.routeId),
                      sql`${confirmationAccess.exchangedAt} is null`
                    )
                  )
                  .returning({ routeId: confirmationAccess.routeId })
              )
              if (exchanged.length !== 1) return { kind: 'not_found' as const }
            }
            const partyAppointments =
              row.access.purpose === 'party_confirmation' && row.access.bookingPartyId
                ? yield* orUnavailable('booking-confirmation')(
                    db
                      .select({ appointment: appointments })
                      .from(appointments)
                      .where(eq(appointments.bookingPartyId, row.access.bookingPartyId))
                  )
                : [{ appointment: row.appointment }]
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
                locale: row.locale as 'en' | 'es' | 'fr' | 'ro',
                snapshot: row.appointment.snapshot!,
                appointments: partyAppointments.map(({ appointment }) => ({
                  id: appointment.id,
                  status: appointment.status,
                  startsAt: appointment.startsAt,
                  endsAt: appointment.endsAt,
                  snapshot: appointment.snapshot!
                })),
                merchant: { publicName: row.merchantName }
              }
            }
          }),
        confirm: (session, input) =>
          Effect.gen(function* () {
            const replayRows = yield* readCommitted(session.id)
            const replay = replayRows[0]
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
              return yield* Effect.promise(() => resultsFrom(replayRows, keyring, true))
            }

            const partyRows = yield* orUnavailable('booking-confirmation')(
              db
                .select({
                  party: bookingParties,
                  request: bookingRequests,
                  hold: timeSlotHolds,
                  shopId: bookingParties.shopId,
                  timezone: merchants.timezone
                })
                .from(bookingParties)
                .innerJoin(
                  bookingSessions,
                  and(
                    eq(bookingSessions.id, bookingParties.bookingSessionId),
                    eq(bookingSessions.lifecycle, 'active')
                  )
                )
                .innerJoin(merchants, eq(merchants.id, bookingSessions.merchantId))
                .innerJoin(
                  bookingRequests,
                  eq(bookingRequests.bookingPartyId, bookingParties.id)
                )
                .innerJoin(
                  timeSlotHolds,
                  and(
                    eq(timeSlotHolds.bookingSessionId, bookingSessions.id),
                    eq(timeSlotHolds.bookingRequestId, bookingRequests.id),
                    gt(timeSlotHolds.expiresAt, input.now)
                  )
                )
                .where(
                  and(
                    eq(bookingParties.bookingSessionId, session.id),
                    eq(bookingParties.lifecycle, 'active')
                  )
                )
            )
            if (partyRows.length > 0) {
              const party = partyRows[0]!.party
              const requestCount = yield* orUnavailable('booking-confirmation')(
                db
                  .select({ count: sql<number>`count(*)` })
                  .from(bookingRequests)
                  .where(eq(bookingRequests.bookingPartyId, party.id))
              )
              if (partyRows.length !== requestCount[0]?.count)
                return yield* rejected('hold_expired')
              if (partyRows.some((row) => !row.request.customerDetailsJson))
                return yield* rejected('details_missing')
              const accepted = yield* orUnavailable('booking-confirmation')(
                db
                  .select({
                    quoteId: pricingQuotes.id,
                    version: pricingQuotes.version,
                    totalMinor: pricingQuotes.totalMinor,
                    acceptedAt: pricingQuoteAcceptances.acceptedAt
                  })
                  .from(pricingQuotes)
                  .innerJoin(
                    pricingQuoteAcceptances,
                    and(
                      eq(pricingQuoteAcceptances.pricingQuoteId, pricingQuotes.id),
                      eq(pricingQuoteAcceptances.partyVersion, party.version)
                    )
                  )
                  .where(
                    and(
                      eq(pricingQuotes.bookingPartyId, party.id),
                      gt(pricingQuotes.expiresAt, input.now)
                    )
                  )
                  .limit(1)
              )
              if (!accepted[0]) return yield* rejected('conflict')
              const acceptedQuote = accepted[0]
              const settlement = yield* paymentSettlements.settlementForConfirmation(
                party.id
              )
              if (
                settlement.kind === 'processing' ||
                (settlement.kind === 'captured' &&
                  (settlement.amountMinor < acceptedQuote.totalMinor ||
                    settlement.currency !== party.currency))
              )
                return yield* new BookingConfirmationProcessing({
                  reason: 'commitment_unknown'
                })
              const checkoutPath =
                settlement.kind === 'captured' ? 'online_payment' : 'pay_in_person'
              const acceptedPolicy = (yield* orUnavailable('booking-confirmation')(
                db
                  .select({ acceptance: policyAcceptances })
                  .from(policyAcceptances)
                  .where(eq(policyAcceptances.bookingPartyId, party.id))
                  .limit(1)
              ))[0]?.acceptance
              if (!keyring.keys[keyring.currentKeyId])
                return yield* new CapabilityUnavailable({
                  capability: 'booking-confirmation',
                  reason: 'Current signing key is unavailable'
                })
              const replayExpiresAt = addMillisecondsToIso(input.now, 24 * 60 * 60_000)
              const generated = partyRows.map((row) => {
                const appointmentId = `apt_${randomHex(16)}`
                const routeId = `cnf_${randomHex(16)}`
                const outboxId = `obx_${randomHex(16)}`
                const notificationIntentId = `nti_${randomHex(16)}`
                const snapshot: StoredAppointmentSnapshot = {
                  ...row.hold.quote,
                  merchantTimezone: row.timezone,
                  customerDetails: JSON.parse(row.request.customerDetailsJson!),
                  checkoutPath,
                  acceptedQuote: {
                    id: acceptedQuote.quoteId,
                    version: acceptedQuote.version,
                    totalMinor: acceptedQuote.totalMinor,
                    acceptedAt: acceptedQuote.acceptedAt
                  },
                  policyAcceptance: acceptedPolicy
                    ? {
                        policyId: acceptedPolicy.checkoutPolicyId,
                        disclosure: acceptedPolicy.disclosureSnapshot,
                        acceptedAt: acceptedPolicy.acceptedAt
                      }
                    : null
                }
                return {
                  row,
                  appointmentId,
                  routeId,
                  outboxId,
                  notificationIntentId,
                  snapshot,
                  expiresAt: addMillisecondsToIso(
                    row.hold.endsAt,
                    30 * 24 * 60 * 60_000
                  )
                }
              })
              const statements: BatchStatement[] = generated.flatMap((item) => [
                db.insert(appointments).select(
                  db
                    .select({
                      id: sql<string>`${item.appointmentId}`.as('id'),
                      merchantId: timeSlotHolds.merchantId,
                      providerId: timeSlotHolds.providerId,
                      bookingSessionId: timeSlotHolds.bookingSessionId,
                      bookingPartyId: sql<string>`${party.id}`.as('booking_party_id'),
                      bookingRequestId: timeSlotHolds.bookingRequestId,
                      status: sql<'scheduled'>`'scheduled'`.as('status'),
                      startsAt: timeSlotHolds.startsAt,
                      endsAt: timeSlotHolds.endsAt,
                      snapshot:
                        sql<StoredAppointmentSnapshot>`${JSON.stringify(item.snapshot)}`.as(
                          'snapshot'
                        ),
                      createdAt: sql<string>`${input.now}`.as('created_at'),
                      updatedAt: sql<string>`${input.now}`.as('updated_at')
                    })
                    .from(timeSlotHolds)
                    .innerJoin(
                      bookingParties,
                      and(
                        eq(bookingParties.id, party.id),
                        eq(bookingParties.lifecycle, 'active')
                      )
                    )
                    .where(
                      and(
                        eq(timeSlotHolds.id, item.row.hold.id),
                        gt(timeSlotHolds.expiresAt, input.now)
                      )
                    )
                ),
                db.insert(confirmationAccess).values({
                  routeId: item.routeId,
                  appointmentId: item.appointmentId,
                  bookingPartyId: party.id,
                  purpose:
                    item === generated[0]
                      ? 'party_confirmation'
                      : 'appointment_confirmation',
                  tokenVersion: 1,
                  signingKeyId: keyring.currentKeyId,
                  expiresAt: item.expiresAt,
                  exchangedAt: null,
                  revokedAt: null,
                  createdAt: input.now
                }),
                db.insert(notificationIntents).values(
                  confirmationNotificationIntent({
                    id: item.notificationIntentId,
                    shopId: item.row.shopId,
                    appointmentId: item.appointmentId,
                    customerEmail: item.snapshot.customerDetails.email,
                    snapshot: item.snapshot,
                    confirmationRouteId: item.routeId,
                    now: input.now
                  })
                ),
                db.insert(bookingOutbox).values({
                  id: item.outboxId,
                  appointmentId: item.appointmentId,
                  notificationIntentId: item.notificationIntentId,
                  kind: 'appointment.created',
                  traceId: input.traceId,
                  createdAt: input.now
                })
              ])
              statements.push(
                db
                  .delete(timeSlotHolds)
                  .where(eq(timeSlotHolds.bookingSessionId, session.id)),
                db
                  .update(promotionReservations)
                  .set({ status: 'committed' })
                  .where(
                    eq(promotionReservations.pricingQuoteId, acceptedQuote.quoteId)
                  ),
                db.insert(settlementAllocations).values({
                  id: `sta_${randomHex(16)}`,
                  bookingPartyId: party.id,
                  tender:
                    settlement.kind === 'captured'
                      ? 'external_payment'
                      : 'pay_in_person',
                  referenceId:
                    settlement.kind === 'captured' ? settlement.paymentId : null,
                  amountMinor: acceptedQuote.totalMinor,
                  currency: party.currency,
                  createdAt: input.now
                }),
                db
                  .update(bookingParties)
                  .set({ lifecycle: 'confirmed', updatedAt: input.now })
                  .where(
                    and(
                      eq(bookingParties.id, party.id),
                      eq(bookingParties.lifecycle, 'active')
                    )
                  ),
                db
                  .update(bookingSessions)
                  .set({
                    lifecycle: 'consumed',
                    confirmedAppointmentId: generated[0]!.appointmentId,
                    confirmedAt: input.now,
                    replayExpiresAt
                  })
                  .where(
                    and(
                      eq(bookingSessions.id, session.id),
                      eq(bookingSessions.lifecycle, 'active')
                    )
                  )
              )
              const committed = yield* Effect.result(batch(db, statements))
              if (committed._tag === 'Failure') {
                const replayAfterFailure = yield* Effect.result(
                  readCommitted(session.id)
                )
                if (replayAfterFailure._tag === 'Failure')
                  return yield* new BookingConfirmationProcessing({
                    reason: 'commitment_unknown'
                  })
                if (replayAfterFailure.success.length > 0)
                  return yield* Effect.promise(() =>
                    resultsFrom(replayAfterFailure.success, keyring, true)
                  )
                return yield* new CapabilityUnavailable({
                  capability: 'booking-confirmation',
                  reason: committed.failure.reason
                })
              }
              const stored = yield* readCommitted(session.id)
              if (stored.length !== generated.length)
                return yield* new CapabilityUnavailable({
                  capability: 'booking-confirmation',
                  reason: 'Committed Booking Party could not be read'
                })
              return yield* Effect.promise(() => resultsFrom(stored, keyring, false))
            }

            const rows = yield* orUnavailable('booking-confirmation')(
              db
                .select({
                  session: bookingSessions,
                  hold: timeSlotHolds,
                  timezone: merchants.timezone,
                  shopId: shops.id
                })
                .from(bookingSessions)
                .innerJoin(merchants, eq(merchants.id, bookingSessions.merchantId))
                .innerJoin(shops, eq(shops.merchantId, bookingSessions.merchantId))
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
                .limit(2)
            )
            const row = rows[0]
            if (!row) return yield* rejected('hold_expired')
            if (rows.length !== 1) return yield* rejected('conflict')
            if (!row.session.customerName || !row.session.customerEmail)
              return yield* rejected('details_missing')

            const appointmentId = `apt_${randomHex(16)}`
            const routeId = `cnf_${randomHex(16)}`
            const outboxId = `obx_${randomHex(16)}`
            const notificationIntentId = `nti_${randomHex(16)}`
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
              bookingPartyId: null,
              purpose: 'appointment_confirmation' as const,
              tokenVersion: 1,
              signingKeyId: keyring.currentKeyId,
              expiresAt,
              exchangedAt: null,
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
              db.insert(notificationIntents).values(
                confirmationNotificationIntent({
                  id: notificationIntentId,
                  shopId: row.shopId,
                  appointmentId,
                  customerEmail: row.session.customerEmail,
                  snapshot,
                  confirmationRouteId: routeId,
                  now: input.now
                })
              ),
              db.insert(bookingOutbox).values({
                id: outboxId,
                appointmentId,
                notificationIntentId,
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
              const replayAfterFailure = yield* Effect.result(readCommitted(session.id))
              if (replayAfterFailure._tag === 'Failure')
                return yield* new BookingConfirmationProcessing({
                  reason: 'commitment_unknown'
                })
              const raced = replayAfterFailure.success[0]
              if (raced)
                return yield* Effect.promise(() => resultFrom(raced, keyring, true))
              return yield* new CapabilityUnavailable({
                capability: 'booking-confirmation',
                reason: committed.failure.reason
              })
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
