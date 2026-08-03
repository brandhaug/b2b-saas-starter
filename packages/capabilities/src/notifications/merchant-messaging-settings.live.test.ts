import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  LiveMerchantMessagingSettings,
  MerchantMessagingSettings
} from './merchant-messaging-settings.ts'

const now = '2026-07-29T12:00:00.000Z'
let test: TestD1

beforeAll(async () => {
  test = await provisionTestD1()
  for (const statement of [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
     VALUES ('mrc_settings_one', 'One', 'one', 'Europe/Bucharest', 'RON', 'solo', '${now}', '${now}'),
            ('mrc_settings_two', 'Two', 'two', 'Europe/Bucharest', 'RON', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
     VALUES ('brd_settings_one', 'mrc_settings_one', 'One', '${now}', '${now}'),
            ('brd_settings_two', 'mrc_settings_two', 'Two', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
     VALUES ('shp_settings_one', 'brd_settings_one', 'mrc_settings_one', 'one-shop', 'One', 'Europe/Bucharest', 'RON', '${now}', '${now}'),
            ('shp_settings_two', 'brd_settings_two', 'mrc_settings_two', 'two-shop', 'Two', 'Europe/Bucharest', 'RON', '${now}', '${now}')`
  ])
    await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())

const run = <A, E>(effect: Effect.Effect<A, E, MerchantMessagingSettings>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        LiveMerchantMessagingSettings.pipe(Layer.provide(layerFromD1(test.d1)))
      )
    )
  )

describe('Live Merchant Messaging Settings', () => {
  it('saves one Merchant without disclosing or changing another Merchant', async () => {
    const saved = await run(
      Effect.flatMap(MerchantMessagingSettings, (settings) =>
        settings.save({
          merchantId: 'mrc_settings_one',
          enabled: true,
          confirmationEnabled: true,
          rescheduleEnabled: false,
          cancellationEnabled: true,
          reminderEnabled: true,
          reminderLeadHours: 48,
          now
        })
      )
    )
    const other = await run(
      Effect.flatMap(MerchantMessagingSettings, (settings) =>
        settings.read({ merchantId: 'mrc_settings_two' })
      )
    )

    expect(saved).toMatchObject({
      merchantId: 'mrc_settings_one',
      enabled: true,
      reminderLeadHours: 48,
      controls: { reschedule: 'dont_send' }
    })
    expect(other).toMatchObject({
      merchantId: 'mrc_settings_two',
      enabled: false,
      reminderLeadHours: 24,
      controls: { reschedule: 'send' }
    })
    expect(JSON.stringify(saved)).not.toMatch(/provider|route|evidence|whatsapp|smso/i)
  })

  it('requires the complete approved RO/EN purpose set before reporting ready', async () => {
    const templates = (['ro', 'en'] as const).flatMap((locale) =>
      (
        [
          'appointment_confirmation',
          'appointment_reschedule',
          'appointment_cancellation',
          'appointment_reminder'
        ] as const
      ).map((purpose) => ({ locale, purpose }))
    )
    const approve = async (template: (typeof templates)[number]) =>
      test.d1
        .prepare(
          `UPDATE messaging_template_versions
           SET enabled = 1,
               provider_requested_category = 'utility',
               provider_observed_category = 'utility',
               provider_approval_status = 'approved',
               provider_approved_at = ?,
               provider_approval_evidence_reference = ?,
               retired_at = NULL
           WHERE purpose = ? AND locale = ? AND channel = 'whatsapp' AND version = 1`
        )
        .bind(
          now,
          `evidence:${template.locale}:${template.purpose}`,
          template.purpose,
          template.locale
        )
        .run()

    await approve(templates[0]!)
    expect(
      await run(
        Effect.flatMap(MerchantMessagingSettings, (settings) =>
          settings.read({ merchantId: 'mrc_settings_one' })
        )
      )
    ).toMatchObject({ state: 'needs_configuration' })

    for (const template of templates.slice(1)) await approve(template)
    expect(
      await run(
        Effect.flatMap(MerchantMessagingSettings, (settings) =>
          settings.read({ merchantId: 'mrc_settings_one' })
        )
      )
    ).toMatchObject({ state: 'ready' })
  })

  it('rejects direct mutations while the Merchant controls are frozen', async () => {
    await test.d1
      .prepare(
        `INSERT INTO merchant_messaging_controls (
           shop_id, enabled, confirmation_enabled, reschedule_enabled,
           cancellation_enabled, reminder_enabled, reminder_lead_minutes,
           frozen, created_at, updated_at
         ) VALUES (?, 0, 1, 1, 1, 1, 1440, 1, ?, ?)`
      )
      .bind('shp_settings_two', now, now)
      .run()

    await expect(
      run(
        Effect.flatMap(MerchantMessagingSettings, (settings) =>
          settings.save({
            merchantId: 'mrc_settings_two',
            enabled: true,
            confirmationEnabled: true,
            rescheduleEnabled: true,
            cancellationEnabled: true,
            reminderEnabled: true,
            reminderLeadHours: 2,
            now
          })
        )
      )
    ).rejects.toMatchObject({ _tag: 'MerchantMessagingSettingsFrozen' })
  })
})
