import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq, gt } from 'drizzle-orm'
import { bookingSessions, Database, timeSlotHolds } from '@b2b-saas-starter/db'
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
    Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(40),
      Schema.isPattern(/^\S(?:.*\S)?$/)
    )
  )
})
export type CustomerDetails = typeof CustomerDetails.Type

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
  const review = (session: BookingSession, now: string) =>
    Effect.gen(function* () {
      const details = store.details.get(session.id)
      if (!details) return yield* unavailable('details_missing')
      const hold = [...store.scheduling.holds.values()].find(
        (candidate) =>
          candidate.bookingSessionId === session.id && candidate.expiresAt > now
      )
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
        const hold = [...store.scheduling.holds.values()].find(
          (candidate) =>
            candidate.bookingSessionId === session.id && candidate.expiresAt > input.now
        )
        if (!hold) return yield* unavailable('hold_expired')
        store.details.set(session.id, details)
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
              .select({ session: bookingSessions, hold: timeSlotHolds })
              .from(bookingSessions)
              .innerJoin(
                timeSlotHolds,
                and(
                  eq(timeSlotHolds.bookingSessionId, bookingSessions.id),
                  gt(timeSlotHolds.expiresAt, now)
                )
              )
              .where(eq(bookingSessions.id, session.id))
              .limit(1)
          )
          const row = rows[0]
          if (!row) return yield* unavailable('hold_expired')
          if (!row.session.customerName || !row.session.customerEmail) {
            return yield* unavailable('details_missing')
          }
          return {
            customerDetails: {
              name: row.session.customerName,
              email: row.session.customerEmail,
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
                    gt(timeSlotHolds.expiresAt, input.now)
                  )
                )
                .limit(1)
            )
            if (!activeHold[0]) return yield* unavailable('hold_expired')
            yield* orUnavailable('booking-checkout')(
              db
                .update(bookingSessions)
                .set({
                  customerName: details.name,
                  customerEmail: details.email,
                  customerPhone: details.phone
                })
                .where(eq(bookingSessions.id, session.id))
            )
            return yield* read(session, input.now)
          })
      }
    })
  )
