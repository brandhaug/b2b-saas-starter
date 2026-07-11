import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { BookingPartyId, PaymentId } from '../ids.ts'

export const PaymentLifecycle = Schema.Literals([
  'pending',
  'authorized',
  'partially_captured',
  'captured',
  'partially_refunded',
  'refunded',
  'cancelled'
])
export const Payment = Schema.Struct({
  id: PaymentId,
  bookingPartyId: Schema.NullOr(BookingPartyId),
  status: PaymentLifecycle,
  currency: Schema.String,
  authorizedMinor: Schema.Number,
  capturedMinor: Schema.Number,
  refundedMinor: Schema.Number
})
export const GiftCardLifecycle = Schema.Literals([
  'active',
  'suspended',
  'expired',
  'voided'
])
export const GiftCardSaleLifecycle = Schema.Literals([
  'pending_payment',
  'issuing',
  'issued',
  'cancelled',
  'refunded'
])
export class PaymentAttemptRejected extends Schema.TaggedErrorClass<PaymentAttemptRejected>()(
  'PaymentAttemptRejected',
  { paymentId: Schema.String, code: Schema.String }
) {}

export class PaymentNotFound extends Schema.TaggedErrorClass<PaymentNotFound>()(
  'PaymentNotFound',
  { paymentId: PaymentId }
) {}

export type PaymentLedgerShape = {
  readonly findById: (
    paymentId: string
  ) => Effect.Effect<typeof Payment.Type, PaymentNotFound | CapabilityUnavailable>
}

export class PaymentLedger extends Context.Service<PaymentLedger, PaymentLedgerShape>()(
  '@b2b-saas-starter/capabilities/PaymentLedger'
) {}
