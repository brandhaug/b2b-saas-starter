import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveBookingCancellations } from './booking-cancellation-adapter.ts'
import { BookingCancellations } from './booking-cancellation.ts'

let test: TestD1
const now = '2026-07-13T10:00:00.000Z'
const snapshot = (totalMinor: number) =>
  JSON.stringify({
    startsAt: '2026-07-14T10:00:00.000Z',
    endsAt: '2026-07-14T11:00:00.000Z',
    providerPreference: { kind: 'any' },
    assignedProvider: { id: 'prv_cancel', displayName: 'Mara' },
    services: [],
    durationMinutes: 60,
    currency: 'USD',
    totalMinor,
    merchantTimezone: 'UTC',
    customerDetails: { name: 'Ana', email: 'ana@example.test', phone: null },
    checkoutPath: 'online_payment',
    cancellationPolicy: {
      id: 'pol_cancel',
      version: 2,
      cancellableUntilMinutesBeforeStart: 60
    },
    refundPolicy: {
      id: 'pol_refund',
      version: 3,
      refundableUntilMinutesBeforeStart: 120,
      refundBasisPoints: 10000
    }
  })

beforeAll(async () => {
  test = await provisionTestD1()
  for (const statement of [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES ('mrc_cancel', 'Cancel Shop', 'cancel-shop', 'UTC', 'USD', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at) VALUES ('brd_cancel', 'mrc_cancel', 'Cancel Shop', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at) VALUES ('shp_cancel', 'brd_cancel', 'mrc_cancel', 'cancel', 'Cancel Shop', 'UTC', 'USD', '${now}', '${now}')`,
    `INSERT INTO providers (id, merchant_id, display_name, status, created_at, updated_at) VALUES ('prv_cancel', 'mrc_cancel', 'Mara', 'active', '${now}', '${now}')`,
    `INSERT INTO booking_sessions (id, merchant_id, capability_hash, checkout_path, lifecycle, created_at, last_activity_at, idle_expires_at, absolute_expires_at) VALUES ('bsn_cancel', 'mrc_cancel', 'hash', 'pay_in_person', 'consumed', '${now}', '${now}', '2026-07-14T12:00:00.000Z', '2026-07-14T13:00:00.000Z')`,
    `INSERT INTO booking_parties (id, booking_session_id, shop_id, lifecycle, currency, locale, version, created_at, updated_at) VALUES ('bpt_cancel', 'bsn_cancel', 'shp_cancel', 'confirmed', 'USD', 'en', 1, '${now}', '${now}')`,
    `INSERT INTO gift_card_products (id, merchant_id, name, currency, scope, scope_id, preset_amounts_json, allows_custom_amount, active, created_at, updated_at) VALUES ('gcp_cancel', 'mrc_cancel', 'Cancel card', 'USD', 'shop', 'shp_cancel', '[10000]', 0, 1, '${now}', '${now}')`,
    `INSERT INTO gift_card_sales (id, shop_id, gift_card_product_id, status, amount_minor, currency, recipient_json, purchaser_json, created_at, updated_at) VALUES ('gcs_cancel', 'shp_cancel', 'gcp_cancel', 'issued', 10000, 'USD', 'null', '{}', '${now}', '${now}')`,
    `INSERT INTO gift_cards (id, gift_card_sale_id, code_hash, status, currency, scope, scope_id, initial_value_minor, created_at, updated_at) VALUES ('gcd_cancel', 'gcs_cancel', 'cancel-card-hash', 'active', 'USD', 'shop', 'shp_cancel', 10000, '${now}', '${now}')`,
    `INSERT INTO gift_card_ledger_entries (id, gift_card_id, kind, amount_minor, idempotency_key, occurred_at, created_at) VALUES ('gcl_cancel_issue', 'gcd_cancel', 'issuance', 10000, 'issuance:gcd_cancel', '${now}', '${now}')`,
    `INSERT INTO payments (id, booking_party_id, amount_minor, status, currency, captured_minor, created_at, updated_at) VALUES ('pay_cancel', 'bpt_cancel', 6000, 'captured', 'USD', 6000, '${now}', '${now}')`,
    `INSERT INTO payment_transactions (id, payment_id, kind, amount_minor, currency, provider_reference, occurred_at, created_at) VALUES ('ptx_cancel_capture', 'pay_cancel', 'capture', 6000, 'USD', 'pi_cancel:capture', '${now}', '${now}')`,
    `INSERT INTO appointments (id, merchant_id, provider_id, booking_party_id, status, starts_at, ends_at, snapshot, created_at, updated_at) VALUES ('apt_cancel_one', 'mrc_cancel', 'prv_cancel', 'bpt_cancel', 'scheduled', '2026-07-14T10:00:00.000Z', '2026-07-14T11:00:00.000Z', '${snapshot(5000)}', '${now}', '${now}')`,
    `INSERT INTO appointments (id, merchant_id, provider_id, booking_party_id, status, starts_at, ends_at, snapshot, created_at, updated_at) VALUES ('apt_cancel_two', 'mrc_cancel', 'prv_cancel', 'bpt_cancel', 'scheduled', '2026-07-14T12:00:00.000Z', '2026-07-14T13:00:00.000Z', '${snapshot(5000)}', '${now}', '${now}')`,
    `INSERT INTO settlement_allocations (id, booking_party_id, tender, reference_id, amount_minor, currency, created_at) VALUES ('sta_gift', 'bpt_cancel', 'gift_card', 'gcd_cancel', 4000, 'USD', '${now}')`,
    `INSERT INTO settlement_allocations (id, booking_party_id, tender, reference_id, amount_minor, currency, created_at) VALUES ('sta_pay', 'bpt_cancel', 'external_payment', 'pay_cancel', 6000, 'USD', '${now}')`
  ])
    await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())

const run = <A>(effect: Effect.Effect<A, unknown, BookingCancellations>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(LiveBookingCancellations.pipe(Layer.provide(layerFromD1(test.d1))))
    )
  )

describe('Live Booking cancellation', () => {
  it('atomically cancels one appointment and persists original tender allocations', async () => {
    const cancel = () =>
      run(
        Effect.flatMap(BookingCancellations, (service) =>
          service.cancel({
            merchantId: 'mrc_cancel',
            scope: { kind: 'appointment', appointmentId: 'apt_cancel_one' },
            idempotencyKey: 'cancel-live-one',
            reason: 'customer_requested',
            now
          })
        )
      )
    const result = await cancel()
    expect(result.refundObligations[0]?.allocations).toEqual([
      { tender: 'gift_card', referenceId: 'gcd_cancel', amountMinor: 4000 },
      { tender: 'external_payment', referenceId: 'pay_cancel', amountMinor: 1000 }
    ])
    expect((await cancel()).replayed).toBe(true)
    const rows = await test.d1.batch([
      test.d1.prepare("SELECT status FROM appointments WHERE id = 'apt_cancel_one'"),
      test.d1.prepare("SELECT status FROM appointments WHERE id = 'apt_cancel_two'"),
      test.d1.prepare(
        "SELECT * FROM lifecycle_history WHERE aggregate_id = 'apt_cancel_one'"
      ),
      test.d1.prepare('SELECT * FROM refund_obligations'),
      test.d1.prepare('SELECT * FROM refund_obligation_allocations ORDER BY position')
    ])
    expect(rows[0]!.results[0]).toMatchObject({ status: 'cancelled' })
    expect(rows[1]!.results[0]).toMatchObject({ status: 'scheduled' })
    expect(rows[2]!.results).toHaveLength(1)
    expect(rows[3]!.results).toHaveLength(1)
    expect(rows[4]!.results).toHaveLength(2)

    const failed = await run(
      Effect.flatMap(BookingCancellations, (service) =>
        service.recordRefundOutcome({
          obligationId: result.refundObligations[0]!.id,
          providerEventId: 'refund-attempt-failed',
          outcome: 'failed_retryable',
          failureCode: 'provider_unavailable',
          now
        })
      )
    )
    expect(failed).toMatchObject({
      status: 'failed_retryable',
      attemptCount: 1,
      failureCode: 'provider_unavailable'
    })
    const refunded = await run(
      Effect.flatMap(BookingCancellations, (service) =>
        service.recordRefundOutcome({
          obligationId: result.refundObligations[0]!.id,
          providerEventId: 'refund-provider-success',
          outcome: 'succeeded',
          now
        })
      )
    )
    expect(refunded).toMatchObject({ status: 'succeeded', attemptCount: 2 })
    const monetary = await test.d1.batch([
      test.d1.prepare(
        "SELECT refunded_minor, status FROM payments WHERE id = 'pay_cancel'"
      ),
      test.d1.prepare("SELECT * FROM payment_transactions WHERE kind = 'refund'"),
      test.d1.prepare("SELECT * FROM gift_card_ledger_entries WHERE kind = 'refund'")
    ])
    expect(monetary[0]!.results[0]).toMatchObject({
      refunded_minor: 1000,
      status: 'partially_refunded'
    })
    expect(monetary[1]!.results).toHaveLength(1)
    expect(monetary[2]!.results).toHaveLength(1)
  })
})
