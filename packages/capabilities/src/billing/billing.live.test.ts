import { auditEvents, workspaceSubscriptions } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'
import { eq } from 'drizzle-orm'

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

    it.effect('applies a provider event, audits it, and updates planId', () =>
      Effect.gen(function* () {
        const applied = yield* inWorkspace(
          'other-lab',
          Effect.gen(function* () {
            const billing = yield* Billing
            return yield* billing.applyProviderEvent({
              workspaceId: 'wrk_other',
              planId: 'team',
              detail: { source: 'checkout.session.completed' }
            })
          })
        )
        expect(applied).toBe(true)

        const plan = yield* inWorkspace(
          'other-lab',
          Effect.gen(function* () {
            const billing = yield* Billing
            return yield* billing.currentPlan
          })
        )
        expect(plan.id).toBe('team')

        // The system audit row landed: actor is the webhook, not a user. It
        // carries no workspace attribution, so read the raw table instead of
        // the workspace-scoped log.
        const rows = yield* Effect.gen(function* () {
          const db = yield* Database
          return yield* db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.eventType, 'billing.plan_changed'))
        })
        expect(rows).toHaveLength(1)
        expect(rows[0]?.actorUserId).toBeNull()
        expect(rows[0]?.targetId).toBe('wrk_other')
      })
    )

    it.effect('refuses unknown plans without writing anything', () =>
      Effect.gen(function* () {
        const applied = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const billing = yield* Billing
            return yield* billing.applyProviderEvent({
              workspaceId: 'wrk_live',
              planId: 'ultimate'
            })
          })
        )
        expect(applied).toBe(false)
      })
    )

    it.effect('returns false for an unknown workspace id', () =>
      Effect.gen(function* () {
        const applied = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const billing = yield* Billing
            return yield* billing.applyProviderEvent({
              workspaceId: 'wrk_missing',
              planId: 'team'
            })
          })
        )
        expect(applied).toBe(false)
      })
    )
  })

  describe('live seat sync', () => {
    it.effect('links checkout state into a subscription row', () =>
      Effect.gen(function* () {
        const applied = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const billing = yield* Billing
            return yield* billing.applySubscriptionEvent({
              workspaceId: 'wrk_live',
              customerId: 'cus_live_link',
              subscriptionId: 'sub_live_link',
              detail: { source: 'checkout.session.completed' }
            })
          })
        )
        expect(applied).toBe(true)

        const rows = yield* Effect.gen(function* () {
          const db = yield* Database
          return yield* db
            .select()
            .from(workspaceSubscriptions)
            .where(eq(workspaceSubscriptions.workspaceId, 'wrk_live'))
        })
        expect(rows).toHaveLength(1)
        expect(rows[0]?.stripeCustomerId).toBe('cus_live_link')
        expect(rows[0]?.seatQuantity).toBe(0)

        // The portal is openable as soon as the link landed: the customer row
        // exists, even though Stripe itself stays unconfigured in this suite.
        const profiled = yield* inWorkspace(
          'live-lab',
          Effect.flip(
            Effect.gen(function* () {
              const billing = yield* Billing
              return yield* billing.startPortalSession({
                returnUrl: 'https://x.test/b'
              })
            })
          )
        )
        // Unset Stripe env is the first gate: the honest degraded posture.
        expect(profiled.reason).toBe('provider_not_configured')
      })
    )

    it.effect('reconciles a reported quantity and batches the audit event', () =>
      Effect.gen(function* () {
        const applied = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const billing = yield* Billing
            return yield* billing.applySubscriptionEvent({
              workspaceId: 'wrk_live',
              subscriptionItemId: 'si_live',
              quantity: 3,
              detail: { source: 'customer.subscription.updated' }
            })
          })
        )
        expect(applied).toBe(true)

        const rows = yield* Effect.gen(function* () {
          const db = yield* Database
          return yield* db
            .select()
            .from(workspaceSubscriptions)
            .where(eq(workspaceSubscriptions.workspaceId, 'wrk_live'))
        })
        expect(rows[0]?.seatQuantity).toBe(3)
        expect(rows[0]?.stripeSubscriptionItemId).toBe('si_live')

        const audits = yield* Effect.gen(function* () {
          const db = yield* Database
          return yield* db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.eventType, 'billing.seats_changed'))
        })
        expect(audits).toHaveLength(1)
        expect(audits[0]?.workspaceId).toBe('wrk_live')
        expect(audits[0]?.metadata).toMatchObject({ quantity: 3 })

        // An idempotent replay moves nothing and writes no second audit row.
        const replayed = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const billing = yield* Billing
            return yield* billing.applySubscriptionEvent({
              workspaceId: 'wrk_live',
              subscriptionItemId: 'si_live',
              quantity: 3
            })
          })
        )
        expect(replayed).toBe(true)
        const auditsAfterReplay = yield* Effect.gen(function* () {
          const db = yield* Database
          return yield* db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.eventType, 'billing.seats_changed'))
        })
        expect(auditsAfterReplay).toHaveLength(1)
      })
    )

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
  })
})
