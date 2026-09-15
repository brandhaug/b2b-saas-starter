import { describe, expect, it, vi } from 'vite-plus/test'

type SessionForVerification = {
  readonly user: {
    readonly emailVerified: boolean
    readonly id: string
    readonly email: string
  }
}
type SessionState = { value: SessionForVerification | null }

const sessionState = vi.hoisted((): SessionState => ({ value: null }))

vi.mock('./auth', () => ({
  readOptionalSession: () => Promise.resolve(sessionState.value)
}))

import { readEmailVerificationStatusHandler } from './email-verification.effects'

describe('readEmailVerificationStatusHandler', () => {
  it('returns only the verified bit from the current session', async () => {
    sessionState.value = {
      user: {
        emailVerified: true,
        id: 'usr_private',
        email: 'private@example.test'
      }
    }

    expect(await readEmailVerificationStatusHandler()).toBe(true)
  })

  it('returns false without a session or with an unverified session', async () => {
    sessionState.value = null
    expect(await readEmailVerificationStatusHandler()).toBe(false)

    sessionState.value = {
      user: {
        emailVerified: false,
        id: 'usr_private',
        email: 'private@example.test'
      }
    }
    expect(await readEmailVerificationStatusHandler()).toBe(false)
  })
})
