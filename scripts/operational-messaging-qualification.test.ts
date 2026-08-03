import { describe, expect, it } from 'vitest'
import {
  evaluateQualificationRun,
  qualificationProfile,
  runDeterministicQualificationHarness,
  scanMessagingEvidence
} from './operational-messaging-qualification.ts'

describe('Operational Messaging qualification harness', () => {
  it('encodes the settled 30-minute load and queue-outage recovery profile', () => {
    expect(qualificationProfile).toMatchObject({
      merchants: 100,
      submissionsPerMerchantPerMinute: 20,
      durationMinutes: 30,
      totalExpectedSubmissions: 60_000,
      queueOutageMinutes: 15,
      recoveryScanMinutes: 5,
      maximumDrainMinutes: 15
    })
  })

  it('drives a deterministic 60,000-intent load and failure-injection model', () => {
    expect(evaluateQualificationRun(runDeterministicQualificationHarness())).toEqual({
      state: 'passed',
      blockers: []
    })
    expect(
      evaluateQualificationRun(
        runDeterministicQualificationHarness({
          loseIntent: true,
          duplicateSubmission: true,
          failQueueRecovery: true,
          breakEmail: true
        })
      ).blockers
    ).toEqual(
      expect.arrayContaining([
        'lost_or_unsubmitted_intents',
        'platform_duplicate_submission',
        'queue_outage_not_recovered',
        'email_isolation_failed'
      ])
    )
  })

  it('passes only lossless, duplicate-free, financially exact runs within latency gates', () => {
    expect(
      evaluateQualificationRun({
        produced: 60_000,
        submitted: 60_000,
        terminal: 60_000,
        firstSubmissionWithin60Seconds: 59_500,
        platformDuplicateSubmissions: 0,
        duplicateCharges: 0,
        ledgerVarianceMilliEuro: 0,
        queueOutageRecovered: true,
        drainMinutes: 12,
        bookingSucceeded: true,
        emailSucceeded: true
      })
    ).toEqual({ state: 'passed', blockers: [] })

    expect(
      evaluateQualificationRun({
        produced: 60_000,
        submitted: 59_999,
        terminal: 59_999,
        firstSubmissionWithin60Seconds: 59_500,
        platformDuplicateSubmissions: 1,
        duplicateCharges: 1,
        ledgerVarianceMilliEuro: 1,
        queueOutageRecovered: false,
        drainMinutes: 16,
        bookingSucceeded: true,
        emailSucceeded: false
      }).blockers
    ).toEqual([
      'lost_or_unsubmitted_intents',
      'nonterminal_intents',
      'platform_duplicate_submission',
      'duplicate_merchant_charge',
      'ledger_variance',
      'queue_outage_not_recovered',
      'queue_drain_exceeded_15_minutes',
      'email_isolation_failed'
    ])
  })

  it('rejects unmasked phones, bearer credentials, and assigned secret values', () => {
    expect(
      scanMessagingEvidence(
        'recipient=+40722123456 Authorization: Bearer abcdefghijklmnop SMSO_API_KEY=live-secret'
      )
    ).toEqual(['unmasked_romanian_phone', 'bearer_credential', 'assigned_secret_value'])
    expect(
      scanMessagingEvidence(
        'recipient=+40•••••••456 SMSO_API_KEY=<redacted> traceId=trc_safe'
      )
    ).toEqual([])
  })
})
