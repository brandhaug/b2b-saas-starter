import { Effect, Layer, Result } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import {
  AuditEventLog,
  type RecordAuditEventInput
} from '../governance/audit-event-log.ts'
import { makeSeedRoster } from '../governance/workspace-membership.ts'
import { type Member } from '../governance/workspace-identity.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { Billing } from './billing.ts'
import { SeedBilling, type SeedSubscriptionFixture } from './billing.seed.ts'
import {
  assertWithinPlanLimit,
  planById,
  PLANS,
  seatUsage,
  STARTER_PLAN
} from './plan-catalog.ts'
import { subscriptionLinkForStripeEvent, verifyStripeSignature } from './stripe.ts'

/**
 * A recording in-memory `AuditEventLog`: the seed audit layer's writes are a
 * deliberate no-op, so tests asserting on the absorbed billing producers
 * capture `record` inputs in a sink array they own.
 */
function billingFixture(options?: {
  readonly stripeConfigured?: boolean
  readonly planId?: string
  readonly subscriptions?: ReadonlyArray<SeedSubscriptionFixture>
  readonly memberCount?: number
}) {
  const recordedAuditEvents: Array<RecordAuditEventInput> = []
  const auditLayer = Layer.effect(AuditEventLog)(
    Effect.succeed({
      list: () => Effect.die('not used here'),
      listGlobal: Effect.succeed([]),
      record: (input: RecordAuditEventInput) =>
        Effect.sync(() => {
          recordedAuditEvents.push(input)
        }),
      prepareRecord: () => Effect.die('not used here')
    })
  )
  const rosterLayer = Layer.unwrap(
    Effect.gen(function* () {
      const roster = yield* makeSeedRoster(membersFor(options?.memberCount ?? 0))
      return Layer.mergeAll(
        SeedBilling({
          stripeConfigured: options?.stripeConfigured,
          subscriptions: options?.subscriptions,
          roster
        }).pipe(Layer.provide(auditLayer)),
        auditLayer,
        testWorkspaceContext({
          id: 'wrk_billing',
          slug: 'billing-lab',
          name: 'Billing Lab',
          planId: options?.planId ?? 'team'
        })
      )
    })
  )
  const layer = rosterLayer
  return { layer, recordedAuditEvents }
}

/** Fixture members with stable ids; only the count matters to the seat tests. */
function membersFor(count: number): ReadonlyArray<Member> {
  return Array.from({ length: count }, (_, index) => ({
    id: `usr_seat_${index}`,
    name: `Seat ${index}`,
    email: `seat${index}@seed.local`,
    role: 'member',
    systemRole: 'user'
  }))
}

describe('plan catalog', () => {
  it('resolves known plans and falls back to Starter', () => {
    expect(planById('team').id).toBe('team')
    expect(planById('nope').id).toBe('starter')
    expect(PLANS.map((plan) => plan.id)).toEqual(['starter', 'team', 'enterprise'])
  })

  it('carries a price env var only on self-serve plans', () => {
    expect(planById('team').stripePriceEnv).toBe('STRIPE_PRICE_ID_TEAM')
    expect(planById('starter').stripePriceEnv).toBeNull()
    expect(planById('enterprise').stripePriceEnv).toBeNull()
  })
})

describe('seed billing contract', () => {
  it.effect('currentPlan resolves the workspace plan from the catalog', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const plan = yield* billing.currentPlan
      expect(plan.id).toBe('team')
    }).pipe(Effect.provide(billingFixture().layer))
  )

  it.effect('startCheckout fails provider_not_configured when Stripe is unset', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const result = yield* Effect.result(
        billing.startCheckout({
          planId: 'team',
          successUrl: 'https://x.test/s',
          cancelUrl: 'https://x.test/c'
        })
      )
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        // The typed error carries `reason` directly — no narrowing needed.
        expect(result.failure._tag).toBe('CapabilityUnavailable')
        expect(result.failure.reason).toBe('provider_not_configured')
      }
    }).pipe(Effect.provide(billingFixture({ stripeConfigured: false }).layer))
  )

  it.effect('startCheckout hands off a URL and audits when configured', () =>
    Effect.gen(function* () {
      const fixture = billingFixture({ stripeConfigured: true })
      const program = Effect.gen(function* () {
        const billing = yield* Billing
        const session = yield* billing.startCheckout({
          planId: 'team',
          successUrl: 'https://x.test/s',
          cancelUrl: 'https://x.test/c'
        })
        expect(session.url).toContain('https://checkout.stripe.com/')
        // The checkout_started audit event is the deferred producer absorbed
        // into this capability.
        expect(
          fixture.recordedAuditEvents.some(
            (event) => event.eventType === 'billing.checkout_started'
          )
        ).toBe(true)
      })
      yield* program.pipe(Effect.provide(fixture.layer))
    }).pipe(Effect.provide(Layer.empty))
  )

  it.effect('applyProviderEvent changes the plan and audits', () =>
    Effect.gen(function* () {
      const fixture = billingFixture()
      const program = Effect.gen(function* () {
        const billing = yield* Billing
        const applied = yield* billing.applyProviderEvent({
          workspaceId: 'wrk_billing',
          planId: 'starter',
          detail: { source: 'customer.subscription.deleted' }
        })
        expect(applied).toBe(true)
        const plan = yield* billing.currentPlan
        expect(plan.id).toBe('starter')
        const recorded = fixture.recordedAuditEvents.find(
          (event) => event.eventType === 'billing.plan_changed'
        )
        expect(recorded).toBeDefined()
        expect(recorded?.actorUserId).toBeNull()
        expect(recorded?.targetId).toBe('wrk_billing')
      })
      yield* program.pipe(Effect.provide(fixture.layer))
    }).pipe(Effect.provide(Layer.empty))
  )

  it.effect('applyProviderEvent refuses unknown plans', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const unknownPlan = yield* billing.applyProviderEvent({
        workspaceId: 'wrk_billing',
        planId: 'ultimate'
      })
      expect(unknownPlan).toBe(false)
    }).pipe(Effect.provide(billingFixture().layer))
  )
})

describe('seat pricing catalog', () => {
  it('prices the free plan flat with included seats and keeps it', () => {
    expect(STARTER_PLAN.pricing).toBe('flat')
    expect(STARTER_PLAN.price).toBe('$0')
    expect(STARTER_PLAN.limits.seats).toBe(3)
    expect(planById('team').pricing).toBe('per_seat')
    expect(planById('enterprise').pricing).toBe('flat')
  })

  it('flags a flat plan whose members passed its included seats', () => {
    const over = seatUsage(STARTER_PLAN, 4)
    expect(over.overLimit).toBe(true)
    expect(over.included).toBe(3)
    expect(over.used).toBe(4)
    // At the ceiling is fine — the ceiling gates the *next* seat.
    expect(seatUsage(STARTER_PLAN, 3).overLimit).toBe(false)
  })

  it('never flags per-seat or unlimited-flat plans', () => {
    expect(seatUsage(planById('team'), 50).overLimit).toBe(false)
    expect(seatUsage(planById('team'), 50).included).toBeNull()
    expect(seatUsage(planById('enterprise'), 999).overLimit).toBe(false)
  })
})

describe('seed billing seat sync', () => {
  const subscription: SeedSubscriptionFixture = {
    workspaceId: 'wrk_billing',
    customerId: 'cus_seed',
    subscriptionId: 'sub_seed',
    subscriptionItemId: 'si_seed',
    seatQuantity: 2
  }

  it.effect('syncs the member count onto the stored quantity and audits', () =>
    Effect.gen(function* () {
      const fixture = billingFixture({
        stripeConfigured: true,
        subscriptions: [subscription],
        memberCount: 4
      })
      const program = Effect.gen(function* () {
        const billing = yield* Billing
        const result = yield* billing.syncSeats({
          workspaceId: 'wrk_billing',
          reason: 'member_added'
        })
        expect(result).toEqual({ outcome: 'synced', quantity: 4 })
        const recorded = fixture.recordedAuditEvents.find(
          (event) => event.eventType === 'billing.seats_changed'
        )
        expect(recorded).toBeDefined()
        expect(recorded?.actorUserId).toBeNull()
        expect(recorded?.metadata).toMatchObject({
          quantity: 4,
          reason: 'member_added'
        })
      })
      yield* program.pipe(Effect.provide(fixture.layer))
    }).pipe(Effect.provide(Layer.empty))
  )

  it.effect('skips a quantity already equal to the member count', () =>
    Effect.gen(function* () {
      const fixture = billingFixture({
        stripeConfigured: true,
        subscriptions: [{ ...subscription, seatQuantity: 4 }],
        memberCount: 4
      })
      const program = Effect.gen(function* () {
        const billing = yield* Billing
        const result = yield* billing.syncSeats({
          workspaceId: 'wrk_billing',
          reason: 'member_added'
        })
        expect(result).toEqual({ outcome: 'quantity_unchanged', quantity: 4 })
        expect(
          fixture.recordedAuditEvents.some(
            (event) => event.eventType === 'billing.seats_changed'
          )
        ).toBe(false)
      })
      yield* program.pipe(Effect.provide(fixture.layer))
    }).pipe(Effect.provide(Layer.empty))
  )

  it.effect('skips workspaces that never checked out', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const result = yield* billing.syncSeats({
        workspaceId: 'wrk_billing',
        reason: 'member_added'
      })
      expect(result).toEqual({ outcome: 'no_subscription', quantity: null })
    }).pipe(Effect.provide(billingFixture({ stripeConfigured: true }).layer))
  )

  it.effect('skips subscriptions whose seat item has not been linked yet', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const result = yield* billing.syncSeats({
        workspaceId: 'wrk_billing',
        reason: 'member_added'
      })
      expect(result).toEqual({ outcome: 'no_seat_item', quantity: null })
    }).pipe(
      Effect.provide(
        billingFixture({
          stripeConfigured: true,
          subscriptions: [{ ...subscription, subscriptionItemId: null }]
        }).layer
      )
    )
  )

  it.effect('skips without a configured provider once a sync is due', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const result = yield* billing.syncSeats({
        workspaceId: 'wrk_billing',
        reason: 'member_added'
      })
      expect(result).toEqual({ outcome: 'provider_not_configured', quantity: null })
    }).pipe(
      Effect.provide(
        billingFixture({ subscriptions: [subscription], memberCount: 4 }).layer
      )
    )
  )
})

describe('seed billing subscription events', () => {
  it.effect('links checkout state and reconciles a moved quantity', () =>
    Effect.gen(function* () {
      const fixture = billingFixture({ stripeConfigured: true })
      const program = Effect.gen(function* () {
        const billing = yield* Billing
        const linked = yield* billing.applySubscriptionEvent({
          workspaceId: 'wrk_billing',
          customerId: 'cus_seed',
          subscriptionId: 'sub_seed',
          detail: { source: 'checkout.session.completed' }
        })
        expect(linked).toBe(true)
        // A link without a quantity change records no seat event.
        expect(
          fixture.recordedAuditEvents.some(
            (event) => event.eventType === 'billing.seats_changed'
          )
        ).toBe(false)

        const reconciled = yield* billing.applySubscriptionEvent({
          workspaceId: 'wrk_billing',
          subscriptionItemId: 'si_seed',
          quantity: 5,
          detail: { source: 'customer.subscription.updated' }
        })
        expect(reconciled).toBe(true)
        const seats = fixture.recordedAuditEvents.find(
          (event) => event.eventType === 'billing.seats_changed'
        )
        expect(seats).toBeDefined()
        expect(seats?.metadata).toMatchObject({ quantity: 5 })
      })
      yield* program.pipe(Effect.provide(fixture.layer))
    }).pipe(Effect.provide(Layer.empty))
  )

  it.effect('deletion clears the seat item and keeps the customer', () =>
    Effect.gen(function* () {
      const fixture = billingFixture({
        stripeConfigured: true,
        subscriptions: [
          {
            workspaceId: 'wrk_billing',
            customerId: 'cus_seed',
            subscriptionId: 'sub_seed',
            subscriptionItemId: 'si_seed',
            seatQuantity: 4
          }
        ]
      })
      const program = Effect.gen(function* () {
        const billing = yield* Billing
        const applied = yield* billing.applySubscriptionEvent({
          workspaceId: 'wrk_billing',
          deleted: true,
          detail: { source: 'customer.subscription.deleted' }
        })
        expect(applied).toBe(true)
        // The portal still works afterwards: the customer row survives.
        yield* billing.startPortalSession({ returnUrl: 'https://x.test/b' })
        const seats = fixture.recordedAuditEvents.find(
          (event) => event.eventType === 'billing.seats_changed'
        )
        expect(seats?.metadata).toMatchObject({ quantity: 0 })
      })
      yield* program.pipe(Effect.provide(fixture.layer))
    }).pipe(Effect.provide(Layer.empty))
  )

  it.effect('refuses a customerless event for a workspace that has no profile', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const applied = yield* billing.applySubscriptionEvent({
        workspaceId: 'wrk_billing',
        quantity: 3
      })
      expect(applied).toBe(false)
    }).pipe(Effect.provide(billingFixture().layer))
  )
})

describe('seed billing portal', () => {
  it.effect('hands off a portal URL and audits when the workspace has a profile', () =>
    Effect.gen(function* () {
      const fixture = billingFixture({
        stripeConfigured: true,
        subscriptions: [
          {
            workspaceId: 'wrk_billing',
            customerId: 'cus_seed',
            seatQuantity: 4
          }
        ]
      })
      const program = Effect.gen(function* () {
        const billing = yield* Billing
        const session = yield* billing.startPortalSession({
          returnUrl: 'https://x.test/billing'
        })
        expect(session.url).toContain('https://billing.stripe.com/')
        const recorded = fixture.recordedAuditEvents.find(
          (event) => event.eventType === 'billing.portal_opened'
        )
        expect(recorded).toBeDefined()
        expect(recorded?.targetId).toBe('wrk_billing')
      })
      yield* program.pipe(Effect.provide(fixture.layer))
    }).pipe(Effect.provide(Layer.empty))
  )

  it.effect('fails no_billing_profile before the first checkout', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const result = yield* Effect.result(
        billing.startPortalSession({ returnUrl: 'https://x.test/billing' })
      )
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe('no_billing_profile')
      }
    }).pipe(Effect.provide(billingFixture({ stripeConfigured: true }).layer))
  )

  it.effect('fails provider_not_configured with Stripe unset', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const result = yield* Effect.result(
        billing.startPortalSession({ returnUrl: 'https://x.test/billing' })
      )
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe('provider_not_configured')
      }
    }).pipe(Effect.provide(billingFixture().layer))
  )
})

describe('stripe subscription event policy', () => {
  it('reads linkage from checkout sessions and seat quantities from subscription events', () => {
    const checkout = subscriptionLinkForStripeEvent('checkout.session.completed', {
      customer: 'cus_1',
      subscription: 'sub_1'
    })
    expect(checkout).toEqual({
      kind: 'link',
      customerId: 'cus_1',
      subscriptionId: 'sub_1'
    })

    const updated = subscriptionLinkForStripeEvent('customer.subscription.updated', {
      id: 'sub_1',
      customer: 'cus_1',
      items: { data: [{ id: 'si_1', quantity: 7 }] }
    })
    expect(updated).toEqual({
      kind: 'quantity',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      subscriptionItemId: 'si_1',
      quantity: 7
    })
  })

  it('degrades a quantity-less subscription event to link and reads deletions', () => {
    expect(
      subscriptionLinkForStripeEvent('customer.subscription.created', {
        id: 'sub_2',
        items: { data: [{ id: 'si_2' }] }
      })
    ).toEqual({ kind: 'link', customerId: undefined, subscriptionId: 'sub_2' })
    expect(
      subscriptionLinkForStripeEvent('customer.subscription.deleted', { id: 'sub_2' })
    ).toEqual({ kind: 'deleted' })
    expect(subscriptionLinkForStripeEvent('invoice.paid', {})).toBeNull()
  })
})

describe('entitlement gate', () => {
  it.effect('starter caps are enforced against the used count', () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        assertWithinPlanLimit({ resource: 'api_token', used: 2 })
      )
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe('PlanLimitExceeded')
        // SAFETY: the tag assertion above proves the cast.
        const error = result.failure
        expect(error.limit).toBe(2)
        expect(error.planId).toBe('starter')
      }
    }).pipe(Effect.provide(billingFixture({ planId: 'starter' }).layer))
  )

  it.effect('counts below the cap pass', () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        assertWithinPlanLimit({ resource: 'api_token', used: 1 })
      )
      expect(Result.isSuccess(result)).toBe(true)
    }).pipe(Effect.provide(billingFixture({ planId: 'starter' }).layer))
  )

  it.effect('paid plans never cap', () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        assertWithinPlanLimit({ resource: 'webhook_endpoint', used: 999 })
      )
      expect(Result.isSuccess(result)).toBe(true)
    }).pipe(Effect.provide(billingFixture({ planId: 'enterprise' }).layer))
  )
})

describe('stripe signature verification', () => {
  /* oxlint-disable effect/noAsyncFunction, effect/noGlobals -- these tests exercise the real Web Crypto and wall-clock behavior the verifier depends on; faking either would prove nothing */

  async function signedHeader(secret: string, payload: string, timestamp: number) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signed = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${payload}`)
    )
    const hex = [...new Uint8Array(signed)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `t=${timestamp},v1=${hex}`
  }

  it('accepts a fresh valid signature and rejects tampering', async () => {
    const payload = '{"type":"checkout.session.completed"}'
    const header = await signedHeader(
      'whsec_test',
      payload,
      Math.floor(Date.now() / 1000)
    )
    expect(
      await verifyStripeSignature({
        secret: 'whsec_test',
        payload,
        header
      })
    ).toBe(true)
    expect(
      await verifyStripeSignature({
        secret: 'whsec_other',
        payload,
        header
      })
    ).toBe(false)
    expect(
      await verifyStripeSignature({
        secret: 'whsec_test',
        payload: '{"type":"tampered"}',
        header
      })
    ).toBe(false)
    expect(
      await verifyStripeSignature({ secret: 'whsec_test', payload, header: null })
    ).toBe(false)
  })

  it('rejects malformed headers without touching the MAC', async () => {
    const payload = 'p'
    for (const header of ['', 'garbage', 'v1=abc', 't=123', 't=abc,v1=zz']) {
      expect(
        await verifyStripeSignature({ secret: 'whsec_test', payload, header })
      ).toBe(false)
    }
  })

  it('rejects stale timestamps beyond tolerance', async () => {
    const payload = 'p'
    const stale = Math.floor(Date.now() / 1000) - 3600
    const header = await signedHeader('whsec_test', payload, stale)
    expect(await verifyStripeSignature({ secret: 'whsec_test', payload, header })).toBe(
      false
    )
  })
  /* oxlint-enable effect/noAsyncFunction, effect/noGlobals */
})
