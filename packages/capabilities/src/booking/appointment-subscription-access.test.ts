import { describe, expect, it } from 'vitest'
import { subscriptionAccessAllows } from '../subscriptions/subscription-access.ts'
import {
  appointmentSubscriptionOperation,
  type AppointmentSubscriptionMutation
} from './appointment-subscription-access.ts'

describe('appointment subscription access', () => {
  it('blocks new appointment demand during Restricted Access', () => {
    for (const operation of ['merchant-create', 'record-completed'] as const)
      expect(
        subscriptionAccessAllows(
          'restricted',
          appointmentSubscriptionOperation(operation)
        )
      ).toBe(false)
  })

  it('allows every existing-commitment mutation during Restricted Access', () => {
    const operations: readonly AppointmentSubscriptionMutation[] = [
      'edit',
      'reschedule',
      'cancel',
      'complete',
      'no-show',
      'outcome-correction',
      'external-collection',
      'whole-party-cancel'
    ]
    expect(
      operations.every((operation) =>
        subscriptionAccessAllows(
          'restricted',
          appointmentSubscriptionOperation(operation)
        )
      )
    ).toBe(true)
  })
})
