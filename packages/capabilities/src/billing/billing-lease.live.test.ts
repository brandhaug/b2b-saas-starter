import { billingSynchronization, workspaces } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { expect, layer } from '@effect/vitest'
import { eq } from 'drizzle-orm'

import { LIVE_SUITE_TIMEOUT, TestDatabase } from '../testing/live-harness.ts'
import { makeBillingLease } from './billing-lease.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('billing lease fencing', (it) => {
  it.effect(
    'an earlier owner cannot commit after a new invocation takes the lease',
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        const leases = yield* makeBillingLease()
        const stale = yield* leases.withLease('wrk_live', Effect.succeed)
        yield* leases.withLease('wrk_live', (current) =>
          Effect.gen(function* () {
            expect(current.owner).not.toBe(stale.owner)
            expect(current.fence).toBeGreaterThan(stale.fence)
            yield* Effect.flip(
              leases.fencedBatch(stale, [
                db
                  .update(workspaces)
                  .set({ planId: 'enterprise' })
                  .where(eq(workspaces.id, 'wrk_live'))
              ])
            )
            const unchanged = yield* db
              .select()
              .from(workspaces)
              .where(eq(workspaces.id, 'wrk_live'))
            expect(unchanged[0]?.planId).toBe('starter')
            yield* leases.fencedBatch(current, [
              db
                .update(workspaces)
                .set({ planId: 'team' })
                .where(eq(workspaces.id, 'wrk_live'))
            ])
          })
        )
        const rows = yield* db
          .select()
          .from(billingSynchronization)
          .where(eq(billingSynchronization.workspaceId, 'wrk_live'))
        expect(rows[0]?.leaseOwner).toBeNull()
        expect(rows[0]?.leaseExpiresAt).toBeNull()
      })
  )

  it.effect(
    'an expired owner cannot commit even before a replacement claims the workspace',
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        const leases = yield* makeBillingLease()
        yield* leases.withLease('wrk_other', (lease) =>
          Effect.gen(function* () {
            yield* TestClock.adjust('3 minutes')
            yield* Effect.flip(
              leases.fencedBatch(lease, [
                db
                  .update(workspaces)
                  .set({ planId: 'enterprise' })
                  .where(eq(workspaces.id, 'wrk_other'))
              ])
            )
            const unchanged = yield* db
              .select()
              .from(workspaces)
              .where(eq(workspaces.id, 'wrk_other'))
            expect(unchanged[0]?.planId).toBe('starter')
          })
        )
      })
  )
})
