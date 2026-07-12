import { Context, Effect, Layer, Schema } from 'effect'
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import {
  batch,
  bookingParties,
  bookingRequests,
  bookingSessions,
  Database,
  timeSlotHolds
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import type { SeedBookingSchedulingStore } from './booking-scheduling.ts'
import { BookingQuote } from './booking-scheduling.ts'
import type { BookingSession } from './booking-sessions.ts'

export const CustomerDetails = Schema.Struct({
  name: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(120),
    Schema.isPattern(/^\S(?:.*\S)?$/)
  ),
  email: Schema.String.check(
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
    Schema.isMaxLength(254)
  ),
  phone: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(16), Schema.isPattern(/^\+[1-9]\d{7,14}$/))
  )
})
export type CustomerDetails = typeof CustomerDetails.Type

export const CustomerDetailsField = Schema.Literals(['name', 'email', 'phone'])
export const CustomerDetailsErrorCode = Schema.Literals([
  'name_required',
  'name_too_long',
  'email_invalid',
  'phone_invalid'
])
export const CustomerDetailsIssue = Schema.Struct({
  field: CustomerDetailsField,
  code: CustomerDetailsErrorCode
})
export type CustomerDetailsIssue = typeof CustomerDetailsIssue.Type

export class CustomerDetailsInvalid extends Schema.TaggedErrorClass<CustomerDetailsInvalid>()(
  'CustomerDetailsInvalid',
  { issues: Schema.Array(CustomerDetailsIssue) }
) {}

export const normalizeCustomerDetails = (
  input: {
    readonly name: string
    readonly email: string
    readonly phone: string | null
  },
  defaultCountry?: CountryCode
): CustomerDetails => {
  const name = input.name.trim().replace(/\s+/g, ' ')
  const email = input.email.trim().toLowerCase()
  const rawPhone = input.phone?.trim() || null
  const parsedPhone = rawPhone
    ? parsePhoneNumberFromString(rawPhone, defaultCountry)
    : undefined
  const phone = parsedPhone?.isValid() ? parsedPhone.number : null
  const issues: CustomerDetailsIssue[] = []
  if (!name) issues.push({ field: 'name', code: 'name_required' })
  else if (name.length > 120) issues.push({ field: 'name', code: 'name_too_long' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    issues.push({ field: 'email', code: 'email_invalid' })
  if (rawPhone && !phone) issues.push({ field: 'phone', code: 'phone_invalid' })
  if (issues.length > 0) throw new CustomerDetailsInvalid({ issues })
  return { name, email, phone }
}

export const CheckoutPolicy = Schema.Struct({
  id: Schema.String,
  scope: Schema.Literals(['merchant', 'brand', 'shop']),
  scopeId: Schema.String,
  kind: Schema.String,
  version: Schema.Number,
  disclosure: Schema.String,
  effectiveAt: Schema.String,
  retiredAt: Schema.NullOr(Schema.String)
})
export type CheckoutPolicy = typeof CheckoutPolicy.Type

export const resolveCheckoutPolicy = (
  policies: readonly CheckoutPolicy[],
  input: {
    readonly merchantId: string
    readonly brandId: string
    readonly shopId: string
    readonly now: string
  }
): CheckoutPolicy | null => {
  const identities = [
    ['shop', input.shopId],
    ['brand', input.brandId],
    ['merchant', input.merchantId]
  ] as const
  for (const [scope, scopeId] of identities) {
    const resolved = policies
      .filter(
        (policy) =>
          policy.scope === scope &&
          policy.scopeId === scopeId &&
          policy.effectiveAt <= input.now &&
          (!policy.retiredAt || policy.retiredAt > input.now)
      )
      .sort((a, b) => b.version - a.version)[0]
    if (resolved) return resolved
  }
  return null
}

export const CheckoutPolicyAcceptance = Schema.Struct({
  policyId: Schema.String,
  version: Schema.Number,
  disclosure: Schema.String,
  acceptedAt: Schema.String
})
export type CheckoutPolicyAcceptance = typeof CheckoutPolicyAcceptance.Type

export const acceptCheckoutPolicy = (
  policy: CheckoutPolicy,
  acceptedAt: string,
  existing?: CheckoutPolicyAcceptance | null
): CheckoutPolicyAcceptance =>
  existing &&
  existing.policyId === policy.id &&
  existing.version === policy.version &&
  existing.disclosure === policy.disclosure
    ? existing
    : {
        policyId: policy.id,
        version: policy.version,
        disclosure: policy.disclosure,
        acceptedAt
      }
export const MarketingConsent = Schema.Struct({
  personId: Schema.String,
  channel: Schema.Literals(['email', 'sms']),
  granted: Schema.Boolean,
  policyVersion: Schema.String,
  recordedAt: Schema.String
})
export const PartyCheckoutReview = Schema.Struct({
  requests: Schema.Array(
    Schema.Struct({ id: Schema.String, complete: Schema.Boolean })
  ),
  acceptedQuote: Schema.Struct({ id: Schema.String, acceptedAt: Schema.String }),
  policyAcceptance: CheckoutPolicyAcceptance,
  marketingConsents: Schema.Array(MarketingConsent),
  readyToConfirm: Schema.Literal(true)
})
export type PartyCheckoutReview = typeof PartyCheckoutReview.Type

export class CheckoutReviewUnavailable extends Schema.TaggedErrorClass<CheckoutReviewUnavailable>()(
  'CheckoutReviewUnavailable',
  {
    reason: Schema.Literals([
      'request_incomplete',
      'quote_unaccepted',
      'policy_unaccepted'
    ])
  }
) {}

export const buildCheckoutReview = (input: {
  readonly requests: readonly { readonly id: string; readonly complete: boolean }[]
  readonly acceptedQuote: { readonly id: string; readonly acceptedAt: string } | null
  readonly policyAcceptance: typeof CheckoutPolicyAcceptance.Type | null
  readonly marketingConsents: readonly (typeof MarketingConsent.Type)[]
}): PartyCheckoutReview => {
  if (
    input.requests.length === 0 ||
    input.requests.some((request) => !request.complete)
  )
    throw new CheckoutReviewUnavailable({ reason: 'request_incomplete' })
  if (!input.acceptedQuote)
    throw new CheckoutReviewUnavailable({ reason: 'quote_unaccepted' })
  if (!input.policyAcceptance)
    throw new CheckoutReviewUnavailable({ reason: 'policy_unaccepted' })
  return {
    requests: [...input.requests],
    acceptedQuote: input.acceptedQuote,
    policyAcceptance: input.policyAcceptance,
    marketingConsents: [...input.marketingConsents],
    readyToConfirm: true
  }
}

export type CheckoutFunnelEvent = {
  readonly name: 'customer_details_submitted' | 'policy_accepted' | 'checkout_reviewed'
  readonly analyticsConsent: boolean
}

export const createCheckoutTelemetry = (
  providers: {
    readonly analytics?: {
      readonly send: (
        event: Omit<CheckoutFunnelEvent, 'analyticsConsent'>
      ) => Promise<void>
    }
    readonly errors?: { readonly report: (error: unknown) => Promise<void> }
  } = {}
) => ({
  track: async (event: CheckoutFunnelEvent): Promise<void> => {
    if (!event.analyticsConsent || !providers.analytics) return
    try {
      await providers.analytics.send({ name: event.name })
    } catch {
      // Telemetry is observational and never participates in Booking commands.
    }
  },
  report: async (error: unknown): Promise<void> => {
    if (!providers.errors) return
    try {
      await providers.errors.report(error)
    } catch {
      // Optional error reporting cannot replace or mask the command result.
    }
  }
})

export const CheckoutReview = Schema.Struct({
  customerDetails: CustomerDetails,
  checkoutPath: Schema.Literal('pay_in_person'),
  holdExpiresAt: Schema.String,
  quote: BookingQuote
})
export type CheckoutReview = typeof CheckoutReview.Type

export class CheckoutUnavailable extends Schema.TaggedErrorClass<CheckoutUnavailable>()(
  'CheckoutUnavailable',
  {
    reason: Schema.Literals(['hold_expired', 'details_missing']),
    message: Schema.String
  }
) {}

type Failure = CheckoutUnavailable | CapabilityUnavailable
export type BookingCheckoutShape = {
  readonly saveCustomerDetails: (
    session: BookingSession,
    details: CustomerDetails,
    input: { readonly now: string }
  ) => Effect.Effect<CheckoutReview, Failure>
  readonly review: (
    session: BookingSession,
    input: { readonly now: string }
  ) => Effect.Effect<CheckoutReview, Failure>
}

export class BookingCheckout extends Context.Service<
  BookingCheckout,
  BookingCheckoutShape
>()('@b2b-saas-starter/capabilities/BookingCheckout') {}

const unavailable = (reason: CheckoutUnavailable['reason']) =>
  new CheckoutUnavailable({
    reason,
    message:
      reason === 'hold_expired'
        ? 'Your held time is no longer available'
        : 'Add your details to continue'
  })

export type SeedBookingCheckoutStore = {
  readonly details: Map<string, CustomerDetails>
  readonly scheduling: SeedBookingSchedulingStore
}

export const emptySeedBookingCheckoutStore = (
  scheduling: SeedBookingSchedulingStore
): SeedBookingCheckoutStore => ({ details: new Map(), scheduling })

export const SeedBookingCheckout = (
  store: SeedBookingCheckoutStore
): Layer.Layer<BookingCheckout> => {
  const requestKey = (session: BookingSession) =>
    store.scheduling.activeRequests?.get(session.id) ?? session.id
  const activeHold = (session: BookingSession, now: string) =>
    [...store.scheduling.holds.values()].find(
      (candidate) =>
        candidate.bookingSessionId === session.id &&
        candidate.expiresAt > now &&
        (!store.scheduling.activeRequests?.get(session.id) ||
          candidate.bookingRequestId ===
            store.scheduling.activeRequests?.get(session.id))
    )
  const review = (session: BookingSession, now: string) =>
    Effect.gen(function* () {
      const details = store.details.get(requestKey(session))
      if (!details) return yield* unavailable('details_missing')
      const hold = activeHold(session, now)
      if (!hold) return yield* unavailable('hold_expired')
      return {
        customerDetails: details,
        checkoutPath: 'pay_in_person' as const,
        holdExpiresAt: hold.expiresAt,
        quote: hold.quote
      }
    })
  return Layer.succeed(BookingCheckout)({
    review: (session, input) => review(session, input.now),
    saveCustomerDetails: (session, details, input) =>
      Effect.gen(function* () {
        const hold = activeHold(session, input.now)
        if (!hold) return yield* unavailable('hold_expired')
        store.details.set(requestKey(session), details)
        return yield* review(session, input.now)
      })
  })
}

export const LiveBookingCheckout: Layer.Layer<BookingCheckout, never, Database> =
  Layer.effect(
    BookingCheckout,
    Effect.gen(function* () {
      const db = yield* Database
      const read = (session: BookingSession, now: string) =>
        Effect.gen(function* () {
          const rows = yield* orUnavailable('booking-checkout')(
            db
              .select({
                session: bookingSessions,
                hold: timeSlotHolds,
                request: bookingRequests
              })
              .from(bookingSessions)
              .leftJoin(
                bookingParties,
                eq(bookingParties.bookingSessionId, bookingSessions.id)
              )
              .leftJoin(
                bookingRequests,
                eq(bookingRequests.id, bookingParties.activeRequestId)
              )
              .innerJoin(
                timeSlotHolds,
                and(
                  eq(timeSlotHolds.bookingSessionId, bookingSessions.id),
                  or(
                    eq(timeSlotHolds.bookingRequestId, bookingRequests.id),
                    isNull(timeSlotHolds.bookingRequestId)
                  ),
                  gt(timeSlotHolds.expiresAt, now)
                )
              )
              .where(eq(bookingSessions.id, session.id))
              .limit(1)
          )
          const row = rows[0]
          if (!row) return yield* unavailable('hold_expired')
          const requestDetails = row.request?.customerDetailsJson
            ? yield* Effect.try({
                try: () => JSON.parse(row.request!.customerDetailsJson!),
                catch: () => null
              }).pipe(
                Effect.flatMap((value) =>
                  Schema.decodeUnknownEffect(CustomerDetails)(value)
                ),
                Effect.mapError(
                  () =>
                    new CapabilityUnavailable({
                      capability: 'booking-checkout',
                      reason: 'invalid_customer_details'
                    })
                )
              )
            : null
          if (
            !requestDetails &&
            (!row.session.customerName || !row.session.customerEmail)
          ) {
            return yield* unavailable('details_missing')
          }
          return {
            customerDetails: requestDetails ?? {
              name: row.session.customerName!,
              email: row.session.customerEmail!,
              phone: row.session.customerPhone
            },
            checkoutPath: 'pay_in_person' as const,
            holdExpiresAt: row.hold.expiresAt,
            quote: row.hold.quote
          }
        })
      return {
        review: (session, input) => read(session, input.now),
        saveCustomerDetails: (session, details, input) =>
          Effect.gen(function* () {
            const activeHold = yield* orUnavailable('booking-checkout')(
              db
                .select({ id: timeSlotHolds.id })
                .from(timeSlotHolds)
                .where(
                  and(
                    eq(timeSlotHolds.bookingSessionId, session.id),
                    or(
                      eq(
                        timeSlotHolds.bookingRequestId,
                        sql`(select active_request_id from booking_parties where booking_session_id = ${session.id})`
                      ),
                      isNull(timeSlotHolds.bookingRequestId)
                    ),
                    gt(timeSlotHolds.expiresAt, input.now)
                  )
                )
                .limit(1)
            )
            if (!activeHold[0]) return yield* unavailable('hold_expired')
            yield* orUnavailable('booking-checkout')(
              batch(db, [
                db
                  .update(bookingSessions)
                  .set({
                    customerName: details.name,
                    customerEmail: details.email,
                    customerPhone: details.phone
                  })
                  .where(eq(bookingSessions.id, session.id)),
                db
                  .update(bookingRequests)
                  .set({ customerDetailsJson: JSON.stringify(details) })
                  .where(
                    eq(
                      bookingRequests.id,
                      sql`(select active_request_id from booking_parties where booking_session_id = ${session.id})`
                    )
                  )
              ])
            )
            return yield* read(session, input.now)
          })
      }
    })
  )
