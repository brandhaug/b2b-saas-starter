import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  MerchantSubscriptions,
  SeedMerchantSubscriptions,
  emptySeedMerchantSubscriptionStore,
  subscriptionEvidenceFromProviderEvent
} from './merchant-subscriptions.ts'

const run = <A, E>(effect: Effect.Effect<A, E, MerchantSubscriptions>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SeedMerchantSubscriptions(store))))

let store: ReturnType<typeof emptySeedMerchantSubscriptionStore>

describe('MerchantSubscriptions', () => {
  it('classifies cancellation changes before the unchanged subscription price', () => {
    expect(
      subscriptionEvidenceFromProviderEvent({
        merchantId: 'mer_1',
        eventId: 'evt_cancel',
        eventType: 'customer.subscription.updated',
        occurredAt: '2026-08-02T12:00:00.000Z',
        providerCustomerRef: 'cus_1',
        providerSubscriptionRef: 'sub_1',
        actualPriceId: 'price_monthly',
        monthlyPriceId: 'price_monthly',
        annualPriceId: 'price_annual',
        cancelAtPeriodEnd: true
      })?.kind
    ).toBe('subscription-cancel-scheduled')
  })

  it('creates one idempotent fourteen-day no-card Solo trial', async () => {
    store = emptySeedMerchantSubscriptionStore()
    const input = {
      merchantId: 'mer_1',
      ownerUserId: 'usr_1',
      interval: 'monthly' as const,
      idempotencyKey: 'onboarding_1',
      now: '2026-08-02T12:00:00.000Z'
    }
    const first = await run(
      Effect.flatMap(MerchantSubscriptions, (s) => s.startTrial(input))
    )
    const replay = await run(
      Effect.flatMap(MerchantSubscriptions, (s) => s.startTrial(input))
    )

    expect(replay).toEqual(first)
    expect(first).toMatchObject({
      access: 'trialing',
      plan: 'solo',
      price: { amountMinor: 1900, currency: 'EUR', excludesVat: true }
    })
    expect(first.trialEndsAt).toBe('2026-08-16T12:00:00.000Z')
    await expect(
      run(
        Effect.flatMap(MerchantSubscriptions, (s) =>
          s.startTrial({
            ...input,
            merchantId: 'mer_2',
            idempotencyKey: 'onboarding_2'
          })
        )
      )
    ).rejects.toMatchObject({ reason: 'person_already_used_trial' })
  })

  it('converges contradictory and delayed Stripe facts without treating status as authority', async () => {
    store = emptySeedMerchantSubscriptionStore()
    await run(
      Effect.flatMap(MerchantSubscriptions, (s) =>
        s.startTrial({
          merchantId: 'mer_1',
          ownerUserId: 'usr_1',
          interval: 'annual',
          idempotencyKey: 'trial',
          now: '2026-08-02T12:00:00.000Z'
        })
      )
    )
    const service = await Effect.runPromise(
      Effect.service(MerchantSubscriptions).pipe(
        Effect.provide(SeedMerchantSubscriptions(store))
      )
    )
    await Effect.runPromise(
      service.recordEvidence({
        merchantId: 'mer_1',
        eventId: 'evt_paid',
        occurredAt: '2026-08-16T12:00:02.000Z',
        kind: 'invoice-paid',
        providerCustomerRef: 'cus_1',
        providerSubscriptionRef: 'sub_1',
        periodEndsAt: '2027-08-16T12:00:00.000Z',
        priceId: 'price_solo_annual',
        amountMinor: 19000,
        currency: 'EUR'
      })
    )
    await Effect.runPromise(
      service.recordEvidence({
        merchantId: 'mer_1',
        eventId: 'evt_failed_old',
        occurredAt: '2026-08-16T12:00:01.000Z',
        kind: 'invoice-payment-failed',
        providerCustomerRef: 'cus_1',
        providerSubscriptionRef: 'sub_1',
        periodEndsAt: '2027-08-16T12:00:00.000Z',
        priceId: 'price_solo_annual',
        amountMinor: 19000,
        currency: 'EUR'
      })
    )
    const current = await Effect.runPromise(service.get('mer_1'))
    expect(current.access).toBe('active')
    expect(store.priceEvidence).toHaveLength(1)
  })

  it('applies grace, recovery, chargeback, explicit refund consequences, and scheduled cancellation', async () => {
    store = emptySeedMerchantSubscriptionStore()
    const service = await Effect.runPromise(
      Effect.service(MerchantSubscriptions).pipe(
        Effect.provide(SeedMerchantSubscriptions(store))
      )
    )
    await Effect.runPromise(
      service.startTrial({
        merchantId: 'mer_1',
        ownerUserId: 'usr_1',
        interval: 'monthly',
        idempotencyKey: 'trial',
        now: '2026-08-02T12:00:00.000Z'
      })
    )
    await Effect.runPromise(
      service.recordEvidence({
        merchantId: 'mer_1',
        eventId: 'paid',
        occurredAt: '2026-08-03T00:00:00.000Z',
        kind: 'invoice-paid',
        providerCustomerRef: 'cus',
        providerSubscriptionRef: 'sub',
        periodEndsAt: '2026-09-03T00:00:00.000Z',
        priceId: 'price_solo_monthly',
        amountMinor: 1900,
        currency: 'EUR'
      })
    )
    expect(
      (
        await Effect.runPromise(
          service.recordEvidence({
            merchantId: 'mer_1',
            eventId: 'failed',
            occurredAt: '2026-09-03T00:00:01.000Z',
            kind: 'invoice-payment-failed',
            providerCustomerRef: 'cus',
            providerSubscriptionRef: 'sub',
            periodEndsAt: '2026-10-03T00:00:00.000Z',
            priceId: 'price_solo_monthly',
            amountMinor: 1900,
            currency: 'EUR'
          })
        )
      ).access
    ).toBe('grace')
    expect(
      (
        await Effect.runPromise(
          service.recordEvidence({
            merchantId: 'mer_1',
            eventId: 'recovered',
            occurredAt: '2026-09-04T00:00:00.000Z',
            kind: 'invoice-paid',
            providerCustomerRef: 'cus',
            providerSubscriptionRef: 'sub',
            periodEndsAt: '2026-10-03T00:00:00.000Z',
            priceId: 'price_solo_monthly',
            amountMinor: 1900,
            currency: 'EUR'
          })
        )
      ).access
    ).toBe('active')
    expect(
      (
        await Effect.runPromise(
          service.recordEvidence({
            merchantId: 'mer_1',
            eventId: 'dispute',
            occurredAt: '2026-09-05T00:00:00.000Z',
            kind: 'chargeback-opened',
            providerCustomerRef: 'cus',
            providerSubscriptionRef: 'sub'
          })
        )
      ).access
    ).toBe('restricted')
    expect(
      (
        await Effect.runPromise(
          service.reconcile({
            merchantId: 'mer_1',
            eventId: 'late-delivery-of-old-paid-invoice',
            occurredAt: '2026-09-04T00:00:00.000Z',
            kind: 'invoice-paid',
            providerCustomerRef: 'cus',
            providerSubscriptionRef: 'sub',
            periodEndsAt: '2026-10-03T00:00:00.000Z',
            priceId: 'price_solo_monthly',
            amountMinor: 1900,
            currency: 'EUR'
          })
        )
      ).access
    ).toBe('restricted')
    await expect(
      Effect.runPromise(
        service.recordEvidence({
          merchantId: 'mer_1',
          eventId: 'refund',
          occurredAt: '2026-09-06T00:00:00.000Z',
          kind: 'full-refund',
          providerCustomerRef: 'cus',
          providerSubscriptionRef: 'sub'
        })
      )
    ).rejects.toMatchObject({ reason: 'refund_consequence_required' })
  })
})
