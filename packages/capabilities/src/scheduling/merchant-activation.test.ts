import { describe, expect, it } from 'vitest'
import {
  decideFirstPublication,
  deriveActivationProgress,
  simulateLaunchTest,
  type ActivationFacts
} from './merchant-activation.ts'

const completeFacts: ActivationFacts = {
  businessDetailsComplete: true,
  ownerProviderConfirmed: true,
  hasActiveEligibleService: true,
  hasExplicitWeeklyHours: true,
  dateOverridesReviewed: true,
  bookingPoliciesConfirmed: true,
  notificationAccepted: true,
  sourceRevision: 'configuration:7',
  launchTestSourceRevision: 'configuration:7',
  subscriptionAccess: true,
  publishedIntent: false,
  firstActivatedAt: null
}

describe('Solo Merchant Activation', () => {
  it('resumes at the first incomplete authoritative requirement', () => {
    const progress = deriveActivationProgress({
      ...completeFacts,
      ownerProviderConfirmed: false,
      notificationAccepted: false
    })
    expect(progress.resumeAt).toBe('owner-provider')
    expect(progress.incomplete).toContain('notification-readiness')
    expect(progress.readyForFirstPublication).toBe(false)
  })

  it('makes a Launch Test stale whenever activation configuration changes', () => {
    const progress = deriveActivationProgress({
      ...completeFacts,
      sourceRevision: 'configuration:8'
    })
    expect(progress.incomplete).toContain('launch-test')
  })

  it('simulates confirmation without writing any operational facts', () => {
    expect(
      simulateLaunchTest(
        'configuration:7',
        {
          serviceId: 'svc_1',
          providerId: 'prv_1',
          startsAt: '2026-10-25T00:30:00.000Z',
          customer: { name: 'Preview Customer', email: 'preview@example.com' }
        },
        ['2026-10-25T00:30:00.000Z']
      )
    ).toMatchObject({
      createsAppointment: false,
      createsCustomerRecord: false,
      consumesHold: false,
      sendsCustomerNotification: false
    })
  })

  it('keeps publication intent but gates current exposure', () => {
    const progress = deriveActivationProgress({
      ...completeFacts,
      publishedIntent: true,
      subscriptionAccess: false,
      firstActivatedAt: '2026-08-03T10:00:00.000Z'
    })
    expect(progress.activated).toBe(true)
    expect(progress.currentlyPublic).toBe(false)
  })

  it('rechecks every fact and subscription access before first publication', () => {
    expect(decideFirstPublication(completeFacts)).toEqual({
      kind: 'publish',
      firstActivation: true
    })
    expect(
      decideFirstPublication({ ...completeFacts, subscriptionAccess: false })
    ).toEqual({ kind: 'reject', incomplete: ['publication'] })
  })
})
