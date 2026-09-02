import { auditEvents } from '@b2b-saas-starter/db/schema'
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
})
