import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  PaymentSettlement,
  SeedPaymentSettlement,
  deriveEligiblePaymentMethods,
  emptySeedPaymentSettlementStore
} from './payment-settlement.ts'

const configured = {
  provider: 'stripe',
  state: 'configured' as const,
  methods: [
    'card',
    'saved_card',
    'apple_pay',
    'google_pay',
    'cash_app_pay',
    'klarna'
  ] as const
}

describe('online Payment settlement', () => {
  it('exposes only configured methods that are eligible for this payer and browser', () => {
    expect(
      deriveEligiblePaymentMethods({
        configuration: configured,
        currency: 'USD',
        amountMinor: 12_500,
        savedMethodCount: 0,
        wallets: { applePay: true, googlePay: false, cashAppPay: true }
      })
    ).toEqual({
      state: 'ready',
      methods: ['card', 'apple_pay', 'cash_app_pay', 'klarna']
    })

    expect(
      deriveEligiblePaymentMethods({
        configuration: {
          provider: 'stripe',
          state: 'needs_configuration',
          methods: []
        },
        currency: 'USD',
        amountMinor: 12_500,
        savedMethodCount: 1,
        wallets: { applePay: true, googlePay: true, cashAppPay: true }
      })
    ).toEqual({ state: 'needs_configuration', methods: [] })
  })

  it('replays an attempt and derives status only from immutable monetary facts', async () => {
    const store = emptySeedPaymentSettlementStore()
    const run = <A>(effect: Effect.Effect<A, unknown, PaymentSettlement>) =>
      Effect.runPromise(effect.pipe(Effect.provide(SeedPaymentSettlement(store))))
    const start = () =>
      run(
        Effect.flatMap(PaymentSettlement, (payments) =>
          payments.start({
            bookingPartyId: 'bpt_online',
            pricingQuoteId: 'pqt_online',
            amountMinor: 12_500,
            currency: 'USD',
            method: 'card',
            provider: 'stripe',
            idempotencyKey: 'checkout-submit-1',
            now: '2026-07-12T12:00:00.000Z'
          })
        )
      )

    const first = await start()
    expect(await start()).toEqual(first)

    const failed = await run(
      Effect.flatMap(PaymentSettlement, (payments) =>
        payments.recordAttemptOutcome({
          attemptId: first.attempt.id,
          outcome: 'failed',
          failureCode: 'card_declined',
          providerReference: 'pi_failed',
          facts: [],
          now: '2026-07-12T12:00:01.000Z'
        })
      )
    )
    expect(failed.payment.status).toBe('pending')
    expect(failed.attempt.outcome).toBe('failed')

    const retry = await run(
      Effect.flatMap(PaymentSettlement, (payments) =>
        payments.start({
          bookingPartyId: 'bpt_online',
          pricingQuoteId: 'pqt_online',
          amountMinor: 12_500,
          currency: 'USD',
          method: 'card',
          provider: 'stripe',
          idempotencyKey: 'checkout-submit-2',
          now: '2026-07-12T12:01:00.000Z'
        })
      )
    )
    const captured = await run(
      Effect.flatMap(PaymentSettlement, (payments) =>
        payments.recordAttemptOutcome({
          attemptId: retry.attempt.id,
          outcome: 'succeeded',
          providerReference: 'pi_captured',
          facts: [
            {
              kind: 'capture',
              amountMinor: 12_500,
              currency: 'USD',
              providerReference: 'ch_once',
              occurredAt: '2026-07-12T12:01:01.000Z'
            }
          ],
          now: '2026-07-12T12:01:01.000Z'
        })
      )
    )
    expect(captured.payment).toMatchObject({
      status: 'captured',
      capturedMinor: 12_500
    })

    const duplicate = await run(
      Effect.flatMap(PaymentSettlement, (payments) =>
        payments.reconcile({
          paymentId: captured.payment.id,
          provider: 'stripe',
          providerEventId: 'evt_duplicate',
          facts: [
            {
              kind: 'capture',
              amountMinor: 12_500,
              currency: 'USD',
              providerReference: 'ch_once',
              occurredAt: '2026-07-12T12:01:01.000Z'
            }
          ],
          now: '2026-07-12T12:02:00.000Z'
        })
      )
    )
    expect(duplicate.payment.capturedMinor).toBe(12_500)
    expect(store.facts.size).toBe(1)
  })

  it('keeps Pay In Person provider-free and creates no Payment', async () => {
    const store = emptySeedPaymentSettlementStore()
    const result = await Effect.runPromise(
      Effect.flatMap(PaymentSettlement, (payments) =>
        payments.choosePayInPerson({
          bookingPartyId: 'bpt_person',
          currency: 'EUR',
          amountMinor: 5000
        })
      ).pipe(Effect.provide(SeedPaymentSettlement(store)))
    )
    expect(result).toEqual({
      tender: 'pay_in_person',
      amountMinor: 5000,
      currency: 'EUR'
    })
    expect(store.payments.size).toBe(0)
  })
})
