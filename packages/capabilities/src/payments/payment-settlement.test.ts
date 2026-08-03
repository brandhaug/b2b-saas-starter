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

    expect(
      deriveEligiblePaymentMethods({
        configuration: configured,
        currency: 'RON',
        amountMinor: 12_500,
        savedMethodCount: 1,
        wallets: { applePay: false, googlePay: false, cashAppPay: false }
      }).methods
    ).toEqual(['card', 'saved_card'])
  })

  it('replays an attempt and derives status only from immutable monetary facts', async () => {
    const store = emptySeedPaymentSettlementStore(
      new Map([
        [
          'pqt_online',
          {
            bookingPartyId: 'bpt_online',
            amountMinor: 12_500,
            currency: 'USD',
            expiresAt: '2026-07-12T13:00:00.000Z',
            partyVersion: 1
          }
        ]
      ])
    )
    const run = <A>(effect: Effect.Effect<A, unknown, PaymentSettlement>) =>
      Effect.runPromise(effect.pipe(Effect.provide(SeedPaymentSettlement(store))))
    const start = () =>
      run(
        Effect.flatMap(PaymentSettlement, (payments) =>
          payments.start({
            bookingPartyId: 'bpt_online',
            bookingPartyVersion: 1,
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
    const samePendingAttempt = await run(
      Effect.flatMap(PaymentSettlement, (payments) =>
        payments.start({
          bookingPartyId: 'bpt_online',
          bookingPartyVersion: 1,
          pricingQuoteId: 'pqt_online',
          amountMinor: 12_500,
          currency: 'USD',
          method: 'card',
          provider: 'stripe',
          idempotencyKey: 'lost-browser-key',
          now: '2026-07-12T12:00:00.000Z'
        })
      )
    )
    expect(samePendingAttempt.attempt.id).toBe(first.attempt.id)

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
    await expect(
      run(
        Effect.flatMap(PaymentSettlement, (payments) =>
          payments.recordAttemptOutcome({
            attemptId: first.attempt.id,
            outcome: 'succeeded',
            providerReference: 'pi_changed',
            facts: [],
            now: '2026-07-12T12:00:02.000Z'
          })
        )
      )
    ).rejects.toMatchObject({ code: 'attempt_already_completed' })

    const retry = await run(
      Effect.flatMap(PaymentSettlement, (payments) =>
        payments.start({
          bookingPartyId: 'bpt_online',
          bookingPartyVersion: 1,
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
    await expect(
      run(
        Effect.flatMap(PaymentSettlement, (payments) =>
          payments.recordAttemptOutcome({
            attemptId: retry.attempt.id,
            outcome: 'succeeded',
            providerReference: 'pi_overcapture',
            facts: [
              {
                kind: 'capture',
                amountMinor: 12_501,
                currency: 'USD',
                providerReference: 'ch_overcapture',
                occurredAt: '2026-07-12T12:01:01.000Z'
              }
            ],
            now: '2026-07-12T12:01:01.000Z'
          })
        )
      )
    ).rejects.toMatchObject({ code: 'invalid_monetary_facts' })
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
    const refunded = await run(
      Effect.flatMap(PaymentSettlement, (payments) =>
        payments.reconcile({
          paymentId: captured.payment.id,
          provider: 'stripe',
          providerEventId: 'evt_refund',
          facts: [
            {
              kind: 'refund',
              amountMinor: 2500,
              currency: 'USD',
              providerReference: 're_partial',
              occurredAt: '2026-07-12T12:03:00.000Z'
            }
          ],
          now: '2026-07-12T12:03:00.000Z'
        })
      )
    )
    expect(refunded.payment).toMatchObject({
      status: 'partially_refunded',
      refundedMinor: 2500
    })
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

  it('derives cancellation and refunds from immutable provider facts', async () => {
    const store = emptySeedPaymentSettlementStore(
      new Map([
        [
          'pqt_lifecycle',
          {
            bookingPartyId: 'bpt_lifecycle',
            amountMinor: 5000,
            currency: 'EUR',
            expiresAt: '2026-07-12T13:00:00.000Z',
            partyVersion: 1
          }
        ]
      ])
    )
    const run = <A>(effect: Effect.Effect<A, unknown, PaymentSettlement>) =>
      Effect.runPromise(effect.pipe(Effect.provide(SeedPaymentSettlement(store))))
    const start = (key: string) =>
      run(
        Effect.flatMap(PaymentSettlement, (payments) =>
          payments.start({
            bookingPartyId: 'bpt_lifecycle',
            bookingPartyVersion: 1,
            pricingQuoteId: 'pqt_lifecycle',
            amountMinor: 5000,
            currency: 'EUR',
            method: 'card',
            provider: 'stripe',
            idempotencyKey: key,
            now: '2026-07-12T12:00:00.000Z'
          })
        )
      )
    const attempt = await start('lifecycle-attempt')
    const cancelled = await run(
      Effect.flatMap(PaymentSettlement, (payments) =>
        payments.recordAttemptOutcome({
          attemptId: attempt.attempt.id,
          outcome: 'succeeded',
          providerReference: 'pi_cancelled',
          facts: [
            {
              kind: 'authorization',
              amountMinor: 5000,
              currency: 'EUR',
              providerReference: 'auth_cancelled',
              occurredAt: '2026-07-12T12:00:01.000Z'
            },
            {
              kind: 'void',
              amountMinor: 5000,
              currency: 'EUR',
              providerReference: 'void_cancelled',
              occurredAt: '2026-07-12T12:00:02.000Z'
            }
          ],
          now: '2026-07-12T12:00:02.000Z'
        })
      )
    )
    expect(cancelled.payment.status).toBe('cancelled')
  })
})
