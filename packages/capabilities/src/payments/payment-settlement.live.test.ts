import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LivePaymentSettlement } from './adapters.ts'
import { PaymentSettlement } from './payment-settlement.ts'

let test: TestD1
const now = '2026-07-12T12:00:00.000Z'

beforeAll(async () => {
  test = await provisionTestD1()
  const statements = [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES ('mrc_payment', 'Payments', 'payments', 'UTC', 'USD', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at) VALUES ('brd_payment', 'mrc_payment', 'Payments', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at) VALUES ('shp_payment', 'brd_payment', 'mrc_payment', 'payments', 'Payments', 'UTC', 'USD', '${now}', '${now}')`,
    `INSERT INTO booking_sessions (id, merchant_id, capability_hash, checkout_path, lifecycle, created_at, last_activity_at, idle_expires_at, absolute_expires_at) VALUES ('bsn_payment', 'mrc_payment', 'hash', 'pay_in_person', 'active', '${now}', '${now}', '2026-07-12T13:00:00.000Z', '2026-07-12T14:00:00.000Z')`,
    `INSERT INTO booking_parties (id, booking_session_id, shop_id, lifecycle, currency, locale, version, created_at, updated_at) VALUES ('bpt_payment', 'bsn_payment', 'shp_payment', 'active', 'USD', 'en', 1, '${now}', '${now}')`,
    `INSERT INTO pricing_quotes (id, booking_party_id, version, currency, subtotal_minor, total_minor, facts_json, accepted_at, expires_at, created_at) VALUES ('pqt_payment', 'bpt_payment', 1, 'USD', 12500, 12500, '{}', '${now}', '2026-07-12T13:00:00.000Z', '${now}')`,
    `INSERT INTO pricing_quote_acceptances (pricing_quote_id, booking_party_id, party_version, accepted_at, created_at) VALUES ('pqt_payment', 'bpt_payment', 1, '${now}', '${now}')`
  ]
  for (const statement of statements) await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())

const run = <A>(effect: Effect.Effect<A, unknown, PaymentSettlement>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(LivePaymentSettlement.pipe(Layer.provide(layerFromD1(test.d1))))
    )
  )

describe('live online Payment settlement', () => {
  it('replays starts and deduplicates provider callbacks and facts', async () => {
    const start = (idempotencyKey: string) =>
      run(
        Effect.flatMap(PaymentSettlement, (service) =>
          service.start({
            bookingPartyId: 'bpt_payment',
            bookingPartyVersion: 1,
            pricingQuoteId: 'pqt_payment',
            amountMinor: 12500,
            currency: 'USD',
            method: 'apple_pay',
            provider: 'stripe',
            idempotencyKey,
            now
          })
        )
      )
    const [first, concurrentReplay] = await Promise.all([
      start('submit-live-1'),
      start('different-browser-key')
    ])
    expect(concurrentReplay.attempt.id).toBe(first.attempt.id)
    const capture = () =>
      run(
        Effect.flatMap(PaymentSettlement, (service) =>
          service.recordAttemptOutcome({
            attemptId: first.attempt.id,
            outcome: 'succeeded',
            providerReference: 'pi_live',
            facts: [
              {
                kind: 'capture',
                amountMinor: 12500,
                currency: 'USD',
                providerReference: 'ch_live',
                occurredAt: now
              }
            ],
            now
          })
        )
      )
    await test.d1
      .prepare(
        "CREATE TRIGGER reject_payment_fact BEFORE INSERT ON payment_transactions BEGIN SELECT RAISE(ABORT, 'forced local failure'); END"
      )
      .run()
    await expect(capture()).rejects.toMatchObject({
      _tag: 'CapabilityUnavailable'
    })
    await test.d1.prepare('DROP TRIGGER reject_payment_fact').run()
    const captured = await capture()
    expect(captured.payment.status).toBe('captured')
    const reconciled = await run(
      Effect.flatMap(PaymentSettlement, (service) =>
        service.reconcile({
          paymentId: captured.payment.id,
          provider: 'stripe',
          providerEventId: 'evt_live',
          facts: [
            {
              kind: 'capture',
              amountMinor: 12500,
              currency: 'USD',
              providerReference: 'ch_live',
              occurredAt: now
            }
          ],
          now
        })
      )
    )
    expect(reconciled.payment.capturedMinor).toBe(12500)
    const replay = await run(
      Effect.flatMap(PaymentSettlement, (service) =>
        service.reconcile({
          paymentId: captured.payment.id,
          provider: 'stripe',
          providerEventId: 'evt_live',
          facts: [
            {
              kind: 'capture',
              amountMinor: 12500,
              currency: 'USD',
              providerReference: 'ch_should_be_ignored',
              occurredAt: now
            }
          ],
          now
        })
      )
    )
    expect(replay.payment.capturedMinor).toBe(12500)
    const counts = await test.d1
      .prepare(
        'SELECT (SELECT count(*) FROM payment_transactions) facts, (SELECT count(*) FROM payment_reconciliation_events) events'
      )
      .first()
    expect(counts).toEqual({ facts: 1, events: 1 })
  }, 30_000)
})
