import { describe, expect, it } from 'vite-plus/test'
import { causeMessage } from './cause-message'
import {
  ImpersonationStateError,
  MembershipRefusedError,
  PlanLimitError,
  UnverifiedEmailError
} from './capability-error'
import { LocalizedError } from './localized-error'
import { uiErrorAdapter } from './ui-error'
import { m } from '@b2b-saas-starter/i18n/messages'

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

  it('translates the session-state refusals server functions throw', () => {
    // Neither used to be a `UiError`, so the browser showed the server's
    // English diagnostic. Both now cross as a code the receiving locale words.
    const impersonation = uiErrorAdapter.toSerializable(
      new ImpersonationStateError('nested')
    )
    expect(causeMessage(uiErrorAdapter.fromSerializable(impersonation), FALLBACK)).toBe(
      m.shell_impersonation_nested()
    )
    const unverified = uiErrorAdapter.toSerializable(new UnverifiedEmailError())
    expect(causeMessage(uiErrorAdapter.fromSerializable(unverified), FALLBACK)).toBe(
      m.shell_unverified_email()
    )
  })

  it('falls back to a discriminant sentence for a reason this build does not know', () => {
    expect(
      causeMessage(
        { code: 'membership_refused', details: { reason: 'invented' } },
        FALLBACK
      )
    ).toBe(m.shell_membership_refused())
    // Inherited object keys are not reasons either.
    expect(
      causeMessage(
        { code: 'membership_refused', details: { reason: 'constructor' } },
        FALLBACK
      )
    ).toBe(m.shell_membership_refused())
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
