import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  MerchantMessagingSettings,
  MerchantMessagingSettingsInput,
  SeedMerchantMessagingSettings,
  merchantReminderAvailableAt
} from './merchant-messaging-settings.ts'

const read = <A, E>(
  effect: Effect.Effect<A, E, MerchantMessagingSettings>,
  layer = SeedMerchantMessagingSettings()
) => Effect.runPromise(effect.pipe(Effect.provide(layer)))

describe('Merchant Messaging Settings', () => {
  it('stages and saves only the supported provider-neutral Appointment controls', async () => {
    const saved = await read(
      Effect.flatMap(MerchantMessagingSettings, (settings) =>
        settings.save({
          merchantId: 'mrc_one',
          enabled: true,
          confirmationEnabled: true,
          rescheduleEnabled: false,
          cancellationEnabled: true,
          reminderEnabled: true,
          reminderLeadHours: 24,
          now: '2026-07-29T12:00:00.000Z'
        })
      )
    )

    expect(saved).toMatchObject({
      merchantId: 'mrc_one',
      enabled: true,
      controls: {
        confirmation: 'send',
        reschedule: 'dont_send',
        cancellation: 'send',
        reminder: 'send'
      },
      reminderLeadHours: 24
    })
    expect(JSON.stringify(saved)).not.toMatch(/whatsapp|smso|provider|route/i)
  })

  it('rejects reminder choices outside 2, 24, or 48 hours', () => {
    expect(() =>
      Schema.decodeUnknownSync(MerchantMessagingSettingsInput)({
        merchantId: 'mrc_one',
        enabled: true,
        confirmationEnabled: true,
        rescheduleEnabled: true,
        cancellationEnabled: true,
        reminderEnabled: true,
        reminderLeadHours: 12,
        now: '2026-07-29T12:00:00.000Z'
      })
    ).toThrow()
  })

  it('returns read-only Romanian and English examples with a link only for confirmation', async () => {
    const projection = await read(
      Effect.flatMap(MerchantMessagingSettings, (settings) =>
        settings.read({ merchantId: 'mrc_one' })
      )
    )

    expect(projection.previews).toHaveLength(8)
    expect(
      projection.previews.filter((preview) => preview.body.includes('https://'))
    ).toEqual([
      expect.objectContaining({ purpose: 'appointment_confirmation', locale: 'ro' }),
      expect.objectContaining({ purpose: 'appointment_confirmation', locale: 'en' })
    ])
  })

  it('derives a future reminder from the saved Merchant lead time', () => {
    expect(
      merchantReminderAvailableAt({
        startsAt: '2026-07-31T12:00:00.000Z',
        now: '2026-07-29T11:59:59.999Z',
        controls: {
          enabled: true,
          reminderEnabled: true,
          reminderLeadMinutes: 2880,
          frozen: false
        }
      })
    ).toBe('2026-07-29T12:00:00.000Z')
    expect(
      merchantReminderAvailableAt({
        startsAt: '2026-07-31T12:00:00.000Z',
        now: '2026-07-29T12:00:00.001Z',
        controls: {
          enabled: true,
          reminderEnabled: true,
          reminderLeadMinutes: 2880,
          frozen: false
        }
      })
    ).toBeNull()
  })
})
