import {
  billingCheckoutClaims,
  billingSynchronization,
  workspaceSubscriptions
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { DateTime, Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { expect, layer } from '@effect/vitest'

import { Billing } from '@b2b-saas-starter/billing/billing'
import {
  baseClaim,
  reset,
  stripeFixture,
  withStripe,
  workspaceId
} from './checkout-test-fixtures.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'

const bindings = {
  billing: { secretKey: 'sk_test_checkout', priceIds: { team: 'price_team' } }
}

const actor = { userId: 'usr_owner' }

function syncRow(updatedAt: string): typeof billingSynchronization.$inferInsert {
  return {
    workspaceId,
    status: 'pending',
    updatedAt
  }
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('checkout recovery', (it) => {
  it.effect(
    'uses an operator customer and session hint to recover a pending claim when lists are inconclusive',
    () => {
      const fixture = stripeFixture({ checkoutListHasMore: true })
      return withStripe(
        fixture,
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            yield* reset
            const db = yield* Database
            const now = DateTime.formatIso(yield* DateTime.now)
            yield* db.insert(billingSynchronization).values(syncRow(now))
            yield* db.insert(billingCheckoutClaims).values(
              baseClaim({
                id: 'claim_operator',
                idempotencyKey: 'billing-checkout:claim_operator',
                status: 'pending',
                stripeSessionId: null,
                checkoutUrl: null,
                createdAt: now,
                updatedAt: now
              })
            )
            fixture.state.recoverySessions.push({
              id: 'cs_operator',
              url: 'https://checkout.stripe.com/c/pay/operator',
              status: 'open',
              expires_at: 4_000_000_000,
              customer: 'cus_checkout',
              subscription: null,
              metadata: { workspaceId, claimId: 'claim_operator' }
            })

            const billing = yield* Billing
            const result = yield* billing.reconcileWorkspace({
              workspaceId,
              recovery: {
                customerId: 'cus_checkout',
                checkoutSessionId: 'cs_operator'
              }
            })
            expect(result).toEqual({
              workspaceId,
              outcome: 'delayed',
              drift: ['checkout_pending']
            })
            expect(fixture.state.checkoutCreates).toBe(0)
            expect(fixture.state.checkoutListReads).toBe(0)
            const claim = (yield* db
              .select()
              .from(billingCheckoutClaims)
              .where(eq(billingCheckoutClaims.id, 'claim_operator')))[0]
            expect(claim?.status).toBe('created')
            expect(claim?.stripeSessionId).toBe('cs_operator')
            expect(
              yield* db
                .select()
                .from(workspaceSubscriptions)
                .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
            ).toHaveLength(0)
          }),
          actor,
          bindings
        )
      )
    }
  )

  it.effect(
    'keeps a mismatched session metadata hint as durable conflict evidence',
    () => {
      const fixture = stripeFixture()
      return withStripe(
        fixture,
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            yield* reset
            const db = yield* Database
            const now = DateTime.formatIso(yield* DateTime.now)
            yield* db.insert(billingSynchronization).values(syncRow(now))
            yield* db.insert(billingCheckoutClaims).values(
              baseClaim({
                id: 'claim_operator',
                idempotencyKey: 'billing-checkout:claim_operator',
                status: 'pending',
                stripeSessionId: null,
                checkoutUrl: null,
                createdAt: now,
                updatedAt: now
              })
            )
            fixture.state.recoverySessions.push({
              id: 'cs_foreign_workspace',
              url: 'https://checkout.stripe.com/c/pay/foreign',
              status: 'complete',
              expires_at: 4_000_000_000,
              customer: 'cus_checkout',
              subscription: 'sub_foreign',
              metadata: { workspaceId: 'wrk_other', claimId: 'claim_operator' }
            })

            const billing = yield* Billing
            const result = yield* billing.reconcileWorkspace({
              workspaceId,
              recovery: {
                customerId: 'cus_checkout',
                checkoutSessionId: 'cs_foreign_workspace'
              }
            })
            expect(result).toEqual({
              workspaceId,
              outcome: 'conflict',
              drift: ['checkout_recovery_required']
            })
            expect(fixture.state.checkoutCreates).toBe(0)
            const claim = (yield* db
              .select()
              .from(billingCheckoutClaims)
              .where(eq(billingCheckoutClaims.id, 'claim_operator')))[0]
            expect(claim?.status).toBe('pending')
            expect(
              (yield* db
                .select()
                .from(billingSynchronization)
                .where(eq(billingSynchronization.workspaceId, workspaceId)))[0]
            ).toMatchObject({
              status: 'conflict',
              failureReason: 'checkout_recovery_required'
            })
          }),
          actor,
          bindings
        )
      )
    }
  )

  it.effect('keeps a foreign customer hint from linking or granting a claim', () => {
    const fixture = stripeFixture()
    return withStripe(
      fixture,
      inWorkspace(
        'live-lab',
        Effect.gen(function* () {
          yield* reset
          const db = yield* Database
          const now = DateTime.formatIso(yield* DateTime.now)
          yield* db.insert(billingSynchronization).values(syncRow(now))
          yield* db.insert(billingCheckoutClaims).values(
            baseClaim({
              id: 'claim_operator',
              idempotencyKey: 'billing-checkout:claim_operator',
              status: 'pending',
              stripeSessionId: null,
              checkoutUrl: null,
              createdAt: now,
              updatedAt: now
            })
          )
          fixture.state.recoverySessions.push({
            id: 'cs_foreign_customer',
            url: 'https://checkout.stripe.com/c/pay/foreign-customer',
            status: 'complete',
            expires_at: 4_000_000_000,
            customer: 'cus_other',
            subscription: 'sub_other',
            metadata: { workspaceId, claimId: 'claim_operator' }
          })

          const billing = yield* Billing
          const result = yield* billing.reconcileWorkspace({
            workspaceId,
            recovery: {
              customerId: 'cus_checkout',
              checkoutSessionId: 'cs_foreign_customer'
            }
          })
          expect(result).toEqual({
            workspaceId,
            outcome: 'conflict',
            drift: ['customer_ownership_conflict']
          })
          expect(fixture.state.checkoutCreates).toBe(0)
          const claim = (yield* db
            .select()
            .from(billingCheckoutClaims)
            .where(eq(billingCheckoutClaims.id, 'claim_operator')))[0]
          expect(claim?.status).toBe('pending')
          expect(
            (yield* db
              .select()
              .from(billingSynchronization)
              .where(eq(billingSynchronization.workspaceId, workspaceId)))[0]
          ).toMatchObject({
            status: 'conflict',
            failureReason: 'customer_ownership_conflict'
          })
        }),
        actor,
        bindings
      )
    )
  })

  it.effect(
    'uses the complete customer list when an old claim has no known customer',
    () => {
      const fixture = stripeFixture({
        customersSince: [{ id: 'cus_checkout', metadata: { workspaceId } }]
      })
      return withStripe(
        fixture,
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            yield* reset
            const db = yield* Database
            const now = yield* DateTime.now
            const old = DateTime.formatIso(DateTime.add(now, { hours: -24 }))
            yield* db
              .insert(billingSynchronization)
              .values(syncRow(DateTime.formatIso(now)))
            yield* db.insert(billingCheckoutClaims).values(
              baseClaim({
                id: 'claim_old',
                idempotencyKey: 'billing-checkout:claim_old',
                status: 'pending',
                stripeSessionId: null,
                checkoutUrl: null,
                createdAt: old,
                updatedAt: old
              })
            )
            fixture.state.recoverySessions.push({
              id: 'cs_old',
              url: 'https://checkout.stripe.com/c/pay/old',
              status: 'open',
              expires_at: 4_000_000_000,
              customer: 'cus_checkout',
              subscription: null,
              metadata: { workspaceId, claimId: 'claim_old' }
            })

            const billing = yield* Billing
            const result = yield* billing.reconcileWorkspace({ workspaceId })
            expect(result).toEqual({
              workspaceId,
              outcome: 'delayed',
              drift: ['checkout_pending']
            })
            expect(fixture.state.customerListReads).toBe(1)
            expect(fixture.state.checkoutListReads).toBe(1)
            expect(fixture.state.checkoutCreates).toBe(0)
            const claim = (yield* db
              .select()
              .from(billingCheckoutClaims)
              .where(eq(billingCheckoutClaims.id, 'claim_old')))[0]
            expect(claim?.status).toBe('created')
            expect(claim?.stripeSessionId).toBe('cs_old')
          }),
          actor,
          bindings
        )
      )
    }
  )
})
