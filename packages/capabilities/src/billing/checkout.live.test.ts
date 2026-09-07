import {
  billingCheckoutClaims,
  billingSynchronization,
  workspaceMembers,
  workspaceSubscriptions
} from '@b2b-saas-starter/db/schema'
import { Database, type BatchStatement } from '@b2b-saas-starter/db/service'
import { DateTime, Effect } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { eq } from 'drizzle-orm'
import { expect, layer } from '@effect/vitest'

import { CapabilityUnavailable } from '../errors.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { makeBillingLease } from './billing-lease.ts'
import { makeBillingSyncStore } from './billing-sync-store.ts'
import { Billing } from './billing.ts'
import { makeDurableCheckout } from './checkout.live.ts'
import { updateStripeSubscriptionItemQuantity } from './stripe.ts'

import {
  baseClaim,
  checkoutInput,
  durable,
  reset,
  secretKey,
  stripeFixture,
  withStripe,
  workspaceId
} from './checkout-test-fixtures.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('durable checkout', (it) => {
  it.effect(
    'serializes same-plan attempts and returns one hosted URL',
    () => {
      const fixture = stripeFixture()
      return withStripe(
        fixture,
        TestClock.withLive(
          Effect.gen(function* () {
            yield* reset
            const results = yield* durable((checkout) =>
              Effect.all([checkout(checkoutInput()), checkout(checkoutInput())], {
                concurrency: 'unbounded'
              })
            )
            expect(results.map((result) => result.url)).toEqual([
              'https://checkout.stripe.com/c/pay/checkout',
              'https://checkout.stripe.com/c/pay/checkout'
            ])
            expect(fixture.state.checkoutCreates).toBe(1)
            expect(fixture.state.customerCreates).toBe(1)
          })
        )
      )
    },
    20_000
  )

  it.effect('rejects a competing plan while the original claim is open', () => {
    const fixture = stripeFixture()
    return withStripe(
      fixture,
      Effect.gen(function* () {
        yield* reset
        yield* durable((checkout) => checkout(checkoutInput()))
        const error = yield* Effect.flip(
          durable((checkout) =>
            checkout(
              checkoutInput({ planId: 'enterprise', priceId: 'price_enterprise' })
            )
          )
        )
        expect(error).toMatchObject({ reason: 'checkout_in_progress' })
        expect(fixture.state.checkoutCreates).toBe(1)
      })
    )
  })

  it.effect(
    'retries provider success with the claim values after a finalization failure',
    () => {
      const fixture = stripeFixture()
      return withStripe(
        fixture,
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            yield* reset
            const db = yield* Database
            const audit = yield* AuditEventLog
            const leases = yield* makeBillingLease()
            const syncStore = yield* makeBillingSyncStore()
            let fencedCalls = 0
            const flakyLease = {
              ...leases,
              fencedBatch: (
                lease: Parameters<typeof leases.fencedBatch>[0],
                statements: ReadonlyArray<BatchStatement>
              ) => {
                fencedCalls += 1
                if (fencedCalls === 3) {
                  return Effect.fail(
                    new CapabilityUnavailable({
                      capability: 'billing',
                      reason: 'stripe_request_timed_out'
                    })
                  )
                }
                return leases.fencedBatch(lease, statements)
              }
            }
            const checkout = makeDurableCheckout({
              db,
              audit,
              lease: flakyLease,
              unavailable: orUnavailable('billing'),
              recordFailure: syncStore.fail
            })
            const first = checkoutInput({
              quantity: 2,
              successUrl: 'https://example.test/original-success',
              cancelUrl: 'https://example.test/original-cancel'
            })
            yield* Effect.flip(checkout(first))
            const second = yield* checkout(
              checkoutInput({
                quantity: 99,
                successUrl: 'https://attacker.example/success',
                cancelUrl: 'https://attacker.example/cancel'
              })
            )
            expect(second.url).toBe('https://checkout.stripe.com/c/pay/checkout')
            expect(fixture.state.checkoutCreates).toBe(2)
            const secondBody = new URLSearchParams(fixture.state.checkoutBodies[1])
            expect(secondBody.get('line_items[0][quantity]')).toBe('2')
            expect(secondBody.get('success_url')).toBe(
              'https://example.test/original-success'
            )
            expect(secondBody.get('cancel_url')).toBe(
              'https://example.test/original-cancel'
            )
            expect(fixture.state.checkoutIdempotencyKeys[1]).toBe(
              fixture.state.checkoutIdempotencyKeys[0]
            )
          }),
          { userId: 'usr_owner' }
        )
      )
    }
  )

  it.effect(
    'recovers a provider-created session by claim metadata without a duplicate POST',
    () => {
      const fixture = stripeFixture({ exposeCreatedSessionOnList: true })
      return withStripe(
        fixture,
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            yield* reset
            const db = yield* Database
            const audit = yield* AuditEventLog
            const leases = yield* makeBillingLease()
            const syncStore = yield* makeBillingSyncStore()
            let fencedCalls = 0
            const flakyLease = {
              ...leases,
              fencedBatch: (
                lease: Parameters<typeof leases.fencedBatch>[0],
                statements: ReadonlyArray<BatchStatement>
              ) => {
                fencedCalls += 1
                if (fencedCalls === 3) {
                  return Effect.fail(
                    new CapabilityUnavailable({
                      capability: 'billing',
                      reason: 'stripe_request_timed_out'
                    })
                  )
                }
                return leases.fencedBatch(lease, statements)
              }
            }
            const checkout = makeDurableCheckout({
              db,
              audit,
              lease: flakyLease,
              unavailable: orUnavailable('billing'),
              recordFailure: syncStore.fail
            })
            yield* Effect.flip(checkout(checkoutInput()))
            expect(fixture.state.checkoutCreates).toBe(1)
            expect(fixture.state.recoverySessions).toHaveLength(1)

            const retry = yield* checkout(
              checkoutInput({
                quantity: 99,
                successUrl: 'https://attacker.example/success',
                cancelUrl: 'https://attacker.example/cancel'
              })
            )
            expect(retry.url).toBe('https://checkout.stripe.com/c/pay/checkout')
            expect(fixture.state.checkoutCreates).toBe(1)
            expect(fixture.state.checkoutListReads).toBe(1)
            const claim = (yield* db
              .select()
              .from(billingCheckoutClaims)
              .where(eq(billingCheckoutClaims.workspaceId, workspaceId)))[0]
            expect(claim?.status).toBe('created')
            expect(claim?.stripeSessionId).toBe('cs_checkout')
            expect(claim?.quantity).toBe(1)
            expect(claim?.successUrl).toBe('https://example.test/success')
          }),
          { userId: 'usr_owner' }
        )
      )
    }
  )

  it.effect(
    'opens the portal for an existing subscription and a completed checkout',
    () => {
      const existingFixture = stripeFixture()
      const existing = withStripe(
        existingFixture,
        durable((checkout, db) =>
          Effect.gen(function* () {
            yield* reset
            yield* db.insert(workspaceSubscriptions).values({
              workspaceId,
              stripeCustomerId: 'cus_checkout',
              stripeSubscriptionId: 'sub_existing',
              stripeSubscriptionItemId: 'si_existing',
              seatQuantity: 1,
              updatedAt: '2026-09-07T00:00:00.000Z'
            })
            const result = yield* checkout(checkoutInput())
            expect(result.url).toContain('billing.stripe.com')
            expect(existingFixture.state.checkoutCreates).toBe(0)
            expect(existingFixture.state.portalCreates).toBe(1)
          })
        )
      )
      const completedFixture = stripeFixture({
        checkoutStatus: 'complete',
        checkoutSubscription: 'sub_completed',
        checkoutUrl: null,
        customerSubscriptions: [
          {
            id: 'sub_completed',
            customer: 'cus_checkout',
            status: 'active',
            itemId: 'si_completed',
            quantity: 1
          }
        ]
      })
      const completed = withStripe(
        completedFixture,
        durable((checkout, db) =>
          Effect.gen(function* () {
            yield* reset
            yield* db.insert(billingCheckoutClaims).values(baseClaim())
            const result = yield* checkout(checkoutInput())
            expect(result.url).toContain('billing.stripe.com')
            expect(completedFixture.state.checkoutCreates).toBe(0)
            expect(completedFixture.state.portalCreates).toBe(1)
            const claim = (yield* db
              .select()
              .from(billingCheckoutClaims)
              .where(eq(billingCheckoutClaims.id, 'claim_existing')))[0]
            expect(claim?.status).toBe('completed')
          })
        )
      )
      return Effect.gen(function* () {
        yield* existing
        yield* completed
      })
    }
  )

  it.effect(
    'keeps an expired uncertain session claim open without creating a duplicate',
    () => {
      const fixture = stripeFixture({
        checkoutStatus: 'open',
        checkoutExpiresAt: 1_700_000_000
      })
      return withStripe(
        fixture,
        durable((checkout, db) =>
          Effect.gen(function* () {
            yield* reset
            yield* db.insert(billingCheckoutClaims).values(baseClaim())
            const result = yield* checkout(checkoutInput())
            expect(result.url).toBe('https://checkout.stripe.com/c/pay/claim')
            expect(fixture.state.checkoutCreates).toBe(0)
            const rows = yield* db
              .select()
              .from(billingCheckoutClaims)
              .where(eq(billingCheckoutClaims.workspaceId, workspaceId))
            expect(rows).toHaveLength(1)
            expect(rows[0]?.status).toBe('created')
          })
        )
      )
    }
  )

  it.effect(
    'retires an expired session with no URL before creating the next claim',
    () => {
      const fixture = stripeFixture({
        checkoutStatus: 'expired',
        checkoutUrl: null
      })
      return withStripe(
        fixture,
        durable((checkout, db) =>
          Effect.gen(function* () {
            yield* reset
            yield* db.insert(billingCheckoutClaims).values(baseClaim())
            const result = yield* checkout(checkoutInput())
            expect(result.url).toBe('https://checkout.stripe.com/c/pay/checkout')
            expect(fixture.state.checkoutCreates).toBe(1)
            const claims = yield* db
              .select()
              .from(billingCheckoutClaims)
              .where(eq(billingCheckoutClaims.workspaceId, workspaceId))
            expect(claims).toHaveLength(2)
            expect(claims.find((claim) => claim.id === 'claim_existing')?.status).toBe(
              'expired'
            )
            expect(claims.filter((claim) => claim.status === 'created')).toHaveLength(1)
          })
        )
      )
    }
  )

  it.effect(
    'allows a new checkout after a completed claim and later subscription cancellation',
    () => {
      const fixture = stripeFixture({
        checkoutStatus: 'complete',
        checkoutSubscription: 'sub_existing',
        checkoutUrl: null
      })
      return withStripe(
        fixture,
        durable((checkout, db) =>
          Effect.gen(function* () {
            yield* reset
            yield* db.insert(workspaceSubscriptions).values({
              workspaceId,
              stripeCustomerId: 'cus_checkout',
              stripeSubscriptionId: 'sub_existing',
              stripeSubscriptionItemId: 'si_existing',
              seatQuantity: 1,
              updatedAt: '2026-09-07T00:00:00.000Z'
            })
            yield* db.insert(billingCheckoutClaims).values(baseClaim())

            const portal = yield* checkout(checkoutInput())
            expect(portal.url).toContain('billing.stripe.com')
            const completedClaim = (yield* db
              .select()
              .from(billingCheckoutClaims)
              .where(eq(billingCheckoutClaims.id, 'claim_existing')))[0]
            expect(completedClaim?.status).toBe('completed')

            fixture.state.checkoutStatus = 'open'
            fixture.state.subscriptionStatus = 'canceled'
            fixture.state.customerSubscriptions = []
            const next = yield* checkout(checkoutInput())
            expect(next.url).toBe('https://checkout.stripe.com/c/pay/checkout')
            expect(fixture.state.checkoutCreates).toBe(1)
            expect(fixture.state.portalCreates).toBe(1)
          })
        )
      )
    }
  )

  it.effect('rejects checkout when the provider customer metadata is missing', () => {
    const fixture = stripeFixture({ customerMetadata: null })
    return withStripe(
      fixture,
      durable((checkout) =>
        Effect.gen(function* () {
          yield* reset
          const error = yield* Effect.flip(checkout(checkoutInput()))
          expect(error).toMatchObject({ reason: 'customer_ownership_conflict' })
          expect(fixture.state.checkoutCreates).toBe(0)
          expect(fixture.state.portalCreates).toBe(0)
        })
      )
    )
  })

  it.effect(
    'rejects the public portal when customer ownership metadata mismatches',
    () => {
      const fixture = stripeFixture({ customerMetadata: { workspaceId: 'wrk_other' } })
      return withStripe(
        fixture,
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            yield* reset
            const db = yield* Database
            yield* db.insert(workspaceSubscriptions).values({
              workspaceId,
              stripeCustomerId: 'cus_checkout',
              stripeSubscriptionId: 'sub_existing',
              stripeSubscriptionItemId: 'si_existing',
              seatQuantity: 1,
              updatedAt: '2026-09-07T00:00:00.000Z'
            })
            const billing = yield* Billing
            const error = yield* Effect.flip(
              billing.startPortalSession({ returnUrl: 'https://example.test/billing' })
            )
            expect(error).toMatchObject({ reason: 'customer_ownership_conflict' })
            expect(fixture.state.portalCreates).toBe(0)
          }),
          { userId: 'usr_owner' },
          { billing: { secretKey, priceIds: { team: 'price_team' } } }
        )
      )
    }
  )

  it.effect(
    'rejects checkout and portal when Stripe reports multiple active subscriptions',
    () => {
      const fixture = stripeFixture({
        customerSubscriptions: [
          { id: 'sub_one', customer: 'cus_checkout', status: 'active' },
          { id: 'sub_two', customer: 'cus_checkout', status: 'trialing' }
        ]
      })
      return withStripe(
        fixture,
        Effect.gen(function* () {
          yield* durable((checkout, db) =>
            Effect.gen(function* () {
              yield* reset
              yield* db.insert(workspaceSubscriptions).values({
                workspaceId,
                stripeCustomerId: 'cus_checkout',
                stripeSubscriptionId: 'sub_existing',
                stripeSubscriptionItemId: 'si_existing',
                seatQuantity: 1,
                updatedAt: '2026-09-07T00:00:00.000Z'
              })
              const error = yield* Effect.flip(checkout(checkoutInput()))
              expect(error).toMatchObject({ reason: 'multiple_subscriptions' })
            })
          )
          expect(fixture.state.checkoutCreates).toBe(0)

          yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              yield* reset
              const db = yield* Database
              yield* db.insert(workspaceSubscriptions).values({
                workspaceId,
                stripeCustomerId: 'cus_checkout',
                stripeSubscriptionId: 'sub_existing',
                stripeSubscriptionItemId: 'si_existing',
                seatQuantity: 1,
                updatedAt: '2026-09-07T00:00:00.000Z'
              })
              const billing = yield* Billing
              const error = yield* Effect.flip(
                billing.startPortalSession({
                  returnUrl: 'https://example.test/billing'
                })
              )
              expect(error).toMatchObject({ reason: 'multiple_subscriptions' })
            }),
            { userId: 'usr_owner' },
            { billing: { secretKey, priceIds: { team: 'price_team' } } }
          )
          expect(fixture.state.portalCreates).toBe(0)
        })
      )
    }
  )

  it.effect(
    'keeps a known-customer handoff delayed and retries it after the fifteen-minute signal window',
    () => {
      const fixture = stripeFixture({ checkoutCreateFailure: true })
      return withStripe(
        fixture,
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            yield* reset
            const db = yield* Database
            const now = DateTime.formatIso(yield* DateTime.now)
            yield* db.insert(workspaceSubscriptions).values({
              workspaceId,
              stripeCustomerId: 'cus_checkout',
              stripeSubscriptionId: null,
              stripeSubscriptionItemId: null,
              seatQuantity: 0,
              updatedAt: now
            })
            yield* db.insert(billingSynchronization).values({
              workspaceId,
              status: 'pending',
              updatedAt: now
            })
            const billing = yield* Billing
            const firstFailure = yield* Effect.flip(
              billing.startCheckout({
                planId: 'team',
                successUrl: 'https://example.test/success',
                cancelUrl: 'https://example.test/cancel'
              })
            )
            expect(firstFailure.reason).toBe('stripe request failed')
            expect(fixture.state.checkoutCreates).toBe(0)

            const pending = (yield* db
              .select()
              .from(billingCheckoutClaims)
              .where(eq(billingCheckoutClaims.workspaceId, workspaceId)))[0]
            expect(pending?.stripeSessionId).toBeNull()
            expect(pending?.failureReason).toBe('stripe request failed')

            const delayed = yield* billing.reconcileWorkspace({ workspaceId })
            expect(delayed).toEqual({
              workspaceId,
              outcome: 'delayed',
              drift: ['checkout_pending']
            })
            const firstSync = (yield* db
              .select()
              .from(billingSynchronization)
              .where(eq(billingSynchronization.workspaceId, workspaceId)))[0]
            expect(firstSync?.status).toBe('delayed')
            expect(firstSync?.failureReason).toBe('checkout_pending')
            expect(firstSync?.unresolvedSince).toBeTruthy()
            const unresolvedSince = firstSync?.unresolvedSince

            yield* TestClock.adjust('15 minutes')
            const retried = yield* billing.reconcileBatch({ limit: 1 })
            expect(retried).toEqual([
              { workspaceId, outcome: 'delayed', drift: ['checkout_pending'] }
            ])
            const secondSync = (yield* db
              .select()
              .from(billingSynchronization)
              .where(eq(billingSynchronization.workspaceId, workspaceId)))[0]
            expect(secondSync?.failureCount).toBe(3)
            expect(secondSync?.unresolvedSince).toBe(unresolvedSince)
            expect(secondSync?.nextAttemptAt).toBeTruthy()
          }),
          { userId: 'usr_owner' },
          { billing: { secretKey, priceIds: { team: 'price_team' } } }
        )
      )
    }
  )

  it.effect(
    'lets seat synchronization converge while checkout uses its captured count',
    () => {
      const fixture = stripeFixture()
      return withStripe(
        fixture,
        durable((checkout, db) =>
          Effect.gen(function* () {
            yield* reset
            const members = yield* db
              .select()
              .from(workspaceMembers)
              .where(eq(workspaceMembers.workspaceId, workspaceId))
            yield* db.insert(workspaceMembers).values({
              id: 'mem_live_joiner_checkout',
              workspaceId,
              userId: 'usr_joiner',
              role: 'member'
            })
            yield* Effect.all(
              [
                checkout(checkoutInput({ quantity: members.length })),
                updateStripeSubscriptionItemQuantity({
                  secretKey,
                  subscriptionItemId: 'si_sync',
                  quantity: members.length + 1,
                  idempotencyKey: 'billing-seat-sync:wrk_live'
                })
              ],
              { concurrency: 'unbounded' }
            )
            expect(fixture.state.checkoutBodies).toHaveLength(1)
            expect(
              new URLSearchParams(fixture.state.checkoutBodies[0]).get(
                'line_items[0][quantity]'
              )
            ).toBe(String(members.length))
            expect(fixture.state.seatQuantities).toEqual([members.length + 1])
          })
        )
      )
    }
  )

  it.effect('wires checkout and seat reconciliation through Billing', () => {
    const fixture = stripeFixture()
    return withStripe(
      fixture,
      inWorkspace(
        'live-lab',
        Effect.gen(function* () {
          yield* reset
          const db = yield* Database
          const billing = yield* Billing
          const [checkout] = yield* Effect.all(
            [
              billing.startCheckout({
                planId: 'team',
                successUrl: 'https://example.test/success',
                cancelUrl: 'https://example.test/cancel'
              }),
              db.insert(workspaceMembers).values({
                id: 'mem_live_reconcile_joiner',
                workspaceId,
                userId: 'usr_joiner',
                role: 'member'
              })
            ],
            { concurrency: 'unbounded' }
          )
          expect(checkout.url).toContain('checkout.stripe.com')
          fixture.state.customerSubscriptions.push({
            id: 'sub_sync',
            customer: 'cus_checkout',
            status: 'active',
            itemId: 'si_sync',
            quantity: 1
          })
          const synced = yield* billing.syncSeats({
            workspaceId,
            reason: 'checkout_test'
          })
          expect(synced.outcome).toBe('synced')
          expect(synced.quantity).toBe(2)
          expect(fixture.state.seatQuantities).toEqual([2])
        }),
        { userId: 'usr_owner' },
        { billing: { secretKey, priceIds: { team: 'price_team' } } }
      )
    )
  })
})
