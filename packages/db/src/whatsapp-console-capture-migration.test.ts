import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, provisionUnmigratedTestD1, type TestD1 } from './testing.ts'

const previousMigration = '20260722174000_appointment_calendar_range_index'
const whatsappCaptureMigration = '20260727171000_whatsapp_console_capture'
const now = '2026-07-27T14:00:00.000Z'
let test: TestD1

beforeAll(async () => {
  test = await provisionUnmigratedTestD1()
  await applyMigrations(test.d1, { through: previousMigration })
}, 60_000)
afterAll(async () => test.dispose())

describe('WhatsApp console-capture migration', () => {
  it('marks completed legacy work not applicable while new work starts pending', async () => {
    await test.d1
      .prepare(
        `INSERT INTO merchants
         (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
         VALUES ('mer_whatsapp_migration', 'Migration', 'migration', 'UTC', 'EUR', 'solo', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO providers
         (id, merchant_id, display_name, status, is_default, created_at, updated_at)
         VALUES ('prv_whatsapp_migration', 'mer_whatsapp_migration', 'Provider', 'active', 1, ?, ?)`
      )
      .bind(now, now)
      .run()
    for (const id of ['legacy', 'new'])
      await test.d1
        .prepare(
          `INSERT INTO appointments
           (id, merchant_id, provider_id, status, starts_at, ends_at, created_at, updated_at)
           VALUES (?, 'mer_whatsapp_migration', 'prv_whatsapp_migration', 'scheduled', ?, ?, ?, ?)`
        )
        .bind(
          `apt_whatsapp_${id}`,
          '2026-07-28T10:00:00.000Z',
          '2026-07-28T11:00:00.000Z',
          now,
          now
        )
        .run()
    await test.d1
      .prepare(
        `INSERT INTO booking_outbox
         (id, appointment_id, kind, trace_id, processed_at, created_at)
         VALUES ('out_whatsapp_legacy', 'apt_whatsapp_legacy', 'appointment.created', 'trace_legacy', ?, ?)`
      )
      .bind(now, now)
      .run()

    await applyMigrations(test.d1, {
      after: previousMigration,
      through: whatsappCaptureMigration
    })

    await test.d1
      .prepare(
        `INSERT INTO booking_outbox
         (id, appointment_id, kind, trace_id, created_at)
         VALUES ('out_whatsapp_new', 'apt_whatsapp_new', 'appointment.created', 'trace_new', ?)`
      )
      .bind(now)
      .run()

    const rows = await test.d1
      .prepare(
        `SELECT id, whatsapp_status
         FROM booking_outbox
         WHERE id IN ('out_whatsapp_legacy', 'out_whatsapp_new')
         ORDER BY id`
      )
      .all<{ id: string; whatsapp_status: string }>()
    expect(rows.results).toEqual([
      { id: 'out_whatsapp_legacy', whatsapp_status: 'not_applicable' },
      { id: 'out_whatsapp_new', whatsapp_status: 'pending' }
    ])
  })
})
