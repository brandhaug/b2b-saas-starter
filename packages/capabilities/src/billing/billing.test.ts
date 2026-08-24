import { Effect, Layer, Result } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { type PlanLimitExceeded } from '../errors.ts'
import {
  AuditEventLog,
  type RecordAuditEventInput
} from '../governance/audit-event-log.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import {
  assertWithinPlanLimit,
  Billing,
  planById,
  PLANS,
  SeedBilling,
  stripePriceEnvName,
  verifyStripeSignature
} from './billing.ts'

/**
 * A recording in-memory `AuditEventLog`: the seed audit layer's writes are a
 * deliberate no-op, so tests asserting on the absorbed billing producers
 * capture `record` inputs in a sink array they own.
 */
function billingFixture(options?: {
  readonly stripeConfigured?: boolean
  readonly planId?: string
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
  const layer = Layer.mergeAll(
    SeedBilling({ stripeConfigured: options?.stripeConfigured }).pipe(
      Layer.provide(auditLayer)
    ),
    auditLayer,
    testWorkspaceContext({
      id: 'wrk_billing',
      slug: 'billing-lab',
      name: 'Billing Lab',
      planId: options?.planId ?? 'team'
    })
  )
  return { layer, recordedAuditEvents }
}

describe('plan catalog', () => {
  it('resolves known plans and falls back to Starter', () => {
    expect(planById('team').id).toBe('team')
    expect(planById('nope').id).toBe('starter')
    expect(PLANS.map((plan) => plan.id)).toEqual(['starter', 'team', 'enterprise'])
  })

  it('maps only self-serve plans onto price env names', () => {
    expect(stripePriceEnvName('team')).toBe('STRIPE_PRICE_ID_TEAM')
    expect(stripePriceEnvName('starter')).toBeNull()
    expect(stripePriceEnvName('enterprise')).toBeNull()
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
        expect(result.failure._tag).toBe('CapabilityUnavailable')
        // SAFETY: the tag assertion above proves the cast; the reason field
        // is what this test is about.
        // oxlint-disable-next-line effect/noAs -- test-only narrowing proven by the tag assertion directly above
        const error = result.failure as { readonly reason?: string }
        expect(error.reason).toBe('provider_not_configured')
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
        // oxlint-disable-next-line effect/noAs -- test-only narrowing proven by the tag assertion directly above
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
