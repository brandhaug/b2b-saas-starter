import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  LiveOperationalMessagingJobs,
  OperationalMessagingJobs
} from './operational-messaging-jobs.ts'

const day = 24 * 60 * 60 * 1_000
const asIso = (value: number) => new Date(value).toISOString()
const now = Date.parse('2026-07-29T12:00:00.000Z')

describe('Operational Messaging reconciliation and retention jobs', () => {
  let test: TestD1

  beforeAll(async () => {
    test = await provisionTestD1()
    const createdAt = asIso(now - 200 * day)
    const unknownAt = asIso(now - 8 * day)
    for (const statement of [
      `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
       VALUES ('mer_jobs', 'Jobs Merchant', 'jobs', 'UTC', 'EUR', 'solo', '${createdAt}', '${createdAt}'),
              ('mer_other_jobs', 'Other Merchant', 'other-jobs', 'UTC', 'EUR', 'solo', '${createdAt}', '${createdAt}')`,
      `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
       VALUES ('brd_jobs', 'mer_jobs', 'Jobs', '${createdAt}', '${createdAt}'),
              ('brd_other_jobs', 'mer_other_jobs', 'Other', '${createdAt}', '${createdAt}')`,
      `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
       VALUES ('shp_jobs', 'brd_jobs', 'mer_jobs', 'jobs', 'Jobs', 'UTC', 'EUR', '${createdAt}', '${createdAt}'),
              ('shp_other_jobs', 'brd_other_jobs', 'mer_other_jobs', 'other-jobs', 'Other', 'UTC', 'EUR', '${createdAt}', '${createdAt}')`,
      `INSERT INTO messaging_balances (shop_id, currency, created_at, updated_at)
       VALUES ('shp_jobs', 'EUR', '${createdAt}', '${createdAt}'),
              ('shp_other_jobs', 'EUR', '${createdAt}', '${createdAt}')`,
      `INSERT INTO messaging_financial_external_facts
       (id, shop_id, kind, provider, source_id, status, amount_milli_euro, currency,
       reference, observed_at, created_at)
       VALUES ('mff_jobs', 'shp_jobs', 'provider_payment', 'stripe', 'pi_jobs',
        'confirmed', 10000, 'EUR', 'invoice:jobs', '${createdAt}', '${createdAt}'),
       ('mff_jobs_missing', 'shp_jobs', 'provider_refund', 'stripe', 'refund_jobs',
        'confirmed', 100, 'EUR', 'credit-note:jobs', '${createdAt}', '${createdAt}')`,
      `INSERT INTO messaging_balance_ledger_entries
       (id, shop_id, direction, kind, amount_milli_euro, currency, source_type,
        source_id, idempotency_key, fiscal_reference, external_fact_id, occurred_at,
        created_at)
       VALUES ('mle_jobs', 'shp_jobs', 'credit', 'top_up', 10000, 'EUR',
        'stripe_payment', 'pi_jobs', 'stripe:pi_jobs', 'invoice:jobs', 'mff_jobs',
        '${createdAt}', '${createdAt}')`,
      `INSERT INTO notification_intents
       (id, shop_id, topic, recipient_json, payload_json, source_type, source_id,
        source_version, deduplication_key, purpose, phase, status, available_at,
        created_at, updated_at)
       VALUES ('nti_jobs_unknown', 'shp_jobs', 'appointment.confirmation', '{}', '{}',
        'appointment', 'apt_jobs_unknown', 1, 'jobs:unknown', 'appointment_confirmation',
        'awaiting_provider', 'processing', '${unknownAt}', '${unknownAt}', '${unknownAt}'),
       ('nti_jobs_erasure', 'shp_jobs', 'appointment.reminder', '{}', '{}',
        'appointment', 'apt_jobs_erasure', 1, 'jobs:erasure', 'appointment_reminder',
        'terminal', 'failed', '${createdAt}', '${createdAt}', '${createdAt}'),
       ('nti_other_jobs', 'shp_other_jobs', 'appointment.reminder', '{}', '{}',
        'appointment', 'apt_other_jobs', 1, 'jobs:other', 'appointment_reminder',
        'terminal', 'failed', '${createdAt}', '${createdAt}', '${createdAt}')`,
      `UPDATE notification_intents
       SET result = 'delivery_failed', result_reason = 'provider_failure', terminal_at = '${createdAt}'
       WHERE id IN ('nti_jobs_erasure', 'nti_other_jobs')`,
      `INSERT INTO delivery_routes
       (id, shop_id, intent_id, ordinal, channel, provider, state, created_at, updated_at)
       VALUES ('drt_jobs_unknown', 'shp_jobs', 'nti_jobs_unknown', 0, 'whatsapp', 'meta',
        'submission_unknown', '${unknownAt}', '${unknownAt}')`,
      `INSERT INTO messaging_balance_reservations
       (id, shop_id, intent_id, rate_card_id, amount_milli_euro, status, expires_at,
        created_at, updated_at)
       VALUES ('mbr_jobs_unknown', 'shp_jobs', 'nti_jobs_unknown', 'mrcard_launch_v1', 45,
        'active', '${asIso(now + day)}', '${unknownAt}', '${unknownAt}')`,
      `INSERT INTO protected_messaging_destinations
       (id, shop_id, intent_id, ciphertext, key_version, fingerprint, masked_value,
        country_code, created_at)
       VALUES ('pmd_jobs_erasure', 'shp_jobs', 'nti_jobs_erasure', 'ciphertext-jobs', 1,
        'sha256:jobs', '+40•••••••111', 'RO', '${createdAt}'),
       ('pmd_other_jobs', 'shp_other_jobs', 'nti_other_jobs', 'ciphertext-other', 1,
        'sha256:other', '+40•••••••222', 'RO', '${createdAt}')`,
      `INSERT INTO delivery_routes
       (id, shop_id, intent_id, ordinal, channel, provider, state, delivered_at,
        created_at, updated_at)
       VALUES ('drt_jobs_erasure', 'shp_jobs', 'nti_jobs_erasure', 0, 'whatsapp',
        'meta', 'delivered', '${createdAt}', '${createdAt}', '${createdAt}')`,
      `INSERT INTO submission_attempts
       (id, shop_id, intent_id, route_id, ordinal, idempotency_key,
        request_fingerprint, state, started_at, completed_at, created_at)
       VALUES ('pat_jobs_erasure', 'shp_jobs', 'nti_jobs_erasure', 'drt_jobs_erasure',
        0, 'idem:jobs:erasure', 'sha256:request-jobs', 'accepted', '${createdAt}',
        '${createdAt}', '${createdAt}')`,
      `INSERT INTO protected_provider_references
       (id, shop_id, attempt_id, environment, provider, provider_account_key,
        reference_type, ciphertext, key_version, fingerprint, masked_suffix, created_at)
       VALUES ('ppr_jobs_erasure', 'shp_jobs', 'pat_jobs_erasure', 'test', 'meta',
        'meta_test', 'message_id', 'provider-reference-ciphertext', 1,
        'sha256:provider-reference-jobs', '123', '${createdAt}')`,
      `INSERT INTO notification_intent_controlled_facts
       (intent_id, shop_id, template_version_id, facts_json, facts_fingerprint,
        created_at, expires_at)
       VALUES ('nti_jobs_erasure', 'shp_jobs', 'mtv_ro_appointment_reminder_whatsapp_v1',
        '{"merchantLabel":"Jobs"}', 'sha256:facts-jobs', '${createdAt}', '${createdAt}')`
    ])
      await test.d1.prepare(statement).run()
  }, 60_000)

  afterAll(async () => test.dispose())

  const run = <A, E>(
    use: (jobs: OperationalMessagingJobs['Service']) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      Effect.flatMap(OperationalMessagingJobs, use).pipe(
        Effect.provide(
          LiveOperationalMessagingJobs.pipe(Layer.provide(layerFromD1(test.d1)))
        )
      )
    )

  it('alerts after 24 hours and closes seven-day ambiguity without charging', async () => {
    const result = await run((jobs) =>
      jobs.reconcile({ now: asIso(now), ownerId: 'worker_jobs', limit: 20 })
    )

    expect(result).toMatchObject({
      ambiguityAlertsOpened: 1,
      ambiguitiesClosed: 1,
      financialCasesOpened: 1,
      merchantsFinanciallyFrozen: 1
    })
    await expect(
      test.d1
        .prepare(
          `SELECT phase, result, result_reason FROM notification_intents
           WHERE id = 'nti_jobs_unknown'`
        )
        .first()
    ).resolves.toMatchObject({
      phase: 'terminal',
      result: 'delivery_failed',
      result_reason: 'delivery_unconfirmed'
    })
    await expect(
      test.d1
        .prepare(
          `SELECT status, release_reason FROM messaging_balance_reservations
           WHERE id = 'mbr_jobs_unknown'`
        )
        .first()
    ).resolves.toMatchObject({
      status: 'released',
      release_reason: 'ambiguity_timeout'
    })
    await expect(
      test.d1
        .prepare(
          `SELECT kind, status FROM messaging_reconciliation_cases
           WHERE source_identity = 'external-fact:mff_jobs_missing:missing_ledger'`
        )
        .first()
    ).resolves.toMatchObject({ kind: 'external_fact_without_ledger', status: 'open' })
  })

  it('leases retryable tombstones and crypto-erases only the requested Merchant scope', async () => {
    await test.d1
      .prepare(
        `INSERT INTO messaging_retention_holds
         (id, resource_type, resource_id, purpose, status, reason,
          placed_by_operator_id, placed_at, created_at, updated_at)
         VALUES ('mrh_jobs_destination', 'protected_messaging_destination',
          'pmd_jobs_erasure', 'privacy-complaint', 'active',
          'Preserve the exact destination while the complaint is investigated',
          'opr_jobs', ?, ?, ?)`
      )
      .bind(asIso(now), asIso(now), asIso(now))
      .run()
    await run((jobs) =>
      jobs.scheduleRetention({ now: asIso(now), shopId: 'shp_jobs', limit: 20 })
    )
    const first = await run((jobs) =>
      jobs.processRetention({ now: asIso(now), ownerId: 'worker_jobs', limit: 20 })
    )
    const retry = await run((jobs) =>
      jobs.processRetention({ now: asIso(now), ownerId: 'worker_jobs', limit: 20 })
    )

    expect(first.completed).toBe(2)
    expect(retry.completed).toBe(0)
    await expect(
      test.d1
        .prepare(
          `SELECT ciphertext FROM protected_messaging_destinations
           WHERE id = 'pmd_jobs_erasure'`
        )
        .first()
    ).resolves.toMatchObject({ ciphertext: 'ciphertext-jobs' })
    await expect(
      run((jobs) =>
        jobs.schedulePrivacyDeletion({ now: asIso(now), shopId: 'shp_jobs' })
      )
    ).resolves.toBe(0)
    await test.d1
      .prepare(
        `UPDATE messaging_retention_holds
         SET status = 'released', released_by_operator_id = 'opr_jobs',
             released_at = ?, updated_at = ? WHERE id = 'mrh_jobs_destination'`
      )
      .bind(asIso(now), asIso(now))
      .run()
    await expect(
      run((jobs) =>
        jobs.schedulePrivacyDeletion({ now: asIso(now), shopId: 'shp_jobs' })
      )
    ).resolves.toBe(1)
    await expect(
      run((jobs) =>
        jobs.processRetention({ now: asIso(now), ownerId: 'worker_jobs', limit: 20 })
      )
    ).resolves.toMatchObject({ completed: 1 })
    await expect(
      test.d1
        .prepare(
          `SELECT ciphertext, fingerprint, masked_value, erased_at
           FROM protected_messaging_destinations WHERE id = 'pmd_jobs_erasure'`
        )
        .first()
    ).resolves.toMatchObject({
      ciphertext: null,
      fingerprint: null,
      masked_value: null
    })
    await expect(
      test.d1
        .prepare(
          `SELECT ciphertext FROM protected_messaging_destinations
           WHERE id = 'pmd_other_jobs'`
        )
        .first()
    ).resolves.toMatchObject({ ciphertext: 'ciphertext-other' })
    await expect(
      test.d1
        .prepare(
          `SELECT ciphertext, masked_suffix, erased_at FROM protected_provider_references
           WHERE id = 'ppr_jobs_erasure'`
        )
        .first()
    ).resolves.toMatchObject({ ciphertext: null, masked_suffix: null })
    await expect(
      test.d1
        .prepare(
          `SELECT facts_json, facts_fingerprint, erased_at
           FROM notification_intent_controlled_facts WHERE intent_id = 'nti_jobs_erasure'`
        )
        .first()
    ).resolves.toMatchObject({ facts_json: '{}', facts_fingerprint: 'erased' })
  })

  it('records a failed tombstone and safely retries it after partial-job failure', async () => {
    await test.d1.batch([
      test.d1
        .prepare(
          `INSERT INTO messaging_incident_quarantine
           (id, source, ciphertext, key_version, body_fingerprint, received_at,
            expires_at, created_at)
           VALUES ('quarantine_injected', 'meta', 'encrypted-quarantine', 1,
            'sha256:quarantine', ?, ?, ?)`
        )
        .bind(asIso(now), asIso(now), asIso(now)),
      test.d1
        .prepare(
          `INSERT INTO messaging_retention_tombstones
         (id, shop_id, resource_type, resource_id, action, status, due_at,
          attempt_count, created_at, updated_at)
         VALUES ('mrt_jobs_quarantine', 'shp_jobs', 'incident_quarantine',
          'quarantine_injected', 'delete_quarantine', 'pending', ?, 0, ?, ?)`
        )
        .bind(asIso(now), asIso(now), asIso(now)),
      test.d1.prepare(
        `CREATE TRIGGER fail_quarantine_deletion
         BEFORE DELETE ON messaging_incident_quarantine
         BEGIN SELECT RAISE(FAIL, 'injected_retention_failure'); END`
      )
    ])

    const first = await run((jobs) =>
      jobs.processRetention({ now: asIso(now), ownerId: 'worker_jobs_a', limit: 20 })
    )
    await test.d1.prepare(`DROP TRIGGER fail_quarantine_deletion`).run()
    const retry = await run((jobs) =>
      jobs.processRetention({ now: asIso(now), ownerId: 'worker_jobs_b', limit: 20 })
    )

    expect(first.failed).toBe(1)
    expect(retry.completed).toBe(1)
    await expect(
      test.d1
        .prepare(
          `SELECT status, attempt_count, lease_owner, leased_until, last_failure_code
           FROM messaging_retention_tombstones WHERE id = 'mrt_jobs_quarantine'`
        )
        .first()
    ).resolves.toMatchObject({
      status: 'completed',
      attempt_count: 2,
      lease_owner: null,
      leased_until: null,
      last_failure_code: null
    })
    await expect(
      test.d1
        .prepare(
          `SELECT id FROM messaging_incident_quarantine WHERE id = 'quarantine_injected'`
        )
        .first()
    ).resolves.toBeNull()
  })
})
