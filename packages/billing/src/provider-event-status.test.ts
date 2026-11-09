import { describe, expect, it } from 'vite-plus/test'

import {
  nextProviderEventStatus,
  settledBySynchronization
} from './provider-event-status.ts'
import { billingProviderEventStatuses } from '@b2b-saas-starter/db/enums'

describe('nextProviderEventStatus', () => {
  it('keeps an event processing while an attempt runs', () => {
    expect(nextProviderEventStatus('processing', { kind: 'attempt' })).toBe(
      'processing'
    )
    expect(nextProviderEventStatus('failed', { kind: 'attempt' })).toBe('processing')
  })

  it('records failures and conflicts from a processing attempt', () => {
    expect(
      nextProviderEventStatus('processing', { kind: 'failure', conflict: false })
    ).toBe('failed')
    expect(
      nextProviderEventStatus('processing', { kind: 'failure', conflict: true })
    ).toBe('conflict')
  })

  it('completes an event its own successful retry commits', () => {
    expect(nextProviderEventStatus('processing', { kind: 'commit' })).toBe('completed')
    expect(nextProviderEventStatus('failed', { kind: 'commit' })).toBe('completed')
    expect(nextProviderEventStatus('conflict', { kind: 'commit' })).toBe('completed')
  })

  it('refuses every event against a completed row', () => {
    expect(nextProviderEventStatus('completed', { kind: 'attempt' })).toBeNull()
    expect(
      nextProviderEventStatus('completed', { kind: 'failure', conflict: true })
    ).toBeNull()
    expect(nextProviderEventStatus('completed', { kind: 'commit' })).toBeNull()
  })

  it('settles exactly the statuses a later unrelated commit may complete', () => {
    // `conflict` is operator evidence and must survive an unrelated success;
    // only its own retry (above) may complete it.
    expect([...settledBySynchronization]).toEqual(['processing', 'failed'])
  })

  it('covers the stored vocabulary', () => {
    // Compile-time exhaustiveness plus a runtime guard for the test itself.
    expect(billingProviderEventStatuses).toContain('conflict')
  })
})
