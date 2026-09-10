import { assertWithinPlanLimit } from '@b2b-saas-starter/billing/resource-admission'
import { SeedNotificationFeed } from '../notifications/notification-feed.seed.ts'
import { SeedNotificationPreferences } from '../notifications/notification-preferences.ts'
import { SeedAccountPreferences } from '../governance/account-preferences.ts'
import { Effect, Layer, Ref, Result } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import {
  AuditEventLog,
  type RecordAuditEventInput
} from '../governance/audit-event-log.ts'
import { makeSeedRoster } from '../governance/workspace-membership.ts'
import { type Member } from '../governance/workspace-identity.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { BillingAuditLayer, BillingNotificationLayer } from '../billing-adapters.ts'
import { Billing } from '@b2b-saas-starter/billing/billing'
import {
  SeedBilling,
  type SeedProviderSubscriptionFixture,
  type SeedSubscriptionFixture
} from '@b2b-saas-starter/billing/billing.seed'
import {
  planById,
  PLANS,
  resourceEntitlement,
  EMPTY_RESOURCE_SELECTION,
  seatUsage,
  STARTER_PLAN
} from '@b2b-saas-starter/billing/plan-catalog'
import {
  subscriptionLinkForStripeEvent,
  verifyStripeSignature
} from '@b2b-saas-starter/billing/stripe'

/**
 * A recording in-memory `AuditEventLog`: the seed audit layer's writes are a
 * deliberate no-op, so tests asserting on the absorbed billing producers
 * capture `record` inputs in a sink array they own.
 */
function billingFixture(options?: {
  readonly stripeConfigured?: boolean
  readonly planId?: string
  readonly subscriptions?: ReadonlyArray<SeedSubscriptionFixture>
  readonly providerSubscriptions?: ReadonlyArray<SeedProviderSubscriptionFixture>
  readonly providerState?: Ref.Ref<ReadonlyMap<string, SeedProviderSubscriptionFixture>>
  readonly memberCount?: number
  readonly failFirstAudit?: boolean
}) {
  const recordedAuditEvents: Array<RecordAuditEventInput> = []
  let failFirstAudit = options?.failFirstAudit ?? false
  const auditLayer = Layer.effect(AuditEventLog)(
    Effect.succeed({
      get: () => Effect.die('not used here'),
      list: () => Effect.die('not used here'),
      listGlobal: Effect.succeed([]),
      record: (input: RecordAuditEventInput) => {
        if (failFirstAudit) {
          failFirstAudit = false
          return Effect.fail(
            new CapabilityUnavailable({ capability: 'audit', reason: 'test_failure' })
          )
        }
        return Effect.sync(() => {
          recordedAuditEvents.push(input)
        })
      },
      prepareRecord: () => Effect.die('not used here')
    })
  )
  const feed = SeedNotificationFeed([]).pipe(
    Layer.provide(
      Layer.merge(SeedNotificationPreferences([]), SeedAccountPreferences([]))
    ),
    Layer.provide(auditLayer)
  )
  const rosterLayer = Layer.unwrap(
    Effect.gen(function* () {
      const roster = yield* makeSeedRoster(membersFor(options?.memberCount ?? 0))
      return Layer.mergeAll(
        SeedBilling({
          stripeConfigured: options?.stripeConfigured,
          subscriptions: options?.subscriptions,
          providerState: options?.providerState,
          providerSubscriptions: options?.providerSubscriptions?.map((provider) => ({
            ...provider,
            payment: provider.payment ?? {
              lastPaymentAt: '2026-08-01T00:00:00.000Z',
              firstFailedAt: null,
              currentInvoicePaid: true
            }
          })),
          workspacePlans: { wrk_billing: options?.planId ?? 'team' },
          members: Ref.get(roster)
        }).pipe(
          Layer.provide(BillingAuditLayer.pipe(Layer.provide(auditLayer))),
          Layer.provide(BillingNotificationLayer.pipe(Layer.provide(feed)))
        ),
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
})

describe('seat pricing catalog', () => {
  it('prices the free plan flat with included seats and keeps it', () => {
    expect(STARTER_PLAN.pricing).toBe('flat')
    expect(STARTER_PLAN.price).toEqual({ amount: 0, currency: 'USD' })
    expect(STARTER_PLAN.descriptionKey).toBe('shell_plan_starter_description')
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

  it('preserves excess resources but pauses an over-limit category until selected', () => {
    const ids = ['tok_1', 'tok_2', 'tok_3']
    const paused = resourceEntitlement(
      STARTER_PLAN,
      'api_token',
      ids,
      EMPTY_RESOURCE_SELECTION
    )
    expect(paused.paused).toBe(true)
    expect(paused.activeIds).toEqual([])
    expect(paused.used).toBe(3)

    const selected = resourceEntitlement(STARTER_PLAN, 'api_token', ids, {
      apiTokenIds: ['tok_3', 'tok_missing', 'tok_1'],
      webhookEndpointIds: []
    })
    expect(selected.paused).toBe(false)
    expect(selected.activeIds).toEqual(['tok_3', 'tok_1'])
    expect(
      resourceEntitlement(STARTER_PLAN, 'api_token', ids, {
        apiTokenIds: ['tok_1', 'tok_2'],
        webhookEndpointIds: []
      }).paused
    ).toBe(false)
  })

  it('keeps every resource active when the plan has no ceiling', () => {
    const ids = ['wh_1', 'wh_2', 'wh_3']
    const entitlement = resourceEntitlement(planById('team'), 'webhook_endpoint', ids)
    expect(entitlement.paused).toBe(false)
    expect(entitlement.activeIds).toEqual(ids)
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

  it.effect('does not publish a seat mutation before its audit succeeds', () =>
    Effect.gen(function* () {
      const fixture = billingFixture({
        stripeConfigured: true,
        subscriptions: [subscription],
        memberCount: 4,
        failFirstAudit: true
      })
      const program = Effect.gen(function* () {
        const billing = yield* Billing
        const failed = yield* Effect.result(
          billing.syncSeats({ workspaceId: 'wrk_billing', reason: 'member_added' })
        )
        expect(Result.isFailure(failed)).toBe(true)

        // The one-shot audit failure leaves the stored quantity at 2. The
        // retry therefore still performs the mutation and emits its evidence.
        const retried = yield* billing.syncSeats({
          workspaceId: 'wrk_billing',
          reason: 'member_added'
        })
        expect(retried).toEqual({ outcome: 'synced', quantity: 4 })
        expect(
          fixture.recordedAuditEvents.filter(
            (event) => event.eventType === 'billing.seats_changed'
          )
        ).toHaveLength(1)
      })
      yield* program.pipe(Effect.provide(fixture.layer))
    }).pipe(Effect.provide(Layer.empty))
  )

  it.effect('reconciles provider seat drift even when the stored count matches', () =>
    Effect.gen(function* () {
      const fixture = billingFixture({
        stripeConfigured: true,
        subscriptions: [{ ...subscription, seatQuantity: 4 }],
        providerSubscriptions: [
          {
            ...subscription,
            seatQuantity: 2,
            planId: 'team',
            status: 'active'
          }
        ],
        memberCount: 4
      })
      const program = Effect.gen(function* () {
        const billing = yield* Billing
        const result = yield* billing.syncSeats({
          workspaceId: 'wrk_billing',
          reason: 'member_added'
        })
        expect(result).toEqual({ outcome: 'synced', quantity: 4 })
        expect(
          fixture.recordedAuditEvents.some(
            (event) =>
              event.eventType === 'billing.seats_changed' &&
              event.metadata?.reason === 'member_added'
          )
        ).toBe(true)
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

describe('seed billing reconciliation and checkout claims', () => {
  for (const delivery of ['direct', 'receipt']) {
    it.effect(
      `shows missing-provider conflicts for ${delivery} events and allows retry`,
      () =>
        Effect.gen(function* () {
          const provider: SeedProviderSubscriptionFixture = {
            workspaceId: 'wrk_billing',
            customerId: 'cus_seed',
            subscriptionId: 'sub_seed',
            subscriptionItemId: 'si_seed',
            seatQuantity: 1,
            planId: 'team',
            status: 'active',
            payment: {
              lastPaymentAt: '2026-08-01T00:00:00.000Z',
              firstFailedAt: null,
              currentInvoicePaid: true
            }
          }
          const providerState = yield* Ref.make<
            ReadonlyMap<string, SeedProviderSubscriptionFixture>
          >(new Map([['wrk_billing', provider]]))
          yield* Effect.gen(function* () {
            const billing = yield* Billing
            yield* billing.reconcileWorkspace({ workspaceId: 'wrk_billing' })
            const verified = yield* billing.synchronizationStatus
            expect(verified.status).toBe('current')
            expect(verified.lastSyncedAt).not.toBeNull()
            yield* Ref.set(providerState, new Map())
            const event = {
              providerEventId: `evt_seed_missing_${delivery}`,
              eventType: 'customer.subscription.updated',
              workspaceId: 'wrk_billing'
            }
            if (delivery === 'receipt') {
              yield* billing.recordProviderEvent(event)
              yield* billing.reconcileBatch({ limit: 1 })
            } else {
              expect(yield* billing.processProviderEvent(event)).toEqual({
                outcome: 'conflict',
                providerEventId: event.providerEventId,
                reason: 'provider_snapshot_missing'
              })
            }
            expect(yield* billing.synchronizationStatus).toEqual({
              status: 'conflict',
              lastSyncedAt: verified.lastSyncedAt
            })
            expect((yield* billing.currentPlan).id).toBe('team')
            yield* Ref.set(providerState, new Map([['wrk_billing', provider]]))
            if (delivery === 'receipt') {
              yield* billing.reconcileBatch({ limit: 1 })
            } else {
              expect((yield* billing.processProviderEvent(event)).outcome).toBe(
                'applied'
              )
            }
            expect((yield* billing.processProviderEvent(event)).outcome).toBe(
              'duplicate'
            )
            expect((yield* billing.synchronizationStatus).status).toBe('current')
          }).pipe(
            Effect.provide(
              billingFixture({ stripeConfigured: true, providerState }).layer
            )
          )
        })
    )
  }

  it.effect('reconciles a persisted provider receipt after a queue crash', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      yield* billing.recordProviderEvent({
        providerEventId: 'evt_seed_receipt',
        eventType: 'customer.subscription.updated',
        workspaceId: 'wrk_billing',
        subscription: { customerId: 'cus_seed', subscriptionId: 'sub_seed' }
      })
      yield* billing.reconcileBatch({ limit: 1 })
      expect((yield* billing.currentPlan).id).toBe('team')
      const duplicate = yield* billing.processProviderEvent({
        providerEventId: 'evt_seed_receipt',
        eventType: 'customer.subscription.updated',
        workspaceId: 'wrk_billing'
      })
      expect(duplicate.outcome).toBe('duplicate')
      yield* billing.recordProviderEvent({
        providerEventId: 'evt_seed_receipt',
        eventType: 'customer.subscription.updated',
        workspaceId: 'wrk_billing'
      })
      yield* billing.reconcileBatch({ limit: 1 })
      const stillDuplicate = yield* billing.processProviderEvent({
        providerEventId: 'evt_seed_receipt',
        eventType: 'customer.subscription.updated',
        workspaceId: 'wrk_billing'
      })
      expect(stillDuplicate.outcome).toBe('duplicate')
    }).pipe(
      Effect.provide(
        billingFixture({
          stripeConfigured: true,
          planId: 'starter',
          providerSubscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_seed',
              subscriptionItemId: 'si_seed',
              seatQuantity: 1,
              planId: 'team',
              status: 'active'
            }
          ]
        }).layer
      )
    )
  )

  it.effect('reconciles the provider fixture instead of trusting event payloads', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const result = yield* billing.processProviderEvent({
        providerEventId: 'evt_seed_authority',
        eventType: 'customer.subscription.deleted',
        workspaceId: 'wrk_billing',
        planId: 'starter',
        subscription: { deleted: true }
      })
      expect(result.outcome).toBe('applied')
      expect((yield* billing.currentPlan).id).toBe('team')
      const duplicate = yield* billing.processProviderEvent({
        providerEventId: 'evt_seed_authority',
        eventType: 'customer.subscription.deleted',
        workspaceId: 'wrk_billing',
        planId: 'starter'
      })
      expect(duplicate.outcome).toBe('duplicate')
    }).pipe(
      Effect.provide(
        billingFixture({
          stripeConfigured: true,
          planId: 'team',
          providerSubscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_seed',
              subscriptionItemId: 'si_seed',
              seatQuantity: 1,
              planId: 'team',
              status: 'active'
            }
          ]
        }).layer
      )
    )
  )

  it.effect('records verified incomplete provider state without paid access', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const result = yield* billing.reconcileWorkspace({ workspaceId: 'wrk_billing' })
      expect(result.outcome).toBe('repaired')
      expect((yield* billing.synchronizationStatus).status).toBe('current')
      expect((yield* billing.currentPlan).id).toBe('starter')
    }).pipe(
      Effect.provide(
        billingFixture({
          stripeConfigured: true,
          planId: 'team',
          subscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_seed',
              subscriptionItemId: 'si_seed',
              seatQuantity: 1
            }
          ],
          providerSubscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_seed',
              subscriptionItemId: 'si_seed',
              seatQuantity: 1,
              planId: 'team',
              status: 'past_due'
            }
          ]
        }).layer
      )
    )
  )

  it.effect('records delayed synchronization when the provider is not configured', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const result = yield* Effect.result(
        billing.processProviderEvent({
          providerEventId: 'evt_seed_unconfigured',
          eventType: 'customer.subscription.updated',
          workspaceId: 'wrk_billing'
        })
      )
      expect(Result.isFailure(result)).toBe(true)
      expect((yield* billing.synchronizationStatus).status).toBe('delayed')
    }).pipe(
      Effect.provide(
        billingFixture({
          subscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_seed',
              subscriptionItemId: 'si_seed',
              seatQuantity: 1
            }
          ],
          providerSubscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_seed',
              subscriptionItemId: 'si_seed',
              seatQuantity: 1,
              planId: 'team',
              status: 'active'
            }
          ]
        }).layer
      )
    )
  )

  it.effect('reuses one checkout claim for concurrent retries', () =>
    Effect.gen(function* () {
      const fixture = billingFixture({ stripeConfigured: true, memberCount: 2 })
      const result = yield* Effect.gen(function* () {
        const billing = yield* Billing
        return yield* Effect.all(
          [
            billing.startCheckout({
              planId: 'team',
              successUrl: 'https://x.test/s',
              cancelUrl: 'https://x.test/c'
            }),
            billing.startCheckout({
              planId: 'team',
              successUrl: 'https://x.test/s',
              cancelUrl: 'https://x.test/c'
            })
          ],
          { concurrency: 'unbounded' }
        )
      }).pipe(Effect.provide(fixture.layer))
      expect(result[0].url).toBe(result[1].url)
      expect(
        fixture.recordedAuditEvents.filter(
          (event) => event.eventType === 'billing.checkout_started'
        )
      ).toHaveLength(1)
    })
  )

  it.effect('blocks a competing checkout plan', () =>
    Effect.gen(function* () {
      const fixture = billingFixture({ stripeConfigured: true })
      const program = Effect.gen(function* () {
        const billing = yield* Billing
        const first = yield* billing.startCheckout({
          planId: 'team',
          successUrl: 'https://x.test/s',
          cancelUrl: 'https://x.test/c'
        })
        expect(first.url).toContain('checkout.stripe.com')
        const competing = yield* Effect.result(
          billing.startCheckout({
            planId: 'enterprise',
            successUrl: 'https://x.test/s2',
            cancelUrl: 'https://x.test/c2'
          })
        )
        expect(Result.isFailure(competing)).toBe(true)
      })
      yield* program.pipe(Effect.provide(fixture.layer))
    })
  )

  it.effect(
    'opens the portal when the provider already has an active subscription',
    () =>
      Effect.gen(function* () {
        const fixture = billingFixture({
          stripeConfigured: true,
          subscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_seed',
              subscriptionItemId: 'si_seed',
              seatQuantity: 1
            }
          ],
          providerSubscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_seed',
              subscriptionItemId: 'si_seed',
              seatQuantity: 1,
              planId: 'team',
              status: 'active'
            }
          ]
        })
        const program = Effect.gen(function* () {
          const billing = yield* Billing
          const result = yield* billing.startCheckout({
            planId: 'team',
            successUrl: 'https://x.test/s',
            cancelUrl: 'https://x.test/c'
          })
          expect(result.url).toContain('billing.stripe.com')
        })
        yield* program.pipe(Effect.provide(fixture.layer))
      })
  )

  it.effect('reconciles provider seats and plan from the authoritative fixture', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const result = yield* billing.reconcileWorkspace({ workspaceId: 'wrk_billing' })
      expect(result).toEqual({
        workspaceId: 'wrk_billing',
        outcome: 'repaired',
        drift: ['seat_quantity', 'subscription']
      })
      expect((yield* billing.currentPlan).id).toBe('team')
    }).pipe(
      Effect.provide(
        billingFixture({
          stripeConfigured: true,
          memberCount: 4,
          planId: 'team',
          subscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_old',
              subscriptionItemId: 'si_old',
              seatQuantity: 1
            }
          ],
          providerSubscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_new',
              subscriptionItemId: 'si_new',
              seatQuantity: 2,
              planId: 'team',
              status: 'active'
            }
          ]
        }).layer
      )
    )
  )

  it.effect('reconciles cancellation while retaining the customer profile', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const result = yield* billing.reconcileWorkspace({ workspaceId: 'wrk_billing' })
      expect(result.outcome).toBe('repaired')
      expect(result.drift).toEqual(['plan', 'seat_quantity', 'subscription'])
      expect((yield* billing.currentPlan).id).toBe('starter')
      const portal = yield* billing.startPortalSession({
        returnUrl: 'https://x.test/b'
      })
      expect(portal.url).toContain('test_portal_wrk_billing')
    }).pipe(
      Effect.provide(
        billingFixture({
          stripeConfigured: true,
          planId: 'team',
          subscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_old',
              subscriptionItemId: 'si_old',
              seatQuantity: 2
            }
          ],
          providerSubscriptions: [
            {
              workspaceId: 'wrk_billing',
              customerId: 'cus_seed',
              subscriptionId: 'sub_old',
              subscriptionItemId: 'si_old',
              seatQuantity: 2,
              planId: 'team',
              status: 'canceled'
            }
          ]
        }).layer
      )
    )
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
    expect(subscriptionLinkForStripeEvent('invoice.paid', {})).toEqual({
      kind: 'link',
      customerId: undefined,
      subscriptionId: undefined
    })
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
        expect(result.failure).toMatchObject({
          _tag: 'PlanLimitExceeded',
          limit: 2,
          planId: 'starter'
        })
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
  /* oxlint-disable effect/noAsyncFunction -- these tests exercise the real Web Crypto the verifier depends on; faking it would prove nothing */

  /**
   * The fixed clock injected as the verifier's `now`: no real-time
   * dependence, so the tolerance boundary is asserted exactly rather than
   * raced against wall time.
   */
  const nowSeconds = 1_700_000_000

  function fixedNow(): number {
    return nowSeconds * 1000
  }

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
    const header = await signedHeader('whsec_test', payload, nowSeconds)
    expect(
      await verifyStripeSignature({ secret: 'whsec_test', payload, header }, fixedNow)
    ).toBe(true)
    expect(
      await verifyStripeSignature({ secret: 'whsec_other', payload, header }, fixedNow)
    ).toBe(false)
    expect(
      await verifyStripeSignature(
        { secret: 'whsec_test', payload: '{"type":"tampered"}', header },
        fixedNow
      )
    ).toBe(false)
    expect(
      await verifyStripeSignature(
        { secret: 'whsec_test', payload, header: null },
        fixedNow
      )
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

  it('accepts a timestamp 300s old and rejects one 301s old', async () => {
    const payload = 'p'
    const atTolerance = await signedHeader('whsec_test', payload, nowSeconds - 300)
    expect(
      await verifyStripeSignature(
        { secret: 'whsec_test', payload, header: atTolerance },
        fixedNow
      )
    ).toBe(true)
    const pastTolerance = await signedHeader('whsec_test', payload, nowSeconds - 301)
    expect(
      await verifyStripeSignature(
        { secret: 'whsec_test', payload, header: pastTolerance },
        fixedNow
      )
    ).toBe(false)
  })
  /* oxlint-enable effect/noAsyncFunction */
})
