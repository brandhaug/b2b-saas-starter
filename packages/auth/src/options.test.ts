import { describe, expect, it } from 'vitest'
import { type AuthConfigInterface, makeAuthOptions } from './index.ts'

// The email-verification gate is decided by the caller (from `ENVIRONMENT`)
// and carried on `AuthConfig`; these tests pin that `makeAuthOptions` forwards
// it to Better Auth instead of hardcoding a stance.
const baseConfig: AuthConfigInterface = {
  // SAFETY: these tests only read the returned options object — `db` is
  // forwarded into `drizzleAdapter`'s closure and no property of it is read.
  // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion, anti-slop(require-safety-comment-for-type-assertion) -- an empty sentinel stands in for the promise client, which the adapter alone would touch
  db: {} as AuthConfigInterface['db'],
  secret: 'test-secret-at-least-32-characters-long',
  baseURL: 'http://localhost:3071',
  trustedOrigins: [],
  emails: {
    sendPasswordReset: () => Promise.resolve(),
    sendEmailVerification: () => Promise.resolve()
  },
  requireEmailVerification: false
}

describe('makeAuthOptions', () => {
  it('forwards requireEmailVerification from the config', () => {
    expect(makeAuthOptions(baseConfig).emailAndPassword).toMatchObject({
      requireEmailVerification: false
    })
    expect(
      makeAuthOptions({ ...baseConfig, requireEmailVerification: true })
        .emailAndPassword
    ).toMatchObject({ requireEmailVerification: true })
  })
})
