import { describe, expect, it } from 'vite-plus/test'
import { causeMessage } from './cause-message'
import { MembershipRefusedError, PlanLimitError } from './capability-error'
import { LocalizedError } from './localized-error'
import { uiErrorAdapter } from './ui-error'

const FALLBACK = 'Failed to send the invitation'

describe('causeMessage', () => {
  it('keeps internal errors out of the UI', () => {
    expect(causeMessage(new Error('D1 connection secret'), FALLBACK)).toBe(FALLBACK)
    expect(causeMessage(new TypeError('fetch failed'), FALLBACK)).toBe(FALLBACK)
    expect(causeMessage({ name: 'Error', message: 'private details' }, FALLBACK)).toBe(
      FALLBACK
    )
  })

  it('preserves trusted local copy while rejecting a forged serialized error', () => {
    expect(
      causeMessage(new LocalizedError('That password is incorrect.'), FALLBACK)
    ).toBe('That password is incorrect.')
    expect(
      causeMessage({ name: 'LocalizedError', message: 'private details' }, FALLBACK)
    ).toBe(FALLBACK)
  })

  it('translates structured errors after serialization', () => {
    const serialized = uiErrorAdapter.toSerializable(
      new MembershipRefusedError('sole_owner')
    )
    expect(serialized).not.toHaveProperty('message')
    expect(serialized).not.toHaveProperty('stack')
    expect(
      causeMessage(uiErrorAdapter.fromSerializable(serialized), FALLBACK)
    ).toContain('transfer ownership')
  })

  it('preserves safe values for an actionable plan error', () => {
    const serialized = uiErrorAdapter.toSerializable(new PlanLimitError('starter', 5))
    expect(
      causeMessage(uiErrorAdapter.fromSerializable(serialized), FALLBACK)
    ).toContain('at most 5')
  })

  it('rejects unknown codes and malformed details', () => {
    expect(causeMessage('boom', FALLBACK)).toBe(FALLBACK)
    expect(
      causeMessage({ code: 'plan_limit', details: { limit: 'private' } }, FALLBACK)
    ).toBe(FALLBACK)
    expect(causeMessage({ code: 'unknown' }, FALLBACK)).toBe(FALLBACK)
    expect(causeMessage(undefined, FALLBACK)).toBe(FALLBACK)
  })
})
