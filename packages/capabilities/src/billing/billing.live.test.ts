import { workspaceSubscriptions } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { Billing } from './billing.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('live billing', (it) => {
  describe('live billing', () => {
    it.effect('resolves the workspace plan from the catalog', () =>
      Effect.gen(function* () {
        const plan = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const billing = yield* Billing
            return yield* billing.currentPlan
          })
        )
        // The fixture rows carry no explicit `planId`, so the catalog's
        // fallback applies.
        expect(plan.id).toBe('starter')
      })
    )

    it.effect('startCheckout fails provider_not_configured with unset env', () =>
      Effect.gen(function* () {
        const error = yield* inWorkspace(
          'live-lab',
          Effect.flip(
            Effect.gen(function* () {
              const billing = yield* Billing
              return yield* billing.startCheckout({
                planId: 'team',
                successUrl: 'https://x.test/s',
                cancelUrl: 'https://x.test/c'
              })
            })
          )
        )
        expect(error.reason).toBe('provider_not_configured')
      })
    )
  })
  describe('live seat sync', () => {
    it.effect('skips seat sync for a workspace with no subscription row', () =>
      Effect.gen(function* () {
        const result = yield* inWorkspace(
          'other-lab',
          Effect.gen(function* () {
            const billing = yield* Billing
            return yield* billing.syncSeats({
              workspaceId: 'wrk_other',
              reason: 'member_added'
            })
          })
        )
        expect(result).toEqual({ outcome: 'no_subscription', quantity: null })
      })
    )

    it.effect('answers provider_not_configured when Stripe is unset', () =>
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(workspaceSubscriptions).values({
          workspaceId: 'wrk_live',
          stripeCustomerId: 'cus_unset_config',
          stripeSubscriptionId: 'sub_unset_config',
          stripeSubscriptionItemId: 'si_unset_config',
          seatQuantity: 0,
          updatedAt: '2026-07-03T09:00:00.000Z'
        })
        const result = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const billing = yield* Billing
            return yield* billing.syncSeats({
              workspaceId: 'wrk_live',
              reason: 'member_added'
            })
          })
        )
        expect(result).toEqual({ outcome: 'provider_not_configured', quantity: null })
      })
    )

    it.effect('treats a partial Stripe config as provider_not_configured', () =>
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(workspaceSubscriptions).values({
          workspaceId: 'wrk_other',
          stripeCustomerId: 'cus_partial_config',
          stripeSubscriptionId: 'sub_partial_config',
          stripeSubscriptionItemId: 'si_partial_config',
          seatQuantity: 1,
          updatedAt: '2026-07-03T09:00:00.000Z'
        })
        const result = yield* inWorkspace(
          'other-lab',
          Effect.gen(function* () {
            const billing = yield* Billing
            return yield* billing.syncSeats({
              workspaceId: 'wrk_other',
              reason: 'member_added'
            })
          }),
          undefined,
          { billing: { secretKey: 'sk_partial_config', priceIds: {} } }
        )
        expect(result).toEqual({ outcome: 'provider_not_configured', quantity: null })
      })
    )
  })
})
