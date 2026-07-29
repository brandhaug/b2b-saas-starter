import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, provisionUnmigratedTestD1, type TestD1 } from './testing.ts'

const previousMigration = '20260729140000_messaging_financial_invariants'
const cutoverMigration = '20260729150000_booking_intent_cutover'
const now = '2026-07-29T15:00:00.000Z'
let test: TestD1

const destination = JSON.stringify({
  role: 'customer',
  destination: {
    ciphertext: 'ciphertext:future-reminder',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    maskedValue: '+40•••••••456',
    countryCode: 'RO',
    keyVersion: 1
  }
})
const controlledFacts = {
  merchantLabel: 'Migration',
  merchantSmsLabel: 'Migration',
  localizedDate: '1 august 2099',
  smsDate: '01.08.2099',
  time: '12:00',
  locationLabel: 'Migration',
  locationSmsLabel: 'Migration',
  reference: 'FUTURE',
  confirmationUrl: ''
}

beforeAll(async () => {
  test = await provisionUnmigratedTestD1()
  await applyMigrations(test.d1, { through: previousMigration })
  for (const statement of [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
     VALUES ('mer_cutover', 'Migration', 'migration', 'Europe/Bucharest', 'EUR', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
     VALUES ('brd_cutover', 'mer_cutover', 'Migration', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
     VALUES ('shp_cutover', 'brd_cutover', 'mer_cutover', 'migration', 'Migration', 'Europe/Bucharest', 'EUR', '${now}', '${now}')`,
    `INSERT INTO providers (id, merchant_id, display_name, status, created_at, updated_at)
     VALUES ('prv_cutover', 'mer_cutover', 'Provider', 'active', '${now}', '${now}')`,
    `INSERT INTO appointments (id, merchant_id, provider_id, status, version, starts_at, ends_at, created_at, updated_at)
     VALUES ('apt_cutover', 'mer_cutover', 'prv_cutover', 'scheduled', 3,
       '2099-08-01T09:00:00.000Z', '2099-08-01T10:00:00.000Z', '${now}', '${now}')`,
    `INSERT INTO booking_outbox
     (id, appointment_id, notification_intent_id, kind, trace_id, email_status,
      whatsapp_status, webhook_status, created_at)
     VALUES ('obx_cutover', 'apt_cutover', NULL, 'appointment.created', 'trace_cutover',
       'pending', 'pending', 'pending', '${now}')`,
    `INSERT INTO notification_intents
     (id, shop_id, topic, recipient_json, payload_json, source_type, source_id,
      source_version, deduplication_key, status, available_at, created_at, updated_at)
     VALUES
       ('nti_future_safe', 'shp_cutover', 'appointment.reminder', '${destination}',
        '${JSON.stringify({ controlledFacts, factsFingerprint: `sha256:${'b'.repeat(64)}` })}',
        'appointment', 'apt_cutover', 3, 'reminder:apt_cutover:3', 'pending',
        '2099-08-01T07:00:00.000Z', '${now}', '${now}'),
       ('nti_past', 'shp_cutover', 'appointment.reminder', '${destination}',
        '${JSON.stringify({ controlledFacts, factsFingerprint: `sha256:${'c'.repeat(64)}` })}',
        'appointment', 'apt_cutover', 2, 'reminder:apt_cutover:2', 'pending',
        '2020-01-01T07:00:00.000Z', '${now}', '${now}'),
       ('nti_historical_confirmation', 'shp_cutover', 'appointment.confirmation', '${destination}',
        '{}', 'appointment', 'apt_cutover', 3, 'confirmation:apt_cutover:3', 'pending',
        '${now}', '${now}', '${now}'),
       ('nti_historical_cancellation', 'shp_cutover', 'appointment.cancellation', '${destination}',
        '{}', 'appointment', 'apt_cutover', 3, 'cancellation:apt_cutover:3', 'pending',
        '${now}', '${now}', '${now}'),
       ('nti_historical_reschedule', 'shp_cutover', 'appointment.reschedule', '${destination}',
        '{}', 'appointment', 'apt_cutover', 3, 'reschedule:apt_cutover:3', 'pending',
        '${now}', '${now}', '${now}'),
       ('nti_future_incomplete', 'shp_cutover', 'appointment.reminder',
        '${JSON.stringify({ role: 'customer', destination: { ciphertext: 'ciphertext:incomplete', fingerprint: `sha256:${'d'.repeat(64)}`, maskedValue: '+40•••••••000', keyVersion: 1 } })}',
        '${JSON.stringify({ controlledFacts, factsFingerprint: `sha256:${'e'.repeat(64)}` })}',
        'appointment', 'apt_cutover', 3, 'reminder:apt_cutover:incomplete', 'pending',
        '2099-08-01T06:00:00.000Z', '${now}', '${now}')`,
    `INSERT INTO scheduled_work
     (id, shop_id, kind, source_type, source_id, source_version, payload_json,
      idempotency_key, status, run_at, attempts, created_at, updated_at)
     VALUES
       ('scw_future_safe', 'shp_cutover', 'appointment.reminder', 'appointment',
        'apt_cutover', 3, '{}', 'work:future-safe', 'pending',
        '2099-08-01T07:00:00.000Z', 0, '${now}', '${now}'),
       ('scw_past', 'shp_cutover', 'appointment.reminder', 'appointment',
        'apt_cutover', 2, '{}', 'work:past', 'pending',
        '2020-01-01T07:00:00.000Z', 0, '${now}', '${now}'),
       ('scw_future_incomplete', 'shp_cutover', 'appointment.reminder', 'appointment',
        'apt_cutover', 3, '{}', 'work:future-incomplete', 'pending',
        '2099-08-01T06:00:00.000Z', 0, '${now}', '${now}')`
  ])
    await test.d1.prepare(statement).run()

  await applyMigrations(test.d1, {
    after: previousMigration,
    through: cutoverMigration
  })
}, 60_000)

afterAll(async () => test.dispose())

describe('Booking intent producer cutover migration', () => {
  it('migrates only a protected pending future reminder with no submission', async () => {
    const intents = await test.d1
      .prepare(
        `SELECT id, purpose, phase, status FROM notification_intents
         WHERE id IN (
           'nti_future_safe', 'nti_future_incomplete', 'nti_past',
           'nti_historical_confirmation', 'nti_historical_cancellation',
           'nti_historical_reschedule'
         )
         ORDER BY id`
      )
      .all()
    expect(intents.results).toEqual([
      {
        id: 'nti_future_incomplete',
        purpose: null,
        phase: null,
        status: 'pending'
      },
      {
        id: 'nti_future_safe',
        purpose: 'appointment_reminder',
        phase: 'scheduled',
        status: 'pending'
      },
      {
        id: 'nti_historical_cancellation',
        purpose: null,
        phase: null,
        status: 'pending'
      },
      {
        id: 'nti_historical_confirmation',
        purpose: null,
        phase: null,
        status: 'pending'
      },
      {
        id: 'nti_historical_reschedule',
        purpose: null,
        phase: null,
        status: 'pending'
      },
      { id: 'nti_past', purpose: null, phase: null, status: 'pending' }
    ])
    const routes = await test.d1
      .prepare(
        `SELECT intent_id, ordinal, channel FROM delivery_routes ORDER BY ordinal`
      )
      .all()
    expect(routes.results).toEqual([
      { intent_id: 'nti_future_safe', ordinal: 0, channel: 'whatsapp' },
      { intent_id: 'nti_future_safe', ordinal: 1, channel: 'sms' }
    ])
    const work = await test.d1
      .prepare(`SELECT id, status FROM scheduled_work ORDER BY id`)
      .all()
    expect(work.results).toEqual([
      { id: 'scw_future_incomplete', status: 'pending' },
      { id: 'scw_future_safe', status: 'cancelled' },
      { id: 'scw_past', status: 'pending' }
    ])
  })

  it('preserves email/webhook outbox work while removing every mobile column', async () => {
    const columns = await test.d1
      .prepare(`PRAGMA table_info('booking_outbox')`)
      .all<{ name: string }>()
    expect(columns.results.map((column) => column.name)).not.toContain(
      'notification_intent_id'
    )
    expect(columns.results.map((column) => column.name)).not.toContain(
      'whatsapp_status'
    )
    const outbox = await test.d1
      .prepare(
        `SELECT id, appointment_id, trace_id, email_status, webhook_status
         FROM booking_outbox WHERE id = 'obx_cutover'`
      )
      .first()
    expect(outbox).toEqual({
      id: 'obx_cutover',
      appointment_id: 'apt_cutover',
      trace_id: 'trace_cutover',
      email_status: 'pending',
      webhook_status: 'pending'
    })

    await expect(
      test.d1
        .prepare(
          `INSERT INTO platform_webhook_events
           (id, outbox_id, merchant_id, event_type, raw_body, occurred_at, created_at)
           VALUES ('evt_cutover', 'obx_cutover', 'mer_cutover',
             'appointment.created', '{}', '${now}', '${now}')`
        )
        .run()
    ).resolves.toBeDefined()
    const foreignKeyViolations = await test.d1.prepare('PRAGMA foreign_key_check').all()
    expect(foreignKeyViolations.results).toEqual([])
  })
})
