import { provisionTestD1 } from '@b2b-saas-starter/db/testing'
import { RawD1, type D1Binding } from '@b2b-saas-starter/db/service'
import { it } from '@effect/vitest'
import { DateTime, Effect, Layer, Schema } from 'effect'
import { describe, expect } from 'vite-plus/test'

import { LiveRetention } from './retention.live.ts'
import { Retention, type RetentionPolicy } from './retention.ts'
import { retentionPolicyDigest, RETENTION_DEFAULTS } from './retention-policy.ts'

const now = DateTime.makeUnsafe('2026-09-07T12:00:00.000Z')
const encodePreview = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))
const isoOld = '2026-01-01T00:00:00.000Z'
const isoNow = '2026-09-07T12:00:00.000Z'
const epochNow = DateTime.toEpochMillis(now) / 1000

function withDatabase<E>(test: (d1: D1Binding) => Effect.Effect<void, E, Retention>) {
  return Effect.gen(function* () {
    const database = yield* Effect.acquireRelease(
      Effect.promise(provisionTestD1),
      (db) => Effect.promise(() => db.dispose())
    )
    yield* Effect.promise(() =>
      database.d1
        .prepare(
          "INSERT INTO workspaces (id, name, slug) VALUES ('retention-one', 'One', 'retention-one'), ('retention-two', 'Two', 'retention-two')"
        )
        .run()
    )
    yield* test(database.d1).pipe(
      Effect.provide(
        LiveRetention.pipe(Layer.provide(Layer.succeed(RawD1, database.d1)))
      )
    )
  })
}

function insert(
  d1: D1Binding,
  table: string,
  row: Record<string, string | number | null>
) {
  const keys = Object.keys(row)
  return Effect.promise(() =>
    d1
      .prepare(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
      )
      .bind(...Object.values(row))
      .run()
  )
}

function ids(d1: D1Binding, table: string) {
  return Effect.map(
    Effect.promise(() =>
      d1.prepare(`SELECT id FROM ${table} ORDER BY id`).all<{ id: string }>()
    ),
    (result) => result.results.map((row) => row.id)
  )
}

function run(mode: 'preview' | 'execute', overrides: Partial<RetentionPolicy> = {}) {
  return Effect.gen(function* () {
    const retention = yield* Retention
    let configuration = {
      ...RETENTION_DEFAULTS,
      target: 'isolated-d1-test',
      destructiveEnabled: false,
      recoveryVerified: false,
      ...overrides
    }
    if (mode === 'execute') {
      const digest = retentionPolicyDigest(configuration)
      configuration = {
        ...configuration,
        destructiveEnabled: true,
        recoveryVerified: true,
        policyApprovalDigest: digest,
        previewDigest: digest,
        recoveryEvidenceRef: 'isolated-test-drill'
      }
    }
    return yield* retention.run({
      now: DateTime.toDateUtc(now),
      mode,
      policy: configuration
    })
  })
}

// Every case starts workerd and applies the real migrations before scanning D1.
describe('retention on D1', { timeout: 30_000 }, () => {
  it.effect(
    'previews and removes only expired personal artifacts with indexed session cleanup',
    () =>
      withDatabase((d1) =>
        Effect.gen(function* () {
          yield* insert(d1, 'user', {
            id: 'export-owner',
            name: 'Export Owner',
            email: 'export-owner@example.test',
            createdAt: epochNow,
            updatedAt: epochNow
          })
          yield* insert(d1, 'session', {
            id: 'export-session',
            userId: 'export-owner',
            token: 'test-session',
            expiresAt: epochNow + 172_800,
            createdAt: epochNow,
            updatedAt: epochNow
          })
          const artifact = {
            user_id: 'export-owner',
            session_id: 'export-session',
            archive: '{"private":"personal content"}',
            created_at: isoOld
          }
          yield* insert(d1, 'personal_data_exports', {
            ...artifact,
            id: 'expired-personal',
            expires_at: isoNow
          })
          yield* insert(d1, 'personal_data_exports', {
            ...artifact,
            id: 'active-personal',
            expires_at: '2026-09-07T12:00:00.001Z'
          })
          const preview = yield* run('preview')
          expect(preview.status).toBe('success')
          expect(preview.candidates.personal_data_exports).toBe(1)
          expect(yield* ids(d1, 'personal_data_exports')).toEqual([
            'active-personal',
            'expired-personal'
          ])
          const result = yield* run('execute')
          expect(result.status).toBe('success')
          expect(result.deleted.personal_data_exports).toBe(1)
          expect(yield* ids(d1, 'personal_data_exports')).toEqual(['active-personal'])
          expect(yield* encodePreview(result)).not.toContain('personal content')
          const plan = yield* Effect.promise(() =>
            d1
              .prepare(
                'EXPLAIN QUERY PLAN SELECT id FROM personal_data_exports WHERE session_id = ?'
              )
              .bind('export-session')
              .all<{ detail: string }>()
          )
          expect(
            plan.results.some((row) => /SEARCH.*USING.*INDEX/.test(row.detail))
          ).toBe(true)
        })
      )
  )

  it.effect(
    'audit expiry and completed billing metadata preserve unrelated and unfinished records',
    () =>
      withDatabase((d1) =>
        Effect.gen(function* () {
          const audit = {
            actor_type: 'system',
            event_type: 'test',
            target_type: 'workspace'
          }
          yield* insert(d1, 'audit_events', {
            ...audit,
            id: 'old-audit',
            workspace_id: 'retention-one',
            created_at: '2025-09-07T12:00:00.000Z'
          })
          yield* insert(d1, 'audit_events', {
            ...audit,
            id: 'recent-audit',
            workspace_id: 'retention-two',
            created_at: '2025-09-07T12:00:00.001Z'
          })
          const checkout = {
            workspace_id: 'retention-one',
            plan_id: 'team',
            price_id: 'price',
            quantity: 1,
            success_url: 'https://example.test/success',
            cancel_url: 'https://example.test/cancel',
            expires_at: isoOld,
            created_at: isoOld,
            updated_at: isoOld
          }
          yield* insert(d1, 'billing_checkout_claims', {
            ...checkout,
            id: 'completed-checkout',
            idempotency_key: 'completed-checkout',
            status: 'completed'
          })
          yield* insert(d1, 'billing_checkout_claims', {
            ...checkout,
            id: 'pending-checkout',
            idempotency_key: 'pending-checkout',
            status: 'pending'
          })
          const notice = {
            workspace_id: 'retention-one',
            notice_type: 'payment_failed',
            title: 'Private title',
            message: 'Private message',
            created_at: isoOld
          }
          yield* insert(d1, 'billing_notices', {
            ...notice,
            id: 'delivered-notice',
            delivered_at: isoOld
          })
          yield* insert(d1, 'billing_notices', { ...notice, id: 'pending-notice' })
          const result = yield* run('execute')
          expect(result.status).toBe('success')
          expect(yield* ids(d1, 'audit_events')).toEqual(['recent-audit'])
          expect(yield* ids(d1, 'billing_checkout_claims')).toEqual([
            'pending-checkout'
          ])
          expect(yield* ids(d1, 'billing_notices')).toEqual(['pending-notice'])
        })
      )
  )

  it.effect(
    'previews both read states without payloads; creation-expired notifications disappear at the cutoff',
    () =>
      withDatabase((d1) =>
        Effect.gen(function* () {
          const base = {
            workspace_id: 'retention-one',
            title: 'Private title',
            message: 'Sensitive contents',
            created_at: '2026-06-09T11:59:59.999Z'
          }
          yield* insert(d1, 'notifications', {
            ...base,
            id: 'notification-read',
            read_at: isoNow
          })
          yield* insert(d1, 'notifications', { ...base, id: 'notification-unread' })
          yield* insert(d1, 'notifications', {
            ...base,
            id: 'notification-boundary',
            created_at: '2026-06-09T12:00:00.000Z'
          })
          yield* insert(d1, 'notifications', {
            ...base,
            id: 'notification-fresh',
            workspace_id: 'retention-two',
            created_at: isoNow
          })
          const preview = yield* run('preview')
          expect(preview.status).toBe('success')
          expect(preview.candidates.notifications).toBe(3)
          expect(preview.deleted.notifications).toBe(0)
          const encoded = yield* encodePreview(preview)
          expect(encoded).not.toMatch(
            /Private title|Sensitive contents|notification-read/
          )
          expect(yield* ids(d1, 'notifications')).toHaveLength(4)
          const progress = yield* Effect.promise(() =>
            d1.prepare('SELECT record_class FROM retention_progress').all()
          )
          expect(progress.results).toEqual([])
          const executed = yield* run('execute')
          expect(executed.status).toBe('success')
          expect(executed.deleted.notifications).toBe(3)
          expect(yield* ids(d1, 'notifications')).toEqual(['notification-fresh'])
        })
      )
  )

  it.effect(
    'invitation terminal clocks and epoch credential expiry protect recently closed or active records',
    () =>
      withDatabase((d1) =>
        Effect.gen(function* () {
          yield* insert(d1, 'user', {
            id: 'retention-user',
            email: 'retention@example.test',
            name: 'Test User'
          })
          const invitation = {
            workspaceId: 'retention-one',
            email: 'invite@example.test',
            inviterId: 'retention-user',
            createdAt: 1,
            expiresAt: 1
          }
          yield* insert(d1, 'workspace_invitations', {
            ...invitation,
            id: 'expired-pending',
            status: 'pending'
          })
          yield* insert(d1, 'workspace_invitations', {
            ...invitation,
            id: 'old-terminal',
            status: 'accepted',
            terminalAt: 1
          })
          yield* insert(d1, 'workspace_invitations', {
            ...invitation,
            id: 'recent-terminal',
            status: 'canceled',
            terminalAt: epochNow
          })
          yield* insert(d1, 'workspace_invitations', {
            ...invitation,
            id: 'active',
            status: 'pending',
            expiresAt: epochNow + 3600
          })
          yield* insert(d1, 'session', {
            id: 'expired-session',
            token: 'expired-session',
            userId: 'retention-user',
            expiresAt: epochNow - 300
          })
          yield* insert(d1, 'session', {
            id: 'skew-session',
            token: 'skew-session',
            userId: 'retention-user',
            expiresAt: epochNow - 299
          })
          yield* insert(d1, 'verification', {
            id: 'expired-verification',
            identifier: 'expired',
            value: 'secret',
            expiresAt: epochNow - 300
          })
          yield* insert(d1, 'verification', {
            id: 'valid-verification',
            identifier: 'valid',
            value: 'secret',
            expiresAt: epochNow + 1
          })
          expect((yield* run('execute')).status).toBe('success')
          expect(yield* ids(d1, 'workspace_invitations')).toEqual([
            'active',
            'recent-terminal'
          ])
          expect(yield* ids(d1, 'session')).toEqual(['skew-session'])
          expect(yield* ids(d1, 'verification')).toEqual(['valid-verification'])
        })
      )
  )

  it.effect(
    'a protected old delivery cannot block later terminal history or another record class',
    () =>
      withDatabase((d1) =>
        Effect.gen(function* () {
          yield* insert(d1, 'webhook_endpoints', {
            id: 'endpoint',
            workspace_id: 'retention-one',
            url: 'https://example.test/hook',
            signing_secret: 'current-secret',
            created_at: isoOld,
            events: '[]'
          })
          const delivery = {
            endpoint_id: 'endpoint',
            event_type: 'test',
            last_attempt_at: isoOld,
            payload: '{}'
          }
          yield* insert(d1, 'webhook_deliveries', {
            ...delivery,
            id: 'a-pending',
            status: 'pending'
          })
          yield* insert(d1, 'webhook_deliveries', {
            ...delivery,
            id: 'b-terminal',
            status: 'delivered'
          })
          yield* insert(d1, 'webhook_delivery_attempts', {
            id: 'attempt',
            delivery_id: 'b-terminal',
            attempts: 1,
            phase: 'http',
            status: 'delivered',
            attempted_at: isoOld
          })
          yield* insert(d1, 'notifications', {
            id: 'other-class',
            workspace_id: 'retention-two',
            title: 'Title',
            message: 'Message',
            created_at: isoOld
          })
          const first = yield* run('execute', { batchSize: 1, workBudget: 18 })
          expect(
            first.records.reduce((total, row) => total + row.scanned, 0)
          ).toBeLessThanOrEqual(18)
          expect(first.deleted.webhooks).toBe(0)
          expect(first.deleted.notifications).toBe(1)
          expect(first.recovery.webhooks).toBe(1)
          const resumed = yield* run('execute', { batchSize: 1, workBudget: 18 })
          expect(resumed.deleted.webhooks).toBe(1)
          expect(yield* ids(d1, 'webhook_deliveries')).toEqual(['a-pending'])
          expect(yield* ids(d1, 'webhook_delivery_attempts')).toEqual([])
          expect(
            (yield* run('execute', { batchSize: 1, workBudget: 18 })).deleted.webhooks
          ).toBe(0)
        })
      )
  )

  it.effect(
    'failed atomic cleanup retains its rows and last success, then resumes safely',
    () =>
      withDatabase((d1) =>
        Effect.gen(function* () {
          const zero = yield* run('execute')
          expect(zero.status).toBe('success')
          expect(zero.failed).toBe(0)
          yield* insert(d1, 'notifications', {
            id: 'retry-after-failure',
            workspace_id: 'retention-one',
            title: 'Title',
            message: 'Message',
            created_at: isoOld
          })
          yield* Effect.promise(() =>
            d1
              .prepare(
                "CREATE TRIGGER fail_retention BEFORE DELETE ON notifications BEGIN SELECT RAISE(ABORT, 'synthetic interruption'); END"
              )
              .run()
          )
          const failed = yield* run('execute')
          expect(failed.status).toBe('failed')
          expect(failed.failed).toBe(1)
          expect(
            failed.records.find((row) => row.recordClass === 'notifications')
          ).toMatchObject({ failure: 'database_unavailable', lastSuccessAt: isoNow })
          expect(yield* ids(d1, 'notifications')).toEqual(['retry-after-failure'])
          yield* Effect.promise(() => d1.prepare('DROP TRIGGER fail_retention').run())
          expect((yield* run('execute')).deleted.notifications).toBe(1)
          expect((yield* run('execute')).deleted.notifications).toBe(0)
        })
      )
  )

  it.effect(
    'billing failures await resolution while email failures obey the 90-day cap',
    () =>
      withDatabase((d1) =>
        Effect.gen(function* () {
          const billing = {
            event_type: 'test',
            received_at: isoOld,
            updated_at: isoOld,
            completed_at: isoOld
          }
          yield* insert(d1, 'billing_provider_events', {
            ...billing,
            id: 'completed',
            provider_event_id: 'completed',
            status: 'completed'
          })
          yield* insert(d1, 'billing_provider_events', {
            ...billing,
            id: 'unresolved',
            provider_event_id: 'unresolved',
            status: 'failed'
          })
          yield* insert(d1, 'billing_provider_events', {
            ...billing,
            id: 'recently-resolved',
            provider_event_id: 'recently-resolved',
            status: 'completed',
            resolved_at: isoNow
          })
          const email = {
            purpose: 'notification',
            recipient: 'private@example.test',
            created_at: isoOld,
            updated_at: isoOld,
            retry_until: isoOld,
            next_attempt_at: isoOld,
            attempt_count: 1,
            uncertain: 0,
            revision: 0
          }
          yield* insert(d1, 'email_deliveries', {
            ...email,
            id: 'ordinary',
            status: 'delivered',
            created_at: '2026-08-08T12:00:00.000Z'
          })
          yield* insert(d1, 'email_deliveries', {
            ...email,
            id: 'old-failure',
            status: 'failed',
            created_at: '2026-06-09T12:00:00.000Z'
          })
          yield* insert(d1, 'email_deliveries', {
            ...email,
            id: 'recent-failure',
            status: 'failed',
            created_at: '2026-06-09T12:00:00.001Z'
          })
          const result = yield* run('execute')
          expect(result.status).toBe('success')
          expect(yield* ids(d1, 'billing_provider_events')).toEqual([
            'recently-resolved',
            'unresolved'
          ])
          expect(yield* ids(d1, 'email_deliveries')).toEqual(['recent-failure'])
        })
      )
  )

  it.effect(
    'expired secrets clear without deleting active endpoints or unresolved exports',
    () =>
      withDatabase((d1) =>
        Effect.gen(function* () {
          yield* insert(d1, 'webhook_endpoints', {
            id: 'endpoint',
            workspace_id: 'retention-one',
            url: 'https://example.test/hook',
            signing_secret: 'current-secret',
            created_at: isoOld,
            previous_signing_secret: 'old-secret',
            previous_secret_expires_at: isoNow,
            events: '[]'
          })
          const job = {
            workspace_id: 'retention-one',
            download_secret: 'download-secret',
            created_at: isoOld
          }
          yield* insert(d1, 'workspace_exports', {
            ...job,
            id: 'pending',
            status: 'pending'
          })
          yield* insert(d1, 'workspace_exports', {
            ...job,
            id: 'old-failed',
            status: 'failed',
            completed_at: '2026-08-08T12:00:00.000Z'
          })
          yield* insert(d1, 'workspace_exports', {
            ...job,
            id: 'recent-failed',
            status: 'failed',
            completed_at: isoNow
          })
          yield* insert(d1, 'workspace_exports', {
            ...job,
            id: 'ready-expired',
            status: 'ready',
            completed_at: '2026-08-31T12:00:00.000Z',
            expires_at: isoNow
          })
          const preview = yield* run('preview')
          expect(preview.recovery.exports).toBe(1)
          const result = yield* run('execute')
          expect(result.deleted.exports).toBe(1)
          expect(result.deleted.export_secrets).toBe(2)
          expect(result.deleted.webhook_secrets).toBe(1)
          expect(yield* ids(d1, 'workspace_exports')).toEqual([
            'pending',
            'ready-expired',
            'recent-failed'
          ])
          const endpoints = yield* Effect.promise(() =>
            d1
              .prepare(
                'SELECT signing_secret, previous_signing_secret FROM webhook_endpoints'
              )
              .all()
          )
          expect(endpoints.results).toEqual([
            {
              signing_secret: 'current-secret',
              previous_signing_secret: null
            }
          ])
          const jobs = yield* Effect.promise(() =>
            d1
              .prepare('SELECT id, download_secret FROM workspace_exports ORDER BY id')
              .all()
          )
          expect(jobs.results).toEqual([
            { id: 'pending', download_secret: 'download-secret' },
            { id: 'ready-expired', download_secret: '' },
            { id: 'recent-failed', download_secret: '' }
          ])
        })
      )
  )

  it.effect('token replacement and OAuth replay evidence survive generic expiry', () =>
    withDatabase((d1) =>
      Effect.gen(function* () {
        yield* insert(d1, 'user', {
          id: 'retention-user',
          email: 'retention@example.test',
          name: 'Test User'
        })
        const token = {
          workspace_id: 'retention-one',
          name: 'Token',
          token_prefix: 'prefix',
          created_at: isoOld,
          scopes: '[]'
        }
        yield* insert(d1, 'api_tokens', {
          ...token,
          id: 'active-ancestor',
          token_hash: 'active-ancestor',
          replaced_by_token_id: 'expired-descendant'
        })
        yield* insert(d1, 'api_tokens', {
          ...token,
          id: 'expired-descendant',
          token_hash: 'expired-descendant',
          expires_at: isoOld
        })
        yield* insert(d1, 'api_tokens', {
          ...token,
          id: 'old-unrelated',
          token_hash: 'old-unrelated',
          revoked_at: isoOld
        })
        yield* insert(d1, 'session', {
          id: 'family-session',
          token: 'family-session',
          userId: 'retention-user',
          expiresAt: 1
        })
        yield* insert(d1, 'oauth_client', {
          id: 'oauth-client',
          clientId: 'oauth-client',
          redirectUris: '[]'
        })
        yield* insert(d1, 'oauth_refresh_token', {
          id: 'rotation-evidence',
          token: 'refresh-token',
          clientId: 'oauth-client',
          sessionId: 'family-session',
          userId: 'retention-user',
          expiresAt: 1,
          rotatedAt: 1,
          scopes: '[]',
          rotationReplayResponse: 'required replay evidence'
        })
        yield* insert(d1, 'oauth_access_token', {
          id: 'expired-access',
          token: 'access-token',
          clientId: 'oauth-client',
          refreshId: 'rotation-evidence',
          expiresAt: 1,
          scopes: '[]'
        })
        yield* insert(d1, 'oauth_client_assertion', {
          id: 'expired-jti',
          expiresAt: 1
        })
        expect((yield* run('execute')).status).toBe('success')
        expect(yield* ids(d1, 'api_tokens')).toEqual([
          'active-ancestor',
          'expired-descendant'
        ])
        expect(yield* ids(d1, 'session')).toEqual(['family-session'])
        expect(yield* ids(d1, 'oauth_refresh_token')).toEqual(['rotation-evidence'])
        expect(yield* ids(d1, 'oauth_access_token')).toEqual([])
        expect(yield* ids(d1, 'oauth_client_assertion')).toEqual([])
      })
    )
  )
})
