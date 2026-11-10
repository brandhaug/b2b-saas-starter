import { describe, expect, it } from 'vite-plus/test'
import { type Enrollment } from '@/components/auth/two-factor-flows'
import { setupTransition, type SetupState } from './two-factor-setup-state'

const enrollment: Enrollment = {
  totpURI:
    'otpauth://totp/B2B%20SaaS%20Starter:demo%40starter.local?secret=JBSWY3DPEHPK3PXP',
  backupCodes: ['abcd-1234', 'efgh-5678']
}

const idle: SetupState = { step: 'idle', message: null }

describe('setupTransition', () => {
  it('clears a completed message when a flow restarts from idle', () => {
    const done: SetupState = { step: 'idle', message: 'Two-factor is now on.' }
    expect(setupTransition(done, { type: 'start' })).toEqual(idle)
  })

  it('keeps an in-progress enrollment when start repeats', () => {
    const enrolling: SetupState = { step: 'enrolling', enrollment }
    expect(setupTransition(enrolling, { type: 'start' })).toBe(enrolling)
  })

  it('enters the one-time reveal with the enrollment payload', () => {
    expect(setupTransition(idle, { type: 'enrolled', enrollment })).toEqual({
      step: 'enrolling',
      enrollment
    })
  })

  it('returns to idle carrying the completion message', () => {
    const enrolling: SetupState = { step: 'enrolling', enrollment }
    expect(
      setupTransition(enrolling, { type: 'completed', message: 'Now on.' })
    ).toEqual({ step: 'idle', message: 'Now on.' })
  })

  it('replaces an older completion message in place', () => {
    const done: SetupState = { step: 'idle', message: 'Turned off.' }
    expect(setupTransition(done, { type: 'completed', message: 'Now on.' })).toEqual({
      step: 'idle',
      message: 'Now on.'
    })
  })
})
