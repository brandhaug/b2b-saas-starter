import { billingSynchronization } from '@b2b-saas-starter/db/schema'
import {
  batch,
  Database,
  RawD1,
  type BatchStatement
} from '@b2b-saas-starter/db/service'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { DateTime, Effect, Schedule } from 'effect'

import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { newCapabilityId } from './internal/ids.ts'

export type BillingLease = {
  readonly workspaceId: string
  readonly owner: string
  readonly fence: number
  readonly expiresAt: string
}

function billingFailure(reason: string) {
  return new CapabilityUnavailable({ capability: 'billing', reason })
}

/** Captures the database once; every invocation claims a distinct, durable owner. */
export const makeBillingLease = Effect.fn('Billing.makeLease')(function* () {
  const db = yield* Database
  const d1 = yield* RawD1
  function stored<A, E, R>(effect: Effect.Effect<A, E, R>) {
    return effect.pipe(
      Effect.mapError(() => billingFailure('billing_store_unavailable'))
    )
  }

  const acquire = Effect.fn('Billing.acquireLease')(function* (workspaceId: string) {
    const now = yield* DateTime.now
    const timestamp = DateTime.formatIso(now)
    const owner = yield* newCapabilityId('bill_lease')
    const expiresAt = DateTime.formatIso(DateTime.add(now, { minutes: 2 }))
    yield* stored(
      db
        .insert(billingSynchronization)
        .values({
          workspaceId,
          status: 'current',
          updatedAt: timestamp
        })
        .onConflictDoNothing()
    )
    yield* stored(
      db
        .update(billingSynchronization)
        .set({
          leaseOwner: owner,
          leaseFence: sql`${billingSynchronization.leaseFence} + 1`,
          leaseExpiresAt: expiresAt
        })
        .where(
          and(
            eq(billingSynchronization.workspaceId, workspaceId),
            or(
              isNull(billingSynchronization.leaseExpiresAt),
              lte(billingSynchronization.leaseExpiresAt, timestamp)
            )
          )
        )
    )
    const rows = yield* stored(
      db
        .select({ fence: billingSynchronization.leaseFence })
        .from(billingSynchronization)
        .where(
          and(
            eq(billingSynchronization.workspaceId, workspaceId),
            eq(billingSynchronization.leaseOwner, owner)
          )
        )
        .limit(1)
    )
    const row = rows[0]
    if (row === undefined) {
      return yield* Effect.fail(billingFailure('workspace_billing_busy'))
    }
    return { workspaceId, owner, fence: row.fence, expiresAt } satisfies BillingLease
  })

  const release = Effect.fn('Billing.releaseLease')(function* (lease: BillingLease) {
    yield* stored(
      db
        .update(billingSynchronization)
        .set({ leaseOwner: null, leaseExpiresAt: null })
        .where(
          and(
            eq(billingSynchronization.workspaceId, lease.workspaceId),
            eq(billingSynchronization.leaseOwner, lease.owner),
            eq(billingSynchronization.leaseFence, lease.fence)
          )
        )
    )
  })

  const fencedBatch = Effect.fn('Billing.fencedBatch')(function* (
    lease: BillingLease,
    statements: ReadonlyArray<BatchStatement>
  ) {
    const now = DateTime.formatIso(yield* DateTime.now)
    // The scalar subquery yields NULL for a stale lease. lease_fence is NOT NULL,
    // so D1 rolls back the entire batch, including unconditional audit inserts.
    // A WHERE-only guard would silently skip a write but still commit its audit.
    const guard: BatchStatement = {
      toSQL: () => ({
        sql: `INSERT INTO billing_synchronization (workspace_id, lease_fence, updated_at)
          VALUES (?, (SELECT lease_fence FROM billing_synchronization
            WHERE workspace_id = ? AND lease_owner = ? AND lease_fence = ?
              AND lease_expires_at > ?), ?)
          ON CONFLICT(workspace_id) DO UPDATE SET lease_fence = excluded.lease_fence`,
        params: [
          lease.workspaceId,
          lease.workspaceId,
          lease.owner,
          lease.fence,
          now,
          now
        ]
      })
    }
    yield* stored(batch([guard, ...statements]).pipe(Effect.provideService(RawD1, d1)))
  })

  function withLease<A, E, R>(
    workspaceId: string,
    use: (lease: BillingLease) => Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | CapabilityUnavailable, R> {
    return Effect.acquireUseRelease(
      acquire(workspaceId).pipe(
        Effect.retry({
          while: (error) => error.reason === 'workspace_billing_busy',
          schedule: Schedule.exponential('50 millis').pipe(Schedule.upTo({ times: 7 }))
        })
      ),
      use,
      (lease) =>
        release(lease).pipe(
          Effect.catchTag('CapabilityUnavailable', () =>
            Effect.logError(
              'Billing lease release failed; expiry permits recovery'
            ).pipe(
              Effect.annotateLogs({ workspaceId, outcome: 'lease_release_failed' })
            )
          )
        )
    )
  }

  return { withLease, fencedBatch }
})
