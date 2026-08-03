import { describe, expect, it } from 'vitest'
import { decodeBookingEventsWakeup } from './booking-events-queue.ts'

describe('Booking events Queue compatibility contract', () => {
  it('normalizes the legacy outbox envelope and accepts both versioned kinds', () => {
    expect(decodeBookingEventsWakeup({ outboxId: 'obx_legacy' })).toEqual({
      version: 1,
      kind: 'booking-outbox',
      outboxId: 'obx_legacy'
    })
    expect(
      decodeBookingEventsWakeup({
        version: 1,
        kind: 'booking-outbox',
        outboxId: 'obx_current'
      })
    ).toEqual({ version: 1, kind: 'booking-outbox', outboxId: 'obx_current' })
    expect(
      decodeBookingEventsWakeup({
        version: 1,
        kind: 'notification-intent',
        intentId: 'nti_current'
      })
    ).toEqual({
      version: 1,
      kind: 'notification-intent',
      intentId: 'nti_current'
    })
    expect(
      decodeBookingEventsWakeup({
        version: 1,
        kind: 'capability-outbox',
        outboxId: 'cob_current'
      })
    ).toEqual({
      version: 1,
      kind: 'capability-outbox',
      outboxId: 'cob_current'
    })
  })

  it('rejects unknown versions, empty identifiers, and business-shaped payloads', () => {
    expect(
      decodeBookingEventsWakeup({
        version: 2,
        kind: 'notification-intent',
        intentId: 'nti_future'
      })
    ).toBeNull()
    expect(decodeBookingEventsWakeup({ outboxId: '' })).toBeNull()
    expect(
      decodeBookingEventsWakeup({ appointment: { phone: '+40722123456' } })
    ).toBeNull()
  })
})
