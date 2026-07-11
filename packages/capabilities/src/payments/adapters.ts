import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, payments } from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { PaymentLedger, PaymentNotFound } from './index.ts'

export const SeedPaymentLedger = (
  records: readonly (typeof import('./index.ts').Payment.Type)[] = []
): Layer.Layer<PaymentLedger> =>
  Layer.succeed(PaymentLedger)({
    findById: (paymentId) => {
      const payment = records.find((record) => record.id === paymentId)
      return payment
        ? Effect.succeed(payment)
        : Effect.fail(new PaymentNotFound({ paymentId }))
    }
  })

export const LivePaymentLedger: Layer.Layer<PaymentLedger, never, Database> =
  Layer.effect(
    PaymentLedger,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        findById: (paymentId) =>
          Effect.flatMap(
            orUnavailable('payment-ledger')(
              db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
            ),
            ([payment]) =>
              payment
                ? Effect.succeed({
                    id: payment.id,
                    bookingPartyId: payment.bookingPartyId,
                    status: payment.status,
                    currency: payment.currency,
                    authorizedMinor: payment.authorizedMinor,
                    capturedMinor: payment.capturedMinor,
                    refundedMinor: payment.refundedMinor
                  })
                : Effect.fail(new PaymentNotFound({ paymentId }))
          )
      }
    })
  )
