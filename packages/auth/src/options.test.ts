import { describe, expect, it } from 'vitest'
import { type AuthConfigInterface, makeAuthOptions } from './index.ts'

// The email-verification gate is decided by the caller (from `ENVIRONMENT`)
// and carried on `AuthConfig`; these tests pin that `makeAuthOptions` forwards
// it to Better Auth instead of hardcoding a stance.
const baseConfig: AuthConfigInterface = {
  // SAFETY: these tests only read the returned options object — `db` is
  // forwarded into `drizzleAdapter`'s closure and no property of it is read.
  // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion -- an empty sentinel stands in for the promise client, which the adapter alone would touch
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

  it('requires verification before two-factor counts as enabled', () => {
    // skipVerificationOnEnable must stay false: without a verified first code,
    // a hijacked session could enroll its own authenticator and lock out the
    // real owner. See the security review in PR history. Better Auth keeps the
    // option on the plugin's `options` bag.
    const options = makeAuthOptions(baseConfig)
    const twoFactor = options.plugins.find(
      (plugin) => 'id' in plugin && plugin.id === 'two-factor'
    )
    // SAFETY: the two-factor plugin is in the array above by construction;
    // this reads the one option this file pins off its `options` bag, which
    // the plugin's declared type omits.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, effect/noAs -- reading an option Better Auth's plugin type does not declare
    const twoFactorOptions = twoFactor as {
      options: { skipVerificationOnEnable: boolean | undefined } | undefined
    }
    expect(twoFactorOptions.options?.skipVerificationOnEnable).toBe(false)
  })

  it('sets a one-hour fresh window for sensitive actions', () => {
    expect(makeAuthOptions(baseConfig).session).toMatchObject({
      freshAge: 60 * 60
    })
  })
})
