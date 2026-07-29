import { describe, expect, it } from 'vitest'
import {
  legacyBookingPolicySteps,
  pendingNotificationPolicyTargets
} from './booking-checkout.ts'

describe('pendingNotificationPolicyTargets', () => {
  it('returns only contactable channels without a current consent decision', () => {
    expect(
      pendingNotificationPolicyTargets({
        marketingPolicy: {
          id: 'pol_marketing',
          scope: 'shop',
          scopeId: 'shp_one',
          kind: 'marketing',
          version: 2,
          disclosure: 'Optional offers.',
          effectiveAt: '2026-01-01T00:00:00.000Z',
          retiredAt: null
        },
        requests: [
          {
            id: 'brq_one',
            customerDetails: {
              name: 'Mia',
              email: 'mia@example.com',
              phone: '+40700111222'
            }
          }
        ],
        consents: [
          {
            bookingRequestId: 'brq_one',
            channel: 'email',
            granted: false,
            policyVersion: '2',
            disclosure: 'Optional offers.',
            recordedAt: '2026-07-16T00:00:00.000Z'
          }
        ]
      })
    ).toEqual([{ bookingRequestId: 'brq_one', channel: 'sms' }])
  })
})

describe('legacyBookingPolicySteps', () => {
  it('orders applicable adults and cancellation policies for a normal booking', () => {
    expect(
      legacyBookingPolicySteps({
        adultsOnly: true,
        checkoutPolicyRequired: true,
        bookingKind: 'appointment',
        depositRequired: false
      })
    ).toEqual(['adults', 'cancellation'])
    expect(
      legacyBookingPolicySteps({
        adultsOnly: false,
        checkoutPolicyRequired: true,
        bookingKind: 'waiting_list',
        depositRequired: false
      })
    ).toEqual([])
    expect(
      legacyBookingPolicySteps({
        adultsOnly: false,
        checkoutPolicyRequired: true,
        bookingKind: 'appointment',
        depositRequired: true
      })
    ).toEqual([])
  })
})
