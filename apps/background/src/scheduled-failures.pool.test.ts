import {
  RETENTION_DEFAULTS,
  retentionPolicyDigest
} from '@b2b-saas-starter/capabilities/governance/retention-policy'
import {
  billingReconciliationCron,
  retentionCleanupCron
} from '@b2b-saas-starter/infra'
import { createScheduledController } from 'cloudflare:test'
import { Effect } from 'effect'
import { beforeAll, beforeEach, expect, it } from 'vite-plus/test'

import worker from './index.ts'
import { type Env } from './queue-consumer.ts'
import { applyPoolMigrations, db, row, rows } from './test-pool.ts'

const scheduledTime = Date.parse('2026-10-09T12:00:00Z')
const target = 'pool-retention'
const digest = retentionPolicyDigest({
  ...RETENTION_DEFAULTS,
  target,
  destructiveEnabled: true,
  recoveryVerified: true
})

function tick(cron: string, overrides: Env = {}) {
  return worker.scheduled(createScheduledController({ cron, scheduledTime }), {
    DB: db(),
    ...overrides
  })
}

const approvedRetention: Env = {
  RETENTION_DATABASE_TARGET: target,
  RETENTION_POLICY_TARGET: target,
  RETENTION_CLEANUP_ENABLED: 'true',
  RETENTION_RECOVERY_VERIFIED: 'true',
  RETENTION_POLICY_APPROVAL_DIGEST: digest,
  RETENTION_PREVIEW_DIGEST: digest,
  RETENTION_RECOVERY_EVIDENCE: 'pool-recovery-verification'
}

// oxlint-disable-next-line effect/noTestLifecycleHooks -- real worker D1 schema
beforeAll(() => applyPoolMigrations())
// oxlint-disable-next-line effect/noTestLifecycleHooks -- isolated scheduled fixtures
beforeEach(() =>
  db().batch([
    db().prepare('delete from assistant_reservations'),
    db().prepare('delete from assistant_conversations'),
    db().prepare('delete from notifications'),
    db().prepare('delete from audit_events'),
    db().prepare('delete from retention_progress'),
    db().prepare('delete from workspaces'),
    db().prepare('delete from user'),
    db().prepare(
      "insert into workspaces (id, name, slug) values ('ws_scheduled', 'Scheduled', 'scheduled')"
    ),
    db().prepare(
      "insert into user (id, name, email) values ('usr_scheduled', 'Scheduled', 'scheduled@example.test')"
    ),
    db().prepare(
      "insert into notifications (id, workspace_id, title, message, created_at) values ('old_notice', 'ws_scheduled', 'Old', 'Old', '2020-01-01T00:00:00.000Z')"
    )
  ])
)

function seedExpiredReservation() {
  return db()
    .prepare(`insert into assistant_reservations
    (id, conversation_id, workspace_id, user_id, created_at, deadline)
    values ('expired', 'conversation', 'ws_scheduled', 'usr_scheduled', 0, 1)`)
    .run()
}

it('keeps preview read-only and rejects stale destructive approval at the cron boundary', () =>
  // oxlint-disable-next-line starter/no-run-promise-in-tests -- scheduled worker/D1 promise boundary
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        tick(retentionCleanupCron, { RETENTION_DATABASE_TARGET: target })
      )
      expect(yield* Effect.promise(() => rows('select id from notifications'))).toEqual(
        [{ id: 'old_notice' }]
      )
      expect(
        yield* Effect.promise(() => rows('select * from retention_progress'))
      ).toEqual([])
      yield* Effect.promise(() =>
        expect(
          tick(retentionCleanupCron, {
            ...approvedRetention,
            RETENTION_POLICY_APPROVAL_DIGEST: 'stale'
          })
        ).rejects.toMatchObject({ reason: 'retention_approval_missing_or_stale' })
      )
      expect(yield* Effect.promise(() => rows('select id from notifications'))).toEqual(
        [{ id: 'old_notice' }]
      )
      expect(
        yield* Effect.promise(() => rows('select * from retention_progress'))
      ).toEqual([])
    })
  ))

it('rejects a failed retention rule and completes cleanup on the next hourly invocation', () =>
  // oxlint-disable-next-line starter/no-run-promise-in-tests -- scheduled worker/D1 promise boundary
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        db()
          .prepare(
            "CREATE TRIGGER reject_retention BEFORE DELETE ON notifications BEGIN SELECT RAISE(ABORT, 'synthetic cleanup failure'); END"
          )
          .run()
      )
      yield* Effect.gen(function* () {
        yield* Effect.promise(() =>
          expect(tick(retentionCleanupCron, approvedRetention)).rejects.toMatchObject({
            reason: 'retention_rule_query_failed'
          })
        )
        expect(
          yield* Effect.promise(() => rows('select id from notifications'))
        ).toEqual([{ id: 'old_notice' }])
        expect(
          yield* Effect.promise(() =>
            row(
              "select failure, last_success_at from retention_progress where record_class = 'notifications'"
            )
          )
        ).toEqual({ failure: 'database_unavailable', last_success_at: null })
      }).pipe(
        Effect.ensuring(
          Effect.promise(() => db().prepare('DROP TRIGGER reject_retention').run())
        )
      )
      yield* Effect.promise(() => tick(retentionCleanupCron, approvedRetention))
      expect(yield* Effect.promise(() => rows('select id from notifications'))).toEqual(
        []
      )
      expect(
        yield* Effect.promise(() =>
          row(
            "select failure, last_success_at from retention_progress where record_class = 'notifications'"
          )
        )
      ).toEqual({ failure: null, last_success_at: '2026-10-09T12:00:00.000Z' })
    })
  ))

it('surfaces billing work-list failure while independent reservation cleanup completes', () =>
  // oxlint-disable-next-line starter/no-run-promise-in-tests -- scheduled worker/D1 promise boundary
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.promise(() => seedExpiredReservation())
      // Remove only the billing work-list table. Operational monitoring reads synchronization instead.
      yield* Effect.promise(() =>
        db()
          .prepare(
            'ALTER TABLE billing_provider_events RENAME TO unavailable_billing_events'
          )
          .run()
      )
      yield* Effect.gen(function* () {
        yield* Effect.promise(() =>
          expect(
            tick(billingReconciliationCron, {
              STRIPE_SECRET_KEY: 'sk_test_pool',
              STRIPE_PRICE_ID_TEAM: 'price_pool'
            })
          ).rejects.toMatchObject({ _tag: 'CapabilityUnavailable' })
        )
        expect(
          yield* Effect.promise(() =>
            row("select released_at from assistant_reservations where id = 'expired'")
          )
        ).toEqual({ released_at: expect.any(Number) })
        // No Stripe configuration means no work-list read, even while that table is unavailable.
        yield* Effect.promise(() => tick(billingReconciliationCron))
        expect(
          yield* Effect.promise(() =>
            rows(
              "select target_id from audit_events where event_type = 'assistant_attempt.released'"
            )
          )
        ).toEqual([{ target_id: 'expired' }])
      }).pipe(
        Effect.ensuring(
          Effect.promise(() =>
            db()
              .prepare(
                'ALTER TABLE unavailable_billing_events RENAME TO billing_provider_events'
              )
              .run()
          )
        )
      )
    })
  ))

it('retains failed conversation deletion while releasing expired reservations exactly once', () =>
  // oxlint-disable-next-line starter/no-run-promise-in-tests -- scheduled worker/D1 promise boundary
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.promise(() => seedExpiredReservation())
      yield* Effect.promise(() =>
        db()
          .prepare(`insert into assistant_conversations
      (id, workspace_id, creator_user_id, created_at, deleted_at)
      values ('conversation', 'ws_scheduled', 'usr_scheduled', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`)
          .run()
      )
      // No conversation host is bound. Pending explicit deletion must remain retryable.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        yield* Effect.promise(() =>
          expect(tick(billingReconciliationCron)).rejects.toMatchObject({
            reason: 'conversation_cleanup_incomplete'
          })
        )
        expect(
          yield* Effect.promise(() =>
            row(
              "select deleted_at, cleaned_at from assistant_conversations where id = 'conversation'"
            )
          )
        ).toEqual({ deleted_at: '2026-10-01T00:00:00.000Z', cleaned_at: null })
      }
      expect(
        yield* Effect.promise(() =>
          row("select released_at from assistant_reservations where id = 'expired'")
        )
      ).toEqual({ released_at: expect.any(Number) })
      expect(
        yield* Effect.promise(() =>
          rows(
            "select target_id from audit_events where event_type = 'assistant_attempt.released'"
          )
        )
      ).toEqual([{ target_id: 'expired' }])
    })
  ))
