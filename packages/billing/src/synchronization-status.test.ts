import { describe, expect, it } from 'vite-plus/test'

import {
  nextSynchronizationStatus,
  unresolvedSynchronizationStatuses
} from './synchronization-status.ts'
import { billingSynchronizationStatuses } from '@b2b-saas-starter/db/enums'

describe('nextSynchronizationStatus', () => {
  it('marks a verified commit with aligned seats current', () => {
    expect(
      nextSynchronizationStatus({ kind: 'commit', verified: true, seatsAligned: true })
    ).toBe('current')
  })

  it('keeps an unverified commit pending', () => {
    expect(
      nextSynchronizationStatus({ kind: 'commit', verified: false, seatsAligned: true })
    ).toBe('pending')
  })

  it('keeps a commit with seat drift pending even when verified', () => {
    expect(
      nextSynchronizationStatus({ kind: 'commit', verified: true, seatsAligned: false })
    ).toBe('pending')
  })

  it('classifies a plain failure delayed and a conflict conflict', () => {
    expect(nextSynchronizationStatus({ kind: 'failure', conflict: false })).toBe(
      'delayed'
    )
    expect(nextSynchronizationStatus({ kind: 'failure', conflict: true })).toBe(
      'conflict'
    )
  })

  it('marks an opened checkout claim pending', () => {
    expect(nextSynchronizationStatus({ kind: 'checkout_claim_opened' })).toBe('pending')
  })
})

describe('unresolvedSynchronizationStatuses', () => {
  it('is every stored status except current', () => {
    expect([...unresolvedSynchronizationStatuses].toSorted()).toEqual(
      [...billingSynchronizationStatuses]
        .filter((status) => status !== 'current')
        .toSorted()
    )
  })
})
