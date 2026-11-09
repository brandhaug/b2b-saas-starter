import { describe, expect, it } from 'vite-plus/test'

import {
  blocksResend,
  claimableDeliveryStatuses,
  deliveryClaimLeaseMs,
  deliveryEvidenceRanks,
  deliveryRetryWindow,
  initialDeliveryStatus,
  isClaimableDelivery,
  isSubmissionProof,
  isTerminalDelivery,
  mergeDeliveryEvidence,
  operationalFailureStatus,
  providerEventEvidence,
  recordedOutcomeStatus,
  resendEligibleStatuses,
  terminalDeliveryStatuses,
  unconfirmedDeliveryStatuses
} from './delivery-transitions.ts'
import { emailDeliveryStatuses, emailPurposes } from '@b2b-saas-starter/db/enums'

describe('deliveryEvidenceRanks', () => {
  it('declares a rank for every status in the stored vocabulary', () => {
    expect(Object.keys(deliveryEvidenceRanks).toSorted()).toEqual(
      [...emailDeliveryStatuses].toSorted()
    )
  })

  it('ranks adverse terminal evidence above delivery', () => {
    // A bounce, complaint or suppression can legitimately follow a delivery,
    // so an out-of-order arrival must never lose against it.
    expect(deliveryEvidenceRanks.failed).toBeGreaterThan(
      deliveryEvidenceRanks.delivered
    )
    expect(deliveryEvidenceRanks.suppressed).toBeGreaterThan(
      deliveryEvidenceRanks.delivered
    )
    expect(deliveryEvidenceRanks.delivered).toBeGreaterThan(
      deliveryEvidenceRanks.delayed
    )
    expect(deliveryEvidenceRanks.delayed).toBeGreaterThan(
      deliveryEvidenceRanks.accepted
    )
    expect(deliveryEvidenceRanks.queued).toBe(deliveryEvidenceRanks.ambiguous)
  })
})

describe('mergeDeliveryEvidence', () => {
  it('raises the row to stronger provider evidence', () => {
    expect(
      mergeDeliveryEvidence(
        { status: 'accepted', reason: null },
        providerEventEvidence({ status: 'delivered' })
      )
    ).toEqual({ status: 'delivered', reason: null })
    expect(
      mergeDeliveryEvidence(
        { status: 'queued', reason: null },
        providerEventEvidence({ status: 'delayed' })
      )
    ).toEqual({ status: 'delayed', reason: null })
  })

  it('refuses evidence below the stored rank, whatever order it arrives in', () => {
    expect(
      mergeDeliveryEvidence(
        { status: 'delivered', reason: null },
        providerEventEvidence({ status: 'delayed' })
      )
    ).toBeNull()
    // A delivery receipt arriving after a suppression with a complaint is
    // refused: the complaint sticks.
    expect(
      mergeDeliveryEvidence(
        { status: 'suppressed', reason: 'complaint' },
        providerEventEvidence({ status: 'delivered' })
      )
    ).toBeNull()
  })

  it('refuses same-rank evidence without a stronger adverse reason', () => {
    expect(
      mergeDeliveryEvidence(
        { status: 'failed', reason: 'complaint' },
        providerEventEvidence({ status: 'failed', reason: 'hard_bounce' })
      )
    ).toBeNull()
    expect(
      mergeDeliveryEvidence(
        { status: 'failed', reason: 'complaint' },
        providerEventEvidence({ status: 'failed', reason: 'complaint' })
      )
    ).toBeNull()
  })

  it('hardens a same-rank failure with a stronger adverse reason', () => {
    expect(
      mergeDeliveryEvidence(
        { status: 'failed', reason: 'provider_rejected' },
        providerEventEvidence({ status: 'failed', reason: 'complaint' })
      )
    ).toEqual({ status: 'failed', reason: 'complaint' })
  })

  it('keeps the stronger stored reason when the status rank rises', () => {
    // A suppression after a complaint hardens the status without softening
    // the reason.
    expect(
      mergeDeliveryEvidence(
        { status: 'failed', reason: 'complaint' },
        providerEventEvidence({ status: 'suppressed' })
      )
    ).toEqual({ status: 'suppressed', reason: 'complaint' })
  })

  it('takes the incoming reason when it is the stronger one', () => {
    expect(
      mergeDeliveryEvidence(
        { status: 'delivered', reason: null },
        providerEventEvidence({ status: 'failed', reason: 'hard_bounce' })
      )
    ).toEqual({ status: 'failed', reason: 'hard_bounce' })
  })
})

describe('providerEventEvidence', () => {
  it('backfills the implicit adverse reason of a bare failure or suppression', () => {
    expect(providerEventEvidence({ status: 'failed' })).toEqual({
      status: 'failed',
      reason: 'provider_rejected'
    })
    expect(providerEventEvidence({ status: 'suppressed' })).toEqual({
      status: 'suppressed',
      reason: 'provider_suppressed'
    })
  })

  it('keeps an explicit reason and reads progress as reasonless', () => {
    expect(providerEventEvidence({ status: 'failed', reason: 'hard_bounce' })).toEqual({
      status: 'failed',
      reason: 'hard_bounce'
    })
    expect(providerEventEvidence({ status: 'delivered' })).toEqual({
      status: 'delivered',
      reason: null
    })
  })
})

describe('isSubmissionProof', () => {
  it('marks only delivered and delayed as proof the provider took the message', () => {
    expect(isSubmissionProof('delivered')).toBe(true)
    expect(isSubmissionProof('delayed')).toBe(true)
    // A bounce or a rejection is evidence against submission; backfilling
    // acceptance from it would manufacture proof that never existed.
    expect(isSubmissionProof('failed')).toBe(false)
    expect(isSubmissionProof('suppressed')).toBe(false)
  })
})

describe('isTerminalDelivery', () => {
  it('terminates exactly the settled statuses', () => {
    expect([...terminalDeliveryStatuses].toSorted()).toEqual([
      'delivered',
      'failed',
      'logged',
      'suppressed'
    ])
  })

  it('agrees with the set over the stored vocabulary', () => {
    for (const status of emailDeliveryStatuses) {
      expect(isTerminalDelivery(status, null)).toBe(
        terminalDeliveryStatuses.includes(status)
      )
    }
  })

  it('treats any acceptance marker as terminal evidence', () => {
    expect(isTerminalDelivery('accepted', '2026-11-09T00:00:00Z')).toBe(true)
    expect(isTerminalDelivery('queued', '2026-11-09T00:00:00Z')).toBe(true)
  })
})

describe('claimableDeliveryStatuses', () => {
  it('holds exactly the statuses a retry or completion decision still owes', () => {
    expect([...claimableDeliveryStatuses].toSorted()).toEqual([
      'ambiguous',
      'queued',
      'temporary_failure'
    ])
  })

  it('agrees with the point predicate over the stored vocabulary', () => {
    for (const status of emailDeliveryStatuses) {
      expect(isClaimableDelivery(status)).toBe(
        claimableDeliveryStatuses.includes(status)
      )
    }
  })

  it('contains no terminal status', () => {
    for (const status of claimableDeliveryStatuses) {
      expect(isTerminalDelivery(status, null)).toBe(false)
    }
  })
})

describe('deliveryRetryWindow', () => {
  it('grants notifications a day and digests six hours', () => {
    expect(deliveryRetryWindow('notification')).toBe(24 * 3_600_000)
    expect(deliveryRetryWindow('digest')).toBe(6 * 3_600_000)
  })

  it('grants security credentials no window at all', () => {
    for (const purpose of emailPurposes) {
      if (purpose === 'notification' || purpose === 'digest') {
        continue
      }
      expect(deliveryRetryWindow(purpose)).toBe(0)
    }
  })
})

describe('recordedOutcomeStatus', () => {
  it('downgrades a temporary failure exactly for purposes with no window', () => {
    for (const purpose of emailPurposes) {
      if (purpose === 'notification' || purpose === 'digest') {
        expect(recordedOutcomeStatus(purpose, 'temporary_failure')).toBe(
          'temporary_failure'
        )
      } else {
        expect(recordedOutcomeStatus(purpose, 'temporary_failure')).toBe('failed')
      }
    }
  })

  it('records every other outcome status untouched', () => {
    for (const status of [
      'accepted',
      'ambiguous',
      'failed',
      'logged',
      'suppressed'
    ] as const) {
      expect(recordedOutcomeStatus('recovery', status)).toBe(status)
    }
  })
})

describe('deliveryClaimLeaseMs', () => {
  it('holds one attempt for five minutes', () => {
    expect(deliveryClaimLeaseMs).toBe(5 * 60_000)
  })
})

describe('resend policy sets', () => {
  it('resends exactly the statuses that ended without acceptance', () => {
    expect([...resendEligibleStatuses].toSorted()).toEqual([
      'ambiguous',
      'failed',
      'temporary_failure'
    ])
  })

  it('blocks exactly the adverse reasons, whatever the status', () => {
    for (const reason of [
      'complaint',
      'hard_bounce',
      'provider_rejected',
      'provider_suppressed'
    ] as const) {
      expect(blocksResend(reason)).toBe(true)
    }
    for (const reason of [
      'timeout',
      'transport_unavailable',
      'temporary_failure',
      'retry_window_expired',
      'no_longer_relevant'
    ]) {
      expect(blocksResend(reason)).toBe(false)
    }
    expect(blocksResend(null)).toBe(false)
  })
})

describe('unconfirmedDeliveryStatuses', () => {
  it('holds exactly the statuses without completion evidence', () => {
    expect([...unconfirmedDeliveryStatuses].toSorted()).toEqual([
      'accepted',
      'ambiguous',
      'delayed',
      'queued'
    ])
  })

  it('overlaps no terminal status', () => {
    for (const status of unconfirmedDeliveryStatuses) {
      expect(terminalDeliveryStatuses).not.toContain(status)
    }
  })
})

describe('adapter-written statuses', () => {
  it('births claims queued and settles operational failures terminal', () => {
    expect(initialDeliveryStatus).toBe('queued')
    expect(isClaimableDelivery(initialDeliveryStatus)).toBe(true)
    expect(operationalFailureStatus).toBe('failed')
    expect(isTerminalDelivery(operationalFailureStatus, null)).toBe(true)
  })
})
