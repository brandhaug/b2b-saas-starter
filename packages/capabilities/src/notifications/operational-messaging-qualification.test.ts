import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  decodeQualificationEvidence,
  evaluateMessagingAlerts
} from './operational-messaging-qualification.ts'

describe('Operational Messaging qualification policy', () => {
  it('rejects malformed external evidence with a typed error', async () => {
    await expect(
      Effect.runPromise(decodeQualificationEvidence('{"produced":"60000"}'))
    ).rejects.toMatchObject({ _tag: 'QualificationEvidenceInvalid' })
  })

  it('applies the settled SLO, complaint, cost, and integrity thresholds', () => {
    expect(
      evaluateMessagingAlerts({
        eligibleIntents: 1_000,
        deliveredWithin15Minutes: 979,
        immediateIntents: 100,
        immediateSubmittedWithin60Seconds: 98,
        remindersDue: 100,
        remindersSubmittedWithin5Minutes: 99,
        eligibleFallbacks: 100,
        fallbacksSubmittedWithin60Seconds: 99,
        verifiedDeliveries7d: 200,
        complaints7d: 3,
        providerCostMilliEuro: 45,
        duplicateCharges: 1,
        negativeBalances: 0,
        unexplainedReconciliationVariances: 0,
        duplicateDeliveries: 0,
        unauthorizedDeliveries: 0
      })
    ).toEqual([
      expect.objectContaining({ code: 'delivery_15m_slo', severity: 'warning' }),
      expect.objectContaining({
        code: 'immediate_submission_slo',
        severity: 'warning'
      }),
      expect.objectContaining({
        code: 'complaint_rate_critical',
        severity: 'critical'
      }),
      expect.objectContaining({ code: 'provider_cost_critical', severity: 'critical' }),
      expect.objectContaining({ code: 'duplicate_charge', severity: 'critical' })
    ])
  })
})
