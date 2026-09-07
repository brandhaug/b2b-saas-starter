import { billingSynchronization, emailDeliveries } from '@b2b-saas-starter/db/schema'
import { Database, RawD1, databaseIsReady } from '@b2b-saas-starter/db/service'
import { DateTime, Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { expect, layer } from '@effect/vitest'
import { LIVE_SUITE_TIMEOUT, TestDatabase } from '../testing/live-harness.ts'
import { LiveOperationalHealth, OperationalHealth } from './operational-health.ts'

const now = Date.parse('2026-09-07T12:00:00.000Z')
const iso = DateTime.formatIso(DateTime.makeUnsafe(now))
const read = Effect.flatMap(OperationalHealth, (health) => health.read(now)).pipe(
  Effect.provide(LiveOperationalHealth)
)

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('operational health', (it) => {
  it.effect('readiness requires the deployed auth and workspace schema', () =>
    Effect.gen(function* () {
      expect(yield* databaseIsReady(undefined)).toBe(false)
      const database = yield* RawD1
      expect(yield* databaseIsReady(database)).toBe(true)
    })
  )

  it.effect(
    'alerts on persisted unresolved billing at fifteen minutes and clears after repair',
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(billingSynchronization).values({
          workspaceId: 'wrk_live',
          status: 'delayed',
          updatedAt: iso,
          unresolvedSince: DateTime.formatIso(DateTime.makeUnsafe(now - 899_999))
        })
        expect((yield* read).overdueBilling).toBe(0)
        yield* db
          .update(billingSynchronization)
          .set({
            unresolvedSince: DateTime.formatIso(DateTime.makeUnsafe(now - 900_000))
          })
          .where(eq(billingSynchronization.workspaceId, 'wrk_live'))
        expect((yield* read).overdueBilling).toBe(1)
        yield* db
          .update(billingSynchronization)
          .set({ status: 'current', unresolvedSince: null })
          .where(eq(billingSynchronization.workspaceId, 'wrk_live'))
        expect((yield* read).overdueBilling).toBe(0)
      })
  )

  it.effect(
    'excludes recipient bounces and counts recent unaccepted transport failures',
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        for (const [id, reason] of [
          ['bounce', 'hard_bounce'],
          ['transport', 'transport_unavailable']
        ]) {
          yield* db.insert(emailDeliveries).values({
            id: `ops_${id}`,
            purpose: 'notification',
            recipient: `${id}@example.test`,
            status: 'failed',
            reason,
            createdAt: iso,
            updatedAt: iso,
            retryUntil: iso,
            nextAttemptAt: iso,
            attemptCount: 1,
            uncertain: false,
            revision: 1
          })
        }
        expect((yield* read).recentEmailFailures).toBe(1)
        yield* db
          .update(emailDeliveries)
          .set({ acceptedAt: iso, status: 'accepted' })
          .where(eq(emailDeliveries.id, 'ops_transport'))
        expect((yield* read).recentEmailFailures).toBe(0)
      })
  )
})
