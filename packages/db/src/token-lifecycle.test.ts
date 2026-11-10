import { describe, expect, it } from '@effect/vitest'

import {
  isActiveLeafToken,
  isExpiredToken,
  type TokenLifecycle
} from './token-lifecycle.ts'

const now = Date.parse('2026-09-01T12:00:00.000Z')

function lifecycle(overrides?: Partial<TokenLifecycle>): TokenLifecycle {
  return {
    revokedAt: null,
    expiresAt: null,
    replacedByTokenId: null,
    ...overrides
  }
}

describe('api token lifecycle predicates', () => {
  it('treats a fresh row with no expiry as a live leaf', () => {
    expect(isActiveLeafToken(lifecycle(), now)).toBe(true)
  })

  it('keeps an unexpired row with a future expiry live', () => {
    expect(
      isActiveLeafToken(lifecycle({ expiresAt: '2026-09-02T12:00:00.000Z' }), now)
    ).toBe(true)
  })

  it('refuses revoked, rotated, and expired rows as leaves', () => {
    expect(
      isActiveLeafToken(lifecycle({ revokedAt: '2026-08-31T12:00:00.000Z' }), now)
    ).toBe(false)
    expect(isActiveLeafToken(lifecycle({ replacedByTokenId: 'tok_next' }), now)).toBe(
      false
    )
    expect(
      isActiveLeafToken(lifecycle({ expiresAt: '2026-08-31T12:00:00.000Z' }), now)
    ).toBe(false)
  })

  it('reads each lifecycle column through the leaf predicate', () => {
    expect(
      isActiveLeafToken(lifecycle({ revokedAt: '2026-08-31T12:00:00.000Z' }), now)
    ).toBe(false)
    expect(isActiveLeafToken(lifecycle({ replacedByTokenId: 'tok_next' }), now)).toBe(
      false
    )
  })

  it('expires at the expiry instant, keeps the instant before live', () => {
    const expiresAt = '2026-09-01T12:00:00.000Z'
    expect(isExpiredToken(expiresAt, Date.parse('2026-09-01T11:59:59.999Z'))).toBe(
      false
    )
    expect(isExpiredToken(expiresAt, now)).toBe(true)
    expect(isExpiredToken(expiresAt, Date.parse('2026-09-01T12:00:00.001Z'))).toBe(true)
  })

  it('never expires a row without a stored expiry and fails closed on malformed ones', () => {
    expect(isExpiredToken(null, now)).toBe(false)
    expect(isExpiredToken('not-a-timestamp', now)).toBe(true)
  })
})
