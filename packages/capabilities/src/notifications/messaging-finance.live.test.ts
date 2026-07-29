import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveMessagingFinance } from './messaging-finance.ts'
import { MessagingFinance } from './index.ts'

const now = '2026-07-29T12:00:00.000Z'
const expiresAt = '2026-08-05T12:00:00.000Z'

let test: TestD1

const run = <A, E>(effect: Effect.Effect<A, E, MessagingFinance>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(LiveMessagingFinance.pipe(Layer.provide(layerFromD1(test.d1))))
    )
  )

beforeAll(async () => {
  test = await provisionTestD1()
  for (const statement of [
    `INSERT INTO merchants
     (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
     VALUES ('mer_finance', 'Finance', 'finance', 'Europe/Bucharest', 'EUR', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands
     (id, merchant_id, name, created_at, updated_at)
     VALUES ('brd_finance', 'mer_finance', 'Finance', '${now}', '${now}')`,
    `INSERT INTO shops
     (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
     VALUES ('shp_finance', 'brd_finance', 'mer_finance', 'finance', 'Finance',
      'Europe/Bucharest', 'EUR', '${now}', '${now}')`,
    `INSERT INTO shops
     (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
     VALUES ('shp_concurrent', 'brd_finance', 'mer_finance', 'concurrent', 'Concurrent',
      'Europe/Bucharest', 'EUR', '${now}', '${now}')`,
    `INSERT INTO shops
     (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
     VALUES ('shp_correction', 'brd_finance', 'mer_finance', 'correction', 'Correction',
      'Europe/Bucharest', 'EUR', '${now}', '${now}')`,
    `INSERT INTO merchant_messaging_controls
     (shop_id, enabled, low_balance_notice_armed, created_at, updated_at)
     VALUES ('shp_finance', 1, 1, '${now}', '${now}')`,
    `INSERT INTO merchant_messaging_controls
     (shop_id, enabled, low_balance_notice_armed, created_at, updated_at)
     VALUES ('shp_concurrent', 1, 1, '${now}', '${now}')`,
    `INSERT INTO notification_intents
     (id, shop_id, topic, recipient_json, payload_json, source_type, source_id,
      source_version, deduplication_key, purpose, phase, locale, rate_card_id,
      status, available_at, created_at, updated_at)
     VALUES ('nti_finance', 'shp_finance', 'appointment.confirmed', '{}', '{}',
      'appointment', 'apt_finance', 1, 'appointment:apt_finance:1:confirmation',
      'appointment_confirmation', 'routing', 'ro', 'mrcard_launch_v1', 'processing',
      '${now}', '${now}', '${now}')`,
    `INSERT INTO delivery_routes
     (id, shop_id, intent_id, ordinal, channel, provider, state, created_at, updated_at)
     VALUES ('drt_finance_whatsapp', 'shp_finance', 'nti_finance', 0, 'whatsapp',
      'meta', 'delivered', '${now}', '${now}')`,
    `INSERT INTO delivery_routes
     (id, shop_id, intent_id, ordinal, channel, provider, state, created_at, updated_at)
     VALUES ('drt_finance_sms', 'shp_finance', 'nti_finance', 1, 'sms',
      'smso', 'eligible', '${now}', '${now}')`,
    `INSERT INTO submission_attempts
     (id, shop_id, intent_id, route_id, ordinal, idempotency_key, request_fingerprint,
      state, started_at, created_at)
     VALUES ('pat_finance_meta', 'shp_finance', 'nti_finance', 'drt_finance_whatsapp', 0,
      'attempt:finance:meta', 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'accepted', '${now}', '${now}')`,
    `INSERT INTO submission_attempts
     (id, shop_id, intent_id, route_id, ordinal, idempotency_key, request_fingerprint,
      state, started_at, created_at)
     VALUES ('pat_finance_smso', 'shp_finance', 'nti_finance', 'drt_finance_sms', 0,
      'attempt:finance:smso', 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'accepted', '${now}', '${now}')`,
    `INSERT INTO provider_evidence
     (id, shop_id, intent_id, route_id, attempt_id, environment, provider,
      provider_account_key, source, source_event_key, status, trusted, observed_at, created_at)
     VALUES ('pevd_finance_delivered', 'shp_finance', 'nti_finance',
      'drt_finance_whatsapp', 'pat_finance_meta', 'test', 'meta', 'meta_test',
      'callback', 'finance:delivered', 'delivered', 1, '${now}', '${now}')`,
    `INSERT INTO notification_intents
     (id, shop_id, topic, recipient_json, payload_json, source_type, source_id,
      source_version, deduplication_key, purpose, phase, locale, rate_card_id,
      status, available_at, created_at, updated_at)
     VALUES ('nti_concurrent_a', 'shp_concurrent', 'appointment.confirmed', '{}', '{}',
      'appointment', 'apt_concurrent_a', 1, 'concurrent:a', 'appointment_confirmation',
      'routing', 'ro', 'mrcard_launch_v1', 'processing', '${now}', '${now}', '${now}')`,
    `INSERT INTO notification_intents
     (id, shop_id, topic, recipient_json, payload_json, source_type, source_id,
      source_version, deduplication_key, purpose, phase, locale, rate_card_id,
      status, available_at, created_at, updated_at)
     VALUES ('nti_concurrent_b', 'shp_concurrent', 'appointment.confirmed', '{}', '{}',
      'appointment', 'apt_concurrent_b', 1, 'concurrent:b', 'appointment_confirmation',
      'routing', 'ro', 'mrcard_launch_v1', 'processing', '${now}', '${now}', '${now}')`,
    `INSERT INTO notification_intents
     (id, shop_id, topic, recipient_json, payload_json, source_type, source_id,
      source_version, deduplication_key, purpose, phase, locale, rate_card_id,
      status, available_at, created_at, updated_at)
     VALUES ('nti_unverified', 'shp_finance', 'appointment.reminder', '{}', '{}',
      'appointment', 'apt_unverified', 1, 'unverified:1', 'appointment_reminder',
      'routing', 'ro', 'mrcard_launch_v1', 'processing', '${now}', '${now}', '${now}')`,
    `INSERT INTO delivery_routes
     (id, shop_id, intent_id, ordinal, channel, provider, state, created_at, updated_at)
     VALUES ('drt_unverified', 'shp_finance', 'nti_unverified', 0, 'whatsapp',
      'meta', 'accepted', '${now}', '${now}')`
  ])
    await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Messaging Finance', () => {
  it('converts one reservation into one €0.045 ordinary delivery charge', async () => {
    const result = await run(
      Effect.gen(function* () {
        const finance = yield* MessagingFinance
        const credit = yield* finance.credit({
          shopId: 'shp_finance',
          kind: 'top_up',
          amountMilliEuro: 10_000,
          sourceType: 'stripe_payment',
          sourceId: 'pi_finance',
          idempotencyKey: 'stripe:pi_finance:succeeded',
          fiscalReference: 'invoice:finance',
          occurredAt: now
        })
        const reservation = yield* finance.reserve({
          shopId: 'shp_finance',
          intentId: 'nti_finance',
          expiresAt,
          reservedAt: now
        })
        const delivery = yield* finance.convertDelivery({
          shopId: 'shp_finance',
          intentId: 'nti_finance',
          routeId: 'drt_finance_whatsapp',
          verifiedAt: '2026-07-29T12:01:00.000Z'
        })
        const retry = yield* finance.convertDelivery({
          shopId: 'shp_finance',
          intentId: 'nti_finance',
          routeId: 'drt_finance_whatsapp',
          verifiedAt: '2026-07-29T12:01:00.000Z'
        })
        return {
          credit,
          reservation,
          delivery,
          retry,
          balance: yield* finance.balance('shp_finance'),
          statement: yield* finance.statement('shp_finance')
        }
      })
    )

    expect(result.reservation.amountMilliEuro).toBe(45)
    expect(result.delivery).toEqual(result.retry)
    expect(result.delivery.chargeMilliEuro).toBe(45)
    expect(result.balance).toMatchObject({
      postedMilliEuro: 9_955,
      reservedMilliEuro: 0,
      availableMilliEuro: 9_955
    })
    expect(
      result.statement.map((entry) => [entry.kind, entry.amountMilliEuro])
    ).toEqual([
      ['top_up', 10_000],
      ['delivery_charge', 45]
    ])
  })

  it('rejects an overdraw and appends an idempotent compensating correction', async () => {
    const finance = await run(MessagingFinance)
    const credit = await run(
      finance.credit({
        shopId: 'shp_correction',
        kind: 'operator_adjustment',
        amountMilliEuro: 100,
        sourceType: 'operator_command',
        sourceId: 'cmd_credit',
        idempotencyKey: 'cmd:credit',
        actorType: 'system_operator',
        actorId: 'opr_finance',
        reason: 'Test credit',
        occurredAt: '2026-07-29T12:02:00.000Z'
      })
    )
    await expect(
      run(
        finance.debit({
          shopId: 'shp_correction',
          kind: 'operator_adjustment',
          amountMilliEuro: 101,
          sourceType: 'operator_command',
          sourceId: 'cmd_overdraw',
          idempotencyKey: 'cmd:overdraw',
          actorType: 'system_operator',
          actorId: 'opr_finance',
          reason: 'Must fail',
          occurredAt: '2026-07-29T12:03:00.000Z'
        })
      )
    ).rejects.toMatchObject({
      _tag: 'MessagingFinanceRejected',
      reason: 'insufficient_balance'
    })

    const debit = await run(
      finance.debit({
        shopId: 'shp_correction',
        kind: 'operator_adjustment',
        amountMilliEuro: 50,
        sourceType: 'operator_command',
        sourceId: 'cmd_debit',
        idempotencyKey: 'cmd:debit',
        actorType: 'system_operator',
        actorId: 'opr_finance',
        reason: 'Test debit',
        occurredAt: '2026-07-29T12:04:00.000Z'
      })
    )
    const correctionInput = {
      shopId: 'shp_correction',
      entryId: debit.id,
      correctionReason: 'invalid_operator_debit',
      sourceType: 'reconciliation',
      sourceId: 'case_correction',
      idempotencyKey: 'case:correction',
      actorType: 'system_operator',
      actorId: 'opr_finance',
      reason: 'Reverse invalid debit',
      occurredAt: '2026-07-29T12:05:00.000Z'
    } as const
    const correction = await run(finance.correct(correctionInput))
    expect(await run(finance.correct(correctionInput))).toEqual(correction)
    expect(correction).toMatchObject({
      direction: 'credit',
      kind: 'correction',
      amountMilliEuro: 50,
      reversesEntryId: debit.id
    })
    expect(await run(finance.balance('shp_correction'))).toMatchObject({
      postedMilliEuro: 100,
      reservedMilliEuro: 0,
      availableMilliEuro: 100
    })
    expect(
      (await run(finance.statement('shp_correction'))).map((entry) => entry.id)
    ).toEqual([credit.id, debit.id, correction.id])
  })

  it('records every provider billing unit without changing the Merchant charge', async () => {
    const finance = await run(MessagingFinance)
    const metaInput = {
      shopId: 'shp_finance',
      intentId: 'nti_finance',
      attemptId: 'pat_finance_meta',
      environment: 'test',
      provider: 'meta',
      providerAccountKey: 'meta_test',
      billingIdentityFingerprint:
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      unitOrdinal: 0,
      amountMinorUnits: 239,
      currency: 'EUR',
      currencyScale: 4,
      units: 1,
      source: 'invoice',
      recordedAt: '2026-07-29T12:06:00.000Z'
    } as const
    const smsoInput = {
      ...metaInput,
      attemptId: 'pat_finance_smso',
      provider: 'smso',
      providerAccountKey: 'smso_test',
      billingIdentityFingerprint:
        'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      amountMinorUnits: 35,
      currencyScale: 3
    } as const
    const meta = await run(finance.recordProviderCost(metaInput))
    expect(await run(finance.recordProviderCost(metaInput))).toEqual(meta)
    await run(finance.recordProviderCost(smsoInput))

    expect(await run(finance.balance('shp_finance'))).toMatchObject({
      postedMilliEuro: 9_955,
      availableMilliEuro: 9_955
    })
    expect(await run(finance.reconciliationInputs('shp_finance'))).toMatchObject({
      ledgerEntryCount: 2,
      activeReservationCount: 0,
      chargeableDeliveryCount: 1,
      providerCostCount: 2,
      openCaseCount: 0
    })
  })

  it('conserves the final charge under concurrent reservations and re-arms after funding', async () => {
    const finance = await run(MessagingFinance)
    await run(
      finance.credit({
        shopId: 'shp_concurrent',
        kind: 'top_up',
        amountMilliEuro: 45,
        sourceType: 'stripe_payment',
        sourceId: 'pi_concurrent_small',
        idempotencyKey: 'stripe:concurrent:small',
        occurredAt: now
      })
    )
    const reserve = (intentId: string) =>
      run(
        finance.reserve({
          shopId: 'shp_concurrent',
          intentId,
          expiresAt,
          reservedAt: now
        })
      )
    const outcomes = await Promise.allSettled([
      reserve('nti_concurrent_a'),
      reserve('nti_concurrent_b')
    ])
    const winner = outcomes.find(
      (
        outcome
      ): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof reserve>>> =>
        outcome.status === 'fulfilled'
    )
    const loser = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(winner?.value.status).toBe('active')
    expect(loser?.reason).toMatchObject({
      _tag: 'MessagingFinanceRejected',
      reason: 'insufficient_balance'
    })
    expect(await run(finance.balance('shp_concurrent'))).toMatchObject({
      postedMilliEuro: 45,
      reservedMilliEuro: 45,
      availableMilliEuro: 0,
      lowBalanceNoticeArmed: false
    })

    await run(
      finance.release({
        shopId: 'shp_concurrent',
        intentId: winner!.value.intentId,
        reason: 'terminal_without_delivery',
        releasedAt: '2026-07-29T12:07:00.000Z'
      })
    )
    await run(
      finance.credit({
        shopId: 'shp_concurrent',
        kind: 'top_up',
        amountMilliEuro: 2_000,
        sourceType: 'stripe_payment',
        sourceId: 'pi_concurrent_rearm',
        idempotencyKey: 'stripe:concurrent:rearm',
        occurredAt: '2026-07-29T12:08:00.000Z'
      })
    )
    expect(await run(finance.balance('shp_concurrent'))).toMatchObject({
      postedMilliEuro: 2_045,
      reservedMilliEuro: 0,
      availableMilliEuro: 2_045,
      lowBalanceNoticeArmed: true
    })
  })

  it('selects effective-dated Rate Cards and rejects a future price without notice', async () => {
    await expect(
      test.d1
        .prepare(
          `INSERT INTO messaging_rate_cards
           (id, version, currency, charge_milli_euro, effective_at,
            notice_published_at, created_at)
           VALUES ('mrcard_invalid_v2', 2, 'EUR', 50,
            '2026-08-15T00:00:00.000Z', '2026-08-01T00:00:00.000Z', ?)`
        )
        .bind(now)
        .run()
    ).rejects.toThrow(/30 days/i)

    await test.d1
      .prepare(
        `INSERT INTO messaging_rate_cards
         (id, version, currency, charge_milli_euro, effective_at,
          notice_published_at, created_at)
         VALUES ('mrcard_v2', 2, 'EUR', 50,
          '2026-09-01T00:00:00.000Z', '2026-07-30T00:00:00.000Z', ?)`
      )
      .bind(now)
      .run()
    const finance = await run(MessagingFinance)
    expect(
      await run(finance.effectiveRateCard('2026-08-31T23:59:59.999Z'))
    ).toMatchObject({
      id: 'mrcard_launch_v1',
      chargeMilliEuro: 45
    })
    expect(
      await run(finance.effectiveRateCard('2026-09-01T00:00:00.000Z'))
    ).toMatchObject({
      id: 'mrcard_v2',
      chargeMilliEuro: 50
    })
  })

  it('does not convert an unverified route or consume its reservation', async () => {
    const finance = await run(MessagingFinance)
    await run(
      finance.reserve({
        shopId: 'shp_finance',
        intentId: 'nti_unverified',
        expiresAt,
        reservedAt: '2026-07-29T12:09:00.000Z'
      })
    )
    await expect(
      run(
        finance.convertDelivery({
          shopId: 'shp_finance',
          intentId: 'nti_unverified',
          routeId: 'drt_unverified',
          verifiedAt: '2026-07-29T12:10:00.000Z'
        })
      )
    ).rejects.toMatchObject({
      _tag: 'MessagingFinanceRejected',
      reason: 'route_unavailable'
    })
    expect(await run(finance.reconciliationInputs('shp_finance'))).toMatchObject({
      activeReservationCount: 1,
      chargeableDeliveryCount: 1
    })
    await run(
      finance.release({
        shopId: 'shp_finance',
        intentId: 'nti_unverified',
        reason: 'terminal_without_delivery',
        releasedAt: '2026-07-29T12:11:00.000Z'
      })
    )
  })
})
