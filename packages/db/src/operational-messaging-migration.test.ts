import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, provisionUnmigratedTestD1, type TestD1 } from './testing.ts'

const previousMigration = '20260727171000_whatsapp_console_capture'
const operationalMessagingMigration = '20260729120000_operational_messaging'
const now = '2026-07-29T12:00:00.000Z'
let test: TestD1

beforeAll(async () => {
  test = await provisionUnmigratedTestD1()
  await applyMigrations(test.d1, { through: previousMigration })

  await test.d1
    .prepare(
      `INSERT INTO merchants
       (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
       VALUES ('mer_message_migration', 'Migration', 'message-migration', 'UTC', 'EUR', 'solo', ?, ?)`
    )
    .bind(now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO providers
       (id, merchant_id, display_name, status, is_default, created_at, updated_at)
       VALUES ('prv_message_migration', 'mer_message_migration', 'Provider', 'active', 1, ?, ?)`
    )
    .bind(now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO appointments
       (id, merchant_id, provider_id, status, starts_at, ends_at, created_at, updated_at)
       VALUES ('apt_message_migration', 'mer_message_migration', 'prv_message_migration', 'scheduled', ?, ?, ?, ?)`
    )
    .bind('2026-07-30T10:00:00.000Z', '2026-07-30T11:00:00.000Z', now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO booking_outbox
       (id, appointment_id, kind, trace_id, email_status, webhook_status, whatsapp_status, created_at)
       VALUES ('out_message_migration', 'apt_message_migration', 'appointment.created', 'trace_migration', 'pending', 'pending', 'pending', ?)`
    )
    .bind(now)
    .run()

  await applyMigrations(test.d1, {
    after: previousMigration,
    through: operationalMessagingMigration
  })
}, 60_000)

afterAll(async () => test.dispose())

describe('operational messaging migration', () => {
  it('preserves existing Booking, email, webhook, and console-capture work', async () => {
    const outbox = await test.d1
      .prepare(
        `SELECT appointment_id, kind, trace_id, email_status, webhook_status, whatsapp_status
         FROM booking_outbox WHERE id = 'out_message_migration'`
      )
      .first()

    expect(outbox).toEqual({
      appointment_id: 'apt_message_migration',
      kind: 'appointment.created',
      trace_id: 'trace_migration',
      email_status: 'pending',
      webhook_status: 'pending',
      whatsapp_status: 'pending'
    })
  })

  it('installs the normalized lifecycle and safe projections', async () => {
    const objects = await test.d1
      .prepare(
        `SELECT name, type FROM sqlite_master
         WHERE name IN (
           'protected_messaging_destinations',
           'messaging_template_versions',
           'notification_intent_controlled_facts',
           'delivery_routes',
           'submission_attempts',
           'submission_outcomes',
           'protected_provider_references',
           'provider_evidence',
           'suppression_directives',
           'messaging_channel_controls',
           'merchant_messaging_controls',
           'notification_intent_leases',
           'messaging_rate_cards',
           'messaging_balances',
           'messaging_balance_reservations',
           'messaging_balance_ledger_entries',
           'chargeable_deliveries',
           'provider_messaging_costs',
           'messaging_reconciliation_cases',
           'messaging_incidents',
           'messaging_retention_tombstones',
           'merchant_notification_delivery_summaries',
           'merchant_messaging_balance_summaries',
           'operations_messaging_case_summaries',
           'operations_messaging_route_summaries',
           'operations_messaging_charge_summaries',
           'operations_messaging_provider_cost_summaries',
           'operations_messaging_incident_summaries',
           'operations_messaging_channel_control_summaries'
         )
         ORDER BY name`
      )
      .all<{ name: string; type: string }>()

    expect(objects.results).toHaveLength(29)
    expect(objects.results.filter(({ type }) => type === 'view')).toHaveLength(8)
  })

  it('enforces tenant-scoped evidence identities and one reservation and charge per intent', async () => {
    await test.d1
      .prepare(
        `INSERT INTO shops
         (id, merchant_id, brand_id, public_name, slug, timezone, currency, created_at, updated_at)
         VALUES ('shp_message_migration', 'mer_message_migration', 'brd_message_migration', 'Migration', 'migration', 'UTC', 'EUR', ?, ?)`
      )
      .bind(now, now)
      .run()
      .catch(async () => {
        await test.d1
          .prepare(
            `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
             VALUES ('brd_message_migration', 'mer_message_migration', 'Migration', ?, ?)`
          )
          .bind(now, now)
          .run()
        await test.d1
          .prepare(
            `INSERT INTO shops
             (id, merchant_id, brand_id, public_name, slug, timezone, currency, created_at, updated_at)
             VALUES ('shp_message_migration', 'mer_message_migration', 'brd_message_migration', 'Migration', 'migration', 'UTC', 'EUR', ?, ?)`
          )
          .bind(now, now)
          .run()
      })
    await test.d1
      .prepare(
        `INSERT INTO notification_intents
         (id, shop_id, topic, recipient_json, payload_json, source_type, source_id, source_version,
          deduplication_key, status, available_at, purpose, phase, created_at, updated_at)
         VALUES ('nti_message_migration', 'shp_message_migration', 'appointment.confirmation', '{}', '{}',
          'appointment', 'apt_message_migration', 1, 'confirmation:apt_message_migration:1',
          'pending', ?, 'appointment_confirmation', 'ready', ?, ?)`
      )
      .bind(now, now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO messaging_balances
         (shop_id, currency, created_at, updated_at)
         VALUES ('shp_message_migration', 'EUR', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO messaging_balance_reservations
         (id, shop_id, intent_id, rate_card_id, amount_milli_euro, status, expires_at, created_at, updated_at)
         VALUES ('mbr_message_migration', 'shp_message_migration', 'nti_message_migration',
          'mrcard_launch_v1', 45, 'active', '2026-08-05T12:00:00.000Z', ?, ?)`
      )
      .bind(now, now)
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO messaging_balance_ledger_entries
           (id, shop_id, direction, kind, amount_milli_euro, currency,
            source_type, source_id, idempotency_key, rate_card_id, occurred_at, created_at)
           VALUES ('mle_delivery_without_intent', 'shp_message_migration', 'debit',
            'delivery_charge', 45, 'EUR', 'notification_intent', 'missing',
            'delivery:missing', 'mrcard_launch_v1', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await test.d1
      .prepare(
        `INSERT INTO messaging_balance_ledger_entries
         (id, shop_id, direction, kind, amount_milli_euro, currency,
          source_type, source_id, idempotency_key, rate_card_id, intent_id,
          occurred_at, created_at)
         VALUES ('mle_delivery', 'shp_message_migration', 'debit', 'delivery_charge',
          45, 'EUR', 'notification_intent', 'nti_message_migration',
          'delivery:nti_message_migration', 'mrcard_launch_v1',
          'nti_message_migration', ?, ?)`
      )
      .bind(now, now)
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO messaging_balance_ledger_entries
           (id, shop_id, direction, kind, amount_milli_euro, currency,
            source_type, source_id, idempotency_key, rate_card_id, intent_id,
            occurred_at, created_at)
           VALUES ('mle_delivery_duplicate', 'shp_message_migration', 'debit',
            'delivery_charge', 45, 'EUR', 'reconciliation', 'case_duplicate',
            'delivery:duplicate', 'mrcard_launch_v1', 'nti_message_migration', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO messaging_balance_reservations
           (id, shop_id, intent_id, rate_card_id, amount_milli_euro, status, expires_at, created_at, updated_at)
           VALUES ('mbr_duplicate', 'shp_message_migration', 'nti_message_migration',
            'mrcard_launch_v1', 45, 'active', '2026-08-05T12:00:00.000Z', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await test.d1
      .prepare(
        `INSERT INTO notification_intents
         (id, shop_id, topic, recipient_json, payload_json, source_type, source_id, source_version,
          deduplication_key, status, available_at, purpose, phase, created_at, updated_at)
         VALUES ('nti_message_second', 'shp_message_migration', 'appointment.reminder', '{}', '{}',
          'appointment', 'apt_message_migration', 2, 'reminder:apt_message_migration:2',
          'pending', ?, 'appointment_reminder', 'ready', ?, ?)`
      )
      .bind(now, now, now)
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO messaging_balance_reservations
           (id, shop_id, intent_id, rate_card_id, amount_milli_euro, status, expires_at,
            created_at, updated_at)
           VALUES ('mbr_wrong_rate_amount', 'shp_message_migration', 'nti_message_second',
            'mrcard_launch_v1', 46, 'active', '2026-08-05T12:00:00.000Z', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await test.d1
      .prepare(
        `INSERT INTO delivery_routes
         (id, shop_id, intent_id, ordinal, channel, provider, state, created_at, updated_at)
         VALUES ('drt_message_second', 'shp_message_migration', 'nti_message_second',
          0, 'whatsapp', 'meta', 'planned', ?, ?)`
      )
      .bind(now, now)
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO submission_attempts
           (id, shop_id, intent_id, route_id, ordinal, idempotency_key, request_fingerprint,
            state, started_at, created_at)
           VALUES ('pat_cross_aggregate', 'shp_message_migration', 'nti_message_migration',
            'drt_message_second', 0, 'idem_cross_aggregate',
            'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            'prepared', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await test.d1
      .prepare(
        `INSERT INTO shops
         (id, merchant_id, brand_id, public_name, slug, timezone, currency, created_at, updated_at)
         VALUES ('shp_message_other', 'mer_message_migration', 'brd_message_migration',
          'Other', 'message-other', 'UTC', 'EUR', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO messaging_balances
         (shop_id, currency, created_at, updated_at)
         VALUES ('shp_message_other', 'EUR', ?, ?)`
      )
      .bind(now, now)
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO messaging_balance_ledger_entries
           (id, shop_id, direction, kind, amount_milli_euro, currency,
            source_type, source_id, idempotency_key, intent_id, occurred_at, created_at)
           VALUES ('mle_cross_tenant', 'shp_message_other', 'debit', 'operator_adjustment',
            45, 'EUR', 'notification_intent', 'nti_message_migration',
            'delivery:cross-tenant', 'nti_message_migration', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO messaging_reconciliation_cases
           (id, shop_id, intent_id, kind, source_identity, status, severity, safe_summary,
            opened_at, created_at, updated_at)
           VALUES ('mrcase_cross_tenant', 'shp_message_other', 'nti_message_migration',
            'contradictory_evidence', 'cross-tenant', 'open', 'high', 'Safe summary',
            ?, ?, ?)`
        )
        .bind(now, now, now)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO delivery_routes
           (id, shop_id, intent_id, ordinal, channel, provider, state, created_at, updated_at)
           VALUES ('drt_cross_tenant', 'shp_message_other', 'nti_message_migration',
            0, 'whatsapp', 'meta', 'planned', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()

    await test.d1
      .prepare(
        `INSERT INTO delivery_routes
         (id, shop_id, intent_id, ordinal, channel, provider, state, created_at, updated_at)
         VALUES ('drt_message_migration', 'shp_message_migration', 'nti_message_migration',
          0, 'whatsapp', 'meta', 'planned', ?, ?)`
      )
      .bind(now, now)
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO chargeable_deliveries
           (id, shop_id, intent_id, reservation_id, rate_card_id, route_id,
            charge_milli_euro, verified_at, created_at)
           VALUES ('mcd_cross_aggregate', 'shp_message_migration', 'nti_message_migration',
            'mbr_message_migration', 'mrcard_launch_v1', 'drt_message_second', 45, ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO chargeable_deliveries
           (id, shop_id, intent_id, reservation_id, rate_card_id, route_id,
            charge_milli_euro, verified_at, created_at)
           VALUES ('mcd_wrong_amount', 'shp_message_migration', 'nti_message_migration',
            'mbr_message_migration', 'mrcard_launch_v1', 'drt_message_migration', 46, ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await test.d1
      .prepare(
        `INSERT INTO submission_attempts
         (id, shop_id, intent_id, route_id, ordinal, idempotency_key, request_fingerprint,
          state, started_at, created_at)
         VALUES ('pat_message_migration', 'shp_message_migration', 'nti_message_migration',
          'drt_message_migration', 0, 'idem_message_migration',
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'prepared', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO provider_evidence
         (id, shop_id, intent_id, route_id, attempt_id, environment, provider,
          provider_account_key, source, source_event_key, provider_reference_fingerprint,
          status, trusted, observed_at, created_at)
         VALUES ('pevd_message_migration', 'shp_message_migration', 'nti_message_migration',
          'drt_message_migration', 'pat_message_migration', 'test', 'meta', 'meta_test',
          'callback', 'callback:one',
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          'accepted', 1, ?, ?)`
      )
      .bind(now, now)
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO provider_evidence
           (id, shop_id, intent_id, route_id, attempt_id, environment, provider,
            provider_account_key, source, source_event_key, provider_reference_fingerprint,
            status, trusted, observed_at, created_at)
           VALUES ('pevd_duplicate', 'shp_message_migration', 'nti_message_migration',
            'drt_message_migration', 'pat_message_migration', 'test', 'meta', 'meta_test',
            'callback', 'callback:one',
            'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            'delivered', 1, ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO provider_evidence
           (id, shop_id, intent_id, route_id, attempt_id, environment, provider,
            provider_account_key, source, source_event_key, provider_reference_fingerprint,
            status, trusted, observed_at, created_at)
           VALUES ('pevd_same_provider_message', 'shp_message_migration',
            'nti_message_migration', 'drt_message_migration', 'pat_message_migration',
            'test', 'meta', 'meta_test', 'query', 'query:one',
            'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            'accepted', 1, ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(
          `UPDATE provider_evidence SET status = 'delivered'
           WHERE id = 'pevd_message_migration'`
        )
        .run()
    ).rejects.toThrow(/append-only/)

    await test.d1
      .prepare(
        `INSERT INTO chargeable_deliveries
         (id, shop_id, intent_id, reservation_id, rate_card_id, route_id,
          charge_milli_euro, verified_at, created_at)
         VALUES ('mcd_message_migration', 'shp_message_migration', 'nti_message_migration',
          'mbr_message_migration', 'mrcard_launch_v1', 'drt_message_migration', 45, ?, ?)`
      )
      .bind(now, now)
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO chargeable_deliveries
           (id, shop_id, intent_id, reservation_id, rate_card_id, route_id,
            charge_milli_euro, verified_at, created_at)
           VALUES ('mcd_duplicate', 'shp_message_migration', 'nti_message_migration',
            'mbr_message_migration', 'mrcard_launch_v1', 'drt_message_migration', 45, ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()

    await expect(
      test.d1
        .prepare(
          `INSERT INTO messaging_balance_ledger_entries
           (id, shop_id, direction, kind, amount_milli_euro, currency,
            source_type, source_id, idempotency_key, occurred_at, created_at)
           VALUES ('mle_invalid', 'shp_message_migration', 'credit', 'top_up', 0, 'EUR',
            'stripe_payment', 'pi_invalid', 'stripe:pi_invalid', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
  })

  it('installs cleanly from the full migration set', async () => {
    const clean = await provisionUnmigratedTestD1()
    try {
      await applyMigrations(clean.d1)
      const rateCard = await clean.d1
        .prepare(
          `SELECT version, currency, charge_milli_euro
           FROM messaging_rate_cards WHERE id = 'mrcard_launch_v1'`
        )
        .first()
      expect(rateCard).toEqual({ version: 1, currency: 'EUR', charge_milli_euro: 45 })
    } finally {
      await clean.dispose()
    }
  }, 60_000)
})
