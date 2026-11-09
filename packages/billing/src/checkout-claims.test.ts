import { describe, expect, it } from 'vite-plus/test'

import {
  checkoutClaimEventFromSessionStatus,
  isOpenCheckoutClaim,
  nextCheckoutClaimStatus,
  openCheckoutClaimStatuses
} from './checkout-claims.ts'
import { billingCheckoutStatuses } from '@b2b-saas-starter/db/enums'

describe('nextCheckoutClaimStatus', () => {
  it('advances a pending claim to created when the provider session exists', () => {
    expect(
      nextCheckoutClaimStatus('pending', { kind: 'provider_session_created' })
    ).toBe('created')
  })

  it('completes or expires an open claim from provider evidence', () => {
    expect(
      nextCheckoutClaimStatus('pending', { kind: 'provider_session_completed' })
    ).toBe('completed')
    expect(
      nextCheckoutClaimStatus('created', { kind: 'provider_session_expired' })
    ).toBe('expired')
  })

  it('expires an open claim when the provider verifiably lacks the resource', () => {
    expect(
      nextCheckoutClaimStatus('created', { kind: 'provider_absence_verified' })
    ).toBe('expired')
    expect(
      nextCheckoutClaimStatus('pending', { kind: 'provider_absence_verified' })
    ).toBe('expired')
  })

  it('refuses transitions out of terminal statuses', () => {
    for (const status of ['completed', 'expired'] as const) {
      expect(
        nextCheckoutClaimStatus(status, { kind: 'provider_session_created' })
      ).toBeNull()
      expect(
        nextCheckoutClaimStatus(status, { kind: 'provider_session_completed' })
      ).toBeNull()
      expect(
        nextCheckoutClaimStatus(status, { kind: 'provider_absence_verified' })
      ).toBeNull()
    }
  })

  it('expires a pending claim whose recovered provider session already expired', () => {
    expect(
      nextCheckoutClaimStatus('pending', { kind: 'provider_session_expired' })
    ).toBe('expired')
  })

  it('treats only pending and created as open', () => {
    expect([...openCheckoutClaimStatuses]).toEqual(['pending', 'created'])
    for (const status of billingCheckoutStatuses) {
      expect(isOpenCheckoutClaim(status)).toBe(
        status === 'pending' || status === 'created'
      )
    }
  })
})

describe('checkoutClaimEventFromSessionStatus', () => {
  it('maps the three provider session states to claim events', () => {
    expect(checkoutClaimEventFromSessionStatus('open')).toEqual({
      kind: 'provider_session_created'
    })
    expect(checkoutClaimEventFromSessionStatus('complete')).toEqual({
      kind: 'provider_session_completed'
    })
    expect(checkoutClaimEventFromSessionStatus('expired')).toEqual({
      kind: 'provider_session_expired'
    })
  })

  it('refuses session states outside the recoverable vocabulary', () => {
    expect(checkoutClaimEventFromSessionStatus('processing')).toBeNull()
  })
})
