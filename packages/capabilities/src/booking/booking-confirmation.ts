import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
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
  giftCards,
  giftCardLedgerEntries,
  giftCardReservations,
  merchants,
  merchantMessagingControls,
  notificationIntents,
  payments,
  pricingAdjustments,
  pricingQuoteAcceptances,
  pricingQuotes,
  policyAcceptances,
  promotionReservations,
  settlementAllocations,
  shopAddresses,
  shops,
  timeSlotHolds,
  type BatchStatement,
  type StoredAppointmentSnapshot
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { DEFAULT_BOOKING_CANCELLATION_POLICY } from './booking-cancellation.ts'
import { randomHex } from '../internal/crypto.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import type { BookingSession } from './booking-sessions.ts'
import type { SeedBookingCheckoutStore } from './booking-checkout.ts'
import type { SeedBookingSessionStore } from './booking-sessions.ts'
import { PaymentSettlement } from '../payments/index.ts'
import { subscriptionAllowsNewDemandSql } from '../subscriptions/subscription-access.ts'
import {
  deriveNotificationDestinationProtection,
  hasNotificationDestinationProtection,
  notificationIntentMutationStatements,
  prepareBookingIntentMutation
} from '../notifications/index.ts'
import type {
  NotificationDestinationProtectionSecrets,
  PreparedBookingIntentMutation
} from '../notifications/index.ts'
import { merchantReminderAvailableAt } from '../notifications/index.ts'
import { appointmentOperationalNotificationFacts } from './operational-notification-facts.ts'
import { prepareAppointmentCustomerAssociation } from '../customer-directory/appointment-association.ts'

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
  notificationIntentIds: Schema.optional(Schema.Array(Schema.String)),
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
const defaultRefundPolicy = {
  id: 'refund:default:v1',
  version: 1,
  refundableUntilMinutesBeforeStart: 24 * 60,
  refundBasisPoints: 10_000
} as const
const CustomerConfirmationAppointment = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
  startsAt: Schema.String,
  endsAt: Schema.String,
  snapshot: AppointmentSnapshot,
  adjustments: Schema.optional(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Literals(['tax', 'fee']),
        amountMinor: Schema.Number
      })
    )
  )
})
export const CustomerConfirmation = Schema.Struct({
  routeId: Schema.String,
  status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
  startsAt: Schema.String,
  endsAt: Schema.String,
  locale: Schema.Literals(['en', 'es', 'fr', 'ro']),
  snapshot: AppointmentSnapshot,
  appointments: Schema.Array(CustomerConfirmationAppointment),
  shop: Schema.Struct({
    publicName: Schema.String,
    coverPhotoUrl: Schema.optional(Schema.String),
    addressLines: Schema.optional(Schema.Array(Schema.String)),
    coordinates: Schema.optional(
      Schema.Struct({ latitude: Schema.Number, longitude: Schema.Number })
    )
  })
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
  readonly recoverAccess: (input: {
    readonly bookingPartyId: string
    readonly confirmationRouteId: string
    readonly now: string
  }) => Effect.Effect<
    { readonly routeId: string; readonly cookieCredential: string },
    CapabilityUnavailable
  >
}
export class BookingConfirmation extends Context.Service<
  BookingConfirmation,
  BookingConfirmationShape
>()('@b2b-saas-starter/capabilities/BookingConfirmation') {}

const addMillisecondsToIso = (instant: string, milliseconds: number) =>
  new Date(Date.parse(instant) + milliseconds).toISOString()

const confirmationShop = (input: {
  readonly publicName: string
  readonly bookingConfiguration?: unknown
  readonly addressJson?: string | null
  readonly latitude?: string | null
  readonly longitude?: string | null
}) => {
  const bookingConfiguration =
    input.bookingConfiguration && typeof input.bookingConfiguration === 'object'
      ? (input.bookingConfiguration as Record<string, unknown>)
      : null
  const coverPhotoUrl =
    typeof bookingConfiguration?.coverPhotoUrl === 'string'
      ? bookingConfiguration.coverPhotoUrl.trim()
      : ''
  let addressLines: string[] = []
  try {
    const address = input.addressJson
      ? (JSON.parse(input.addressJson) as Record<string, unknown>)
      : null
    addressLines = address
      ? ['street', 'city', 'region', 'postalCode', 'country']
          .map((key) => address[key])
          .filter(
            (value): value is string => typeof value === 'string' && !!value.trim()
          )
          .map((value) => value.trim())
      : []
  } catch {
    addressLines = []
  }
  const latitude = input.latitude?.trim() ? Number(input.latitude) : Number.NaN
  const longitude = input.longitude?.trim() ? Number(input.longitude) : Number.NaN
  return {
    publicName: input.publicName,
    ...(coverPhotoUrl ? { coverPhotoUrl } : {}),
    ...(addressLines.length ? { addressLines } : {}),
    ...(Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { coordinates: { latitude, longitude } }
      : {})
  }
}

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
  checkout: SeedBookingCheckoutStore
): SeedBookingConfirmationStore => ({
  sessions,
  checkout,
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
): Layer.Layer<BookingConfirmation, never, PaymentSettlement> =>
  Layer.effect(
    BookingConfirmation,
    Effect.map(PaymentSettlement, (paymentSettlements) => ({
      recoverAccess: (input) =>
        Effect.gen(function* () {
          const metadata = store.access.get(input.confirmationRouteId)
          if (
            !metadata ||
            metadata.bookingPartyId !== input.bookingPartyId ||
            metadata.purpose !== 'party_confirmation' ||
            metadata.expiresAt <= input.now
          )
            return yield* new CapabilityUnavailable({
              capability: 'booking-confirmation',
              reason: 'continuation_not_found'
            })
          return {
            routeId: metadata.routeId,
            cookieCredential: yield* Effect.promise(() =>
              deriveConfirmationCookieCredential(metadata, keyring)
            )
          }
        }),
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
          if (input.credentialKind === 'bearer')
            store.exchangedAccess.add(input.routeId)
          const selectedShopId = store.checkout.scheduling.selections.selections.get(
            recordForAppointmentParty(store, appointment.id)?.id ?? ''
          )?.shopId
          const shop =
            (selectedShopId
              ? store.checkout.scheduling.selections.shops.get(selectedShopId)
              : undefined) ??
            [...store.checkout.scheduling.selections.shops.values()].find(
              (candidate) => candidate.merchantId === appointment.merchantId
            )
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
                  snapshot: sibling.snapshot as StoredAppointmentSnapshot,
                  adjustments: []
                }
              }),
              shop: {
                publicName:
                  shop?.publicName ??
                  store.checkout.scheduling.scenario.merchant.publicName,
                ...(shop?.coverPhotoUrl ? { coverPhotoUrl: shop.coverPhotoUrl } : {}),
                ...(shop?.addressLines ? { addressLines: [...shop.addressLines] } : {}),
                ...(shop?.coordinates ? { coordinates: shop.coordinates } : {})
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
              notificationIntentIds: [],
              replayed: true
            }
          }
          const partyRequestIds = store.checkout.scheduling.partyRequests.get(
            session.id
          )
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
          if (!record || record.lifecycle !== 'active')
            return yield* rejected('conflict')
          const partyId = store.sessions.parties.get(session.id)?.id
          const settlement = partyId
            ? yield* paymentSettlements.settlementForConfirmation(partyId)
            : ({ kind: 'pay_in_person' } as const)
          if (settlement.kind === 'processing')
            return yield* new BookingConfirmationProcessing({
              reason: 'commitment_unknown'
            })
          const checkoutPath =
            settlement.kind === 'captured' ? 'online_payment' : 'pay_in_person'
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
              token: yield* Effect.promise(() =>
                deriveConfirmationToken(access, keyring)
              )
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
            notificationIntentIds: [],
            replayed: false
          }
        })
    }))
  )

const resultFrom = async (
  row: {
    appointment: typeof appointments.$inferSelect
    access: typeof confirmationAccess.$inferSelect
    outboxId: string
    notificationIntentId: string | null
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
    notificationIntentIds: row.notificationIntentId ? [row.notificationIntentId] : [],
    replayed
  }
}

const resultsFrom = async (
  rows: readonly {
    appointment: typeof appointments.$inferSelect
    access: typeof confirmationAccess.$inferSelect
    outboxId: string
    notificationIntentId: string | null
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
    notificationIntentIds: results.flatMap(
      (result) => result.notificationIntentIds ?? []
    ),
    replayed
  }
}

export const LiveBookingConfirmation = (
  keyring: ConfirmationSigningKeyring,
  destinationSecrets?: NotificationDestinationProtectionSecrets
): Layer.Layer<BookingConfirmation, never, Database | PaymentSettlement> =>
  Layer.effect(
    BookingConfirmation,
    Effect.gen(function* () {
      const db = yield* Database
      const paymentSettlements = yield* PaymentSettlement
      const notificationProtection = hasNotificationDestinationProtection(
        destinationSecrets
      )
        ? yield* deriveNotificationDestinationProtection(destinationSecrets)
        : null
      const readCommitted = (sessionId: string) =>
        orUnavailable('booking-confirmation')(
          db
            .select({
              appointment: appointments,
              access: confirmationAccess,
              outboxId: bookingOutbox.id,
              notificationIntentId: notificationIntents.id
            })
            .from(appointments)
            .innerJoin(
              confirmationAccess,
              eq(confirmationAccess.appointmentId, appointments.id)
            )
            .innerJoin(bookingOutbox, eq(bookingOutbox.appointmentId, appointments.id))
            .leftJoin(
              notificationIntents,
              and(
                eq(notificationIntents.sourceType, 'appointment'),
                eq(notificationIntents.sourceId, appointments.id),
                eq(notificationIntents.purpose, 'appointment_confirmation')
              )
            )
            .where(eq(appointments.bookingSessionId, sessionId))
        )
      return {
        recoverAccess: (input) =>
          Effect.gen(function* () {
            const [access] = yield* orUnavailable('booking-confirmation')(
              db
                .select()
                .from(confirmationAccess)
                .where(
                  and(
                    eq(confirmationAccess.routeId, input.confirmationRouteId),
                    eq(confirmationAccess.bookingPartyId, input.bookingPartyId)
                  )
                )
                .limit(1)
            )
            if (
              !access ||
              access.purpose !== 'party_confirmation' ||
              access.revokedAt ||
              access.expiresAt <= input.now
            )
              return yield* new CapabilityUnavailable({
                capability: 'booking-confirmation',
                reason: 'continuation_not_found'
              })
            return {
              routeId: access.routeId,
              cookieCredential: yield* Effect.promise(() =>
                deriveConfirmationCookieCredential(access, keyring)
              )
            }
          }),
        read: (input) =>
          Effect.gen(function* () {
            const rows = yield* orUnavailable('booking-confirmation')(
              db
                .select({
                  appointment: appointments,
                  access: confirmationAccess,
                  merchantName: merchants.publicName,
                  shopName: shops.publicName,
                  shopBookingConfiguration: shops.bookingConfigJson,
                  shopAddressJson: shopAddresses.addressJson,
                  shopLatitude: shopAddresses.latitude,
                  shopLongitude: shopAddresses.longitude,
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
                .leftJoin(
                  bookingParties,
                  eq(bookingParties.bookingSessionId, bookingSessions.id)
                )
                .leftJoin(shops, eq(shops.id, bookingParties.shopId))
                .leftJoin(shopAddresses, eq(shopAddresses.shopId, shops.id))
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
            const acceptedQuoteIds = [
              ...new Set(
                partyAppointments.flatMap(({ appointment }) => {
                  const quoteId = appointment.snapshot?.acceptedQuote?.id
                  return quoteId ? [quoteId] : []
                })
              )
            ]
            const adjustmentRows = acceptedQuoteIds.length
              ? yield* orUnavailable('booking-confirmation')(
                  db
                    .select({
                      pricingQuoteId: pricingAdjustments.pricingQuoteId,
                      kind: pricingAdjustments.kind,
                      amountMinor: pricingAdjustments.amountMinor
                    })
                    .from(pricingAdjustments)
                    .where(
                      and(
                        inArray(pricingAdjustments.pricingQuoteId, acceptedQuoteIds),
                        inArray(pricingAdjustments.kind, ['tax', 'fee'])
                      )
                    )
                )
              : []
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
                appointments: partyAppointments.map(({ appointment }) => {
                  const quoteId = appointment.snapshot?.acceptedQuote?.id
                  return {
                    id: appointment.id,
                    status: appointment.status,
                    startsAt: appointment.startsAt,
                    endsAt: appointment.endsAt,
                    snapshot: appointment.snapshot!,
                    adjustments: adjustmentRows
                      .filter(
                        (adjustment) =>
                          adjustment.pricingQuoteId === quoteId &&
                          (adjustment.kind === 'tax' || adjustment.kind === 'fee')
                      )
                      .map((adjustment) => ({
                        kind: adjustment.kind as 'tax' | 'fee',
                        amountMinor: adjustment.amountMinor
                      }))
                  }
                }),
                shop: confirmationShop({
                  publicName: row.shopName || row.merchantName,
                  bookingConfiguration: row.shopBookingConfiguration,
                  addressJson: row.shopAddressJson,
                  latitude: row.shopLatitude,
                  longitude: row.shopLongitude
                })
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
                    factsJson: pricingQuotes.factsJson,
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
              const giftReservations = yield* orUnavailable('booking-confirmation')(
                db
                  .select()
                  .from(giftCardReservations)
                  .where(eq(giftCardReservations.bookingPartyId, party.id))
              )
              if (
                giftReservations.some(
                  (reservation) =>
                    reservation.status === 'active' &&
                    reservation.expiresAt <= input.now
                )
              )
                return yield* new BookingConfirmationProcessing({
                  reason: 'commitment_unknown'
                })
              const activeGiftReservations = giftReservations.filter(
                (reservation) =>
                  reservation.status === 'active' && reservation.expiresAt > input.now
              )
              const acceptedGiftReservationIds =
                (
                  JSON.parse(acceptedQuote.factsJson) as {
                    readonly giftCardReservationIds?: readonly string[]
                  }
                ).giftCardReservationIds ?? []
              if (
                [...acceptedGiftReservationIds].sort().join('|') !==
                activeGiftReservations
                  .map((reservation) => reservation.id)
                  .sort()
                  .join('|')
              )
                return yield* new BookingConfirmationProcessing({
                  reason: 'commitment_unknown'
                })
              const giftCardMinor = activeGiftReservations.reduce(
                (sum, reservation) => sum + reservation.amountMinor,
                0
              )
              if (
                activeGiftReservations.some(
                  (reservation) => reservation.currency !== party.currency
                ) ||
                giftCardMinor > acceptedQuote.totalMinor
              )
                return yield* new BookingConfirmationProcessing({
                  reason: 'commitment_unknown'
                })
              const activeCards =
                activeGiftReservations.length === 0
                  ? []
                  : yield* orUnavailable('booking-confirmation')(
                      db
                        .select()
                        .from(giftCards)
                        .where(
                          inArray(
                            giftCards.id,
                            activeGiftReservations.map(
                              (reservation) => reservation.giftCardId
                            )
                          )
                        )
                    )
              const [partyShop] = yield* orUnavailable('booking-confirmation')(
                db.select().from(shops).where(eq(shops.id, party.shopId)).limit(1)
              )
              const [reminderControls] = yield* orUnavailable('booking-confirmation')(
                db
                  .select()
                  .from(merchantMessagingControls)
                  .where(eq(merchantMessagingControls.shopId, party.shopId))
                  .limit(1)
              )
              const giftScopeIsValid = activeCards.every(
                (card) =>
                  card.status === 'active' &&
                  (card.expiresAt === null || card.expiresAt > input.now) &&
                  (card.scope === 'merchant'
                    ? card.scopeId === partyShop?.merchantId
                    : card.scope === 'brand'
                      ? card.scopeId === partyShop?.brandId
                      : card.scope === 'shop'
                        ? card.scopeId === partyShop?.id
                        : partyRows.every(
                            ({ request }) => request.providerId === card.scopeId
                          ))
              )
              if (
                activeCards.length !== activeGiftReservations.length ||
                !giftScopeIsValid
              ) {
                return yield* new BookingConfirmationProcessing({
                  reason: 'commitment_unknown'
                })
              }
              const externalPaymentMinor = acceptedQuote.totalMinor - giftCardMinor
              const settlement = yield* paymentSettlements.settlementForConfirmation(
                party.id
              )
              if (
                settlement.kind === 'processing' ||
                (giftCardMinor === 0 &&
                  settlement.kind === 'captured' &&
                  (settlement.amountMinor !== externalPaymentMinor ||
                    settlement.currency !== party.currency)) ||
                (giftCardMinor > 0 &&
                  externalPaymentMinor > 0 &&
                  (settlement.kind !== 'captured' ||
                    settlement.amountMinor !== externalPaymentMinor ||
                    settlement.currency !== party.currency)) ||
                (giftCardMinor > 0 &&
                  externalPaymentMinor === 0 &&
                  settlement.kind !== 'pay_in_person')
              )
                return yield* new BookingConfirmationProcessing({
                  reason: 'commitment_unknown'
                })
              const checkoutPath =
                giftCardMinor > 0 || settlement.kind === 'captured'
                  ? 'online_payment'
                  : 'pay_in_person'
              const paymentGuard =
                settlement.kind === 'captured'
                  ? sql`exists (select 1 from ${payments} where ${payments.id} = ${settlement.paymentId} and ${payments.bookingPartyId} = ${party.id} and ${payments.status} = 'captured' and ${payments.amountMinor} = ${externalPaymentMinor} and ${payments.capturedMinor} = ${externalPaymentMinor} and ${payments.currency} = ${party.currency})`
                  : sql`not exists (select 1 from ${payments} where ${payments.bookingPartyId} = ${party.id})`
              const giftCardAggregateGuard =
                activeGiftReservations.length > 0
                  ? sql`(select coalesce(sum(${giftCardReservations.amountMinor}), 0) from ${giftCardReservations} where ${giftCardReservations.bookingPartyId} = ${party.id} and ${giftCardReservations.status} = 'active' and ${giftCardReservations.expiresAt} > ${input.now} and ${giftCardReservations.currency} = ${party.currency}) = ${giftCardMinor}`
                  : sql`not exists (select 1 from ${giftCardReservations} where ${giftCardReservations.bookingPartyId} = ${party.id} and ${giftCardReservations.status} = 'active')`
              const giftCardGuard = and(
                giftCardAggregateGuard,
                ...activeGiftReservations.map((reservation) => {
                  const card = activeCards.find(
                    (candidate) => candidate.id === reservation.giftCardId
                  )!
                  const scopeGuard =
                    card.scope === 'provider'
                      ? sql`not exists (select 1 from ${bookingRequests} where ${bookingRequests.bookingPartyId} = ${party.id} and (${bookingRequests.providerId} is null or ${bookingRequests.providerId} <> ${card.scopeId}))`
                      : card.scope === 'shop'
                        ? sql`${party.shopId} = ${card.scopeId}`
                        : card.scope === 'brand'
                          ? sql`exists (select 1 from ${shops} where ${shops.id} = ${party.shopId} and ${shops.brandId} = ${card.scopeId})`
                          : sql`exists (select 1 from ${shops} where ${shops.id} = ${party.shopId} and ${shops.merchantId} = ${card.scopeId})`
                  return and(
                    sql`exists (select 1 from ${giftCardReservations} where ${giftCardReservations.id} = ${reservation.id} and ${giftCardReservations.giftCardId} = ${reservation.giftCardId} and ${giftCardReservations.bookingPartyId} = ${party.id} and ${giftCardReservations.amountMinor} = ${reservation.amountMinor} and ${giftCardReservations.currency} = ${party.currency} and ${giftCardReservations.status} = 'active' and ${giftCardReservations.expiresAt} > ${input.now})`,
                    sql`exists (select 1 from ${giftCards} where ${giftCards.id} = ${card.id} and ${giftCards.status} = 'active' and (${giftCards.expiresAt} is null or ${giftCards.expiresAt} > ${input.now}) and ${giftCards.scope} = ${card.scope} and ${giftCards.scopeId} = ${card.scopeId})`,
                    scopeGuard
                  )!
                })
              )!
              const settlementGuard = and(paymentGuard, giftCardGuard)!
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
                const snapshot: StoredAppointmentSnapshot = {
                  ...row.hold.quote,
                  merchantTimezone: row.timezone,
                  customerDetails: JSON.parse(row.request.customerDetailsJson!),
                  operationalMessagingPermission:
                    row.request.operationalMessagingPermissionGranted !== null &&
                    row.request.operationalMessagingPermissionPolicyVersion &&
                    row.request.operationalMessagingPermissionRecordedAt
                      ? {
                          granted: row.request.operationalMessagingPermissionGranted,
                          policyVersion:
                            row.request.operationalMessagingPermissionPolicyVersion,
                          recordedAt:
                            row.request.operationalMessagingPermissionRecordedAt
                        }
                      : null,
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
                    : null,
                  cancellationPolicy: DEFAULT_BOOKING_CANCELLATION_POLICY,
                  refundPolicy: defaultRefundPolicy
                }
                return {
                  row,
                  appointmentId,
                  routeId,
                  outboxId,
                  snapshot,
                  reminderAt: merchantReminderAvailableAt({
                    startsAt: snapshot.startsAt,
                    now: input.now,
                    controls: reminderControls ?? null
                  }),
                  expiresAt: addMillisecondsToIso(
                    row.hold.endsAt,
                    30 * 24 * 60 * 60_000
                  )
                }
              })
              const preparedIntents = yield* Effect.forEach(generated, (item) =>
                notificationProtection
                  ? Effect.all([
                      prepareBookingIntentMutation(
                        db,
                        {
                          shopId: item.row.shopId,
                          sourceId: item.appointmentId,
                          sourceVersion: 1,
                          semanticDeduplicationKey: `confirmation:${item.appointmentId}:1`,
                          rawDestination: item.snapshot.customerDetails.phone,
                          permissionGranted:
                            item.snapshot.operationalMessagingPermission?.granted ===
                            true,
                          purpose: 'appointment_confirmation',
                          locale: item.row.party.locale === 'ro' ? 'ro' : 'en',
                          availableAt: input.now,
                          appointmentStartsAt: item.snapshot.startsAt,
                          createdAt: input.now,
                          traceId: input.traceId,
                          facts: appointmentOperationalNotificationFacts({
                            purpose: 'appointment_confirmation',
                            locale: item.row.party.locale === 'ro' ? 'ro' : 'en',
                            merchantLabel:
                              partyShop?.publicName ?? session.merchantSlug,
                            startsAt: item.snapshot.startsAt,
                            timeZone: item.snapshot.merchantTimezone,
                            appointmentId: item.appointmentId,
                            confirmationRouteId: item.routeId
                          })
                        },
                        notificationProtection
                      ),
                      item.reminderAt
                        ? prepareBookingIntentMutation(
                            db,
                            {
                              shopId: item.row.shopId,
                              sourceId: item.appointmentId,
                              sourceVersion: 1,
                              semanticDeduplicationKey: `reminder:${item.appointmentId}:1:${item.reminderAt}`,
                              rawDestination: item.snapshot.customerDetails.phone,
                              permissionGranted:
                                item.snapshot.operationalMessagingPermission
                                  ?.granted === true,
                              purpose: 'appointment_reminder',
                              locale: item.row.party.locale === 'ro' ? 'ro' : 'en',
                              availableAt: item.reminderAt,
                              appointmentStartsAt: item.snapshot.startsAt,
                              createdAt: input.now,
                              traceId: input.traceId,
                              facts: appointmentOperationalNotificationFacts({
                                purpose: 'appointment_reminder',
                                locale: item.row.party.locale === 'ro' ? 'ro' : 'en',
                                merchantLabel:
                                  partyShop?.publicName ?? session.merchantSlug,
                                startsAt: item.snapshot.startsAt,
                                timeZone: item.snapshot.merchantTimezone,
                                appointmentId: item.appointmentId,
                                confirmationRouteId: item.routeId
                              })
                            },
                            notificationProtection
                          )
                        : Effect.succeed(null)
                    ])
                  : Effect.succeed<
                      [
                        PreparedBookingIntentMutation | null,
                        PreparedBookingIntentMutation | null
                      ]
                    >([null, null])
              )
              const customerAssociationStatements = (yield* Effect.all(
                generated.map((item) =>
                  prepareAppointmentCustomerAssociation(db, {
                    merchantId: item.row.hold.merchantId,
                    appointment: {
                      id: item.appointmentId,
                      details: item.snapshot.customerDetails
                    },
                    origin: 'public_booking',
                    now: input.now
                  }).pipe(
                    Effect.mapError(
                      (error) =>
                        new CapabilityUnavailable({
                          capability: 'booking-confirmation',
                          reason: error.reason
                        })
                    )
                  )
                )
              )).flat()
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
                        gt(timeSlotHolds.expiresAt, input.now),
                        subscriptionAllowsNewDemandSql(timeSlotHolds.merchantId),
                        sql`NOT EXISTS (SELECT 1 FROM appointments conflicting WHERE conflicting.merchant_id = ${timeSlotHolds.merchantId} AND conflicting.provider_id = ${timeSlotHolds.providerId} AND conflicting.status = 'scheduled' AND COALESCE(json_extract(conflicting.snapshot, '$.occupiedStartsAt'), conflicting.starts_at) < COALESCE(json_extract(${timeSlotHolds.quote}, '$.occupiedEndsAt'), ${timeSlotHolds.endsAt}) AND COALESCE(json_extract(conflicting.snapshot, '$.occupiedEndsAt'), conflicting.ends_at) > COALESCE(json_extract(${timeSlotHolds.quote}, '$.occupiedStartsAt'), ${timeSlotHolds.startsAt}))`,
                        settlementGuard
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
                db.insert(bookingOutbox).values({
                  id: item.outboxId,
                  appointmentId: item.appointmentId,
                  kind: 'appointment.created',
                  traceId: input.traceId,
                  createdAt: input.now
                })
              ])
              statements.push(...customerAssociationStatements)
              statements.push(
                ...preparedIntents.flatMap((intents) =>
                  intents.flatMap((intent) =>
                    intent ? notificationIntentMutationStatements(intent) : []
                  )
                )
              )
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
              statements.push(
                ...activeGiftReservations.flatMap((reservation) => [
                  db.insert(giftCardLedgerEntries).values({
                    id: `gcl_${reservation.id}_release`,
                    giftCardId: reservation.giftCardId,
                    bookingPartyId: party.id,
                    kind: 'release',
                    amountMinor: reservation.amountMinor,
                    idempotencyKey: `confirmation:${party.id}:${reservation.id}:release`,
                    occurredAt: input.now,
                    createdAt: input.now
                  }),
                  db.insert(giftCardLedgerEntries).values({
                    id: `gcl_${reservation.id}_redemption`,
                    giftCardId: reservation.giftCardId,
                    bookingPartyId: party.id,
                    kind: 'redemption',
                    amountMinor: -reservation.amountMinor,
                    idempotencyKey: `confirmation:${party.id}:${reservation.id}:redemption`,
                    occurredAt: input.now,
                    createdAt: input.now
                  }),
                  db
                    .update(giftCardReservations)
                    .set({ status: 'committed', updatedAt: input.now })
                    .where(
                      and(
                        eq(giftCardReservations.id, reservation.id),
                        eq(giftCardReservations.status, 'active'),
                        gt(giftCardReservations.expiresAt, input.now)
                      )
                    ),
                  db.insert(settlementAllocations).values({
                    id: `sta_${reservation.id}`,
                    bookingPartyId: party.id,
                    tender: 'gift_card',
                    referenceId: reservation.giftCardId,
                    amountMinor: reservation.amountMinor,
                    currency: party.currency,
                    createdAt: input.now
                  })
                ]),
                ...(settlement.kind === 'captured'
                  ? [
                      db.insert(settlementAllocations).values({
                        id: `sta_${randomHex(16)}`,
                        bookingPartyId: party.id,
                        tender: 'external_payment',
                        referenceId: settlement.paymentId,
                        amountMinor: externalPaymentMinor,
                        currency: party.currency,
                        createdAt: input.now
                      })
                    ]
                  : giftCardMinor === 0
                    ? [
                        db.insert(settlementAllocations).values({
                          id: `sta_${randomHex(16)}`,
                          bookingPartyId: party.id,
                          tender: 'pay_in_person',
                          referenceId: null,
                          amountMinor: acceptedQuote.totalMinor,
                          currency: party.currency,
                          createdAt: input.now
                        })
                      ]
                    : [])
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
                const finalSlotConflicts = yield* Effect.all(
                  generated.map((item) =>
                    orUnavailable('booking-confirmation')(
                      db
                        .select({ id: appointments.id })
                        .from(appointments)
                        .where(
                          and(
                            eq(appointments.merchantId, item.row.hold.merchantId),
                            eq(appointments.providerId, item.row.hold.providerId),
                            eq(appointments.status, 'scheduled'),
                            sql`COALESCE(json_extract(${appointments.snapshot}, '$.occupiedStartsAt'), ${appointments.startsAt}) < ${item.row.hold.quote.occupiedEndsAt ?? item.row.hold.endsAt}`,
                            sql`COALESCE(json_extract(${appointments.snapshot}, '$.occupiedEndsAt'), ${appointments.endsAt}) > ${item.row.hold.quote.occupiedStartsAt ?? item.row.hold.startsAt}`
                          )
                        )
                        .limit(1)
                    )
                  )
                )
                if (finalSlotConflicts.some((rows) => rows.length > 0))
                  return yield* rejected('conflict')
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
                  shopId: shops.id,
                  shopName: shops.publicName
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
              checkoutPath: 'pay_in_person',
              cancellationPolicy: DEFAULT_BOOKING_CANCELLATION_POLICY,
              refundPolicy: defaultRefundPolicy
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
            const preparedIntent = notificationProtection
              ? yield* prepareBookingIntentMutation(
                  db,
                  {
                    shopId: row.shopId,
                    sourceId: appointmentId,
                    sourceVersion: 1,
                    semanticDeduplicationKey: `confirmation:${appointmentId}:1`,
                    rawDestination: snapshot.customerDetails.phone,
                    permissionGranted: false,
                    purpose: 'appointment_confirmation',
                    locale: row.session.locale === 'ro' ? 'ro' : 'en',
                    availableAt: input.now,
                    appointmentStartsAt: snapshot.startsAt,
                    createdAt: input.now,
                    traceId: input.traceId,
                    facts: appointmentOperationalNotificationFacts({
                      purpose: 'appointment_confirmation',
                      locale: row.session.locale === 'ro' ? 'ro' : 'en',
                      merchantLabel: row.shopName,
                      startsAt: snapshot.startsAt,
                      timeZone: snapshot.merchantTimezone,
                      appointmentId,
                      confirmationRouteId: routeId
                    })
                  },
                  notificationProtection
                )
              : null
            const customerAssociationStatements =
              yield* prepareAppointmentCustomerAssociation(db, {
                merchantId: row.session.merchantId,
                appointment: {
                  id: appointmentId,
                  details: snapshot.customerDetails
                },
                origin: 'public_booking',
                now: input.now
              }).pipe(
                Effect.mapError(
                  (error) =>
                    new CapabilityUnavailable({
                      capability: 'booking-confirmation',
                      reason: error.reason
                    })
                )
              )
            const statements: BatchStatement[] = [
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
                      gt(timeSlotHolds.expiresAt, input.now),
                      subscriptionAllowsNewDemandSql(timeSlotHolds.merchantId),
                      sql`NOT EXISTS (SELECT 1 FROM appointments conflicting WHERE conflicting.merchant_id = ${timeSlotHolds.merchantId} AND conflicting.provider_id = ${timeSlotHolds.providerId} AND conflicting.status = 'scheduled' AND COALESCE(json_extract(conflicting.snapshot, '$.occupiedStartsAt'), conflicting.starts_at) < COALESCE(json_extract(${timeSlotHolds.quote}, '$.occupiedEndsAt'), ${timeSlotHolds.endsAt}) AND COALESCE(json_extract(conflicting.snapshot, '$.occupiedEndsAt'), conflicting.ends_at) > COALESCE(json_extract(${timeSlotHolds.quote}, '$.occupiedStartsAt'), ${timeSlotHolds.startsAt}))`
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
                ),
              ...customerAssociationStatements
            ]
            if (preparedIntent)
              statements.push(...notificationIntentMutationStatements(preparedIntent))
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
              const finalSlotConflict = yield* orUnavailable('booking-confirmation')(
                db
                  .select({ id: appointments.id })
                  .from(appointments)
                  .where(
                    and(
                      eq(appointments.merchantId, row.hold.merchantId),
                      eq(appointments.providerId, row.hold.providerId),
                      eq(appointments.status, 'scheduled'),
                      sql`COALESCE(json_extract(${appointments.snapshot}, '$.occupiedStartsAt'), ${appointments.startsAt}) < ${row.hold.quote.occupiedEndsAt ?? row.hold.endsAt}`,
                      sql`COALESCE(json_extract(${appointments.snapshot}, '$.occupiedEndsAt'), ${appointments.endsAt}) > ${row.hold.quote.occupiedStartsAt ?? row.hold.startsAt}`
                    )
                  )
                  .limit(1)
              )
              if (finalSlotConflict.length > 0) return yield* rejected('conflict')
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
